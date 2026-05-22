"""扫描件 PDF：文本层为空时走逐页渲染 + OCR 回退。"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import get_settings
from app.modules.knowledge.application.import_service import (
    _detect_scanned_body_start_page,
    _filter_scanned_ocr_pages,
)
from app.services.image_analysis_service import FaultImageAnalysisService
from app.services.knowledge_import_service import KnowledgeImportService
from app.services.ocr_service import ImageOcrResult, KnowledgeOcrService


@pytest.mark.asyncio
async def test_prepare_upload_content_scanned_pdf_uses_page_ocr():
    session = MagicMock()
    svc = KnowledgeImportService(session)
    with patch.object(
        svc.importer,
        "extract_pages_from_bytes",
        side_effect=ValueError("未从 PDF 中提取到可用文本"),
    ):
        with patch(
            "app.modules.knowledge.application.import_service.render_pdf_pages_as_png_bytes",
            return_value=[b"\x89PNG\r\n\x1a\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"],
        ):
            with patch.object(
                svc.ocr_service,
                "extract_text",
                new=AsyncMock(
                    return_value=ImageOcrResult(
                        recognized_text="火花塞检查要点",
                        summary="摘要",
                        keywords=["火花塞"],
                        source="vision_model",
                    )
                ),
            ):
                prepared = await svc._prepare_upload_content(
                    import_type="pdf",
                    filename="scan.pdf",
                    file_bytes=b"%PDF-1.4",
                    content_type="application/pdf",
                    title="手册",
                    equipment_type="摩托车发动机",
                    equipment_model=None,
                    fault_type=None,
                    section_reference=None,
                )
    assert prepared["final_import_type"] == "pdf_scanned_ocr"
    assert prepared["page_count"] == 1
    assert "火花塞检查要点" in prepared["content"]
    assert len(prepared["chunk_payloads"]) >= 1
    assert prepared["chunk_payloads"][0]["source_modality"] == "ocr"


@pytest.mark.asyncio
async def test_prepare_upload_content_scanned_pdf_rejects_fallback_only_ocr():
    session = MagicMock()
    svc = KnowledgeImportService(session)
    with patch.object(
        svc.importer,
        "extract_pages_from_bytes",
        side_effect=ValueError("未从 PDF 中提取到可用文本"),
    ):
        with patch(
            "app.modules.knowledge.application.import_service.render_pdf_pages_as_png_bytes",
            return_value=[b"fake-page-1", b"fake-page-2"],
        ):
            with patch.object(
                svc.ocr_service,
                "extract_text",
                new=AsyncMock(
                    return_value=ImageOcrResult(
                        recognized_text="文档标题：扫描件\n当前导入文本为 OCR 回退结果。",
                        summary="回退",
                        keywords=["扫描件"],
                        source="fallback",
                        warning="当前环境未配置可用的视觉 OCR 模型。",
                    )
                ),
            ):
                with pytest.raises(ValueError, match="视觉 OCR 未成功完成"):
                    await svc._prepare_upload_content(
                        import_type="pdf",
                        filename="scan.pdf",
                        file_bytes=b"%PDF-1.4",
                        content_type="application/pdf",
                        title="手册",
                        equipment_type="摩托车发动机",
                        equipment_model=None,
                        fault_type=None,
                        section_reference=None,
                    )


def test_multimodal_llm_does_not_treat_deepseek_chat_as_vision_ocr_backend(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "dummy-key")
    get_settings.cache_clear()
    try:
        service = FaultImageAnalysisService()
        llm = service._create_multimodal_llm("openai", None)  # noqa: SLF001
        assert llm is None
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_glm_ocr_response_is_treated_as_real_ocr(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ZHIPU_API_KEY", "dummy-zhipu-key")
    get_settings.cache_clear()

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "model": "GLM-OCR",
                "md_results": "# 台式电脑维修\n\n1. 检查主板供电。\n2. 检查内存接触。",
            }

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

        async def post(self, *args, **kwargs):
            return _FakeResponse()

    try:
        with patch("app.services.ocr_service.httpx.AsyncClient", _FakeAsyncClient):
            svc = KnowledgeOcrService()
            result = await svc.extract_text(
                image_bytes=b"fake-image-bytes",
                image_mime_type="image/png",
                image_filename="desktop.png",
                equipment_type="电脑维修",
                equipment_model=None,
                title="台式电脑维修完全手册",
                section_reference=None,
            )
        assert result.source == "glm_ocr"
        assert "检查主板供电" in result.recognized_text
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_prepare_upload_content_treats_glm_ocr_as_successful_image_ocr():
    session = MagicMock()
    svc = KnowledgeImportService(session)
    with patch.object(
        svc.ocr_service,
        "extract_text",
        new=AsyncMock(
            return_value=ImageOcrResult(
                recognized_text="1. 检查主板供电。\n2. 检查内存接触。",
                summary="已识别台式机检修步骤。",
                keywords=["主板", "内存"],
                source="glm_ocr",
            )
        ),
    ):
        prepared = await svc._prepare_upload_content(
            import_type="image_ocr",
            filename="desktop.png",
            file_bytes=b"fake-image",
            content_type="image/png",
            title="台式电脑维修完全手册",
            equipment_type="电脑维修",
            equipment_model=None,
            fault_type=None,
            section_reference=None,
        )

    assert prepared["final_import_type"] == "image_ocr"


def test_filter_scanned_ocr_pages_drops_front_and_toc_when_body_exists():
    pages = [
        (1, "[第 1 页 OCR]\n案例大全版\n客服热线：（010）88378991"),
        (2, "[第 2 页 OCR]\n版权所有，侵权必究\n图书在版编目（CIP）数据"),
        (3, "[第 3 页 OCR]\n## 目录\n第1章 电脑维修···2\n第2章 电脑故障···14"),
        (4, "[第 4 页 OCR]\n# 第1章 常见的台式电脑品牌及其型号\n本章介绍联想、方正等品牌机型的识别方法。"),
    ]

    kept, dropped = _filter_scanned_ocr_pages(pages)

    assert [page for page, _ in kept] == [4]
    assert dropped["front"] == [1, 2]
    assert dropped["toc"] == [3]


def test_filter_scanned_ocr_pages_keeps_toc_when_no_body_page_in_window():
    pages = [
        (1, "[第 1 页 OCR]\n案例大全版\n客服热线：（010）88378991"),
        (2, "[第 2 页 OCR]\n## 目录\n第1章 电脑维修···2\n第2章 电脑故障···14"),
        (3, "[第 3 页 OCR]\n第3章 系统维护···37\n第4章 黑屏故障···53"),
    ]

    kept, dropped = _filter_scanned_ocr_pages(pages)

    assert [page for page, _ in kept] == [2, 3]
    assert dropped["front"] == [1]
    assert dropped["toc"] == []


def test_filter_scanned_ocr_pages_drops_title_page_before_detected_body_start():
    pages = [
        (3, "[第 3 页 OCR]\n## 台式电脑维修\n\n完全手册\n\n余素芬 张建 等编著\n\n技术才是硬道理！"),
        (8, "[第 8 页 OCR]\n## 目录\n\n第1章 电脑维修···2\n第2章 电脑故障···14"),
        (10, "[第 10 页 OCR]\n# 第 5 章 Windows 操作系统启动与关机故障维修 63\n\n了解 Windows 操作系统启动步骤 64\n\n开机报错故障一般解决方法 64\n\n无法启动 Windows 操作系统故障一般解决方法 66"),
    ]

    kept, dropped = _filter_scanned_ocr_pages(pages)

    assert [page for page, _ in kept] == [10]
    assert dropped["front"] == [3]
    assert dropped["toc"] == [8]


def test_detect_scanned_body_start_page_prefers_first_real_chapter_page():
    pages = [
        (3, "## 台式电脑维修\n\n完全手册\n\n余素芬 张建 等编著\n\n技术才是硬道理！"),
        (8, "## 目录\n\n第1章 电脑维修···2\n第2章 电脑故障···14"),
        (9, "第3章 掌握维护电脑的必备技能 ··· 37\n\n教你几招防毒杀毒技能 ··· 46"),
        (10, "# 第 5 章 Windows 操作系统启动与关机故障维修 63\n\n了解 Windows 操作系统启动步骤 64\n\n开机报错故障一般解决方法 64\n\n无法启动 Windows 操作系统故障一般解决方法 66"),
    ]

    body_start = _detect_scanned_body_start_page(pages)

    assert body_start == 10


def test_render_pdf_pages_returns_empty_without_pymupdf_bytes():
    """非 PDF 字节不应误解析出页（返回空列表由上层决定错误提示）。"""
    from app.services.knowledge_import_service import render_pdf_pages_as_png_bytes

    assert render_pdf_pages_as_png_bytes(b"not a pdf") == []


@pytest.mark.asyncio
async def test_get_document_detail_builds_document_level_summary():
    session = MagicMock()
    svc = KnowledgeImportService(session)
    document = SimpleNamespace(
        id=9,
        title="摩托车发动机维修手册",
        source_name="manual.pdf",
        source_type="manual",
        equipment_type="摩托车",
        equipment_model="LX200",
        fault_type="火花塞检查",
        status="published",
        section_reference="1.2 检查火花塞",
        page_reference="第3页",
        created_at=None,
        updated_at=None,
        content="旧的原文截断不应该再直接展示在摘要里。",
    )
    preview_chunks = [
        SimpleNamespace(
            chunk_index=1,
            heading="1.2 检查火花塞",
            step_anchor=None,
            section_reference="1.2 检查火花塞",
            section_path=None,
            content="检查火花塞螺纹以及中心电极，若有损坏或变形，则应更换火花塞。",
        ),
        SimpleNamespace(
            chunk_index=2,
            heading="1.3 安装火花塞",
            step_anchor=None,
            section_reference="1.3 安装火花塞",
            section_path=None,
            content="用套筒顺时针转动预紧，然后再转动四分之一圈，并按扭矩要求拧紧。",
        ),
    ]

    session.execute = AsyncMock(
        side_effect=[
            SimpleNamespace(scalar_one=lambda: 2),
            SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: preview_chunks)),
        ]
    )
    svc._ensure_document = AsyncMock(return_value=document)

    payload = await svc.get_document_detail(9)

    assert payload["content_excerpt"] is not None
    assert "文档用途：摩托车发动机维修手册是一份面向摩托车、LX200、火花塞检查的检修指导资料" in payload["content_excerpt"]
    assert "主要覆盖模块：文档主要覆盖检查火花塞、安装火花塞等系统或部件的维修内容" in payload["content_excerpt"]
    assert "可用于哪些检修/诊断场景：可用于检查、安装等检修流程" in payload["content_excerpt"]
