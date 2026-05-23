# File: app/core/config.py
"""Application configuration management.

统一由 Pydantic Settings 管理环境变量，避免手动读取环境变量与
BaseSettings 混用造成的解析不一致。
"""
import json
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine.url import URL, make_url


def _backend_root() -> Path:
    """backend/ 根目录（含 app、alembic），与进程 cwd 无关。"""
    return Path(__file__).resolve().parents[2]


def _repo_root() -> Path:
    """仓库根目录（含 datasets、.env、历史 sensor_data.db）。"""
    return _backend_root().parent


def _default_sqlite_url() -> str:
    # 与历史约定一致：默认库文件在仓库根目录，便于与 datasets/ 并列管理
    p = (_repo_root() / "sensor_data.db").resolve()
    return str(URL.create("sqlite+aiosqlite", database=str(p)))


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # 数据库连接（默认文件落在 backend/，避免从仓库根目录启动时路径漂移）
    database_url: str = Field(default_factory=_default_sqlite_url, alias="DATABASE_URL")

    # 应用元信息
    app_name: str = "Industrial Fault Detection API"
    app_version: str = "0.1.0"
    debug: bool = Field(default=False, alias="DEBUG")

    # 数据库连接池（主要用于 PostgreSQL，SQLite 分支自动忽略）
    db_pool_size: int = Field(default=10, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=20, alias="DB_MAX_OVERFLOW")
    db_pool_timeout: int = Field(default=30, alias="DB_POOL_TIMEOUT")
    db_pool_recycle: int = Field(default=1800, alias="DB_POOL_RECYCLE")

    # LLM 配置
    default_llm_provider: str = Field(default="zhipu", alias="DEFAULT_LLM_PROVIDER")
    default_text_model: str = Field(default="glm-4.5", alias="DEFAULT_TEXT_MODEL")
    default_vision_model: str = Field(default="glm-4.5v", alias="DEFAULT_VISION_MODEL")
    deepseek_api_key: str | None = Field(default=None, alias="DEEPSEEK_API_KEY")
    deepseek_api_base: str = Field(default="https://api.deepseek.com", alias="DEEPSEEK_API_BASE")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_api_base: str | None = Field(default=None, alias="OPENAI_API_BASE")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    zhipu_api_key: str | None = Field(default=None, alias="ZHIPU_API_KEY")
    zhipu_api_base: str = Field(default="https://open.bigmodel.cn/api/paas/v4", alias="ZHIPU_API_BASE")
    zhipu_text_model: str = Field(default="glm-4.5", alias="ZHIPU_TEXT_MODEL")
    zhipu_vision_model: str = Field(default="glm-4.5v", alias="ZHIPU_VISION_MODEL")
    zhipu_ocr_model: str = Field(default="glm-ocr", alias="ZHIPU_OCR_MODEL")
    dashscope_api_key: str | None = Field(default=None, alias="DASHSCOPE_API_KEY")
    dashscope_api_base: str = Field(
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        alias="DASHSCOPE_API_BASE",
    )
    dashscope_embedding_model: str = Field(
        default="text-embedding-v4",
        alias="DASHSCOPE_EMBEDDING_MODEL",
    )
    dashscope_rerank_model: str = Field(default="gte-rerank-v2", alias="DASHSCOPE_RERANK_MODEL")
    dashscope_vl_rerank_model: str = Field(
        default="qwen3-vl-rerank",
        alias="DASHSCOPE_VL_RERANK_MODEL",
    )
    hf_endpoint: str | None = Field(default=None, alias="HF_ENDPOINT")

    # CORS 配置。需要携带 HttpOnly refresh cookie 时，生产环境应配置明确来源而不是 "*"。
    cors_origins: list[str] = Field(default=["*"], alias="CORS_ORIGINS")

    # 检修域：JWT 与附件存储（生产环境务必设置强随机 JWT_SECRET_KEY）
    jwt_secret_key: str = Field(
        default="dev-maintenance-secret-change-me",
        alias="JWT_SECRET_KEY",
    )
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=30, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=7, alias="REFRESH_TOKEN_EXPIRE_DAYS")
    refresh_token_remember_days: int = Field(default=7, alias="REFRESH_TOKEN_REMEMBER_DAYS")
    maintenance_upload_dir: str = Field(
        default="./data/maintenance_uploads",
        alias="MAINTENANCE_UPLOAD_DIR",
    )
    attachment_sign_secret: str = Field(
        default="dev-attachment-sign-secret",
        alias="ATTACHMENT_SIGN_SECRET",
    )

    # Redis（验证码、登录锁定、后续会话/限流/检索缓存）
    redis_enabled: bool = Field(default=True, alias="REDIS_ENABLED")
    redis_host: str = Field(default="localhost", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_password: str | None = Field(default=None, alias="REDIS_PASSWORD")
    redis_db: int = Field(default=0, alias="REDIS_DB")
    redis_prefix: str = Field(default="maintenance", alias="REDIS_PREFIX")
    redis_socket_timeout: int = Field(default=3, alias="REDIS_SOCKET_TIMEOUT")
    captcha_ttl_seconds: int = Field(default=180, alias="CAPTCHA_TTL_SECONDS")
    login_fail_max: int = Field(default=5, alias="LOGIN_FAIL_MAX")
    login_lock_seconds: int = Field(default=600, alias="LOGIN_LOCK_SECONDS")
    login_fail_window_seconds: int = Field(default=300, alias="LOGIN_FAIL_WINDOW_SECONDS")

    # 邮箱验证码 Provider；smtp=真实发信，mock=本地/CI 调试
    email_provider: str = Field(default="smtp", alias="EMAIL_PROVIDER")

    # SMTP 邮箱验证码（SMTP_PASSWORD 使用邮箱服务商授权码，不写入代码）
    smtp_host: str | None = Field(default=None, alias="SMTP_HOST")
    smtp_port: int = Field(default=465, alias="SMTP_PORT")
    smtp_user: str | None = Field(default=None, alias="SMTP_USER")
    smtp_password: str | None = Field(default=None, alias="SMTP_PASSWORD")
    smtp_from_name: str = Field(default="FaultDiag 运维管理后台", alias="SMTP_FROM_NAME")
    smtp_use_ssl: bool = Field(default=True, alias="SMTP_USE_SSL")

    # Embedding / 向量检索
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    embedding_provider: str = Field(default="dashscope", alias="EMBEDDING_PROVIDER")
    embedding_model: str = Field(default="bge-m3:latest", alias="EMBEDDING_MODEL")
    embedding_dim: int = Field(default=1024, alias="EMBEDDING_DIM")
    faiss_index_path: str = Field(default="data/faiss_index", alias="FAISS_INDEX_PATH")
    vector_store_backend: str = Field(default="pgvector", alias="VECTOR_STORE_BACKEND")
    # "pgvector" → PgvectorAdapter（需要 PostgreSQL + pgvector 扩展）
    # "faiss"    → FaissAdapter（本地文件，SQLite/离线环境降级）

    # Reranker 配置
    enable_reranker: bool = Field(default=True, alias="ENABLE_RERANKER")
    reranker_provider: str = Field(default="dashscope", alias="RERANKER_PROVIDER")
    reranker_model: str = Field(default="BAAI/bge-reranker-v2-m3", alias="RERANKER_MODEL")
    reranker_top_k: int = Field(default=20, alias="RERANKER_TOP_K")
    reranker_batch_size: int = Field(default=32, alias="RERANKER_BATCH_SIZE")
    ocr_provider: str = Field(default="zhipu", alias="OCR_PROVIDER")
    image_analysis_provider: str = Field(default="zhipu", alias="IMAGE_ANALYSIS_PROVIDER")
    query_rewrite_provider: str = Field(default="zhipu", alias="QUERY_REWRITE_PROVIDER")

    # 搜索结果缓存配置
    enable_search_cache: bool = Field(default=True, alias="ENABLE_SEARCH_CACHE")
    search_cache_ttl: int = Field(default=300, alias="SEARCH_CACHE_TTL")
    search_cache_maxsize: int = Field(default=1000, alias="SEARCH_CACHE_MAXSIZE")

    # Graph RAG 配置
    enable_graph_rag: bool = Field(default=False, alias="ENABLE_GRAPH_RAG")
    graph_rag_max_neighbors: int = Field(default=3, alias="GRAPH_RAG_MAX_NEIGHBORS")

    @field_validator("debug", mode="before")
    @classmethod
    def _normalize_debug(cls, value: object) -> bool:
        """容错解析 DEBUG，避免异常字符串直接导致启动失败。"""
        if isinstance(value, bool):
            return value

        if value is None:
            return False

        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "debug"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", ""}:
                return False

        return False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _normalize_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return ["*"]
            if raw.startswith("["):
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    return [raw]
                if isinstance(parsed, list):
                    return parsed
                return [raw]
            return [item.strip() for item in raw.split(",") if item.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def _anchor_sqlite_database_path(cls, v: str) -> str:
        """将 SQLite 相对路径解析到仓库根目录，与 uvicorn cwd 无关（兼容原 ./sensor_data.db）。"""
        if not v or "sqlite" not in v.lower():
            return v
        try:
            u = make_url(v)
        except Exception:
            return v
        if u.drivername != "sqlite" and u.drivername != "sqlite+aiosqlite":
            return v
        if not u.database:
            return v
        raw = u.database
        p = Path(raw)
        if p.is_absolute():
            return v
        anchored = (_repo_root() / raw).resolve()
        return str(URL.create(u.drivername, database=str(anchored)))

    @field_validator("maintenance_upload_dir", "faiss_index_path")
    @classmethod
    def _anchor_maintenance_upload_dir(cls, v: str) -> str:
        """相对路径锚定到 backend/，避免 cwd 变化导致上传目录漂移。"""
        if not v or v.strip() == "":
            return v
        p = Path(v)
        if p.is_absolute():
            return str(p)
        return str((_backend_root() / v).resolve())

    model_config = SettingsConfigDict(
        env_file=(
            str(_backend_root().parent / ".env"),
            str(_backend_root() / ".env"),
        ),
        env_file_encoding="utf-8",
        populate_by_name=True,
        extra="ignore",  # 允许 .env 中存在未声明的字段（如 DEEPSEEK_API_KEY 等）
    )


@lru_cache()
def get_settings() -> Settings:
    """Return cached settings instance (singleton pattern)."""
    return Settings()
