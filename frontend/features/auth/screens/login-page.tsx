"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MaintenanceAuthError, maintenanceFetchCaptcha, maintenanceLogin } from "@/features/auth/api"
import {
  CAPTCHA_CODE_LENGTH,
  normalizeCaptchaInput,
} from "@/features/auth/components/captcha-field"
import { ROUTES } from "@/shared/lib/routes"
import { setMaintenanceToken } from "@/features/auth/lib/token-store"
import {
  Eye,
  EyeOff,
  Lock,
  User,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"

const REMEMBERED_CREDENTIALS_KEY = "dachuang_remembered_password"
const LOGIN_LOCK_MESSAGE = "登录失败次数过多，请稍后再试"
type BannerTone = "info" | "warning" | "error"

// 输入框组件
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
        {showToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 transition-colors hover:text-slate-800 dark:text-tertiary dark:hover:text-secondary"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  )
}

// 状态提示 Banner
function StatusBanner({
  message,
  tone,
}: {
  message: string
  tone: BannerTone
}) {
  const Icon = tone === "info" ? Info : tone === "warning" ? AlertTriangle : XCircle
  const palette =
    tone === "info"
      ? {
          wrapper: "border-sky-500/25 bg-sky-500/10",
          icon: "text-sky-500",
          text: "text-sky-700 dark:text-sky-300",
          button: "text-sky-500 hover:text-sky-600 dark:hover:text-sky-300",
        }
      : tone === "warning"
        ? {
            wrapper: "border-amber-500/25 bg-amber-500/10",
            icon: "text-amber-500",
            text: "text-amber-700 dark:text-amber-300",
            button: "text-amber-500 hover:text-amber-600 dark:hover:text-amber-300",
          }
        : {
            wrapper: "border-red-500/20 bg-red-500/10",
            icon: "text-red-400",
            text: "text-red-700 dark:text-red-300",
            button: "text-red-400 hover:text-red-500 dark:hover:text-red-300",
          }

  return (
    <div className={`mb-4 flex items-start gap-3 rounded-lg border p-3 ${palette.wrapper}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${palette.icon}`} />
      <div className="flex-1">
        <p className={`text-sm ${palette.text}`}>{message}</p>
      </div>
    </div>
  )
}

// 成功提示Banner
function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        <p className="text-sm text-emerald-300">{message}</p>
      </div>
      <Link
        href={ROUTES.dashboard}
        className="shrink-0 text-sm font-medium text-emerald-200 underline-offset-4 hover:text-emerald-100 hover:underline"
      >
        进入工作台 →
      </Link>
    </div>
  )
}

export default function LoginPage() {
  const currentYear = new Date().getFullYear()
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [captchaId, setCaptchaId] = useState("")
  const [captchaImage, setCaptchaImage] = useState("")
  const [captchaCode, setCaptchaCode] = useState("")
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [banner, setBanner] = useState<{ message: string; tone: BannerTone } | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string
    password?: string
    captchaCode?: string
  }>({})
  const [nextPath, setNextPath] = useState<string>(ROUTES.dashboard)
  const [lockUntil, setLockUntil] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const isLoginLocked = lockUntil !== null && nowMs < lockUntil

  useEffect(() => {
    if (!lockUntil) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [lockUntil])

  useEffect(() => {
    if (lockUntil && nowMs >= lockUntil) {
      setLockUntil(null)
      setBanner((prev) => (prev?.message === LOGIN_LOCK_MESSAGE ? null : prev))
    }
  }, [lockUntil, nowMs])

  useEffect(() => {
    setLockUntil(null)
  }, [username])

  const loadCaptcha = async () => {
    setCaptchaLoading(true)
    try {
      const data = await maintenanceFetchCaptcha()
      setCaptchaId(data.captchaId)
      setCaptchaImage(data.image)
      setCaptchaCode("")
    } catch (e) {
      setBanner({
        message: e instanceof Error ? e.message : "验证码加载失败，请稍后重试",
        tone: "error",
      })
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => {
    void loadCaptcha()
    const params = new URLSearchParams(window.location.search)
    const rawNext = params.get("next")?.trim()
    const registeredUsername = params.get("username")?.trim()
    if (rawNext && rawNext.startsWith("/")) {
      setNextPath(rawNext)
    }
    const reason = params.get("reason")
    if (reason === "expired") {
      setBanner({ message: "登录已过期，请重新登录", tone: "warning" })
    } else if (reason === "auth_required") {
      setBanner({ message: "请先登录后进入演示", tone: "info" })
    }
    try {
      const raw = window.localStorage.getItem(REMEMBERED_CREDENTIALS_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { username?: string; password?: string }
        if (saved.username) setUsername(saved.username)
        if (saved.password) setPassword(saved.password)
        if (saved.username || saved.password) setRememberMe(true)
      }
    } catch {
      window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY)
    }
    if (params.get("registered") === "1") {
      setSuccess("注册成功，请使用新账号登录")
      if (registeredUsername) setUsername(registeredUsername)
    }
    if (params.get("reset") === "1") {
      setSuccess("密码已重置，请使用新密码登录")
      if (registeredUsername) setUsername(registeredUsername)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoginLocked) {
      setBanner({ message: LOGIN_LOCK_MESSAGE, tone: "error" })
      return
    }
    setBanner(null)
    setFieldErrors({})

    // 验证
    const errors: typeof fieldErrors = {}
    if (!username) errors.username = "请输入账号"
    if (!password) errors.password = "请输入密码"
    const code = captchaCode.trim()
    if (!code) errors.captchaCode = "请输入验证码"
    else if (code.length !== CAPTCHA_CODE_LENGTH) errors.captchaCode = `验证码为 ${CAPTCHA_CODE_LENGTH} 位`
    if (!captchaId) errors.captchaCode = "验证码未加载，请点击图片刷新"

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setIsLoading(true)

    try {
      const data = await maintenanceLogin(username, password, {
        captchaId,
        captchaCode: captchaCode.trim(),
      })
      setMaintenanceToken(data.access_token)
      if (rememberMe) {
        window.localStorage.setItem(
          REMEMBERED_CREDENTIALS_KEY,
          JSON.stringify({ username, password }),
        )
      } else {
        window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY)
      }
      setSuccess(rememberMe ? "登录成功，已保存本机登录信息" : "登录成功，正在进入系统")
      router.push(nextPath)
    } catch (e) {
      if (e instanceof MaintenanceAuthError && e.businessCode === "ACCOUNT_LOCKED") {
        const sec = e.retryAfterSeconds ?? 60
        setLockUntil(Date.now() + sec * 1000)
        setBanner({ message: LOGIN_LOCK_MESSAGE, tone: "error" })
      } else {
        setBanner({ message: e instanceof Error ? e.message : "登录失败", tone: "error" })
        void loadCaptcha()
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eef4fb] px-4 py-12 dark:bg-[#071018]">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat dark:hidden"
          style={{ backgroundImage: "url('/images/auth/login-bg-light.png')" }}
        />
        <div
          className="absolute inset-0 hidden bg-cover bg-center bg-no-repeat dark:block"
          style={{ backgroundImage: "url('/images/auth/login-bg-dark.png')" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.5),rgba(255,255,255,0.16))] dark:bg-[linear-gradient(180deg,rgba(7,16,24,0.22),rgba(7,16,24,0.4))]" />
        {/* 噪点纹理 */}
        <div
          className="absolute inset-0 opacity-[0.015] dark:opacity-[0.024]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12),transparent_58%)] dark:bg-[radial-gradient(circle_at_center,rgba(14,165,233,0.06),transparent_58%)]" />
      </div>

      {/* 登录卡片 */}
      <div className="relative z-10 w-full max-w-lg">
        {/* 返回主站链接 */}
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-sm text-slate-700 backdrop-blur-sm transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/[0.10] dark:bg-panel/35 dark:text-[#9fb0c5] dark:hover:border-white/[0.22] dark:hover:bg-white/[0.08] dark:hover:text-[#f5f7fa]"
        >
          <ArrowLeft className="h-4 w-4" />
          返回主站
        </Link>

        {/* 主卡片 */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-panel/80 p-8 shadow-2xl backdrop-blur-sm dark:border-cyan-300/12 dark:bg-[#0b141b]/82 dark:shadow-[0_28px_80px_rgba(0,0,0,0.55),0_0_55px_rgba(20,184,166,0.12)] dark:backdrop-blur-xl sm:p-10">
          <div className="pointer-events-none absolute inset-x-8 top-0 hidden h-px bg-[linear-gradient(90deg,transparent,rgba(45,212,191,0.55),transparent)] dark:block" />
          <div className="pointer-events-none absolute inset-0 hidden rounded-xl ring-1 ring-inset ring-white/[0.04] dark:block" />
          {/* Logo和标题 */}
          <div className="relative mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-white/90 dark:border-border dark:bg-[rgba(255,255,255,0.03)]">
              <KeyRound className="h-7 w-7 text-brand" />
            </div>
            <h1 className="text-xl font-semibold text-brand dark:text-primary">运维管理后台</h1>
          </div>

          {/* 错误/成功提示 */}
          {banner && <StatusBanner message={banner.message} tone={banner.tone} />}
          {success && <SuccessBanner message={success} />}

          {/* 登录表单 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <InputField
              id="username"
              label="账号"
              type="text"
              value={username}
              onChange={setUsername}
              placeholder="请输入账号"
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
              autoComplete="current-password"
              showToggle
              onToggle={() => setShowPassword(!showPassword)}
              showPassword={showPassword}
            />

            <div className="space-y-1.5">
              <label htmlFor="captchaCode" className="block text-sm font-medium text-primary">
                验证码
              </label>
              <div className="flex gap-2.5">
                <div className="relative min-w-0 flex-1">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <ShieldCheck className="h-4 w-4 text-slate-500 dark:text-tertiary" />
                  </div>
                  <input
                    id="captchaCode"
                    type="text"
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(normalizeCaptchaInput(e.target.value))}
                    placeholder="4 位验证码"
                    autoComplete="off"
                    maxLength={CAPTCHA_CODE_LENGTH}
                    inputMode="text"
                    className={`
                      block w-full rounded-md border bg-slate-100/90 py-2.5 pl-10 pr-3
                      text-sm uppercase tracking-[0.2em] text-slate-900 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500
                      transition-all duration-200
                      focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand/50
                      dark:bg-[rgba(255,255,255,0.02)] dark:text-primary dark:placeholder:text-tertiary dark:focus:bg-[rgba(255,255,255,0.04)]
                      ${fieldErrors.captchaCode ? "border-red-500/50" : "border-border dark:border-cyan-300/20 dark:shadow-[0_0_18px_rgba(45,212,191,0.08)]"}
                    `}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadCaptcha()}
                  disabled={captchaLoading}
                  title="点击刷新验证码"
                  aria-label="刷新验证码"
                  className="
                    group relative h-[42px] w-[128px] shrink-0 overflow-hidden rounded-md border
                    border-border bg-[#071018]
                    transition-all duration-200
                    hover:border-brand/50 hover:shadow-[0_0_20px_rgba(45,212,191,0.22)]
                    focus:outline-none focus:ring-2 focus:ring-brand/40
                    disabled:cursor-not-allowed disabled:opacity-60
                    dark:border-cyan-300/25 dark:shadow-[0_0_16px_rgba(45,212,191,0.12)]
                  "
                >
                  {captchaImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={captchaImage} alt="图形验证码" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[11px] text-tertiary">
                      {captchaLoading ? "加载中…" : "点击获取"}
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                    <RefreshCw className={`h-4 w-4 text-brand-light ${captchaLoading ? "animate-spin" : ""}`} />
                  </span>
                </button>
              </div>
              {fieldErrors.captchaCode ? (
                <p className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  {fieldErrors.captchaCode}
                </p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-tertiary">验证码 1 分钟内有效，点击图片可刷新</p>
              )}
            </div>

            {/* 登录辅助项 */}
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border border-border bg-card text-brand focus:ring-1 focus:ring-brand/50 focus:ring-offset-0"
                />
                <span className="text-sm text-slate-700 dark:text-slate-200">记住密码</span>
              </label>
              <Link
                href={ROUTES.forgotPassword}
                className="text-sm text-brand-dark transition-colors hover:text-brand dark:text-brand dark:hover:text-brand-light"
              >
                忘记密码？
              </Link>
            </div>

            {/* 登录按钮 */}
            <button
              type="submit"
              disabled={isLoading || isLoginLocked}
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
                  正在登录...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  登录系统
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-600 dark:text-slate-300">
            还没有账号？
            <Link href={ROUTES.register} className="ml-1 font-medium text-brand hover:text-brand-light">
              立即注册
            </Link>
          </div>

        </div>

        {/* 版权信息 */}
        <p className="mt-6 text-center text-xs text-slate-700 dark:text-slate-400">
          &copy; {currentYear} 工业故障诊断平台后台
        </p>
      </div>
    </div>
  )
}
