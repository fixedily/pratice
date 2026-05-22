"""Knowledge base request and response schemas."""
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator


class KnowledgeDocumentCreate(BaseModel):
    """Create a knowledge document and automatically split it into chunks."""

    knowledge_base_id: int | None = Field(default=None, ge=1, description="所属知识库 ID；为空时使用默认知识库")
    title: str = Field(..., min_length=1, description="知识文档标题")
    document_type: str = Field(default="pdf", description="文档类型：pdf/image/text/json 等")
    source_modality: str | None = Field(default=None, description="来源模态：text/image/ocr 等")
    object_key: str | None = Field(default=None, description="原始文件路径或对象键")
    source_name: str = Field(..., min_length=1, description="原始来源文件名或资源名")
    source_type: str = Field(default="manual", description="知识来源类型，例如 manual/case/procedure")
    equipment_type: str = Field(..., min_length=1, description="设备类型")
    equipment_model: str | None = Field(default=None, description="设备型号")
    fault_type: str | None = Field(default=None, description="故障类型")
    section_reference: str | None = Field(default=None, description="章节标识")
    page_reference: str | None = Field(default=None, description="页码标识")
    content: str = Field(..., min_length=20, description="原始知识文本内容")


class KnowledgeBaseCreate(BaseModel):
    """Create a knowledge base."""

    name: str = Field(..., min_length=1, max_length=255, description="知识库名称")
    description: str | None = Field(default=None, description="知识库描述")
    type: str = Field(default="comprehensive", description="知识库类型")
    visibility: str = Field(default="internal", description="可见范围")


class KnowledgeBaseUpdate(BaseModel):
    """Update a knowledge base."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    type: str | None = None
    visibility: str | None = None


class KnowledgeBaseResponse(BaseModel):
    """Knowledge base summary."""

    id: int
    name: str
    slug: str
    description: str | None = None
    type: str = "comprehensive"
    visibility: str = "internal"
    owner_id: int | None = None
    document_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class KnowledgeBaseListResponse(BaseModel):
    """Knowledge base list."""

    total: int
    bases: list[KnowledgeBaseResponse]


class KnowledgeCategoryStat(BaseModel):
    """Category count within one knowledge base."""

    id: str
    name: str
    count: int


class KnowledgeCategoryListResponse(BaseModel):
    """Category statistics for one knowledge base."""

    knowledge_base_id: int
    total: int
    categories: list[KnowledgeCategoryStat]


class KnowledgeDocumentResponse(BaseModel):
    """Document import response."""

    id: int
    knowledge_base_id: int
    title: str
    source_name: str
    source_type: str
    equipment_type: str
    equipment_model: str | None = None
    fault_type: str | None = None
    status: str
    chunk_count: int


class KnowledgeSearchRequest(BaseModel):
    """Knowledge search request."""

    graph_relation_types: list[str] = Field(
        default_factory=list,
        description="语义图谱扩展时允许的关系类型；为空表示不过滤。",
    )

    work_order_id: str | None = Field(default=None, description="工单编号")
    report_source: str | None = Field(default=None, description="报修来源")
    priority: str = Field(default="medium", description="工单优先级")
    maintenance_level: str = Field(default="standard", description="检修等级")
    query: str | None = Field(default=None, description="检修问题或关键词")
    equipment_type: str | None = Field(default=None, description="设备类型")
    equipment_model: str | None = Field(default=None, description="设备型号")
    fault_type: str | None = Field(default=None, description="故障类型")
    image_base64: str | None = Field(default=None, description="单张故障图片的 Base64 编码")
    image_mime_type: str | None = Field(default=None, description="故障图片 MIME 类型，例如 image/png")
    image_filename: str | None = Field(default=None, description="故障图片原始文件名")
    attachment_ids: list[int] = Field(default_factory=list, description="已上传的图片附件 ID 列表")
    model_provider: str = Field(default="openai", description="图片识别模型提供商")
    model_name: str | None = Field(default=None, description="图片识别模型名称")
    limit: int = Field(default=5, ge=1, le=20, description="返回结果上限")

    @field_validator(
        "query",
        "work_order_id",
        "report_source",
        "equipment_type",
        "equipment_model",
        "fault_type",
        "image_base64",
        "image_mime_type",
        "image_filename",
        "model_provider",
        "model_name",
        mode="before",
    )
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("attachment_ids", mode="before")
    @classmethod
    def normalize_attachment_ids(cls, value: object) -> list[int]:
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise ValueError("attachment_ids 必须为整数列表。")
        normalized: list[int] = []
        for item in value:
            if isinstance(item, str):
                item = item.strip()
                if not item:
                    continue
                if not item.isdigit():
                    raise ValueError("attachment_ids 必须为整数列表。")
                item = int(item)
            if not isinstance(item, int) or item < 1:
                raise ValueError("attachment_ids 仅支持正整数。")
            normalized.append(item)
        return normalized

    @field_validator("maintenance_level")
    @classmethod
    def normalize_level(cls, value: str) -> str:
        normalized = (value or "standard").strip().lower()
        allowed = {"routine", "standard", "emergency"}
        if normalized not in allowed:
            raise ValueError("maintenance_level 仅支持 routine、standard、emergency。")
        return normalized

    @field_validator("priority")
    @classmethod
    def normalize_priority(cls, value: str) -> str:
        normalized = (value or "medium").strip().lower()
        allowed = {"low", "medium", "high", "urgent"}
        if normalized not in allowed:
            raise ValueError("priority 仅支持 low、medium、high、urgent。")
        return normalized

    @model_validator(mode="after")
    def validate_search_inputs(self) -> "KnowledgeSearchRequest":
        if not any(
            [
                (self.query or "").strip(),
                (self.equipment_type or "").strip(),
                (self.equipment_model or "").strip(),
                (self.fault_type or "").strip(),
                (self.image_base64 or "").strip(),
                self.attachment_ids,
            ]
        ):
            raise ValueError(
                "至少需要提供检索关键词、设备类型、设备型号、故障类型或故障图片中的一项。"
            )
        if self.image_base64 and not (self.image_mime_type or "").startswith("image/"):
            raise ValueError("上传故障图片时，image_mime_type 必须是 image/ 开头的有效类型。")
        return self


class KnowledgeImageAnalysis(BaseModel):
    """Fault image analysis summary used to enrich retrieval."""

    summary: str
    keywords: list[str] = Field(default_factory=list)
    source: str = Field(description="识别来源：vision_model / fallback")
    warning: str | None = None


class KnowledgeSearchHit(BaseModel):
    """Single knowledge search result."""

    chunk_id: int
    document_id: int
    title: str
    source_name: str
    source_type: str
    equipment_type: str
    equipment_model: str | None = None
    fault_type: str | None = None
    excerpt: str
    section_reference: str | None = None
    section_path: str | None = None
    step_anchor: str | None = None
    page_reference: str | None = None
    image_anchor: str | None = None
    citation_label: str | None = None
    source_modality: str | None = None
    ocr_text: str | None = None
    image_caption: str | None = None
    evidence_summary: str | None = None
    expanded_content: str | None = None
    recommendation_reason: str
    score: float | None = None
    retrieval_score: float | None = None
    rerank_score: float | None = None


class KnowledgeGraphEntityContext(BaseModel):
    id: int
    entity_type: str
    canonical_name: str
    match_type: str | None = None
    match_score: float | None = None


class KnowledgeGraphRelationContext(BaseModel):
    id: int
    relation_type: str
    source_entity_id: int
    source_name: str
    target_entity_id: int
    target_name: str
    confidence: float | None = None
    evidence_chunk_ids: list[int] = Field(default_factory=list)


class KnowledgeGraphContext(BaseModel):
    matched_entities: list[KnowledgeGraphEntityContext] = Field(default_factory=list)
    expanded_relations: list[KnowledgeGraphRelationContext] = Field(default_factory=list)
    enhanced_keywords: list[str] = Field(default_factory=list)


class KnowledgeReasoningEvidenceChunk(BaseModel):
    chunk_id: int
    document_id: int
    title: str
    source_name: str
    citation_label: str | None = None
    section_reference: str | None = None
    page_reference: str | None = None
    excerpt: str
    score: float | None = None


class KnowledgeReasoningChain(BaseModel):
    question: str | None = None
    matched_entities: list[KnowledgeGraphEntityContext] = Field(default_factory=list)
    expanded_relations: list[KnowledgeGraphRelationContext] = Field(default_factory=list)
    evidence_chunks: list[KnowledgeReasoningEvidenceChunk] = Field(default_factory=list)
    selected_answer_claims: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    explanation_text: str | None = None


class KnowledgeSearchResponse(BaseModel):
    """Knowledge search response."""

    query: str | None = None
    effective_query: str | None = None
    effective_keywords: list[str] = Field(default_factory=list)
    query_type: str = Field(default="text_related")
    image_analysis_used: bool = False
    retrieval_path: list[str] = Field(default_factory=list)
    answer_confidence: float = 0.0
    coverage_warnings: list[str] = Field(default_factory=list)
    grounded: bool = True
    image_analysis: KnowledgeImageAnalysis | None = None
    graph_context: KnowledgeGraphContext | None = None
    reasoning_chain: KnowledgeReasoningChain | None = None
    total: int
    results: list[KnowledgeSearchHit]
