#!/usr/bin/env python3
"""通过搜索引擎发现维修手册 PDF 直链，校验后写入 datasets/pdf/。

用法（在 backend 目录下）::

    python scripts/download_repair_manual_pdfs.py --count 3 --query "摩托车发动机 维修手册"

国内网络若搜索或下载失败，可设置代理::

    set HTTP_PROXY=http://127.0.0.1:7890
    set HTTPS_PROXY=http://127.0.0.1:7890

切换 Google Custom Search（需 GOOGLE_API_KEY 与 GOOGLE_CSE_ID）::

    python scripts/download_repair_manual_pdfs.py --provider google --count 2 --query "工业机器人 维修手册"

版权提示：仅用于演示/研究演示，请遵守各站点许可；本脚本不绕过登录墙或付费墙。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse

import httpx
from pypdf import PdfReader

DEFAULT_KEYWORDS = ("维修", "手册", "拆卸", "安装", "检查", "故障", "保养", "检修", "规程")
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; DachuangRepairManualBot/1.0; +https://github.com/local)"
)
CHINESE_URL_HINTS = (
    "zh-cn",
    "zh-hk",
    "zh-tw",
    "zh_cn",
    "chinese",
    "中文",
    "简体",
    "繁体",
    ".cn/",
    ".com.cn",
    "维修手册",
    "service-manual-zh",
)
ENGLISH_URL_HINTS = (
    "-en.pdf",
    "_en.pdf",
    "/en/",
    "/en-us/",
    "/en_us/",
    "english",
    "owner-manual",
    "owners-manual",
    "user-manual",
)
ENGLISH_DOMAIN_HINTS = (
    ".gov",
    "nissanusa.com",
    "hillrom.com",
    "wsdot.wa.gov",
    "laserexpressinc.com",
    "powersports.honda.com",
)
URL_BLOCKLIST = (
    "pan.baidu.com",
    "wenku.baidu.com",
    "doc88.com",
    "docin.com",
    "ishare.iask.sina.com.cn",
    "login",
    "signin",
    "captcha",
)
CJK_PATTERN = re.compile(r"[\u4e00-\u9fff]")
SAFE_FILENAME_PATTERN = re.compile(r"[^\w\u4e00-\u9fff\-]+", re.UNICODE)
MANUAL_SUFFIX = "维修手册"


@dataclass
class SearchHit:
    url: str
    title: str
    query: str


@dataclass
class RunStats:
    attempted: int = 0
    saved: int = 0
    rejected: dict[str, int] = field(default_factory=dict)

    def reject(self, reason: str) -> None:
        self.rejected[reason] = self.rejected.get(reason, 0) + 1


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    return f"{parsed.scheme}://{host}{path}"


def expand_queries(raw_queries: list[str]) -> list[str]:
    expanded: list[str] = []
    for item in raw_queries:
        for part in item.split(","):
            part = part.strip()
            if part:
                expanded.append(part)
    return expanded


def build_search_query(user_query: str, *, china_bias: bool) -> str:
    q = user_query.strip()
    lower = q.lower()
    extras: list[str] = []
    if "filetype:pdf" not in lower:
        extras.append("filetype:pdf")
    if "维修手册" not in q:
        extras.append("维修手册")
    if "中文" not in q and "chinese" not in lower:
        extras.append("中文")
    if china_bias and "site:" not in lower:
        extras.append("site:.cn OR site:.com.cn")
    if "pdf" not in lower and not q.lower().endswith(".pdf"):
        extras.append("PDF")
    if extras:
        return f"{q} {' '.join(extras)}"
    return q


def _combined_hit_text(hit: SearchHit) -> str:
    return f"{hit.url} {hit.title}".lower()


def chinese_hint_score(hit: SearchHit) -> int:
    text = _combined_hit_text(hit)
    score = len(CJK_PATTERN.findall(hit.title))
    for hint in CHINESE_URL_HINTS:
        if hint.lower() in text:
            score += 2
    return score


def english_hint_score(hit: SearchHit) -> int:
    text = _combined_hit_text(hit)
    score = 0
    for hint in ENGLISH_URL_HINTS:
        if hint in text:
            score += 2
    host = (urlparse(hit.url).hostname or "").lower()
    for hint in ENGLISH_DOMAIN_HINTS:
        if hint in host:
            score += 1
    if re.search(r"[-_/]en(?:[-_./]|\.pdf)", text):
        score += 3
    return score


def prefilter_skip_reason(hit: SearchHit) -> str | None:
    """下载前跳过明显英文或非目标 PDF，减少无效流量。"""
    zh = chinese_hint_score(hit)
    en = english_hint_score(hit)
    if en >= 3 and zh == 0:
        return "skipped_prefilter_english"
    if en >= 2 and zh <= 1 and "维修" not in hit.title and "手册" not in hit.title:
        return "skipped_prefilter_english"
    return None


def rank_hits(hits: list[SearchHit]) -> list[SearchHit]:
    return sorted(
        hits,
        key=lambda h: (chinese_hint_score(h) - english_hint_score(h), chinese_hint_score(h)),
        reverse=True,
    )


def is_pdf_candidate_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host_path = f"{parsed.netloc}{parsed.path}".lower()
    if any(block in host_path for block in URL_BLOCKLIST):
        return False
    if "google.com/goto" in host_path:
        return True
    if url.lower().endswith(".pdf"):
        return True
    if ".pdf" in parsed.path.lower():
        return True
    if "pdf" in (parsed.query or "").lower():
        return True
    return False


def _import_ddgs():
    try:
        from ddgs import DDGS

        return DDGS
    except ImportError:
        try:
            from duckduckgo_search import DDGS

            return DDGS
        except ImportError as e:
            print("请先安装：pip install ddgs", file=sys.stderr)
            raise SystemExit(1) from e


def search_duckduckgo(query: str, max_results: int, *, china_bias: bool, region: str) -> list[SearchHit]:
    DDGS = _import_ddgs()

    search_q = build_search_query(query, china_bias=china_bias)
    hits: list[SearchHit] = []
    with DDGS() as ddgs:
        kwargs: dict = {"max_results": max_results}
        if region:
            kwargs["region"] = region
        try:
            rows = ddgs.text(search_q, **kwargs)
        except TypeError:
            rows = ddgs.text(search_q, max_results=max_results)
        for row in rows:
            url = (row.get("href") or row.get("url") or "").strip()
            if not url or not is_pdf_candidate_url(url):
                continue
            title = (row.get("title") or row.get("body") or "").strip()
            hits.append(SearchHit(url=url, title=title, query=query))
    return rank_hits(hits)


def search_google_cse(query: str, max_results: int, *, china_bias: bool) -> list[SearchHit]:
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    cse_id = os.environ.get("GOOGLE_CSE_ID", "").strip()
    if not api_key or not cse_id:
        print(
            "使用 --provider google 需要设置环境变量 GOOGLE_API_KEY 与 GOOGLE_CSE_ID。",
            file=sys.stderr,
        )
        raise SystemExit(1)

    search_q = build_search_query(query, china_bias=china_bias)
    hits: list[SearchHit] = []
    start = 1
    while len(hits) < max_results and start <= 91:
        batch = min(10, max_results - len(hits))
        params = {
            "key": api_key,
            "cx": cse_id,
            "q": search_q,
            "start": start,
            "num": batch,
            "fileType": "pdf",
        }
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(
                "https://www.googleapis.com/customsearch/v1",
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
        for item in data.get("items") or []:
            url = (item.get("link") or "").strip()
            if not url or not is_pdf_candidate_url(url):
                continue
            title = (item.get("title") or "").strip()
            hits.append(SearchHit(url=url, title=title, query=query))
        if not data.get("items"):
            break
        start += 10
    return rank_hits(hits)


def search_hits(
    provider: str,
    query: str,
    max_results: int,
    *,
    china_bias: bool,
    region: str,
) -> list[SearchHit]:
    if provider == "google":
        return search_google_cse(query, max_results, china_bias=china_bias)
    if provider == "duckduckgo":
        return search_duckduckgo(query, max_results, china_bias=china_bias, region=region)
    raise ValueError(f"未知搜索提供方: {provider}")


def load_manifest(path: Path) -> tuple[set[str], set[str]]:
    urls: set[str] = set()
    hashes: set[str] = set()
    if not path.exists():
        return urls, hashes
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("url"):
                urls.add(normalize_url(rec["url"]))
            if rec.get("sha256"):
                hashes.add(rec["sha256"])
    return urls, hashes


def append_manifest(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def chinese_ratio(text: str) -> float:
    if not text:
        return 0.0
    cjk = len(CJK_PATTERN.findall(text))
    return cjk / max(len(text), 1)


def count_keyword_hits(text: str, keywords: Iterable[str]) -> int:
    return sum(1 for kw in keywords if kw and kw in text)


def sanitize_filename_base(name: str) -> str:
    base = Path(name).stem if name.lower().endswith(".pdf") else name
    base = unquote(base)
    base = SAFE_FILENAME_PATTERN.sub("_", base.strip())
    base = re.sub(r"_+", "_", base).strip("_")
    return base or "维修手册"


def ensure_manual_filename(base: str) -> str:
    if MANUAL_SUFFIX in base:
        return f"{base}.pdf"
    return f"{base}{MANUAL_SUFFIX}.pdf"


def pick_filename(
    *,
    content_disposition: str | None,
    url: str,
    title: str,
    out_dir: Path,
) -> str:
    name = ""
    if content_disposition:
        match = re.search(r"filename\*=UTF-8''([^;]+)", content_disposition, re.I)
        if match:
            name = unquote(match.group(1))
        else:
            match = re.search(r'filename="?([^";]+)"?', content_disposition, re.I)
            if match:
                name = match.group(1)
    if not name:
        path_name = Path(urlparse(url).path).name
        if path_name.lower().endswith(".pdf"):
            name = path_name
    if not name and title:
        name = sanitize_filename_base(title) + ".pdf"
    if not name:
        name = "维修手册.pdf"
    final = ensure_manual_filename(sanitize_filename_base(name))
    candidate = out_dir / final
    if not candidate.exists():
        return final
    stem = Path(final).stem
    idx = 2
    while True:
        alt = f"{stem}_{idx}.pdf"
        if not (out_dir / alt).exists():
            return alt
        idx += 1


def extract_sample_text(pdf_path: Path, max_pages: int = 10) -> tuple[str, int]:
    """抽取多页文本；封面常空白，故会抽样前若干页直至字数足够。"""
    reader = PdfReader(str(pdf_path))
    page_count = len(reader.pages)
    if page_count == 0:
        return "", 0
    indices: list[int] = []
    for i in range(min(max_pages, page_count)):
        if i not in indices:
            indices.append(i)
    if page_count > max_pages:
        mid = page_count // 2
        if mid not in indices:
            indices.append(mid)
    chunks: list[str] = []
    min_chars = 400
    for idx in sorted(indices):
        chunks.append(reader.pages[idx].extract_text() or "")
        if len("".join(chunks)) >= min_chars:
            break
    return "\n".join(chunks), page_count


def validate_pdf(
    pdf_path: Path,
    *,
    min_bytes: int,
    min_chinese_ratio: float,
    keywords: tuple[str, ...],
    min_keyword_hits: int,
    min_pages: int,
) -> str | None:
    data = pdf_path.read_bytes()
    if not data.startswith(b"%PDF"):
        return "rejected_not_pdf"
    if len(data) < min_bytes:
        return "rejected_too_small"
    try:
        text, page_count = extract_sample_text(pdf_path)
    except Exception:
        return "rejected_unreadable"
    if page_count < min_pages:
        return "rejected_too_few_pages"
    if chinese_ratio(text) < min_chinese_ratio:
        return "rejected_low_chinese"
    if count_keyword_hits(text, keywords) < min_keyword_hits:
        return "rejected_low_keywords"
    if not text.strip():
        return "rejected_no_text"
    return None


def download_to_temp(
    client: httpx.Client,
    url: str,
    temp_path: Path,
) -> tuple[str | None, str | None]:
    """Returns (content_disposition, error_reason)."""
    last_error = "rejected_download_failed"
    for attempt in range(2):
        try:
            with client.stream("GET", url, follow_redirects=True) as resp:
                resp.raise_for_status()
                content_type = (resp.headers.get("content-type") or "").lower()
                disposition = resp.headers.get("content-disposition")
                first_chunk = b""
                with temp_path.open("wb") as out:
                    for chunk in resp.iter_bytes():
                        if not first_chunk and chunk:
                            first_chunk = chunk[:8]
                        out.write(chunk)
                if b"%PDF" not in first_chunk and "pdf" not in content_type:
                    temp_path.unlink(missing_ok=True)
                    return None, "rejected_not_pdf"
                return disposition, None
        except httpx.HTTPError:
            last_error = "rejected_download_failed"
            temp_path.unlink(missing_ok=True)
            if attempt == 0:
                time.sleep(1.5)
    return None, last_error


def collect_candidates(
    provider: str,
    queries: list[str],
    search_results: int,
    seen_urls: set[str],
    *,
    china_bias: bool,
    region: str,
) -> list[SearchHit]:
    candidates: list[SearchHit] = []
    for query in queries:
        try:
            hits = search_hits(
                provider,
                query,
                search_results,
                china_bias=china_bias,
                region=region,
            )
        except Exception as exc:
            print(f"[搜索失败] query={query!r}: {exc}", file=sys.stderr)
            continue
        for hit in hits:
            key = normalize_url(hit.url)
            if key in seen_urls:
                continue
            seen_urls.add(key)
            candidates.append(hit)
    return rank_hits(candidates)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="搜索并下载中文维修手册 PDF 到 datasets/pdf/"
    )
    parser.add_argument("--count", type=int, default=5, help="目标成功落盘份数")
    parser.add_argument(
        "--query",
        action="append",
        default=[],
        help="搜索关键词，可多次传入；单条内可用逗号分隔多个主题",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="输出目录（默认仓库 datasets/pdf）",
    )
    parser.add_argument(
        "--search-results",
        type=int,
        default=30,
        help="每条 query 向搜索引擎获取的结果数上限",
    )
    parser.add_argument("--min-bytes", type=int, default=100_000)
    parser.add_argument("--min-chinese-ratio", type=float, default=0.15)
    parser.add_argument(
        "--keywords",
        default=",".join(DEFAULT_KEYWORDS),
        help="逗号分隔；文本中至少命中其中若干个",
    )
    parser.add_argument(
        "--min-keyword-hits",
        type=int,
        default=2,
        help="关键词最少命中个数",
    )
    parser.add_argument("--min-pages", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true", help="只列出候选 URL")
    parser.add_argument(
        "--skip-existing",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="跳过 manifest 中已有 URL 或 sha256",
    )
    parser.add_argument(
        "--provider",
        choices=("duckduckgo", "google"),
        default="duckduckgo",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="manifest 路径（默认 out-dir/download_manifest.jsonl）",
    )
    parser.add_argument(
        "--china-bias",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="搜索时偏向 .cn 站点并优先中文 URL（默认开启）",
    )
    parser.add_argument(
        "--region",
        default="cn-zh",
        help="DuckDuckGo 区域代码（默认 cn-zh；不支持时自动忽略）",
    )
    parser.add_argument(
        "--prefilter",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="下载前跳过明显英文 PDF（默认开启）",
    )
    args = parser.parse_args()

    queries = expand_queries(args.query) if args.query else [
        "摩托车发动机 维修手册",
        "工业机器人 维修手册",
        "数控机床 维修手册",
    ]
    keywords = tuple(k.strip() for k in args.keywords.split(",") if k.strip())
    root = _repo_root()
    out_dir = (args.out_dir or (root / "datasets" / "pdf")).resolve()
    manifest_path = (args.manifest or (out_dir / "download_manifest.jsonl")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    known_urls, known_hashes = load_manifest(manifest_path)
    seen_urls = set(known_urls)
    stats = RunStats()

    candidates = collect_candidates(
        args.provider,
        queries,
        args.search_results,
        seen_urls,
        china_bias=args.china_bias,
        region=args.region,
    )
    if not candidates:
        print("未找到任何 PDF 候选链接，请调整 --query 或检查网络/代理。", file=sys.stderr)
        raise SystemExit(1)

    if args.dry_run:
        for hit in candidates:
            skip = prefilter_skip_reason(hit) if args.prefilter else None
            tag = f" [将跳过:{skip}]" if skip else ""
            print(
                f"{hit.url}\t{hit.title}\t"
                f"(query={hit.query}, zh={chinese_hint_score(hit)}, en={english_hint_score(hit)}){tag}"
            )
        print(f"共 {len(candidates)} 条候选 URL（dry-run，未下载）。")
        return

    saved = 0
    target = max(args.count, 0)
    headers = {"User-Agent": DEFAULT_USER_AGENT}
    timeout = httpx.Timeout(15.0, read=120.0)

    with httpx.Client(headers=headers, timeout=timeout) as client:
        for hit in candidates:
            if saved >= target:
                break
            norm = normalize_url(hit.url)
            if args.skip_existing and norm in known_urls:
                print(f"[跳过] 已在 manifest: {hit.url}")
                continue

            if args.prefilter:
                skip = prefilter_skip_reason(hit)
                if skip:
                    append_manifest(
                        manifest_path,
                        {
                            "url": hit.url,
                            "query": hit.query,
                            "downloaded_at": _utc_now_iso(),
                            "status": skip,
                        },
                    )
                    known_urls.add(norm)
                    print(f"[预筛跳过] {hit.url} ({skip})")
                    continue

            stats.attempted += 1
            temp_path = out_dir / f".download_{saved}_{int(time.time())}.part"
            print(f"[下载] {hit.url}")
            disposition, err = download_to_temp(client, hit.url, temp_path)
            if err:
                stats.reject(err)
                append_manifest(
                    manifest_path,
                    {
                        "url": hit.url,
                        "query": hit.query,
                        "downloaded_at": _utc_now_iso(),
                        "status": err,
                    },
                )
                print(f"  -> 失败: {err}")
                continue

            reject_reason = validate_pdf(
                temp_path,
                min_bytes=args.min_bytes,
                min_chinese_ratio=args.min_chinese_ratio,
                keywords=keywords,
                min_keyword_hits=args.min_keyword_hits,
                min_pages=args.min_pages,
            )
            file_hash = sha256_file(temp_path)
            if args.skip_existing and file_hash in known_hashes:
                temp_path.unlink(missing_ok=True)
                stats.reject("rejected_duplicate_hash")
                append_manifest(
                    manifest_path,
                    {
                        "url": hit.url,
                        "sha256": file_hash,
                        "query": hit.query,
                        "downloaded_at": _utc_now_iso(),
                        "status": "rejected_duplicate_hash",
                    },
                )
                print("  -> 跳过: 与已有文件内容重复")
                continue

            if reject_reason:
                stats.reject(reject_reason)
                temp_path.unlink(missing_ok=True)
                append_manifest(
                    manifest_path,
                    {
                        "url": hit.url,
                        "sha256": file_hash,
                        "query": hit.query,
                        "downloaded_at": _utc_now_iso(),
                        "status": reject_reason,
                    },
                )
                print(f"  -> 拒绝: {reject_reason}")
                continue

            filename = pick_filename(
                content_disposition=disposition,
                url=hit.url,
                title=hit.title,
                out_dir=out_dir,
            )
            dest = out_dir / filename
            temp_path.replace(dest)
            append_manifest(
                manifest_path,
                {
                    "url": hit.url,
                    "sha256": file_hash,
                    "filename": filename,
                    "query": hit.query,
                    "downloaded_at": _utc_now_iso(),
                    "status": "saved",
                },
            )
            known_urls.add(norm)
            known_hashes.add(file_hash)
            saved += 1
            stats.saved += 1
            print(f"  -> 已保存: {dest}")

    print(
        f"\n完成: 成功 {stats.saved}/{target}，尝试下载 {stats.attempted} 次。"
    )
    if stats.rejected:
        print("拒绝统计:", ", ".join(f"{k}={v}" for k, v in sorted(stats.rejected.items())))

    if stats.saved < target:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
