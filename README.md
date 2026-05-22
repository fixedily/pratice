# 设备检修知识与作业助手

这是一个面向设备检修场景的 Web 原型系统，结合故障诊断、知识检索、任务生成、工单流转和案例沉淀能力，提供从问题输入到处理建议输出的完整流程。

当前仓库采用前后端分离结构：

- `backend/`：FastAPI 后端、数据库迁移、测试与辅助脚本
- `frontend/`：Next.js 前端工作台
- `docs/`：公开部署、联调与架构说明

公开仓库默认不包含本地数据库、未授权手册、真实业务数据、评测产物或敏感演示素材。请只使用你有权使用的数据和手册进行本地演示。

## 主要能力

- 文本、图片和 PDF 知识导入
- 混合知识检索与可追溯引用
- 实体级语义知识图谱查询与审核
- 诊断任务创建、执行过程展示和历史记录
- 检修工单、步骤推进、升级会诊、案例沉淀
- 登录验证码、失败锁定、角色权限与系统配置页
- Next.js 工作台、知识图谱、任务详情、监控告警和设置页面

## 公开数据说明

仓库只保留可公开的模板和说明文件：

- `datasets/validation/motorcycle_engine_retrieval_eval.csv`
- `datasets/validation/motorcycle_engine_multimodal_eval.csv`
- `datasets/img/README.md`
- `datasets/pdf/README.md`

PDF 原件、下载清单、本地数据库、截图产物和本地归档已通过 `.gitignore` 排除。

## 快速启动

Windows 本地开发推荐直接运行：

```powershell
.\scripts\start-dev.ps1
```

脚本会自动：

- 执行数据库初始化
- 启动后端与前端
- 更新 `frontend/.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL`

默认访问地址：

- 前端：`http://127.0.0.1:3000`
- 后端：`http://127.0.0.1:18000`
- 后端文档：`http://127.0.0.1:18000/docs`

## 手工运行

### 1. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

至少确认：

```env
DATABASE_URL=sqlite+aiosqlite:///./sensor_data.db
DEFAULT_LLM_PROVIDER=zhipu
ZHIPU_API_KEY=your-zhipu-api-key
DASHSCOPE_API_KEY=your-dashscope-api-key
VECTOR_STORE_BACKEND=pgvector
REDIS_ENABLED=false
DEBUG=false
```

真实密钥只保存在本地 `.env`，不要提交到仓库。

### 3. 初始化数据库

```bash
cd backend
python scripts/init_db.py --init-only
```

### 4. 启动后端

```bash
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 18000
```

### 5. 启动前端

```bash
cd frontend
npm install
npm run dev
```

## 文档

- [docs/全流程跑通指南.md](docs/%E5%85%A8%E6%B5%81%E7%A8%8B%E8%B7%91%E9%80%9A%E6%8C%87%E5%8D%97.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/系统架构文档.md](docs/%E7%B3%BB%E7%BB%9F%E6%9E%B6%E6%9E%84%E6%96%87%E6%A1%A3.md)
