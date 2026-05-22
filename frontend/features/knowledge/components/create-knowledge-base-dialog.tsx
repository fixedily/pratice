"use client";

import { useState } from "react";
import { createKnowledgeBase } from "@/features/knowledge/api";
import type { KnowledgeBaseSummary } from "@/shared/lib/http";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const KNOWLEDGE_BASE_TYPE_OPTIONS = [
  { value: "comprehensive", label: "综合知识库" },
  { value: "device", label: "设备知识库" },
  { value: "manual", label: "设备手册库" },
  { value: "sop", label: "SOP规范库" },
  { value: "case", label: "故障案例库" },
] as const;

const KNOWLEDGE_BASE_VISIBILITY_OPTIONS = [
  { value: "internal", label: "团队内部" },
  { value: "private", label: "仅自己" },
  { value: "public", label: "公开" },
] as const;

type CreateKnowledgeBaseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (base: KnowledgeBaseSummary) => void;
};

export function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateKnowledgeBaseDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<string>("comprehensive");
  const [visibility, setVisibility] = useState<string>("internal");
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setName("");
    setDescription("");
    setType("comprehensive");
    setVisibility("internal");
  };

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("请填写知识库名称");
      return;
    }

    void (async () => {
      setSubmitting(true);
      try {
        const created = await createKnowledgeBase({
          name: trimmedName,
          description: description.trim() || undefined,
          type,
          visibility,
        });
        toast.success("知识库已创建");
        resetForm();
        onOpenChange(false);
        onCreated(created);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "创建知识库失败");
      } finally {
        setSubmitting(false);
      }
    })();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          onOpenChange(next);
          if (!next) resetForm();
        }
      }}
    >
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建知识库</DialogTitle>
          <DialogDescription>
            为不同设备域或项目创建独立知识库，上传的文档将写入当前选中的知识库。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="kb-name">知识库名称 *</Label>
            <Input
              id="kb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：摩托车发动机知识库"
              disabled={submitting}
              className="app-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-desc">知识库描述</Label>
            <Input
              id="kb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选，说明该库的业务范围"
              disabled={submitting}
              className="app-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>知识库类型</Label>
              <Select value={type} onValueChange={setType} disabled={submitting}>
                <SelectTrigger className="app-input w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_BASE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>可见范围</Label>
              <Select
                value={visibility}
                onValueChange={setVisibility}
                disabled={submitting}
              >
                <SelectTrigger className="app-input w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_BASE_VISIBILITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                创建中
              </>
            ) : (
              "创建"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
