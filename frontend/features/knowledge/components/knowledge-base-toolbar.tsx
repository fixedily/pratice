"use client";

import type { KnowledgeBaseSummary } from "@/shared/lib/http";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Check, ChevronDown, Plus } from "lucide-react";

type KnowledgeBaseToolbarProps = {
  bases: KnowledgeBaseSummary[];
  currentBaseId: number | null;
  currentBaseName: string;
  disabled?: boolean;
  onSelectBase: (base: KnowledgeBaseSummary) => void;
  onCreateClick: () => void;
};

function formatBaseLabel(base: KnowledgeBaseSummary) {
  const count = base.document_count ?? 0;
  return `${base.name} · ${count} 篇文档`;
}

export function KnowledgeBaseToolbar({
  bases,
  currentBaseId,
  currentBaseName,
  disabled,
  onSelectBase,
  onCreateClick,
}: KnowledgeBaseToolbarProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">当前知识库</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || bases.length === 0}
            className="h-9 max-w-[min(100%,320px)] justify-between gap-2 border-border bg-background px-3 text-sm font-normal"
          >
            <span className="truncate">
              {bases.length === 0 ? "暂无知识库" : currentBaseName}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[min(100vw-2rem,360px)]">
          <DropdownMenuLabel>切换知识库</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {bases.map((base) => (
            <DropdownMenuItem
              key={base.id}
              className="flex items-center justify-between gap-2"
              onClick={() => onSelectBase(base)}
            >
              <span className="truncate">{formatBaseLabel(base)}</span>
              {base.id === currentBaseId ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 border-border"
        onClick={onCreateClick}
        disabled={disabled}
      >
        <Plus className="h-4 w-4" />
        新建知识库
      </Button>
    </div>
  );
}
