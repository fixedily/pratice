# 多模态演示图片与 CRCO 提示词

本目录整理了两类图片：

- `*_photo.*`：更适合做“真实故障外观”演示
- `*_check.*`：从《摩托车发动机维修手册》抽取的部件/装配/对正示意图，更适合做“图文联合检索”演示

## 推荐优先使用的图片

1. [spark_plug_carbon_fouling_photo.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/spark_plug_carbon_fouling_photo.png>)
   - 类型：真实照片
   - 适合演示：火花塞积炭、启动困难、点火异常

2. [spark_plug_gap_out_of_spec_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/spark_plug_gap_out_of_spec_check.png>)
   - 类型：手册示意图
   - 适合演示：火花塞间隙检查、间隙标准值

3. [starter_motor_connection_removal_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/starter_motor_connection_removal_check.png>)
   - 类型：手册示意图
   - 适合演示：起动电机位置识别、拆卸步骤

4. [timing_chain_tensioner_lock_release_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/timing_chain_tensioner_lock_release_check.png>)
   - 类型：手册示意图
   - 适合演示：正时链条涨紧器预压、自锁、释放

5. [valve_clearance_out_of_spec_shim_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/valve_clearance_out_of_spec_shim_check.png>)
   - 类型：手册示意图
   - 适合演示：气门间隙调整、垫片位置识别

6. [crankshaft_balance_shaft_timing_mark_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/crankshaft_balance_shaft_timing_mark_check.png>)
   - 类型：手册示意图
   - 适合演示：曲轴/平衡轴标记对正

7. [crankshaft_tdc_mark_alignment_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/crankshaft_tdc_mark_alignment_check.png>)
   - 类型：手册示意图
   - 适合演示：上止点标记识别、装配校核

## 命名规则

当前命名按“零件/部位 + 问题或检查点 + 用途”组织：

- `spark_plug_carbon_fouling_photo`
- `spark_plug_gap_out_of_spec_check`
- `timing_chain_tensioner_lock_release_check`
- `crankshaft_tdc_mark_alignment_check`

这样你在前端上传图片时，文件名本身就能帮助答辩老师理解图片用途。

## CRCO 提示词说明

这里按一个简单实用的版本来写：

- `C1 = Context`：场景背景
- `R = Role`：模型角色
- `C2 = Command`：具体任务
- `O = Output`：输出要求

你可以直接把下面整段粘到系统里，再配合对应图片上传。

---

## 1) 火花塞积炭

图片：
- [spark_plug_carbon_fouling_photo.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/spark_plug_carbon_fouling_photo.png>)

CRCO：

```text
Context:
当前输入是一张摩托车发动机火花塞的现场照片，目标是结合图片外观和维修知识库判断是否存在火花塞积炭、点火异常或启动困难相关问题。

Role:
你是摩托车发动机检修助手，擅长根据零部件外观现象和维修手册内容做知识检索与检修建议。

Command:
请先识别图片中的关键零件和可见异常现象，再结合“摩托车发动机维修手册”检索与火花塞检查、火花塞间隙、积炭处理、启动困难相关的知识片段。

Output:
请输出：
1. 图片中识别到的零件名称
2. 可见异常现象
3. 最相关的手册知识点
4. 建议优先检查的项目
5. 如有页码或章节，请给出引用
```

---

## 2) 火花塞间隙检查

图片：
- [spark_plug_gap_out_of_spec_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/spark_plug_gap_out_of_spec_check.png>)

CRCO：

```text
Context:
当前输入是一张火花塞结构与间隙示意图，目标是验证系统是否能结合图片定位到火花塞间隙检查知识。

Role:
你是维修知识检索助手，需要把图片中的结构特征和用户问题对应到手册章节。

Command:
请识别这张图中的零件及关键测量位置，结合维修手册检索火花塞间隙检查、标准值、是否需要更换等相关知识。

Output:
请输出：
1. 图片中的零件名称
2. 需要检查的关键位置
3. 对应的标准值或范围
4. 关联的手册章节或页码
```

---

## 3) 起动电机拆卸

图片：
- [starter_motor_connection_removal_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/starter_motor_connection_removal_check.png>)

CRCO：

```text
Context:
当前输入是一张发动机侧面装配图，目标是结合图片识别起动电机及相关拆卸位置。

Role:
你是检修工艺辅助助手，需要根据装配图检索部件名称和拆卸步骤。

Command:
请识别图中与起动电机相关的部件位置，结合维修手册检索起动电机拆卸、断开线路、固定螺栓拆除等步骤。

Output:
请输出：
1. 识别到的关键部件
2. 推荐的拆卸顺序
3. 注意事项
4. 对应手册引用
```

---

## 4) 正时链条涨紧器

图片：
- [timing_chain_tensioner_lock_release_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/timing_chain_tensioner_lock_release_check.png>)

CRCO：

```text
Context:
当前输入是一张正时链条涨紧器操作示意图，目标是验证系统是否能理解“预压、自锁、释放”这类装配动作。

Role:
你是发动机正时系统检修助手。

Command:
请识别图片中的零件名称和操作方向，结合维修手册检索涨紧器预压、自锁、释放以及安装后的校核步骤。

Output:
请输出：
1. 零件名称
2. 图中动作含义
3. 对应操作步骤
4. 检修后的校核要点
5. 手册出处
```

---

## 5) 气门间隙调整

图片：
- [valve_clearance_out_of_spec_shim_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/valve_clearance_out_of_spec_shim_check.png>)

CRCO：

```text
Context:
当前输入是一张气门机构局部示意图，目标是结合图像定位气门间隙调整相关知识。

Role:
你是气门机构检修助手。

Command:
请识别图片中的气门机构关键部位，并结合维修手册检索气门间隙标准范围、调整垫片、更换规则和注意事项。

Output:
请输出：
1. 识别到的关键结构
2. 可能对应的检修任务
3. 标准间隙范围
4. 调整或更换建议
5. 手册章节或页码
```

---

## 6) 曲轴/平衡轴标记对正

图片：
- [crankshaft_balance_shaft_timing_mark_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/crankshaft_balance_shaft_timing_mark_check.png>)
- [crankshaft_tdc_mark_alignment_check.png](</e:/南京航空航天大学/aaa大创/智能体案例/dachuang_project/datasets/img/crankshaft_tdc_mark_alignment_check.png>)

CRCO：

```text
Context:
当前输入是一张曲轴与平衡轴标记对正示意图，目标是验证系统是否能从图像中识别装配标记并检索对应知识。

Role:
你是发动机装配校核助手。

Command:
请识别图中的标记点和齿轮/轴系关系，结合维修手册检索曲轴、平衡轴、上止点标记对正和安装校核要求。

Output:
请输出：
1. 图中关键标记说明
2. 对正关系
3. 安装后的检查要求
4. 若未对正可能导致的问题
5. 手册引用
```

## 前端演示建议

最适合现场演示的两组：

1. `火花塞积炭照片 + 火花塞积炭 CRCO`
2. `涨紧器示意图 + 正时链条涨紧器 CRCO`

原因：

- 第一组更像真实故障图
- 第二组更能体现“图像 + 手册知识检索”的多模态能力
