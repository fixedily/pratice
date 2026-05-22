# 设备检修知识检索验证集

这是一份面向学生演示的、小而清晰的验证集，专门配合：

- [摩托车发动机维修手册.pdf](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/pdf/摩托车发动机维修手册.pdf>)
- `/api/v1/knowledge/search`

主文件：

- [motorcycle_engine_retrieval_eval.csv](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/validation/motorcycle_engine_retrieval_eval.csv>)
- [motorcycle_engine_multimodal_eval.csv](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/validation/motorcycle_engine_multimodal_eval.csv>)

## 这份验证集适合做什么

- 演示“输入检修问题，系统能不能找到对应手册知识”
- 做课程答辩里的检索效果展示
- 统计简单指标：`Top-1`、`Top-3`、`Top-5`

它故意做得不大，方便你自己看懂每一条样例。

## 字段说明

- `case_id`：样例编号
- `category`：`success` / `fuzzy` / `failure`
- `modality`：当前先用 `text`，后续你可以自己扩展成 `image+text`
- `query`：实际检索问题
- `expected_section_reference`：理想命中的章节
- `expected_page_reference`：理想命中的页码
- `expected_terms`：命中结果里最好能看到的关键词
- `expected_behavior`：你人工判断时应该关注的点

## 推荐演示方式

先把 `摩托车发动机维修手册.pdf` 导入知识库，再挑 6 到 8 条样例现场演示：

1. `ME-01`：火花塞拆卸
2. `ME-02`：火花塞间隙标准值
3. `ME-06`：涨紧器预压与释放
4. `ME-08`：气缸头扭矩
5. `ME-12`：水泵安装方向和扭矩
6. `ME-16`：曲轴与平衡轴标记对正

这样老师一看就知道：

- 你不是只会搜关键词
- 你能检索步骤、参数、扭矩、装配规则

## 最简单的判分规则

你可以先用最容易人工核对的规则：

### 1. Top-1 命中率

第一条结果同时满足下面两项，就算命中：

- `section_reference` 与 `expected_section_reference` 一致或高度接近
- 结果正文里包含 `expected_terms` 里的核心词

### 2. Top-3 命中率

前三条里有一条满足上面的命中条件，就算通过。

### 3. 失败样例

对 `ME-17`、`ME-18` 这类问题，如果你只导入了发动机手册，那么系统应尽量：

- 不返回特别高置信度答案
- 或返回覆盖不足、知识缺失这类提示

这能说明你的系统有“知识边界感”，不会什么都乱答。

## 建议你在答辩时怎么说

你可以直接这样讲：

“我使用摩托车发动机维修手册构造了 18 条小型验证样例，其中包含明确检索、模糊检索和失败检索三类问题。通过观察 Top-1 和 Top-3 的命中情况，可以验证系统对检修步骤、扭矩参数、装配规则和故障排查知识的召回能力。”

## 后续扩展

如果你想把它升级成“多模态验证集”，最简单的做法是：

1. 用手机拍 5 到 10 张图片：
   - 火花塞积碳
   - 水泵密封圈
   - 起动电机
   - 活塞环
   - 曲轴标记
2. 在 CSV 里新增：
   - `image_path`
   - `image_expected_terms`
3. 再跑一次“文本”与“图片+文本”的对比实验

这样就能把你的题目里“多模态知识检索”这一点讲得更完整。

## 直接批跑多模态验证集

现在仓库里已经补了一份现成的多模态 CSV：

- [motorcycle_engine_multimodal_eval.csv](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/validation/motorcycle_engine_multimodal_eval.csv>)

它依赖 `datasets/img/` 里的图片样例，并且可以直接复用同一个批跑脚本：

```bash
cd backend
..\venv\Scripts\python.exe -X utf8 scripts/run_motorcycle_retrieval_eval.py --dataset-csv ..\datasets\validation\motorcycle_engine_multimodal_eval.csv --output-prefix motorcycle_engine_multimodal_eval
```

输出结果会写到：

- `backend/evaluation/results/motorcycle_engine_multimodal_eval.json`
- `backend/evaluation/results/motorcycle_engine_multimodal_eval.csv`

说明：

- 这个脚本现在同时支持纯文本样例和 `image_path + query` 的图片文本联合样例
- 若 CSV 中包含 `image_path` 列，脚本会自动读取图片并编码成 `image_base64` 发给知识检索接口
