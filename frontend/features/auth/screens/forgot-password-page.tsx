"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, KeyRound, Loader2, Lock, Mail, User } from "lucide-react";

import { maintenanceConfirmPasswordReset, maintenanceRequestPasswordReset } from "@/features/auth/api";
import { AuthCard, AuthLayout } from "@/features/auth/components/auth-page-shell";
import { CaptchaField, useCaptchaField } from "@/features/auth/components/captcha-field";
import {
  AuthInput,
  AuthNotice,
  PasswordInput,
  PasswordStrengthMeter,
  validatePassword,
} from "@/features/auth/components/auth-form-controls";
import { ROUTES } from "@/shared/lib/routes";

type Step = "account" | "reset" | "admin";
type ResetErrors = {
  account?: string;
  emailCode?: string;
  newPassword?: string;
  confirmPassword?: string;
};

export default function ForgotPasswordPage() {
  const currentYear = new Date().getFullYear();
  const router = useRouter();
  const captcha = useCaptchaField();
  const [step, setStep] = useState<Step>("account");
  const [account, setAccount] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [errors, setErrors] = useState<ResetErrors>({});

  const validateAccountStep = () => {
    const nextErrors: ResetErrors = {};
    if (!account.trim()) nextErrors.account = "请输入账号、邮箱或手机号";
    const captchaOk = captcha.validate();
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 && captchaOk;
  };

  const handleRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!validateAccountStep()) return;
    setIsLoading(true);
    try {
      const data = await maintenanceRequestPasswordReset({ account: account.trim() }, captcha.payload());
      if (data.need_admin_reset) {
        setStep("admin");
        setMessage({ tone: "info", text: "该账号未绑定邮箱，请联系系统管理员重置密码。" });
        return;
      }
      setMaskedEmail(data.masked_email || "");
      setStep("reset");
      setMessage({ tone: "success", text: data.message || "如果账号存在，系统将发送重置验证码。" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "验证码发送失败，请稍后重试。" });
      void captcha.loadCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  const validateResetStep = () => {
    const nextErrors: ResetErrors = {};
    if (!emailCode.trim()) nextErrors.emailCode = "请输入邮箱验证码";
    const passwordError = validatePassword(newPassword, account.trim());
    if (passwordError) nextErrors.newPassword = passwordError;
    if (!confirmPassword) nextErrors.confirmPassword = "请再次输入新密码";
    else if (confirmPassword !== newPassword) nextErrors.confirmPassword = "两次输入的密码不一致";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!validateResetStep()) return;
    setIsLoading(true);
    try {
      await maintenanceConfirmPasswordReset({
        account: account.trim(),
        email_code: emailCode.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setMessage({ tone: "success", text: "密码已重置，请重新登录。" });
      window.setTimeout(() => router.push(`${ROUTES.login}?reset=1`), 900);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "密码重置失败，请稍后重试。" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Link
        href={ROUTES.login}
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-sm text-slate-700 backdrop-blur-sm transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/[0.10] dark:bg-panel/35 dark:text-[#9fb0c5] dark:hover:border-white/[0.22] dark:hover:bg-white/[0.08] dark:hover:text-[#f5f7fa]"
      >
        <ArrowLeft className="h-4 w-4" />
        返回登录
      </Link>

      <AuthCard>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-white/90 dark:border-border dark:bg-[rgba(255,255,255,0.03)]">
            <KeyRound className="h-7 w-7 text-brand" />
          </div>
          <h1 className="text-xl font-semibold text-brand dark:text-primary">找回密码</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">通过绑定邮箱验证身份后重置密码</p>
        </div>

        {message ? <AuthNotice tone={message.tone}>{message.text}</AuthNotice> : null}

        {step === "account" ? (
          <form onSubmit={handleRequest} className="space-y-4">
            <AuthInput id="account" label="账号 / 邮箱 / 手机号" value={account} onChange={setAccount} placeholder="请输入账号、邮箱或手机号" icon={User} error={errors.account} autoComplete="username" />
            <CaptchaField value={captcha.captchaCode} onChange={captcha.setCaptchaCode} error={captcha.captchaError} image={captcha.captchaImage} loading={captcha.captchaLoading} onRefresh={() => void captcha.loadCaptcha()} />
            <button type="submit" disabled={isLoading} className="relative mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand/20 transition-all duration-200 hover:bg-brand-light hover:shadow-brand/30 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {isLoading ? "正在验证..." : "下一步"}
            </button>
          </form>
        ) : null}

        {step === "reset" ? (
          <form onSubmit={handleConfirm} className="space-y-4">
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3 text-sm text-sky-700 dark:text-sky-300">
              验证码已发送至 {maskedEmail || "账号绑定邮箱"}。
            </div>
            <AuthInput id="emailCode" label="邮箱验证码" value={emailCode} onChange={setEmailCode} placeholder="请输入 6 位验证码" icon={Mail} error={errors.emailCode} maxLength={6} inputMode="numeric" />
            <PasswordInput id="newPassword" label="新密码" value={newPassword} onChange={setNewPassword} placeholder="请输入新密码" icon={Lock} error={errors.newPassword} autoComplete="new-password" visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            <PasswordStrengthMeter password={newPassword} username={account.trim()} />
            <PasswordInput id="confirmPassword" label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} placeholder="请再次输入新密码" icon={Lock} error={errors.confirmPassword} autoComplete="new-password" visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((v) => !v)} />
            <button type="submit" disabled={isLoading} className="relative mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand/20 transition-all duration-200 hover:bg-brand-light hover:shadow-brand/30 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {isLoading ? "正在重置..." : "重置密码"}
            </button>
          </form>
        ) : null}

        {step === "admin" ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>该账号未绑定邮箱，请联系系统管理员重置密码。</p>
            </div>
          </div>
        ) : null}
      </AuthCard>
      <p className="mt-6 text-center text-xs text-slate-700 dark:text-slate-400">&copy; {currentYear} 工业故障诊断平台后台</p>
    </AuthLayout>
  );
}
