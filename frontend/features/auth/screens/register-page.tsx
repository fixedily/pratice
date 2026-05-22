"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { maintenanceRegister } from "@/features/auth/api"
import { AuthPageCard, AuthPageShell } from "@/features/auth/components/auth-page-shell"
import { CaptchaField, useCaptchaField } from "@/features/auth/components/captcha-field"
import { ROUTES } from "@/shared/lib/routes"
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  User,
} from "lucide-react"

function InputField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  icon: Icon,
  error,
  autoComplete,
  showToggle,
  onToggle,
  showPassword,
}: {
  id: string
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  icon: React.ElementType
  error?: string
  autoComplete?: string
  showToggle?: boolean
  onToggle?: () => void
  showPassword?: boolean
}) {
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
          type={showToggle ? (showPassword ? "text" : "password") : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`
            block w-full rounded-md border bg-slate-100/90 py-2.5 pl-10 pr-10
            text-sm text-slate-900 placeholder:text-slate-500
            transition-all duration-200
            focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand/50
            dark:bg-[rgba(255,255,255,0.02)] dark:text-primary dark:placeholder:text-tertiary dark:focus:bg-[rgba(255,255,255,0.04)]
            ${error ? "border-red-500/50" : "border-border"}
          `}
        />
        {showToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 transition-colors hover:text-slate-800 dark:text-tertiary dark:hover:text-secondary"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default function RegisterPage() {
  const currentYear = new Date().getFullYear()
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string
    password?: string
    confirmPassword?: string
  }>({})
  const captcha = useCaptchaField()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setFieldErrors({})

    const errors: typeof fieldErrors = {}
    if (!username.trim()) errors.username = "请输入用户名"
    else if (username.trim().length < 3) errors.username = "用户名至少 3 个字符"
    if (!password) errors.password = "请输入密码"
    else if (password.length < 6) errors.password = "密码至少 6 个字符"
    if (!confirmPassword) errors.confirmPassword = "请再次输入密码"
    else if (confirmPassword !== password) errors.confirmPassword = "两次输入的密码不一致"
    const captchaOk = captcha.validate()

    if (Object.keys(errors).length > 0 || !captchaOk) {
      setFieldErrors(errors)
      return
    }

    setIsLoading(true)
    try {
      await maintenanceRegister(username.trim(), password, captcha.payload())
      setSuccess("注册成功，正在返回登录页")
      setTimeout(() => {
        router.push(`${ROUTES.login}?registered=1&username=${encodeURIComponent(username.trim())}`)
      }, 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : "注册失败")
      void captcha.loadCaptcha()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthPageShell>
        <Link
          href={ROUTES.login}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-sm text-slate-700 backdrop-blur-sm transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/[0.10] dark:bg-panel/35 dark:text-[#9fb0c5] dark:hover:border-white/[0.22] dark:hover:bg-white/[0.08] dark:hover:text-[#f5f7fa]"
        >
          <ArrowLeft className="h-4 w-4" />
          返回登录
        </Link>

        <AuthPageCard>
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-white/90 dark:border-border dark:bg-[rgba(255,255,255,0.03)]">
              <KeyRound className="h-7 w-7 text-brand" />
            </div>
            <h1 className="text-xl font-semibold text-brand dark:text-primary">注册运维账号</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">注册后默认进入检修员角色</p>
          </div>

          {error ? (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          ) : null}
          {success ? (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-sm text-emerald-300">{success}</p>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <InputField
              id="username"
              label="用户名"
              type="text"
              value={username}
              onChange={setUsername}
              placeholder="请输入用户名"
              icon={User}
              error={fieldErrors.username}
              autoComplete="username"
            />
            <InputField
              id="password"
              label="密码"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="请输入密码"
              icon={Lock}
              error={fieldErrors.password}
              autoComplete="new-password"
              showToggle
              onToggle={() => setShowPassword(!showPassword)}
              showPassword={showPassword}
            />
            <InputField
              id="confirmPassword"
              label="确认密码"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="请再次输入密码"
              icon={Lock}
              error={fieldErrors.confirmPassword}
              autoComplete="new-password"
              showToggle
              onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
              showPassword={showConfirmPassword}
            />

            <CaptchaField
              value={captcha.captchaCode}
              onChange={captcha.setCaptchaCode}
              error={captcha.captchaError}
              image={captcha.captchaImage}
              loading={captcha.captchaLoading}
              onRefresh={() => void captcha.loadCaptcha()}
            />

            <button
              type="submit"
              disabled={isLoading}
              className="
                relative mt-6 flex w-full items-center justify-center gap-2 rounded-md
                bg-brand px-4 py-2.5 text-sm font-medium text-white
                shadow-lg shadow-brand/20
                transition-all duration-200
                hover:bg-brand-light hover:shadow-brand/30
                focus:outline-none focus:ring-2 focus:ring-brand/50 focus:ring-offset-2 focus:ring-offset-background
                disabled:cursor-not-allowed disabled:opacity-60
              "
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在注册...
                </>
              ) : (
                <>
                  <User className="h-4 w-4" />
                  创建账号
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-600 dark:text-slate-300">
            已有账号？
            <Link href={ROUTES.login} className="ml-1 font-medium text-brand hover:text-brand-light">
              立即登录
            </Link>
          </div>
        </AuthPageCard>

        <p className="mt-6 text-center text-xs text-slate-700 dark:text-slate-400">
          &copy; {currentYear} 工业故障诊断平台后台
        </p>
    </AuthPageShell>
  )
}
