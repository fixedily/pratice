"""Knowledge chunking and anchor extraction helpers."""
from __future__ import annotations

import re

SECTION_HEADING_PATTERNS = [
    (1, re.compile(r"^第\s*[一二三四五六七八九十百零\d]+\s*章(?:[：:\s-]+.+)?$")),
    (2, re.compile(r"^第\s*[一二三四五六七八九十百零\d]+\s*节(?:[：:\s-]+.+)?$")),
    (3, re.compile(r"^第\s*[一二三四五六七八九十百零\d]+\s*条(?:[：:\s-]+.+)?$")),
]
DECIMAL_SECTION_PATTERN = re.compile(r"^(\d+(?:\.\d+){1,3})(?:[：:\s-]+.+)?$")
LIST_SECTION_PATTERN = re.compile(r"^[一二三四五六七八九十]+、.+$")
ACTION_SUBSECTION_PATTERN = re.compile(
    r"^(拆卸|安装|检查|更换|调整|清洁|润滑|装配|拆装)[^\s。；！？：:]{1,20}$"
)
COMPACT_SECTION_WITH_BODY_PATTERN = re.compile(
    r"^(?P<heading>\d+(?:\.\d+){1,3}(?:\s+[^\s。；！？]{1,20}){1,2})\s+"
    r"(?P<body>.+)$"
)
STEP_ANCHOR_PATTERNS = [
    re.compile(r"^(步骤\s*\d+)(?:[：:、.\s-]+.*)?$"),
    re.compile(r"^(\d+)(?:[.、:：)-]+.*)$"),
    re.compile(r"^[（(]\s*(\d+)\s*[)）].*$"),
    re.compile(r"^([一二三四五六七八九十]+)、(?:.*)$"),
]
PROCEDURAL_BLOCK_LABELS = (
    "拧紧力矩要求：",
    "机油规格要求：",
    "检查部位：",
    "提示：",
    "依次取下：",
    "依次松开以下部件的固定螺栓：",
    "具体操作顺序为：",
)
INLINE_STEP_SPLIT_PATTERN = re.compile(
    r"(?=(?:[（(]\s*\d+\s*[)）]\s*(?:检查|测量|确认|观察|安装|拆卸|拆下|取下|加注|排放|松开|更换|调整|清洁|润滑|装上|断开|拔下)"
    r"|步骤\s*\d+\s*(?:检查|测量|确认|观察|安装|拆卸|拆下|取下|加注|排放|松开|更换|调整|清洁|润滑|装上|断开|拔下)"
    r"|\d+[.、:：]\s*(?:检查|测量|确认|观察|安装|拆卸|拆下|取下|加注|排放|松开|更换|调整|清洁|润滑|装上|断开|拔下)))"
)
BULLET_LINE_PATTERN = re.compile(r"^[○●•·▪▫■□\-]\s*(.+)$")
TRAILING_BLOCK_LABEL_PATTERN = re.compile(
    r"^(?P<lead>.+?)\s+(?P<label>(?:拧紧力矩要求|机油规格要求|检查部位|具体操作顺序为)[：:])$"
)
MARKDOWN_HEADING_PREFIX_PATTERN = re.compile(r"^\s{0,3}#{1,6}\s*")


def split_text_into_paragraphs(content: str) -> list[str]:
    """Split raw content into stable paragraphs for chunking and anchor extraction."""
    normalized = "\n".join(line.strip() for line in content.splitlines())
    paragraphs = [part.strip() for part in normalized.split("\n\n") if part.strip()]
    if paragraphs:
        expanded: list[str] = []
        for paragraph in paragraphs:
            expanded.extend(_split_inline_procedural_paragraph(paragraph))
        return expanded
    stripped = content.strip()
    return [stripped] if stripped else []


def _split_inline_procedural_paragraph(paragraph: str) -> list[str]:
    compact = paragraph.strip()
    if not compact:
        return []
    matches = [match.start() for match in INLINE_STEP_SPLIT_PATTERN.finditer(compact)]
    unique_positions: list[int] = []
    for position in matches:
        if position not in unique_positions:
            unique_positions.append(position)
    if len(unique_positions) <= 1:
        return [compact]

    parts: list[str] = []
    for index, start in enumerate(unique_positions):
        end = unique_positions[index + 1] if index + 1 < len(unique_positions) else len(compact)
        segment = compact[start:end].strip()
        if segment:
            parts.append(segment)
    return parts or [compact]


def _normalize_anchor_text(value: str | None, *, max_length: int = 120) -> str | None:
    condensed = " ".join((value or "").split()).strip()
    if not condensed:
        return None
    if len(condensed) <= max_length:
        return condensed
    return condensed[: max_length - 1].rstrip() + "…"


def _split_segment_by_length(text: str, max_chars: int) -> list[str]:
    """Split one paragraph into deterministic sub-segments when it is too long."""
    condensed = text.strip()
    if not condensed:
        return []
    if len(condensed) <= max_chars:
        return [condensed]

    segments: list[str] = []
    remaining = condensed
    boundary_tokens = ("。", "；", "！", "？", "，", ";", ",", " ")
    while remaining:
        if len(remaining) <= max_chars:
            segments.append(remaining.strip())
            break

        end = max_chars
        best_boundary = -1
        for token in boundary_tokens:
            boundary = remaining.rfind(token, 0, max_chars)
            if boundary > best_boundary:
                best_boundary = boundary
        if best_boundary >= max_chars // 3:
            end = best_boundary + 1

        segments.append(remaining[:end].strip())
        remaining = remaining[end:].strip()

    return [segment for segment in segments if segment]


def _detect_section_heading(paragraph: str) -> tuple[int, str] | None:
    normalized = _normalize_anchor_text(paragraph, max_length=140)
    if not normalized:
        return None
    markdown_normalized = MARKDOWN_HEADING_PREFIX_PATTERN.sub("", normalized).strip()
    if not markdown_normalized:
        return None

    for level, pattern in SECTION_HEADING_PATTERNS:
        if pattern.match(markdown_normalized):
            return level, markdown_normalized

    decimal_match = DECIMAL_SECTION_PATTERN.match(markdown_normalized)
    if decimal_match:
        numbering = decimal_match.group(1)
        compact_match = COMPACT_SECTION_WITH_BODY_PATTERN.match(markdown_normalized)
        if compact_match:
            body = compact_match.group("body").strip()
            if body.startswith(("步骤", "1.", "2.", "3.", "4.", "5.", "（1）", "(1)")) or any(
                token in body for token in ("。", "；", "！", "？")
            ):
                return min(numbering.count(".") + 1, 4), compact_match.group("heading").strip()
        # "1" → level 1, "1.2" → level 2, "1.2.3" → level 3
        return min(numbering.count(".") + 1, 4), markdown_normalized

    if len(markdown_normalized) <= 36 and LIST_SECTION_PATTERN.match(markdown_normalized) and "。" not in markdown_normalized:
        return 1, markdown_normalized
    if len(markdown_normalized) <= 24 and ACTION_SUBSECTION_PATTERN.match(markdown_normalized):
        return 99, markdown_normalized
    return None


def _detect_step_anchor(paragraph: str) -> str | None:
    normalized = _normalize_anchor_text(paragraph, max_length=100)
    if not normalized:
        return None

    for pattern in STEP_ANCHOR_PATTERNS:
        if pattern.match(normalized):
            return normalized
    return None


def _apply_heading_to_section_stack(
    section_stack: list[str],
    *,
    level: int,
    heading: str,
) -> list[str]:
    if level == 99:
        if section_stack and ACTION_SUBSECTION_PATTERN.match(section_stack[-1]):
            return [*section_stack[:-1], heading]
        return [*section_stack, heading]

    updated_stack = section_stack[: level - 1]
    updated_stack.append(heading)
    return updated_stack


def _normalize_procedural_block_items(text: str) -> str:
    compact = " ".join((text or "").split()).strip()
    if not compact:
        return ""
    labeled_items = re.findall(r"([^:：\s]{2,12}[:：][\s\S]*?)(?=\s+[^:：\s]{2,12}[:：]|$)", compact)
    if labeled_items:
        return "\n".join(f"- {' '.join(item.split()).strip()}" for item in labeled_items if item.strip())
    volume_items = re.findall(r"(\d+\s*mL[\s\S]*?)(?=\s+\d+\s*mL|$)", compact, flags=re.IGNORECASE)
    if volume_items:
        return "\n".join(f"- {' '.join(item.split()).strip()}" for item in volume_items if item.strip())
    sentence_items = [part.strip() for part in re.split(r"[。；]+", compact) if part.strip()]
    if len(sentence_items) >= 2:
        return "\n".join(f"- {item}" for item in sentence_items)
    return compact


def _extract_procedural_title_and_remainder(text: str) -> tuple[str, str]:
    compact = " ".join((text or "").split()).strip()
    if not compact:
        return "", ""

    split_markers = (
        " 安装顺序",
        " 安装 ",
        " 从 ",
        " 向 ",
        " 用 ",
        " 启动",
        " 再次向 ",
        " 依次松开",
        " 依次取下",
        " 依次放入",
        " 具体操作顺序为",
        " 将 ",
        " 让 ",
        " 拆下",
        " 取下",
        " 松开",
        " 断开",
        " 打开",
        " 关闭",
        " 拔下",
        " 取出",
        " 拧紧力矩要求",
        " 机油规格要求",
        " 注意",
        " 提示",
    )
    split_index: int | None = None
    for marker in split_markers:
        position = compact.find(marker)
        if position > 2:
            if split_index is None or position < split_index:
                split_index = position

    if split_index is not None:
        title = re.sub(r"\s*/\s*", "/", compact[:split_index].strip())
        remainder = compact[split_index:].strip()
        if title:
            return title, remainder

    sentence_items = [part.strip() for part in re.split(r"[。；]+", compact) if part.strip()]
    if sentence_items:
        return re.sub(r"\s*/\s*", "/", sentence_items[0]), " ".join(sentence_items[1:]).strip()
    return compact, ""


def _format_procedural_chunk_content(text: str) -> str:
    source_lines = [" ".join(line.split()).strip() for line in (text or "").splitlines() if line.strip()]
    if not source_lines:
        compact = " ".join((text or "").split()).strip()
        if not compact:
            return ""
        source_lines = [compact]

    lines: list[str] = []
    first_line = source_lines[0]
    body_inputs: list[str] = source_lines[1:]

    step_match = re.match(r"^(\d+\.)\s*(.+)$", first_line)
    if step_match:
        title, remainder = _extract_procedural_title_and_remainder(step_match.group(2).strip())
        lines.append(f"{step_match.group(1).strip()} {title}".strip())
        if remainder:
            body_inputs = [remainder, *body_inputs]
    else:
        body_inputs = source_lines

    prefer_bullet = len(body_inputs) >= 2
    for raw_line in body_inputs:
        lines.extend(_format_procedural_body_line(raw_line, prefer_bullet=prefer_bullet))

    return "\n".join(line for line in lines if line.strip()).strip()


def _format_procedural_body_line(line: str, *, prefer_bullet: bool = False) -> list[str]:
    compact = " ".join((line or "").split()).strip()
    if not compact:
        return []

    trailing_label_match = TRAILING_BLOCK_LABEL_PATTERN.match(compact)
    if trailing_label_match:
        lead = trailing_label_match.group("lead").strip()
        label = trailing_label_match.group("label").strip()
        lines: list[str] = []
        if lead:
            lines.extend(_format_procedural_body_line(lead, prefer_bullet=True))
        lines.append(label)
        return lines

    bullet_match = BULLET_LINE_PATTERN.match(compact)
    if bullet_match:
        return [f"- {bullet_match.group(1).strip()}"]

    if "○" in compact or "●" in compact or "•" in compact:
        parts = re.split(r"[○●•]\s*", compact)
        lead = parts[0].strip()
        bullets = [part.strip() for part in parts[1:] if part.strip()]
        lines: list[str] = []
        if lead:
            if lead.endswith("：") or lead.endswith(":"):
                lines.append(lead)
            else:
                lines.extend(_format_procedural_body_line(lead, prefer_bullet=prefer_bullet))
        lines.extend(f"- {item}" for item in bullets)
        return lines

    label_match = re.match(r"^(?P<label>[^:：]{2,24}[：:])\s*(?P<body>.+)$", compact)
    if label_match:
        label = label_match.group("label").strip()
        body = label_match.group("body").strip()
        if label.startswith(("注意：", "注意:", "提示：", "提示:")):
            return [f"{label} {body}".strip()]
        inline_labeled_items = re.findall(r"[^:：\s]{2,12}[：:]\s*[^:：]+?(?=\s+[^:：\s]{2,12}[：:]|$)", compact)
        if len(inline_labeled_items) >= 2:
            return [f"- {' '.join(item.split()).strip()}" for item in inline_labeled_items]
        formatted_body = _normalize_procedural_block_items(body)
        if formatted_body and formatted_body != body:
            return [label, *[item for item in formatted_body.splitlines() if item.strip()]]
        return [label, body] if body else [label]

    if compact.endswith(("：", ":")):
        return [compact]

    if any(token in compact for token in ("：", "mL", "N·m")) and compact.count("：") >= 2:
        formatted_body = _normalize_procedural_block_items(compact)
        if formatted_body:
            return [item for item in formatted_body.splitlines() if item.strip()]

    sentence_items = [part.strip() for part in re.split(r"[。；]+", compact) if part.strip()]
    if len(sentence_items) >= 2:
        return [f"- {item}" for item in sentence_items]

    if prefer_bullet:
        return [f"- {compact.rstrip('。；')}"]

    return [compact]


def build_anchored_chunk_payloads(
    content: str,
    *,
    title: str,
    max_chars: int = 480,
    section_reference: str | None = None,
    page_reference: str | None = None,
    image_anchor_prefix: str | None = None,
    inherited_section_path: str | None = None,
) -> list[dict[str, str | None]]:
    """Build searchable chunk payloads together with hierarchical anchor metadata.

    ``inherited_section_path`` carries the last section context from the
    previous page so that continuation pages (which start mid-section with no
    heading line) are not labelled with the bare document title.
    """
    paragraphs = split_text_into_paragraphs(content)
    if not paragraphs:
        return []

    # Seed the section stack from the inherited context so that pages that
    # start mid-section (no heading on first paragraph) inherit the correct
    # section label rather than falling back to the document title.
    #
    # The inherited path is a " > "-joined string (e.g. "3.2 拆卸发动机").
    # We split it back into a list so that the level-based truncation logic
    # (section_stack[:level-1]) works correctly when a new heading is found.
    if inherited_section_path:
        section_stack: list[str] = [
            s.strip() for s in inherited_section_path.split(" > ") if s.strip()
        ]
    else:
        section_stack = []
    default_section = _normalize_anchor_text(section_reference, max_length=140)
    segments: list[dict[str, str | None]] = []
    for paragraph in paragraphs:
        heading_info = _detect_section_heading(paragraph)
        if heading_info is not None:
            level, heading = heading_info
            section_stack = _apply_heading_to_section_stack(
                section_stack,
                level=level,
                heading=heading,
            )
            # Pure heading paragraphs carry anchor context but should not become
            # standalone content chunks or step anchors.
            if paragraph.strip() == heading and "。" not in heading and "；" not in heading:
                continue

        section_path = " > ".join(section_stack) if section_stack else default_section
        section_label = section_stack[-1] if section_stack else default_section
        step_anchor = None if heading_info is not None else _detect_step_anchor(paragraph)
        for segment in _split_segment_by_length(paragraph, max_chars):
            segments.append(
                {
                    "text": segment,
                    "section_reference": section_label,
                    "section_path": section_path,
                    "step_anchor": step_anchor,
                }
            )

    procedural_payloads = _build_procedural_chunk_payloads(
        segments=segments,
        title=title,
        max_chars=max_chars,
        page_reference=page_reference,
        image_anchor_prefix=image_anchor_prefix,
        default_section=default_section,
    )
    if procedural_payloads:
        return procedural_payloads

    payloads: list[dict[str, str | None]] = []
    current_segments: list[str] = []
    current_section_reference: str | None = None
    current_section_path: str | None = None
    current_step_anchor: str | None = None

    def flush_current() -> None:
        nonlocal current_segments, current_section_reference, current_section_path, current_step_anchor
        if not current_segments:
            return
        chunk_number = len(payloads) + 1
        payloads.append(
            {
                "heading": current_section_path or current_section_reference or title,
                "content": "\n\n".join(current_segments).strip(),
                "section_reference": current_section_reference or default_section,
                "section_path": current_section_path or default_section,
                "step_anchor": current_step_anchor,
                "page_reference": page_reference,
                "image_anchor": (
                    f"{image_anchor_prefix}-{chunk_number}" if image_anchor_prefix else None
                ),
            }
        )
        current_segments = []
        current_section_reference = None
        current_section_path = None
        current_step_anchor = None

    for segment in segments:
        text = segment["text"] or ""
        if current_segments and not current_step_anchor and segment.get("step_anchor"):
            flush_current()
        candidate = (
            ("\n\n".join(current_segments) + f"\n\n{text}").strip()
            if current_segments
            else text
        )
        if current_segments and len(candidate) > max_chars:
            flush_current()

        current_segments.append(text)
        if segment.get("section_reference"):
            current_section_reference = segment["section_reference"]
        if segment.get("section_path"):
            current_section_path = segment["section_path"]
        if not current_step_anchor and segment.get("step_anchor"):
            current_step_anchor = segment["step_anchor"]

    flush_current()
    return payloads


def resolve_terminal_section_path(
    content: str,
    *,
    section_reference: str | None = None,
    inherited_section_path: str | None = None,
) -> str | None:
    """Resolve the last visible section path in one content block.

    This is used by page-aware PDF import so that a page ending in pure heading
    lines can still pass the updated section context to the next page.
    """
    paragraphs = split_text_into_paragraphs(content)
    if not paragraphs:
        return _normalize_anchor_text(section_reference, max_length=140)

    if inherited_section_path:
        section_stack: list[str] = [
            s.strip() for s in inherited_section_path.split(" > ") if s.strip()
        ]
    else:
        section_stack = []
    default_section = _normalize_anchor_text(section_reference, max_length=140)

    for paragraph in paragraphs:
        heading_info = _detect_section_heading(paragraph)
        if heading_info is None:
            continue
        level, heading = heading_info
        section_stack = _apply_heading_to_section_stack(
            section_stack,
            level=level,
            heading=heading,
        )

    if section_stack:
        return " > ".join(section_stack)
    return default_section


def _build_procedural_chunk_payloads(
    *,
    segments: list[dict[str, str | None]],
    title: str,
    max_chars: int,
    page_reference: str | None,
    image_anchor_prefix: str | None,
    default_section: str | None,
) -> list[dict[str, str | None]]:
    stepful_segments = [item for item in segments if item.get("step_anchor")]
    if not stepful_segments:
        return []

    payloads: list[dict[str, str | None]] = []
    current_bucket: list[str] = []
    current_step_anchor: str | None = None
    current_section_reference: str | None = None
    current_section_path: str | None = None

    def flush_bucket() -> None:
        nonlocal current_bucket, current_step_anchor, current_section_reference, current_section_path
        if not current_bucket:
            return
        chunk_no = len(payloads) + 1
        step_title = current_step_anchor or current_section_reference or title
        payloads.append(
            {
                "heading": f"{current_section_path or current_section_reference or title} - {step_title}",
                "content": _format_procedural_chunk_content("\n\n".join(current_bucket).strip()),
                "section_reference": current_section_reference or default_section,
                "section_path": current_section_path or default_section,
                "step_anchor": current_step_anchor,
                "page_reference": page_reference,
                "image_anchor": f"{image_anchor_prefix}-{chunk_no}" if image_anchor_prefix else None,
            }
        )
        current_bucket = []
        current_step_anchor = None
        current_section_reference = None
        current_section_path = None

    for segment in segments:
        text = (segment.get("text") or "").strip()
        if not text:
            continue
        step_anchor = segment.get("step_anchor")
        section_changed = bool(
            current_bucket
            and current_step_anchor
            and (
                (segment.get("section_path") or current_section_path) != current_section_path
                or (segment.get("section_reference") or current_section_reference) != current_section_reference
            )
        )
        if section_changed:
            flush_bucket()
        step_anchor = segment.get("step_anchor")
        if step_anchor and current_bucket:
            flush_bucket()

        current_bucket.append(text)
        current_step_anchor = step_anchor or current_step_anchor
        current_section_reference = segment.get("section_reference") or current_section_reference
        current_section_path = segment.get("section_path") or current_section_path

        if sum(len(part) for part in current_bucket) >= max_chars and current_step_anchor:
            flush_bucket()

    flush_bucket()
    return payloads


def split_text_into_chunks(
    content: str,
    max_chars: int = 480,
    overlap_chars: int = 80,
) -> list[str]:
    """Split long knowledge content into deterministic searchable chunks with overlap."""
    paragraphs = split_text_into_paragraphs(content)
    if not paragraphs:
        return [content.strip()]

    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= max_chars:
            current = candidate
            continue

        if current:
            chunks.append(current)
            # carry overlap tail into next chunk
            current = current[-overlap_chars:].strip() if overlap_chars else ""

        if len(paragraph) <= max_chars:
            current = (f"{current}\n\n{paragraph}".strip() if current else paragraph)
            continue

        for seg in _split_segment_by_length(paragraph, max_chars):
            chunks.append(seg)
        current = chunks[-1][-overlap_chars:].strip() if overlap_chars and chunks else ""

    if current:
        chunks.append(current)

    return [chunk for chunk in chunks if chunk]


__all__ = [
    "build_anchored_chunk_payloads",
    "resolve_terminal_section_path",
    "split_text_into_chunks",
    "split_text_into_paragraphs",
]
