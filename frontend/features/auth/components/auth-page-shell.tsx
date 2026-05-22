import type { ReactNode } from "react";

/** 登录 / 注册 / 忘记密码共用背景与页面容器 */
export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eef4fb] px-4 py-12 dark:bg-[#071018]">
      <AuthPageBackground />
      <div className="relative z-10 w-full max-w-lg">{children}</div>
    </div>
  );
}

export const AuthLayout = AuthPageShell;

export function AuthPageBackground() {
  return (
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
      <div
        className="absolute inset-0 opacity-[0.015] dark:opacity-[0.024]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12),transparent_58%)] dark:bg-[radial-gradient(circle_at_center,rgba(14,165,233,0.06),transparent_58%)]" />
    </div>
  );
}

/** 与登录页一致的表单卡片样式 */
export function AuthPageCard({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-panel/80 p-8 shadow-2xl backdrop-blur-sm dark:border-cyan-300/12 dark:bg-[#0b141b]/82 dark:shadow-[0_28px_80px_rgba(0,0,0,0.55),0_0_55px_rgba(20,184,166,0.12)] dark:backdrop-blur-xl sm:p-10">
      <div className="pointer-events-none absolute inset-x-8 top-0 hidden h-px bg-[linear-gradient(90deg,transparent,rgba(45,212,191,0.55),transparent)] dark:block" />
      <div className="pointer-events-none absolute inset-0 hidden rounded-xl ring-1 ring-inset ring-white/[0.04] dark:block" />
      <div className="relative">{children}</div>
    </div>
  );
}

export const AuthCard = AuthPageCard;
