// Type-only on purpose: the one place the captcha is loaded is the import() below.
import type { CaptchaProps } from "./Captcha";
import React, {
  ComponentType,
  FunctionComponent,
  lazy,
  ReactElement,
  Suspense,
} from "react";

/*
 * The captcha as the sign-in and sign-up pages draw it, while their server
 * asks for one: an operator turns it on (CAPTCHA_ENABLED, off unless they
 * do). So it is a file of its own, with hCaptcha's widget and the loader
 * that fetches hCaptcha's script, loaded when a captcha is drawn - and the
 * pages of a server that asks for none download none of it before they draw
 * (packages/Common/Scripts/first-load-budgets.js). Until it arrives, its
 * place is what hCaptcha's widget draws until hCaptcha's own script
 * arrives: the empty box the captcha lays its widget out in.
 */
const Captcha: React.LazyExoticComponent<ComponentType<CaptchaProps>> = lazy(
  () => {
    return import("./Captcha");
  },
);

const LazyCaptcha: FunctionComponent<CaptchaProps> = (
  props: CaptchaProps,
): ReactElement => {
  return (
    <Suspense
      fallback={
        <div
          className={props.className || "flex flex-col items-center gap-2"}
        />
      }
    >
      <Captcha {...props} />
    </Suspense>
  );
};

export default LazyCaptcha;
