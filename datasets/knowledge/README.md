# 知识库配套数据（datasets/knowledge）

本目录存放**可导入后端知识库**的公开语料导出，与 `datasets/pdf/`（手册 PDF）并列使用。

## 目录说明

| 路径 | 说明 |
| ---- | ---- |
| `text/hf_jaya1995_maintenance.jsonl` | 由 `backend/scripts/download_knowledge_datasets.py` 从 Hugging Face 数据集 **Jaya1995/Maintenance** 生成，每条一行 JSON，字段与 `POST /api/v1/knowledge/documents` 请求体对齐（`content` 等）。 |

## 如何重新下载

在 `backend/` 下执行：

```bash
pip install datasets pyarrow
python scripts/download_knowledge_datasets.py
```

若访问 `huggingface.co` 不稳定，可先设置镜像（示例）：

```bash
set HF_ENDPOINT=https://hf-mirror.com
python scripts/download_knowledge_datasets.py
```

## 许可与引用

**Jaya1995/Maintenance** 的版权与使用条件以 [Hugging Face 数据集页面](https://huggingface.co/datasets/Jaya1995/Maintenance) 及作者说明为准；用于竞赛演示或上线前请自行确认是否满足要求。

## 导入到系统

1. 使用 OpenAPI 或自写脚本逐条 `POST /api/v1/knowledge/documents`；或  
2. 若团队已有批量导入脚本，将本 JSONL 作为输入源。

PDF 类资料仍建议放在 `datasets/pdf/` 并通过知识页 **PDF 导入** 或 `backend/scripts/import_knowledge_pdf.py` 处理。批量下载公开手册 PDF 见 [`datasets/pdf/README.md`](../pdf/README.md) 与 `backend/scripts/download_repair_manual_pdfs.py`。
