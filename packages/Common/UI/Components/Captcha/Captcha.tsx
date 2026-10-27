import HCaptcha from "@hcaptcha/react-hcaptcha";
import { Theme, useTheme } from "../../Utils/Theme";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
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
  const translator: Translator = useTranslator();
  /*
   * The widget in the page's theme: a white box on a dark sign-in page
   * otherwise. A public form is always light, so its widget is too.
   */
  const theme: Theme = useTheme();
  const captchaRef: React.MutableRefObject<HCaptcha | null> =
    React.useRef<HCaptcha | null>(null);
  const onTokenChangeRef: React.MutableRefObject<
    CaptchaProps["onTokenChange"]
  > = React.useRef<CaptchaProps["onTokenChange"]>(onTokenChange);

  React.useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  const handleTokenChange: (token: string | null) => void = React.useCallback(
    (token: string | null) => {
      onTokenChangeRef.current?.(token || "");
    },
    [],
  );

  React.useEffect(() => {
    captchaRef.current?.resetCaptcha();
    handleTokenChange("");
  }, [resetSignal, handleTokenChange]);

  if (!siteKey) {
    return (
      <div className={className || "text-center text-sm text-red-500"}>
        {translator.translateText("Captcha is not configured.")}
      </div>
    );
  }

  return (
    <div className={className || "flex flex-col items-center gap-2"}>
      <HCaptcha
        sitekey={siteKey}
        theme={theme === Theme.Dark ? "dark" : "light"}
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
