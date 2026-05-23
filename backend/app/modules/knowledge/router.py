"""Knowledge base APIs for 软件杯检修知识系统."""
import logging

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.session import get_session
from app.modules.knowledge.application.import_service import KnowledgeImportService
from app.modules.knowledge.deps import CurrentUserCtx, optional_user_ctx, require_user_ctx
from app.modules.knowledge.application.search_service import KnowledgeService
from app.modules.knowledge.schemas.imports import (
    KnowledgeChunkPreview,
    KnowledgeChunkPreviewResponse,
    KnowledgeDocumentDetailResponse,
    KnowledgeDocumentListItem,
    KnowledgeDocumentListResponse,
    KnowledgeImportJobListResponse,
    KnowledgeImportJobResponse,
    KnowledgeImportPreviewResponse,
)
from app.modules.knowledge.schemas.search import (
    KnowledgeBaseCreate,
    KnowledgeBaseListResponse,
    KnowledgeBaseResponse,
    KnowledgeBaseUpdate,
    KnowledgeCategoryListResponse,
    KnowledgeCategoryStat,
    KnowledgeDocumentCreate,
    KnowledgeDocumentResponse,
    KnowledgeGraphContext,
    KnowledgeImageAnalysis,
    KnowledgeReasoningChain,
    KnowledgeSafetyWarning,
    KnowledgeSearchHit,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
)
from app.services.knowledge_base_service import KnowledgeBaseService
from app.services.knowledge_import_worker import KnowledgeImportWorker

router = APIRouter(prefix="/api/v1/knowledge", tags=["知识库"])
logger = logging.getLogger(__name__)


def _build_import_job_response(payload: dict) -> KnowledgeImportJobResponse:
    return KnowledgeImportJobResponse(**payload)


def _user_id(ctx: CurrentUserCtx | None) -> int | None:
    return ctx.user_id if ctx is not None else None


def _raise_knowledge_base_error(exc: BaseException) -> None:
    if isinstance(exc, PermissionError):
        raise AppError(
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="knowledge_base_forbidden",
            message=str(exc) or "无权访问该知识库。",
        ) from exc
    message = str(exc)
    if "不存在" in message:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="knowledge_base_not_found",
            message=message,
        ) from exc
    raise AppError(
        status_code=status.HTTP_400_BAD_REQUEST,
        error_code="knowledge_base_invalid_request",
        message=message,
    ) from exc


def _parse_optional_knowledge_base_id(raw: str | int | None) -> int | None:
    if raw in (None, ""):
        return None
    try:
        parsed = int(raw)
    except (TypeError, ValueError) as exc:
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_base_invalid_id",
            message="knowledge_base_id 必须为正整数。",
        ) from exc
    if parsed < 1:
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_base_invalid_id",
            message="knowledge_base_id 必须为正整数。",
        )
    return parsed


@router.post(
    "/documents",
    response_model=KnowledgeDocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="导入知识文档",
    description="将检修手册、标准步骤或整理后的案例文本导入知识库，并自动拆分为可检索分段。",
)
async def create_knowledge_document(
    request: KnowledgeDocumentCreate,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeDocumentResponse:
    """Import a knowledge document into the searchable knowledge base."""
    logger.info(
        "knowledge_document_import source_type=%s equipment_type=%s equipment_model=%s title=%s",
        request.source_type,
        request.equipment_type,
        request.equipment_model or "",
        request.title,
    )
    service = KnowledgeService(session)
    document, chunk_count = await service.create_document(request)

    return KnowledgeDocumentResponse(
        id=document.id,
        knowledge_base_id=getattr(document, "knowledge_base_id", request.knowledge_base_id or 1),
        title=document.title,
        source_name=document.source_name,
        source_type=document.source_type,
        equipment_type=document.equipment_type,
        equipment_model=document.equipment_model,
        fault_type=document.fault_type,
        status=document.status,
        chunk_count=chunk_count,
    )


@router.post(
    "/imports/preview",
    response_model=KnowledgeImportPreviewResponse,
    status_code=status.HTTP_200_OK,
    summary="预览知识导入任务",
    description="在正式导入前解析 PDF 或图片文件的页数、分段数和预览摘录，供知识中心确认导入内容。",
)
async def preview_knowledge_import(
    file: UploadFile = File(..., description="待导入的 PDF 手册或图片文件"),
    equipment_type: str = Form(..., description="设备类型，例如摩托车发动机"),
    title: str | None = Form(default=None, description="知识文档标题，默认使用文件名"),
    equipment_model: str | None = Form(default=None, description="设备型号"),
    fault_type: str | None = Form(default=None, description="故障类型"),
    section_reference: str | None = Form(default=None, description="章节说明"),
    source_type: str = Form(default="manual", description="知识来源类型，默认 manual"),
    replace_existing: bool = Form(default=False, description="存在同名文档时是否覆盖导入"),
    knowledge_base_id: str | None = Form(
        default=None,
        description="目标知识库 ID；为空时使用默认知识库",
    ),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeImportPreviewResponse:
    filename = (file.filename or "").strip()
    if not filename:
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_import_invalid_filename",
            message="上传文件必须包含文件名。",
        )

    logger.info(
        "knowledge_import_preview filename=%s content_type=%s equipment_type=%s equipment_model=%s replace_existing=%s",
        filename,
        file.content_type or "",
        equipment_type,
        equipment_model or "",
        replace_existing,
    )
    service = KnowledgeImportService(session)
    try:
        payload = await service.preview_pdf_upload(
            filename=filename,
            file_bytes=await file.read(),
            content_type=file.content_type,
            title=title,
            equipment_type=equipment_type.strip(),
            equipment_model=(equipment_model or "").strip() or None,
            fault_type=(fault_type or "").strip() or None,
            section_reference=(section_reference or "").strip() or None,
            source_type=(source_type or "manual").strip() or "manual",
            replace_existing=replace_existing,
            knowledge_base_id=_parse_optional_knowledge_base_id(knowledge_base_id),
        )
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_import_invalid_request",
            message=str(exc),
        ) from exc
    return KnowledgeImportPreviewResponse(**payload)


@router.get(
    "/bases",
    response_model=KnowledgeBaseListResponse,
    status_code=status.HTTP_200_OK,
    summary="知识库列表",
    description="返回可用知识库，上传文档时需指定 knowledge_base_id。",
)
async def list_knowledge_bases(
    limit: int = Query(default=50, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx | None = Depends(optional_user_ctx),
) -> KnowledgeBaseListResponse:
    service = KnowledgeBaseService(session)
    await service.ensure_default_knowledge_base()
    items = await service.list_knowledge_bases_with_counts(
        limit=limit,
        user_id=_user_id(user_ctx),
    )
    return KnowledgeBaseListResponse(
        total=len(items),
        bases=[KnowledgeBaseResponse(**item) for item in items],
    )


@router.post(
    "/bases",
    response_model=KnowledgeBaseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="新建知识库",
)
async def create_knowledge_base(
    request: KnowledgeBaseCreate,
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx = Depends(require_user_ctx),
) -> KnowledgeBaseResponse:
    service = KnowledgeBaseService(session)
    try:
        payload = await service.create_knowledge_base(
            name=request.name,
            description=request.description,
            type=request.type,
            visibility=request.visibility,
            owner_id=user_ctx.user_id,
        )
    except (ValueError, PermissionError) as exc:
        _raise_knowledge_base_error(exc)
    return KnowledgeBaseResponse(**payload)


@router.get(
    "/bases/{base_id}",
    response_model=KnowledgeBaseResponse,
    status_code=status.HTTP_200_OK,
    summary="知识库详情",
)
async def get_knowledge_base_detail(
    base_id: int,
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx | None = Depends(optional_user_ctx),
) -> KnowledgeBaseResponse:
    service = KnowledgeBaseService(session)
    try:
        payload = await service.get_knowledge_base_detail(
            base_id,
            user_id=_user_id(user_ctx),
        )
    except (ValueError, PermissionError) as exc:
        _raise_knowledge_base_error(exc)
    return KnowledgeBaseResponse(**payload)


@router.patch(
    "/bases/{base_id}",
    response_model=KnowledgeBaseResponse,
    status_code=status.HTTP_200_OK,
    summary="更新知识库",
)
async def update_knowledge_base(
    base_id: int,
    request: KnowledgeBaseUpdate,
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx | None = Depends(optional_user_ctx),
) -> KnowledgeBaseResponse:
    service = KnowledgeBaseService(session)
    try:
        payload = await service.update_knowledge_base(
            base_id,
            user_id=_user_id(user_ctx),
            name=request.name,
            description=request.description,
            type=request.type,
            visibility=request.visibility,
        )
    except (ValueError, PermissionError) as exc:
        _raise_knowledge_base_error(exc)
    return KnowledgeBaseResponse(**payload)


@router.get(
    "/categories",
    response_model=KnowledgeCategoryListResponse,
    status_code=status.HTTP_200_OK,
    summary="知识库分类统计",
)
async def list_knowledge_categories(
    knowledge_base_id: int = Query(..., description="知识库 ID"),
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx | None = Depends(optional_user_ctx),
) -> KnowledgeCategoryListResponse:
    service = KnowledgeBaseService(session)
    try:
        payload = await service.list_category_stats(
            knowledge_base_id,
            user_id=_user_id(user_ctx),
        )
    except (ValueError, PermissionError) as exc:
        _raise_knowledge_base_error(exc)
    return KnowledgeCategoryListResponse(
        knowledge_base_id=payload["knowledge_base_id"],
        total=payload["total"],
        categories=[KnowledgeCategoryStat(**item) for item in payload["categories"]],
    )


@router.get(
    "/imports",
    response_model=KnowledgeImportJobListResponse,
    status_code=status.HTTP_200_OK,
    summary="知识导入任务列表",
    description="返回最近的知识导入任务，供正式知识中心展示导入历史与状态。",
)
async def list_knowledge_import_jobs(
    limit: int = Query(default=8, ge=1, le=50, description="返回导入任务数量上限"),
    status_filter: str | None = Query(default=None, alias="status", description="按任务状态过滤"),
    batch_id: str | None = Query(default=None, description="按批量上传批次 ID 过滤"),
    knowledge_base_id: int | None = Query(default=None, description="按知识库 ID 过滤"),
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx | None = Depends(optional_user_ctx),
) -> KnowledgeImportJobListResponse:
    service = KnowledgeImportService(session)
    base_service = KnowledgeBaseService(session)
    resolved_base_id: int | None = None
    try:
        if knowledge_base_id is not None:
            resolved_base_id = await base_service.resolve_knowledge_base_id(
                knowledge_base_id,
                user_id=_user_id(user_ctx),
            )
    except (ValueError, PermissionError) as exc:
        _raise_knowledge_base_error(exc)
    jobs = await service.list_import_jobs(
        limit=limit,
        status=status_filter,
        batch_id=batch_id,
        knowledge_base_id=resolved_base_id,
    )
    return KnowledgeImportJobListResponse(
        total=len(jobs),
        jobs=[_build_import_job_response(payload) for payload in jobs],
    )


@router.post(
    "/imports",
    response_model=KnowledgeImportJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="上传并导入知识文档",
    description="通过正式知识中心上传 PDF 手册或图片型知识文档，先创建导入任务，再由后台 worker 异步提取文本并写入知识库。",
)
async def import_knowledge_document(
    file: UploadFile = File(..., description="待导入的 PDF 手册或图片文件"),
    equipment_type: str = Form(..., description="设备类型，例如摩托车发动机"),
    title: str | None = Form(default=None, description="知识文档标题，默认使用文件名"),
    equipment_model: str | None = Form(default=None, description="设备型号"),
    fault_type: str | None = Form(default=None, description="故障类型"),
    section_reference: str | None = Form(default=None, description="章节说明"),
    source_type: str = Form(default="manual", description="知识来源类型，默认 manual"),
    replace_existing: bool = Form(default=False, description="存在同名文档时是否覆盖导入"),
    batch_id: str | None = Form(default=None, description="批量上传批次 ID，多文件上传时保持一致"),
    knowledge_base_id: str | None = Form(
        default=None,
        description="目标知识库 ID；为空时使用默认知识库",
    ),
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx = Depends(require_user_ctx),
) -> KnowledgeImportJobResponse:
    filename = (file.filename or "").strip()
    if not filename:
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_import_invalid_filename",
            message="上传文件必须包含文件名。",
        )

    logger.info(
        "knowledge_import_upload filename=%s content_type=%s equipment_type=%s equipment_model=%s replace_existing=%s",
        filename,
        file.content_type or "",
        equipment_type,
        equipment_model or "",
        replace_existing,
    )
    base_service = KnowledgeBaseService(session)
    import_service = KnowledgeImportService(session)
    try:
        resolved_base_id = await base_service.resolve_knowledge_base_id(
            _parse_optional_knowledge_base_id(knowledge_base_id),
            user_id=user_ctx.user_id,
        )
        payload = await import_service.import_pdf_upload(
            filename=filename,
            file_bytes=await file.read(),
            content_type=file.content_type,
            title=title,
            equipment_type=equipment_type.strip(),
            equipment_model=(equipment_model or "").strip() or None,
            fault_type=(fault_type or "").strip() or None,
            section_reference=(section_reference or "").strip() or None,
            source_type=(source_type or "manual").strip() or "manual",
            replace_existing=replace_existing,
            batch_id=batch_id,
            knowledge_base_id=resolved_base_id,
        )
    except PermissionError as exc:
        _raise_knowledge_base_error(exc)
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_import_invalid_request",
            message=str(exc),
        ) from exc
    KnowledgeImportWorker.schedule_job(payload["id"])
    return _build_import_job_response(payload)


@router.post(
    "/imports/{job_id}/retry",
    response_model=KnowledgeImportJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="重试知识导入任务",
    description="将失败的知识导入任务重新放回后台队列，再次执行 OCR/PDF 解析与入库流程。",
)
async def retry_knowledge_import_job(
    job_id: int,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeImportJobResponse:
    service = KnowledgeImportService(session)
    try:
        payload = await service.retry_job(job_id)
    except ValueError as exc:
        message = str(exc)
        if "不存在" in message:
            raise AppError(
                status_code=status.HTTP_404_NOT_FOUND,
                error_code="knowledge_import_job_not_found",
                message=message,
            ) from exc
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_import_retry_invalid",
            message=message,
        ) from exc
    KnowledgeImportWorker.schedule_job(job_id)
    return _build_import_job_response(payload)


@router.get(
    "/imports/{job_id}",
    response_model=KnowledgeImportJobResponse,
    status_code=status.HTTP_200_OK,
    summary="获取知识导入任务详情",
)
async def get_knowledge_import_job(
    job_id: int,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeImportJobResponse:
    service = KnowledgeImportService(session)
    try:
        payload = await service.get_import_job(job_id)
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="knowledge_import_job_not_found",
            message=str(exc),
        ) from exc
    return _build_import_job_response(payload)


@router.delete(
    "/imports/{job_id}",
    status_code=status.HTTP_200_OK,
    summary="删除知识导入任务记录",
    description="仅允许删除解析失败的导入任务记录，便于清理无效上传历史。",
)
async def delete_knowledge_import_job(
    job_id: int,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    service = KnowledgeImportService(session)
    try:
        await service.delete_import_job(job_id)
    except ValueError as exc:
        message = str(exc)
        if "不存在" in message:
            raise AppError(
                status_code=status.HTTP_404_NOT_FOUND,
                error_code="knowledge_import_job_not_found",
                message=message,
            ) from exc
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_import_delete_invalid",
            message=message,
        ) from exc
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"success": True, "message": "导入记录已删除。"},
    )


@router.get(
    "/documents",
    response_model=KnowledgeDocumentListResponse,
    status_code=status.HTTP_200_OK,
    summary="知识文档列表",
    description="返回正式知识中心的文档列表和分段数，供导入验收和来源回溯。",
)
async def list_knowledge_documents(
    limit: int = Query(default=12, ge=1, le=50, description="返回文档数量上限"),
    query: str | None = Query(default=None, description="按标题、来源或内容模糊搜索"),
    equipment_type: str | None = Query(default=None, description="按设备类型过滤"),
    equipment_model: str | None = Query(default=None, description="按设备型号过滤"),
    source_type: str | None = Query(default=None, description="按来源类型过滤"),
    knowledge_base_id: int | None = Query(
        default=None,
        description="按知识库 ID 过滤；为空时返回默认知识库下的文档",
    ),
    session: AsyncSession = Depends(get_session),
    user_ctx: CurrentUserCtx | None = Depends(optional_user_ctx),
) -> KnowledgeDocumentListResponse:
    base_service = KnowledgeBaseService(session)
    try:
        resolved_base_id = await base_service.resolve_knowledge_base_id(
            knowledge_base_id,
            user_id=_user_id(user_ctx),
        )
    except (ValueError, PermissionError) as exc:
        _raise_knowledge_base_error(exc)
    service = KnowledgeImportService(session)
    documents = await service.list_documents(
        limit=limit,
        knowledge_base_id=resolved_base_id,
        query=query,
        equipment_type=equipment_type,
        equipment_model=equipment_model,
        source_type=source_type,
    )
    return KnowledgeDocumentListResponse(
        total=len(documents),
        documents=[KnowledgeDocumentListItem(**item) for item in documents],
    )


@router.get(
    "/documents/{document_id}",
    response_model=KnowledgeDocumentDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="知识文档详情",
    description="返回指定知识文档的详细元数据，供知识中心做来源回溯与命中调试。",
)
async def get_knowledge_document_detail(
    document_id: int,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeDocumentDetailResponse:
    service = KnowledgeImportService(session)
    try:
        payload = await service.get_document_detail(document_id)
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="knowledge_document_not_found",
            message=str(exc),
        ) from exc
    return KnowledgeDocumentDetailResponse(**payload)


@router.get(
    "/documents/{document_id}/chunks",
    response_model=KnowledgeChunkPreviewResponse,
    status_code=status.HTTP_200_OK,
    summary="知识文档分段预览",
    description="返回指定知识文档的前若干个分段，供正式知识管理页做导入验收和命中调试。",
)
async def get_knowledge_document_chunks(
    document_id: int,
    limit: int = Query(default=6, ge=1, le=500, description="返回分段数量上限"),
    focus_chunk_id: int | None = Query(default=None, description="优先定位的知识分段 ID"),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeChunkPreviewResponse:
    service = KnowledgeImportService(session)
    try:
        chunks = await service.list_document_chunks(
            document_id,
            limit=limit,
            focus_chunk_id=focus_chunk_id,
        )
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="knowledge_document_not_found",
            message=str(exc),
        ) from exc
    return KnowledgeChunkPreviewResponse(
        document_id=document_id,
        total=len(chunks),
        chunks=[
            KnowledgeChunkPreview(
                chunk_id=item["id"],
                chunk_index=item["chunk_index"],
                heading=item.get("heading"),
                content=item["content"],
                page_reference=item.get("page_reference"),
                section_reference=item.get("section_reference"),
                section_path=item.get("section_path"),
                step_anchor=item.get("step_anchor"),
                image_anchor=item.get("image_anchor"),
            )
            for item in chunks
        ],
    )


@router.post(
    "/search",
    response_model=KnowledgeSearchResponse,
    status_code=status.HTTP_200_OK,
    summary="检索检修知识",
    description="支持按文本、设备型号、故障图片等条件联合检索知识文档分段，并返回出处引用。",
)
async def search_knowledge(
    request: KnowledgeSearchRequest,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeSearchResponse:
    """Search the knowledge base with metadata-aware filtering."""
    logger.info(
        "knowledge_search query_present=%s image_present=%s equipment_type=%s equipment_model=%s fault_type=%s limit=%s",
        bool((request.query or "").strip()),
        bool((request.image_base64 or "").strip()) or bool(request.attachment_ids),
        request.equipment_type or "",
        request.equipment_model or "",
        request.fault_type or "",
        request.limit,
    )
    service = KnowledgeService(session)
    try:
        response_payload = await service.search_multimodal(request)
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="knowledge_search_invalid_request",
            message=str(exc),
        ) from exc

    return KnowledgeSearchResponse(
        query=response_payload["query"],
        effective_query=response_payload["effective_query"],
        effective_keywords=response_payload.get("effective_keywords") or [],
        query_type=response_payload.get("query_type") or "text_related",
        image_analysis_used=bool(response_payload.get("image_analysis_used")),
        retrieval_path=response_payload.get("retrieval_path") or [],
        answer_confidence=float(response_payload.get("answer_confidence") or 0.0),
        coverage_warnings=response_payload.get("coverage_warnings") or [],
        grounded=bool(response_payload.get("grounded", True)),
        image_analysis=(
            KnowledgeImageAnalysis(**response_payload["image_analysis"])
            if response_payload["image_analysis"] is not None
            else None
        ),
        graph_context=(
            KnowledgeGraphContext(**response_payload["graph_context"])
            if response_payload.get("graph_context") is not None
            else None
        ),
        reasoning_chain=(
            KnowledgeReasoningChain(**response_payload["reasoning_chain"])
            if response_payload.get("reasoning_chain") is not None
            else None
        ),
        safety_warnings=[
            KnowledgeSafetyWarning(**item)
            for item in response_payload.get("safety_warnings", [])
        ],
        total=len(response_payload["results"]),
        results=[KnowledgeSearchHit(**item) for item in response_payload["results"]],
    )


@router.delete(
    "/documents/{document_id}",
    status_code=status.HTTP_200_OK,
    summary="删除知识文档",
)
async def delete_knowledge_document(
    document_id: int,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    service = KnowledgeImportService(session)
    try:
        await service.delete_document(document_id)
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="knowledge_document_not_found",
            message=str(exc),
        ) from exc
    return JSONResponse({"success": True, "message": "文档已删除"})


__all__ = ["router"]
