"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw, ShieldCheck } from "lucide-react";

import { maintenanceFetchCaptcha } from "@/features/auth/api";

/** 与后端 captcha_service.CAPTCHA_LENGTH 一致 */
export const CAPTCHA_CODE_LENGTH = 4;

export function normalizeCaptchaInput(value: string): string {
  return value.toUpperCase().slice(0, CAPTCHA_CODE_LENGTH);
}

export type CaptchaPayload = {
  captchaId: string;
  captchaCode: string;
};

export function useCaptchaField() {
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | undefined>();

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const data = await maintenanceFetchCaptcha();
      setCaptchaId(data.captchaId);
      setCaptchaImage(data.image);
      setCaptchaCode("");
      setCaptchaError(undefined);
    } catch (e) {
      setCaptchaError(e instanceof Error ? e.message : "验证码加载失败，请稍后重试");
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  const setCaptchaCodeNormalized = useCallback((value: string) => {
    setCaptchaCode(normalizeCaptchaInput(value));
  }, []);

  const validate = () => {
    const code = captchaCode.trim();
    if (!code) {
      setCaptchaError("请输入验证码");
      return false;
    }
    if (code.length !== CAPTCHA_CODE_LENGTH) {
      setCaptchaError(`验证码为 ${CAPTCHA_CODE_LENGTH} 位`);
      return false;
    }
    if (!captchaId) {
      setCaptchaError("验证码未加载，请点击图片刷新");
      return false;
    }
    setCaptchaError(undefined);
    return true;
  };

  const payload = (): CaptchaPayload => ({
    captchaId,
    captchaCode: captchaCode.trim(),
  });

  return {
    captchaId,
    captchaImage,
    captchaCode,
    setCaptchaCode: setCaptchaCodeNormalized,
    captchaLoading,
    captchaError,
    loadCaptcha,
    validate,
    payload,
  };
}

type CaptchaFieldProps = {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  image: string;
  loading: boolean;
  onRefresh: () => void;
};

export function CaptchaField({ value, onChange, error, image, loading, onRefresh }: CaptchaFieldProps) {
  return (
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
            value={value}
            onChange={(e) => onChange(normalizeCaptchaInput(e.target.value))}
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
              ${error ? "border-red-500/50" : "border-border dark:border-cyan-300/20 dark:shadow-[0_0_18px_rgba(45,212,191,0.08)]"}
            `}
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
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
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="图形验证码" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-[11px] text-tertiary">
              {loading ? "加载中…" : "点击获取"}
            </span>
          )}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
            <RefreshCw className={`h-4 w-4 text-brand-light ${loading ? "animate-spin" : ""}`} />
          </span>
        </button>
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : (
        <p className="text-xs text-slate-500 dark:text-tertiary">验证码 1 分钟内有效，点击图片可刷新</p>
      )}
    </div>
  );
}
