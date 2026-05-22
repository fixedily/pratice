"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, CheckCircle2, KeyRound, Loader2, Lock, Mail, Phone, User } from "lucide-react";

import {
  MaintenanceAuthError,
  maintenanceRegister,
  maintenanceSendEmailCode,
  type MaintenanceRequestedRole,
} from "@/features/auth/api";
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

type RegisterErrors = Partial<Record<
  | "username"
  | "realName"
  | "email"
  | "emailCode"
  | "department"
  | "requestedRole"
  | "password"
  | "confirmPassword"
  | "agreement",
  string
>>;

const roleOptions: Array<{ value: MaintenanceRequestedRole; label: string }> = [
  { value: "inspector", label: "巡检员" },
  { value: "maintainer", label: "检修员" },
  { value: "engineer", label: "设备工程师" },
];

export default function RegisterPage() {
  const currentYear = new Date().getFullYear();
  const router = useRouter();
  const captcha = useCaptchaField();
  const [username, setUsername] = useState("");
  const [realName, setRealName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [department, setDepartment] = useState("");
  const [requestedRole, setRequestedRole] = useState<MaintenanceRequestedRole>("maintainer");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreement, setAgreement] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [errors, setErrors] = useState<RegisterErrors>({});

  useEffect(() => {
    if (emailCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setEmailCountdown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [emailCountdown]);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSendEmailCode = async () => {
    const cleanEmail = email.trim().toLowerCase();
    setMessage(null);
    setErrors((prev) => ({ ...prev, email: undefined }));
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setErrors((prev) => ({ ...prev, email: "请输入有效邮箱" }));
      return;
    }
    setEmailSending(true);
    try {
      await maintenanceSendEmailCode({ email: cleanEmail, scene: "register" });
      setEmailCountdown(60);
      setMessage({ tone: "success", text: "邮箱验证码已发送，请在 10 分钟内完成验证。" });
    } catch (error) {
      if (error instanceof MaintenanceAuthError && error.retryAfterSeconds) {
        setEmailCountdown(error.retryAfterSeconds);
      }
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "邮箱验证码发送失败。" });
    } finally {
      setEmailSending(false);
    }
  };

  const validate = () => {
    const nextErrors: RegisterErrors = {};
    if (!username.trim()) nextErrors.username = "请输入用户名";
    else if (username.trim().length < 3) nextErrors.username = "用户名至少 3 个字符";
    if (!realName.trim()) nextErrors.realName = "请输入真实姓名";
    if (email.trim() && !isValidEmail(email.trim())) nextErrors.email = "请输入有效邮箱";
    if (!department.trim()) nextErrors.department = "请输入所属部门";
    const passwordError = validatePassword(password, username.trim());
    if (passwordError) nextErrors.password = passwordError;
    if (!confirmPassword) nextErrors.confirmPassword = "请再次输入密码";
    else if (confirmPassword !== password) nextErrors.confirmPassword = "两次输入的密码不一致";
    if (!agreement) nextErrors.agreement = "请先同意平台使用规范";
    const captchaOk = captcha.validate();
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 && captchaOk;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setIsLoading(true);
    try {
      await maintenanceRegister(
        {
          username: username.trim(),
          real_name: realName.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          email_code: emailCode.trim() || undefined,
          department: department.trim(),
          requested_role: requestedRole,
          password,
          confirm_password: confirmPassword,
        },
        captcha.payload(),
      );
      setMessage({ tone: "success", text: "注册申请已提交，请等待管理员审核。" });
      window.setTimeout(() => {
        router.push(`${ROUTES.login}?registered=1&username=${encodeURIComponent(username.trim())}`);
      }, 1000);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "申请提交失败，请稍后重试。" });
      void captcha.loadCaptcha();
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
          <h1 className="text-xl font-semibold text-brand dark:text-primary">申请运维账号</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">提交后需管理员审核，审核通过后方可登录</p>
        </div>

        {message ? <AuthNotice tone={message.tone}>{message.text}</AuthNotice> : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthInput id="username" label="用户名" value={username} onChange={setUsername} placeholder="请输入用户名" icon={User} error={errors.username} autoComplete="username" />
          <AuthInput id="realName" label="真实姓名" value={realName} onChange={setRealName} placeholder="请输入真实姓名" icon={User} error={errors.realName} autoComplete="name" />
          <AuthInput id="phone" label="手机号" value={phone} onChange={setPhone} placeholder="建议填写，用于密码找回" icon={Phone} autoComplete="tel" />
          <div className="space-y-2">
            <AuthInput id="email" label="邮箱" value={email} onChange={setEmail} placeholder="建议填写，用于密码找回" icon={Mail} error={errors.email} autoComplete="email" />
            <div className="flex gap-2">
              <AuthInput id="emailCode" label="邮箱验证码" value={emailCode} onChange={setEmailCode} placeholder="请输入 6 位验证码" icon={Mail} error={errors.emailCode} maxLength={6} inputMode="numeric" />
              <button
                type="button"
                onClick={() => void handleSendEmailCode()}
                disabled={emailSending || emailCountdown > 0}
                className="mt-[25px] h-[42px] w-32 shrink-0 rounded-md border border-brand/30 bg-white/85 text-sm font-medium text-brand transition-colors hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/[0.03]"
              >
                {emailSending ? "发送中..." : emailCountdown > 0 ? `${emailCountdown}s 后重试` : "发送验证码"}
              </button>
            </div>
          </div>
          <AuthInput id="department" label="所属部门" value={department} onChange={setDepartment} placeholder="请输入所属部门" icon={Building2} error={errors.department} />

          <div className="space-y-1.5">
            <label htmlFor="requestedRole" className="block text-sm font-medium text-primary">申请角色</label>
            <select
              id="requestedRole"
              value={requestedRole}
              onChange={(event) => setRequestedRole(event.target.value as MaintenanceRequestedRole)}
              className="block w-full rounded-md border border-border bg-slate-100/90 px-3 py-2.5 text-sm text-slate-900 focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand/50 dark:bg-[rgba(255,255,255,0.02)] dark:text-primary"
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </div>

          <PasswordInput id="password" label="密码" value={password} onChange={setPassword} placeholder="请输入登录密码" icon={Lock} error={errors.password} autoComplete="new-password" visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
          <PasswordStrengthMeter password={password} username={username.trim()} />
          <PasswordInput id="confirmPassword" label="确认密码" value={confirmPassword} onChange={setConfirmPassword} placeholder="请再次输入密码" icon={Lock} error={errors.confirmPassword} autoComplete="new-password" visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((v) => !v)} />

          <CaptchaField value={captcha.captchaCode} onChange={captcha.setCaptchaCode} error={captcha.captchaError} image={captcha.captchaImage} loading={captcha.captchaLoading} onRefresh={() => void captcha.loadCaptcha()} />

          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={agreement} onChange={(event) => setAgreement(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border border-border bg-card text-brand focus:ring-1 focus:ring-brand/50 focus:ring-offset-0" />
            <span>我已阅读并同意平台使用规范</span>
          </label>
          {errors.agreement ? <p className="text-xs text-red-400">{errors.agreement}</p> : null}

          <button type="submit" disabled={isLoading} className="relative mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand/20 transition-all duration-200 hover:bg-brand-light hover:shadow-brand/30 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {isLoading ? "正在提交..." : "提交申请"}
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-slate-600 dark:text-slate-300">
          已有账号？
          <Link href={ROUTES.login} className="ml-1 font-medium text-brand hover:text-brand-light">立即登录</Link>
        </div>
      </AuthCard>
      <p className="mt-6 text-center text-xs text-slate-700 dark:text-slate-400">&copy; {currentYear} 工业故障诊断平台后台</p>
    </AuthLayout>
  );
}
