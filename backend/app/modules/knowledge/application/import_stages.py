"""Knowledge import job stage definitions shared by API and worker."""
from __future__ import annotations

IMPORT_STAGE_PENDING = "pending"
IMPORT_STAGE_UPLOADING = "uploading"
IMPORT_STAGE_PARSING = "parsing"
IMPORT_STAGE_OCR = "ocr"
IMPORT_STAGE_CHUNKING = "chunking"
IMPORT_STAGE_EMBEDDING = "embedding"
IMPORT_STAGE_INDEXING = "indexing"
IMPORT_STAGE_REVIEWING = "reviewing"
IMPORT_STAGE_COMPLETED = "completed"
IMPORT_STAGE_FAILED = "failed"

IMPORT_STAGES: tuple[str, ...] = (
    IMPORT_STAGE_PENDING,
    IMPORT_STAGE_UPLOADING,
    IMPORT_STAGE_PARSING,
    IMPORT_STAGE_OCR,
    IMPORT_STAGE_CHUNKING,
    IMPORT_STAGE_EMBEDDING,
    IMPORT_STAGE_INDEXING,
    IMPORT_STAGE_REVIEWING,
    IMPORT_STAGE_COMPLETED,
    IMPORT_STAGE_FAILED,
)

ACTIVE_IMPORT_STAGES: frozenset[str] = frozenset(
    {
        IMPORT_STAGE_PENDING,
        IMPORT_STAGE_UPLOADING,
        IMPORT_STAGE_PARSING,
        IMPORT_STAGE_OCR,
        IMPORT_STAGE_CHUNKING,
        IMPORT_STAGE_EMBEDDING,
        IMPORT_STAGE_INDEXING,
        IMPORT_STAGE_REVIEWING,
    }
)

TERMINAL_IMPORT_STAGES: frozenset[str] = frozenset(
    {IMPORT_STAGE_COMPLETED, IMPORT_STAGE_FAILED}
)

STAGE_PROGRESS: dict[str, int] = {
    IMPORT_STAGE_PENDING: 0,
    IMPORT_STAGE_UPLOADING: 10,
    IMPORT_STAGE_PARSING: 25,
    IMPORT_STAGE_OCR: 40,
    IMPORT_STAGE_CHUNKING: 55,
    IMPORT_STAGE_EMBEDDING: 75,
    IMPORT_STAGE_INDEXING: 90,
    IMPORT_STAGE_REVIEWING: 95,
    IMPORT_STAGE_COMPLETED: 100,
    IMPORT_STAGE_FAILED: 0,
}

LEGACY_STATUS_ALIASES: dict[str, str] = {
    "processing": IMPORT_STAGE_PARSING,
}


def normalize_import_status(status: str | None) -> str:
    """Map legacy worker statuses to the unified stage vocabulary."""
    raw = (status or IMPORT_STAGE_PENDING).strip().lower()
    return LEGACY_STATUS_ALIASES.get(raw, raw)


def stage_progress(stage: str | None) -> int:
    normalized = normalize_import_status(stage)
    return STAGE_PROGRESS.get(normalized, 0)


def is_terminal_stage(stage: str | None) -> bool:
    return normalize_import_status(stage) in TERMINAL_IMPORT_STAGES


def is_active_stage(stage: str | None) -> bool:
    return normalize_import_status(stage) in ACTIVE_IMPORT_STAGES
