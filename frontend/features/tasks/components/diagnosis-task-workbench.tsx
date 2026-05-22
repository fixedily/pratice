"use client";

import type { ReactNode, RefObject } from "react";
import {
  Activity,
  Bot,
  Eye,
  FileText,
  FileUp,
  ImagePlus,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";

import type { MaintenanceLevelOption } from "@/features/tasks/api";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

export type DiagnosePhase = "idle" | "running" | "result";
export type DiagnosisMode = "rag" | "multi_agent";

const WORKFLOW_STEPS = [
  { key: "input", label: "故障录入" },
  { key: "agents", label: "智能体分析" },
  { key: "retrieve", label: "知识检索" },
  { key: "advice", label: "诊断建议" },
  { key: "workorder", label: "工单生成" },
] as const;

const QUICK_CASES = [
  "电机振动异常",
  "压缩机温升报警",
  "泵流量下降",
  "风机异响",
  "传感器离线",
] as const;

const AGENT_CARDS = [
  { name: "感知智能体", icon: Eye, desc: "提取故障现象、设备信息和异常特征" },
  { name: "检索智能体", icon: Search, desc: "召回知识文档、历史案例和检修规范" },
  { name: "诊断智能体", icon: Activity, desc: "分析可能故障原因和置信度" },
  { name: "规划智能体", icon: Wrench, desc: "生成检修步骤、工具需求和优先级" },
  { name: "审核智能体", icon: ShieldCheck, desc: "检查依据完整性、风险等级和人工复核建议" },
] as const;

function workflowStepIndex(phase: DiagnosePhase): number {
  if (phase === "idle") return 0;
  if (phase === "running") return 2;
  return 4;
}

export type DiagnosisTaskWorkbenchProps = {
  diagSymptom: string;
  onSymptomChange: (value: string) => void;
  diagEquipmentType: string;
  onEquipmentTypeChange: (value: string) => void;
  diagAssetCode: string;
  onAssetCodeChange: (value: string) => void;
  diagRegion: string;
  onRegionChange: (value: string) => void;
  diagLevel: MaintenanceLevelOption;
  onLevelChange: (value: MaintenanceLevelOption) => void;
  diagMode: DiagnosisMode;
  onModeChange: (value: DiagnosisMode) => void;
  diagAutoWorkOrder: boolean;
  onAutoWorkOrderChange: (value: boolean) => void;
  diagImageFile: File | null;
  diagLogFile: File | null;
  diagRecordFile: File | null;
  onClearImage: () => void;
  onClearLog: () => void;
  onClearRecord: () => void;
  imageInputRef: RefObject<HTMLInputElement | null>;
  logInputRef: RefObject<HTMLInputElement | null>;
  recordInputRef: RefObject<HTMLInputElement | null>;
  onImagePick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLogPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRecordPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  diagSubmitting: boolean;
  diagError: string | null;
  diagPhase: DiagnosePhase;
  runningTitle: string;
  runningDescription: string;
  onSubmit: () => void;
};

export function DiagnosisTaskWorkbench({
  diagSymptom,
  onSymptomChange,
  diagEquipmentType,
  onEquipmentTypeChange,
  diagAssetCode,
  onAssetCodeChange,
  diagRegion,
  onRegionChange,
  diagLevel,
  onLevelChange,
  diagMode,
  onModeChange,
  diagAutoWorkOrder,
  onAutoWorkOrderChange,
  diagImageFile,
  diagLogFile,
  diagRecordFile,
  onClearImage,
  onClearLog,
  onClearRecord,
  imageInputRef,
  logInputRef,
  recordInputRef,
  onImagePick,
  onLogPick,
  onRecordPick,
  diagSubmitting,
  diagError,
  diagPhase,
  runningTitle,
  runningDescription,
  onSubmit,
}: DiagnosisTaskWorkbenchProps) {
  const activeStep = workflowStepIndex(diagPhase);

  return (
    <div id="diagnosis-create" className="space-y-6">
      <section className="app-card border-brand/15 bg-gradient-to-r from-brand/[0.06] via-background to-background p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-brand" />
            诊断业务闭环
          </div>
          <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs text-brand-dark dark:text-brand-light">
            {diagMode === "multi_agent" ? "多智能体协同诊断" : "普通 RAG 诊断"}
          </span>
        </div>
        <ol className="grid gap-2 sm:grid-cols-5">
          {WORKFLOW_STEPS.map((step, index) => {
            const done = index < activeStep;
            const active = index === activeStep;
            return (
              <li
                key={step.key}
                className={cn(
                  "flex flex-col items-center rounded-xl border px-2 py-3 text-center transition-colors",
                  done && "border-brand/30 bg-brand/8",
                  active && "border-brand/45 bg-brand/12 shadow-[0_0_0_1px_rgba(24,195,126,0.12)]",
                  !done && !active && "border-border/80 bg-muted/20",
                )}
              >
                <span
                  className={cn(
                    "mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                    done || active ? "bg-brand text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                <span className="text-xs font-medium text-foreground">{step.label}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="app-card p-5 lg:p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-foreground">故障信息录入</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            填写现场故障与设备信息，支持附件辅助分析；提交后进入智能体协同诊断流程。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div>
              <Label htmlFor="diag-symptom" className="text-sm font-medium text-foreground">
                故障现象 <span className="text-red-400">*</span>
              </Label>
              <Textarea
                id="diag-symptom"
                value={diagSymptom}
                onChange={(e) => onSymptomChange(e.target.value)}
                rows={5}
                placeholder="描述故障现象、报警代码、发生工况与已做检查"
                className="mt-2 min-h-[140px] border-border/80 bg-background"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">快速案例</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_CASES.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onSymptomChange(label)}
                    className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-foreground transition-colors hover:border-brand/35 hover:bg-brand/10"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-brand/25 bg-brand/[0.03] p-4">
              <p className="text-sm font-medium text-foreground">附件上传</p>
              <p className="mt-1 text-xs text-muted-foreground">支持格式：JPG / PNG / TXT / CSV / PDF</p>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onImagePick} />
              <input ref={logInputRef} type="file" accept=".log,.txt,.json,.csv,text/plain,application/json,text/csv" className="hidden" onChange={onLogPick} />
              <input ref={recordInputRef} type="file" accept=".txt,.csv,.pdf,.log,application/pdf,text/plain,text/csv" className="hidden" onChange={onRecordPick} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                  <ImagePlus className="h-4 w-4" />
                  上传图片
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => logInputRef.current?.click()}>
                  <FileUp className="h-4 w-4" />
                  上传日志
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => recordInputRef.current?.click()}>
                  <FileText className="h-4 w-4" />
                  上传维修记录
                </Button>
              </div>
              {(diagImageFile || diagLogFile || diagRecordFile) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {diagImageFile ? <FileChip name={diagImageFile.name} onRemove={onClearImage} /> : null}
                  {diagLogFile ? <FileChip name={diagLogFile.name} onRemove={onClearLog} /> : null}
                  {diagRecordFile ? <FileChip name={diagRecordFile.name} onRemove={onClearRecord} /> : null}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Field label="设备类型" required>
                <Input value={diagEquipmentType} onChange={(e) => onEquipmentTypeChange(e.target.value)} placeholder="如：离心泵、压缩机" />
              </Field>
              <Field label="设备编号">
                <Input value={diagAssetCode} onChange={(e) => onAssetCodeChange(e.target.value)} placeholder="留空将自动生成" />
              </Field>
              <Field label="所属区域">
                <Input value={diagRegion} onChange={(e) => onRegionChange(e.target.value)} placeholder="如：A 车间 / 2 号线" />
              </Field>
              <Field label="诊断标准">
                <Select value={diagLevel} onValueChange={(v) => onLevelChange(v as MaintenanceLevelOption)}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="检修等级" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">例行</SelectItem>
                    <SelectItem value="standard">标准</SelectItem>
                    <SelectItem value="emergency">紧急</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="诊断模式">
              <div className="grid gap-2">
                <ModeOption active={diagMode === "rag"} title="普通 RAG 诊断" hint="基于知识库检索与单轮推理" onClick={() => onModeChange("rag")} />
                <ModeOption active={diagMode === "multi_agent"} title="多智能体协同诊断" hint="感知 → 检索 → 诊断 → 规划 → 审核" onClick={() => onModeChange("multi_agent")} />
              </div>
            </Field>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-muted/20 px-3 py-3">
              <input type="checkbox" className="mt-0.5 accent-brand" checked={diagAutoWorkOrder} onChange={(e) => onAutoWorkOrderChange(e.target.checked)} />
              <span className="text-sm leading-6 text-muted-foreground">诊断完成后自动生成检修工单草稿（可在详情页继续编辑）</span>
            </label>

            <Button type="button" className="h-12 w-full text-base font-medium shadow-sm" onClick={onSubmit} disabled={diagSubmitting}>
              {diagSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  诊断中…
                </>
              ) : (
                "开始智能诊断"
              )}
            </Button>
          </div>
        </div>

        {diagError ? <p className="mt-4 text-sm text-red-400" role="alert">{diagError}</p> : null}
        {diagPhase === "running" ? (
          <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.05] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              {runningTitle}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{runningDescription}</p>
          </div>
        ) : null}
      </section>

      <section className="app-card p-5 lg:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Bot className="h-5 w-5 text-brand" />
          <h2 className="text-base font-semibold text-foreground">多智能体协同流程</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {AGENT_CARDS.map((agent) => {
            const Icon = agent.icon;
            return (
              <div key={agent.name} className="rounded-xl border border-border/80 bg-gradient-to-b from-brand/[0.04] to-background p-4">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-brand/20 bg-brand/10 text-brand">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium text-foreground">{agent.name}</div>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{agent.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="app-card p-5 lg:p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">提交后查看诊断进展</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            系统会创建诊断任务，并进入任务详情页展示智能体执行、知识依据、诊断结论和工单生成入口。
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/15 px-6 py-10 text-center">
          <Network className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">提交后将自动进入任务详情页查看进展。</p>
        </div>
      </section>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-red-400"> *</span> : null}
      </Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ModeOption({ active, title, hint, onClick }: { active: boolean; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
        active ? "border-brand/40 bg-brand/10 shadow-[0_0_0_1px_rgba(24,195,126,0.15)]" : "border-border/80 bg-background hover:border-brand/25 hover:bg-muted/30",
      )}
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
    </button>
  );
}

function FileChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground">
      <span className="truncate">{name}</span>
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onRemove} aria-label="移除附件">
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

