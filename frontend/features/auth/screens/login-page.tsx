"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Loader2, Lock, User } from "lucide-react";

import { MaintenanceAuthError, maintenanceLogin } from "@/features/auth/api";
import { AuthCard, AuthLayout } from "@/features/auth/components/auth-page-shell";
import { CaptchaField, useCaptchaField } from "@/features/auth/components/captcha-field";
import { AuthInput, AuthNotice, PasswordInput } from "@/features/auth/components/auth-form-controls";
import {
  getMaintenanceRememberPreference,
  setMaintenanceToken,
} from "@/features/auth/lib/token-store";
import { ROUTES } from "@/shared/lib/routes";

type LoginErrors = {
  account?: string;
  password?: string;
};

const LOGIN_LOCK_MESSAGE = "密码错误次数过多，账号已临时锁定，请稍后再试。";

export default function LoginPage() {
  const currentYear = new Date().getFullYear();
  const router = useRouter();
  const captcha = useCaptchaField();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [nextPath, setNextPath] = useState<string>(ROUTES.dashboard);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const isLocked = lockUntil !== null && nowMs < lockUntil;

  useEffect(() => {
    setRememberMe(getMaintenanceRememberPreference());
    const params = new URLSearchParams(window.location.search);
    const rawNext = params.get("next")?.trim();
    if (rawNext?.startsWith("/")) setNextPath(rawNext);
    if (params.get("registered") === "1") {
      setMessage({ tone: "success", text: "注册申请已提交，请等待管理员审核。" });
      const username = params.get("username")?.trim();
      if (username) setAccount(username);
    }
    if (params.get("reset") === "1") {
      setMessage({ tone: "success", text: "密码重置申请已提交，请等待管理员核验后处理。" });
    }
    if (params.get("reason") === "expired") {
      setMessage({ tone: "info", text: "登录已过期，请重新登录。" });
    }
  }, []);

  useEffect(() => {
    if (!lockUntil) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lockUntil]);

  const validate = () => {
    const nextErrors: LoginErrors = {};
    if (!account.trim()) nextErrors.account = "请输入账号";
    if (!password) nextErrors.password = "请输入登录密码";
    const captchaOk = captcha.validate();
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 && captchaOk;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLocked) {
      setMessage({ tone: "error", text: LOGIN_LOCK_MESSAGE });
      return;
    }
    setMessage(null);
    if (!validate()) return;
    setIsLoading(true);
    try {
      const data = await maintenanceLogin(account.trim(), password, captcha.payload(), rememberMe);
      setMaintenanceToken(data.access_token, rememberMe);
      setMessage({ tone: "success", text: "登录成功，正在进入系统。" });
      router.push(nextPath);
    } catch (error) {
      if (error instanceof MaintenanceAuthError && error.businessCode === "ACCOUNT_LOCKED") {
        setLockUntil(Date.now() + (error.retryAfterSeconds ?? 60) * 1000);
        setMessage({ tone: "error", text: LOGIN_LOCK_MESSAGE });
      } else {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "登录失败，请稍后重试。" });
      }
      void captcha.loadCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-sm text-slate-700 backdrop-blur-sm transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/[0.10] dark:bg-panel/35 dark:text-[#9fb0c5] dark:hover:border-white/[0.22] dark:hover:bg-white/[0.08] dark:hover:text-[#f5f7fa]"
      >
        <ArrowLeft className="h-4 w-4" />
        返回主站
      </Link>

      <AuthCard>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-white/90 dark:border-border dark:bg-[rgba(255,255,255,0.03)]">
            <KeyRound className="h-7 w-7 text-brand" />
          </div>
          <h1 className="text-xl font-semibold text-brand dark:text-primary">运维管理后台</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            登录后进入设备检修、智能诊断与知识沉淀平台
          </p>
        </div>

        {message ? <AuthNotice tone={message.tone}>{message.text}</AuthNotice> : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthInput
            id="account"
            label="账号"
            type="text"
            value={account}
            onChange={setAccount}
            placeholder="请输入用户名 / 邮箱 / 手机号"
            icon={User}
            error={errors.account}
            autoComplete="username"
          />
          <PasswordInput
            id="password"
            label="密码"
            value={password}
            onChange={setPassword}
            placeholder="请输入登录密码"
            icon={Lock}
            error={errors.password}
            autoComplete="current-password"
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
          <CaptchaField
            value={captcha.captchaCode}
            onChange={captcha.setCaptchaCode}
            error={captcha.captchaError}
            image={captcha.captchaImage}
            loading={captcha.captchaLoading}
            onRefresh={() => void captcha.loadCaptcha()}
          />
          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-4 w-4 rounded border border-border bg-card text-brand focus:ring-1 focus:ring-brand/50 focus:ring-offset-0"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">7 天内保持登录</span>
            </label>
            <Link href={ROUTES.forgotPassword} className="text-sm text-brand-dark hover:text-brand dark:text-brand">
              忘记密码？
            </Link>
          </div>
          <button
            type="submit"
            disabled={isLoading || isLocked}
            className="relative mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand/20 transition-all duration-200 hover:bg-brand-light hover:shadow-brand/30 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {isLoading ? "正在登录..." : "登录系统"}
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-slate-600 dark:text-slate-300">
          还没有账号？
          <Link href={ROUTES.register} className="ml-1 font-medium text-brand hover:text-brand-light">
            申请注册
          </Link>
        </div>
      </AuthCard>
      <p className="mt-6 text-center text-xs text-slate-700 dark:text-slate-400">
        &copy; {currentYear} 工业故障诊断平台后台
      </p>
    </AuthLayout>
  );
}
