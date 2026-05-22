# 维修手册 PDF（datasets/pdf）

本目录存放可导入知识库的**检修手册 PDF**，与 `datasets/knowledge/`（文本语料）并列使用。
公开 GitHub 仓库默认只保留本 README：`*.pdf` 与 `download_manifest.jsonl` 体积较大且需单独确认版权，已在 `.gitignore` 中排除。

## 目录说明

| 文件 | 说明 |
| ---- | ---- |
| `*.pdf` | 维修/检修类手册，建议命名为 `{设备或主题}维修手册.pdf` |
| `download_manifest.jsonl` | 由下载脚本生成，记录 URL、sha256、状态，用于去重 |

## 批量下载新手册

在 `backend/` 下安装依赖并运行：

```bash
pip install ddgs
# 或：pip install -r requirements.txt

python scripts/download_repair_manual_pdfs.py --count 3 --query "摩托车发动机 维修手册"
python scripts/download_repair_manual_pdfs.py --count 5 --query "工业机器人,台式机 维修手册"
```

**提示**：避免只用过于宽泛的 `--query "中文维修手册"`，容易搜到日产/联想等英文官网 PDF。请写清设备类型（如「摩托车发动机」「夏普打印机」）。脚本默认开启 `--china-bias` 与 `--prefilter`，会优先 `.cn` 结果并跳过 URL/标题明显为英文的链接。

常用参数：

| 参数 | 说明 |
| ---- | ---- |
| `--count` | 目标成功落盘份数（默认 5） |
| `--query` | 搜索主题，可重复或逗号分隔 |
| `--dry-run` | 只列出候选 PDF URL，不下载 |
| `--search-results` | 每条 query 的搜索结果上限（默认 30） |
| `--provider` | `duckduckgo`（默认）或 `google` |

### 网络与代理

国内访问 DuckDuckGo 或部分 PDF 源可能不稳定，可设置系统代理后再运行：

**Clash 端口 10808 是 SOCKS5**，不要写成 `http://127.0.0.1:10808`：

```powershell
# PowerShell（推荐直接传参）
python scripts/download_repair_manual_pdfs.py --proxy 10808 --dry-run --query "维修手册"

# 或设置环境变量
$env:DDGS_PROXY="socks5://127.0.0.1:10808"
python scripts/download_repair_manual_pdfs.py --count 2 --query "摩托车发动机 维修手册"
```

HTTP 代理（如 7890）示例：

```bash
set DDGS_PROXY=http://127.0.0.1:7890
python scripts/download_repair_manual_pdfs.py --count 2 --query "设备 维修手册"
```

若出现 `search.yahoo.com ... operation timed out`，请加 `--search-backend duckduckgo,bing,brave` 并增大 `--search-timeout 30`。

### 切换 Google Custom Search

若已申请 [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)：

```bash
set GOOGLE_API_KEY=your-api-key
set GOOGLE_CSE_ID=your-search-engine-id
python scripts/download_repair_manual_pdfs.py --provider google --count 2 --query "工业机器人 维修手册"
```

## 导入到知识库

下载完成后，在 `backend/` 下将 PDF 导入 SQLite/PostgreSQL 知识库：

```bash
python scripts/import_knowledge_pdf.py "../datasets/pdf/机器人维修手册.pdf" --equipment-type "工业机器人"
```

也可通过前端**知识中心 → PDF 导入**上传同目录文件。

## 版权与使用范围

脚本仅抓取公开可访问的 PDF 直链，**不绕过**登录墙、验证码或付费墙。各文件版权归属原发布方；用于竞赛演示、离线评测前请自行确认是否符合许可要求。
