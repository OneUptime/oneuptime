import HCaptcha from "@hcaptcha/react-hcaptcha";
import React from "react";

export interface CaptchaProps {
  siteKey: string;
  resetSignal?: number | undefined;
  error?: string | undefined;
  onTokenChange?: (token: string) => void;
  onBlur?: (() => void) | undefined;
  className?: string | undefined;
}

const Captcha: React.FC<CaptchaProps> = ({
  siteKey,
  resetSignal = 0,
  error,
  onTokenChange,
  onBlur,
  className,
}: CaptchaProps): JSX.Element => {
  const captchaRef = React.useRef<HCaptcha | null>(null);
  const onTokenChangeRef = React.useRef<typeof onTokenChange>(onTokenChange);

  React.useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  const handleTokenChange = React.useCallback((token: string | null) => {
    onTokenChangeRef.current?.(token || "");
  }, []);

  React.useEffect(() => {
    captchaRef.current?.resetCaptcha();
    handleTokenChange("");
  }, [resetSignal, handleTokenChange]);

  if (!siteKey) {
    return (
      <div className={className || "text-center text-sm text-red-500"}>
        Captcha is not configured.
      </div>
    );
  }

  return (
    <div className={className || "flex flex-col items-center gap-2"}>
      <HCaptcha
        sitekey={siteKey}
        ref={captchaRef}
        onVerify={(token: string) => {
          handleTokenChange(token);
          onBlur?.();
        }}
        onExpire={() => {
          handleTokenChange(null);
          captchaRef.current?.resetCaptcha();
          onBlur?.();
        }}
        onError={() => {
          handleTokenChange(null);
          onBlur?.();
        }}
      />
      {error && <span className="text-sm text-red-500">{error}</span>}
    </div>
  );
};

export default Captcha;
