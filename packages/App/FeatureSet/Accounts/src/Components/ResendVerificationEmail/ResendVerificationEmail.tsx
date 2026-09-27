import {
  DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
  VerificationEmailResendCredential,
  VerificationEmailResendOutcome,
  VerificationEmailResendResult,
  clampCooldownSeconds,
  formatCountdown,
  getRetryAfterSecondsFromError,
  requestVerificationEmailResend,
} from "../../Utils/VerificationEmailResend";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * "Resend verification email", with the wait the server imposes between two
 * emails shown as a countdown instead of discovered by clicking.
 *
 * The countdown is a convenience, not the control: the server enforces its
 * own cooldown, per-window cap and per-credential cap whatever this button
 * does, and answers a click that comes too early with how long is left. So
 * every wait shown here comes from the server's last answer (or the signup
 * response), and the button only exists to stop people clicking into a
 * refusal they could have seen coming.
 */

export interface ComponentProps {
  credential: VerificationEmailResendCredential;
  initialCooldownSeconds?: number | undefined;
  onAlreadyVerified?: (() => void) | undefined;
  className?: string | undefined;
}

interface ResendStatus {
  // Bumped on every new message so the alert remounts and is announced again.
  seq: number;
  type: AlertType;
  message: string;
}

interface CooldownState {
  availableAt: number;
}

/*
 * Added to every wait an answer to this button reports. The server rounds
 * its waits to whole seconds and measures some of them against database
 * timestamps rather than its own clock, so a click at exactly "0:00" can land
 * a moment early and buy nothing but another refusal. The initial wait is
 * used as given: it describes a send that happened before this page was even
 * rendered, so it already errs late.
 */
const SERVER_COOLDOWN_SLACK_IN_MS: number = 1000;

const COUNTDOWN_TICK_IN_MS: number = 1000;

const SIGN_IN_ROUTE: Route = new Route("/accounts/login");

type GetRemainingSecondsFunction = (availableAt: number) => number;

const getRemainingSeconds: GetRemainingSecondsFunction = (
  availableAt: number,
): number => {
  return Math.max(0, Math.ceil((availableAt - Date.now()) / 1000));
};

type GetAvailableAtFunction = (
  cooldownSeconds: number,
  fromServer: boolean,
) => number;

const getAvailableAt: GetAvailableAtFunction = (
  cooldownSeconds: number,
  fromServer: boolean,
): number => {
  const seconds: number = clampCooldownSeconds(cooldownSeconds);

  if (seconds <= 0) {
    return Date.now();
  }

  return (
    Date.now() + seconds * 1000 + (fromServer ? SERVER_COOLDOWN_SLACK_IN_MS : 0)
  );
};

type PendingFocus = "status" | "sign-in" | null;

const ResendVerificationEmail: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { t, i18n } = useTranslation();

  /*
   * An absolute deadline rather than a number of seconds counted down by the
   * interval: timers are throttled in background tabs and paused on sleeping
   * laptops, and a counter would drift behind the server by exactly that
   * much. Recomputing from the clock on every tick cannot drift.
   */
  const [cooldown, setCooldown] = useState<CooldownState>((): CooldownState => {
    return {
      availableAt: getAvailableAt(props.initialCooldownSeconds ?? 0, false),
    };
  });

  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    (): number => {
      return getRemainingSeconds(cooldown.availableAt);
    },
  );

  const [isSending, setIsSending] = useState<boolean>(false);
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [status, setStatus] = useState<ResendStatus | null>(null);

  /*
   * State alone cannot stop a double click: both clicks can run before React
   * re-renders the disabled button. A ref is read synchronously.
   */
  const isSendingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const statusSeqRef: React.MutableRefObject<number> = useRef<number>(0);
  const pendingFocusRef: React.MutableRefObject<PendingFocus> =
    useRef<PendingFocus>(null);
  const statusRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const signInLinkRef: React.RefObject<HTMLAnchorElement> =
    useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const initialRemaining: number = getRemainingSeconds(cooldown.availableAt);

    setRemainingSeconds(initialRemaining);

    if (initialRemaining <= 0) {
      return undefined;
    }

    const intervalId: number = window.setInterval((): void => {
      const nextRemaining: number = getRemainingSeconds(cooldown.availableAt);

      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        window.clearInterval(intervalId);
      }
    }, COUNTDOWN_TICK_IN_MS);

    return (): void => {
      window.clearInterval(intervalId);
    };
  }, [cooldown]);

  /*
   * Where keyboard and screen reader focus goes once a request settles. The
   * button was disabled while it ran, which drops focus to <body>; left
   * there, the next Tab starts again from the top of the page and the result
   * is easy to miss. Only taken when nothing else holds focus, so it never
   * pulls someone out of a field they moved to in the meantime -- except for
   * "already verified", where the button is gone and the sign-in link that
   * replaces it is the only thing left to do.
   */
  useLayoutEffect(() => {
    const pendingFocus: PendingFocus = pendingFocusRef.current;

    if (!pendingFocus) {
      return;
    }

    pendingFocusRef.current = null;

    if (pendingFocus === "sign-in") {
      signInLinkRef.current?.focus();
      return;
    }

    const activeElement: Element | null = document.activeElement;

    if (!activeElement || activeElement === document.body) {
      statusRef.current?.focus();
    }
  }, [status, isVerified]);

  type ShowStatusFunction = (type: AlertType, message: string) => void;

  const showStatus: ShowStatusFunction = (
    type: AlertType,
    message: string,
  ): void => {
    statusSeqRef.current += 1;
    setStatus({ seq: statusSeqRef.current, type: type, message: message });
  };

  type StartCooldownFunction = (seconds: number) => void;

  const startCooldown: StartCooldownFunction = (seconds: number): void => {
    const availableAt: number = getAvailableAt(seconds, true);

    setCooldown({ availableAt: availableAt });
    setRemainingSeconds(getRemainingSeconds(availableAt));
  };

  type HandleResultFunction = (result: VerificationEmailResendResult) => void;

  const handleResult: HandleResultFunction = (
    result: VerificationEmailResendResult,
  ): void => {
    if (result.outcome === VerificationEmailResendOutcome.AlreadyVerified) {
      setIsVerified(true);
      pendingFocusRef.current = "sign-in";
      showStatus(
        AlertType.SUCCESS,
        t("resendVerificationEmail.alreadyVerified"),
      );
      props.onAlreadyVerified?.();
      return;
    }

    startCooldown(result.retryAfterSeconds);
    pendingFocusRef.current = "status";

    if (result.outcome === VerificationEmailResendOutcome.Sent) {
      showStatus(AlertType.SUCCESS, t("resendVerificationEmail.sent"));
      return;
    }

    showStatus(AlertType.INFO, t("resendVerificationEmail.wait"));
  };

  type HandleErrorFunction = (error: unknown) => void;

  const handleError: HandleErrorFunction = (error: unknown): void => {
    pendingFocusRef.current = "status";

    /*
     * The rate limiter in front of the route. Not a failure worth alarming
     * anyone over: the same "wait" message as a cooldown, with the wait it
     * asked for.
     */
    if (error instanceof HTTPErrorResponse && error.statusCode === 429) {
      startCooldown(
        getRetryAfterSecondsFromError(error) ||
          DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
      );
      showStatus(AlertType.INFO, t("resendVerificationEmail.wait"));
      return;
    }

    /*
     * A refusal the server wrote for people to read -- the credential is no
     * longer valid, the account is blocked -- shown as sent. It is one of a
     * few curated sentences, and Alert looks each one up as a flat locale key.
     */
    if (
      error instanceof HTTPErrorResponse &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      showStatus(AlertType.DANGER, API.getFriendlyMessage(error));
      return;
    }

    // An outage, a network error or an answer this page did not understand.
    showStatus(AlertType.DANGER, t("resendVerificationEmail.failed"));
  };

  type ResendFunction = () => Promise<void>;

  const resend: ResendFunction = async (): Promise<void> => {
    if (isSendingRef.current || isVerified || remainingSeconds > 0) {
      return;
    }

    isSendingRef.current = true;
    setIsSending(true);
    setStatus(null);

    try {
      const result: VerificationEmailResendResult =
        await requestVerificationEmailResend(props.credential);

      handleResult(result);
    } catch (error) {
      handleError(error);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  return (
    <div className={props.className}>
      {!isVerified && (
        <Button
          buttonStyle={ButtonStyleType.NORMAL}
          icon={IconProp.Refresh}
          title={t("resendVerificationEmail.button")}
          dataTestId="resend-verification-email"
          className="w-full justify-center gap-1 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ width: "100%", marginLeft: 0 }}
          disabled={remainingSeconds > 0 || isSending || isVerified}
          isLoading={isSending}
          onClick={() => {
            resend().catch((error: unknown) => {
              isSendingRef.current = false;
              setIsSending(false);
              handleError(error);
            });
          }}
        />
      )}

      {/*
       * Not a live region: a countdown announced every second would drown
       * out everything else on the page. The alert below already says there
       * is a wait; this line is for sighted readers who want the number.
       */}
      {!isVerified && remainingSeconds > 0 && (
        <p
          data-testid="resend-verification-email-countdown"
          className="mt-2 text-center text-xs leading-5 text-gray-500 tabular-nums"
        >
          {t("resendVerificationEmail.countdown", {
            time: formatCountdown(remainingSeconds, i18n.language),
          })}
        </p>
      )}

      {status && (
        <div ref={statusRef} tabIndex={-1} className="focus:outline-none">
          <Alert
            key={status.seq}
            dataTestId="resend-verification-email-status"
            className="mt-4 text-start"
            type={status.type}
            title={status.message}
          />
        </div>
      )}

      {/*
       * A plain anchor rather than the shared Link, which has no way to take
       * a ref or a test id: focus moves here the moment the account turns out
       * to be verified, because it is the only thing left to do. Behaves like
       * Link -- an in-app navigation on a plain click, the browser's own
       * handling for a modified or middle click.
       */}
      {isVerified && (
        <a
          ref={signInLinkRef}
          href={SIGN_IN_ROUTE.toString()}
          data-testid="resend-verification-email-sign-in"
          className="mt-4 flex w-full items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:text-sm"
          onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }

            event.preventDefault();
            Navigation.navigate(SIGN_IN_ROUTE);
          }}
        >
          {t("verifyEmail.continueToSignIn")}
        </a>
      )}
    </div>
  );
};

export default ResendVerificationEmail;
