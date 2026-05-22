"use client";

import type { ElementType, InputHTMLAttributes, ReactNode } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

type AuthInputProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: ElementType;
  error?: string;
  rightSlot?: ReactNode;
} & Pick<InputHTMLAttributes<HTMLInputElement>, "type" | "autoComplete" | "inputMode" | "maxLength">;

export function AuthInput({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  icon: Icon,
  error,
  rightSlot,
  autoComplete,
  inputMode,
  maxLength,
}: AuthInputProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-primary">
        {label}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Icon className="h-4 w-4 text-slate-500 dark:text-tertiary" />
        </div>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          className={`block w-full rounded-md border bg-slate-100/90 py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-500 transition-all duration-200 focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand/50 dark:bg-[rgba(255,255,255,0.02)] dark:text-primary dark:placeholder:text-tertiary dark:focus:bg-[rgba(255,255,255,0.04)] ${error ? "border-red-500/50" : "border-border"}`}
        />
        {rightSlot}
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

type PasswordInputProps = Omit<AuthInputProps, "type" | "rightSlot"> & {
  visible: boolean;
  onToggle: () => void;
};

export function PasswordInput({ visible, onToggle, ...props }: PasswordInputProps) {
  return (
    <AuthInput
      {...props}
      type={visible ? "text" : "password"}
      rightSlot={
        <button
          type="button"
          onClick={onToggle}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 transition-colors hover:text-slate-800 dark:text-tertiary dark:hover:text-secondary"
          aria-label={visible ? "隐藏密码" : "显示密码"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
}

export type PasswordStrength = "weak" | "medium" | "strong";

export function getPasswordStrength(password: string, username = ""): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (username && password.toLowerCase() === username.toLowerCase()) score = 0;
  if (score >= 3) return "strong";
  if (score >= 2) return "medium";
  return "weak";
}

export function validatePassword(password: string, username = ""): string | undefined {
  if (!password) return "请输入密码";
  if (password.length < 8) return "密码长度至少 8 位";
  if (username && password.toLowerCase() === username.toLowerCase()) return "密码不能与用户名相同";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码需包含字母和数字";
  return undefined;
}

export function PasswordStrengthMeter({ password, username = "" }: { password: string; username?: string }) {
  if (!password) return null;
  const strength = getPasswordStrength(password, username);
  const labels = { weak: "弱", medium: "中", strong: "强" };
  const widths = { weak: "w-1/3", medium: "w-2/3", strong: "w-full" };
  const colors = {
    weak: "bg-red-400",
    medium: "bg-amber-400",
    strong: "bg-emerald-400",
  };
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className={`h-full ${widths[strength]} ${colors[strength]} transition-all`} />
      </div>
      <p className="text-xs text-slate-500 dark:text-tertiary">
        密码强度：{labels[strength]}，建议包含特殊字符
      </p>
    </div>
  );
}

export function AuthNotice({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success" | "info";
}) {
  const palette =
    tone === "success"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "info"
        ? "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
        : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
  return <div className={`mb-4 rounded-lg border p-3 text-sm ${palette}`}>{children}</div>;
}
