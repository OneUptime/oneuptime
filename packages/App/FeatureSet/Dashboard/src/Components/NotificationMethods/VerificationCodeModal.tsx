import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import VerificationCodeStatusJSON, {
  VerificationCodeState,
  VerificationCodeStatus,
} from "Common/Types/UserNotification/VerificationCodeStatus";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Modal from "Common/UI/Components/Modal/Modal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import {
  getVerificationCodeChannel,
  VerificationCodeChannel,
  VerificationCodeChannelDefinition,
  VerificationCodeCopy,
} from "./VerificationCodeChannels";

/*
 * THE ONE PLACE A PERSON VERIFIES A NUMBER.
 *
 * Opened by a row's Verify button, and straight after a number is added. It
 * asks the server where the number's code stands and says what is true:
 *
 *   - a code is waiting: when it went out, to where, and until when it works,
 *     with the field to type it into, and "Didn't get it?" with the way to
 *     send another - counting down the cooldown until it may;
 *   - the code expired, or there is none (it could not be sent, or wrong
 *     guesses used it up): sending a new one is the dialog's action, and
 *     nobody is asked to type a code that does not exist;
 *   - no code can be sent at all - the channel is off, the balance is too
 *     low, there is no Twilio account: why, and who can fix it, in the
 *     server's words, instead of "We have sent a SMS with your verification
 *     code".
 *
 * A send that fails says why, here, with the server's reason. So does a code
 * that is refused, after which the dialog reads the status again: an expired
 * or used-up code turns the dialog into the "send a new one" step.
 */

export interface ComponentProps {
  channel: VerificationCodeChannel;
  itemId: ObjectID | string;
  // Where the code goes, as the row shows it: the phone number.
  destination: string;
  onClose: () => void;
  /*
   * The number is verified: the list refreshes. The dialog closes itself,
   * or first says what else happened (a number verified for calls too).
   */
  onVerified: (result: JSONObject) => void;
}

export const VERIFICATION_CODE_INPUT_TEST_ID: string = "verification-code-input";
export const VERIFICATION_CODE_STATUS_TEST_ID: string =
  "verification-code-status";
export const VERIFICATION_CODE_RESEND_TEST_ID: string =
  "verification-code-resend";

const CODE_LENGTH: number = 6;

type ApiResponse = HTTPResponse<JSONObject> | HTTPErrorResponse;

const formatTime: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
};

const VerificationCodeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const definition: VerificationCodeChannelDefinition =
    getVerificationCodeChannel(props.channel);
  const codeInputId: string = useId();

  const [status, setStatus] = useState<VerificationCodeStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [hasStatusFailed, setHasStatusFailed] = useState<boolean>(false);

  const [code, setCode] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [wasCodeResent, setWasCodeResent] = useState<boolean>(false);

  // When another code may be sent, on this machine's clock.
  const [resendAvailableAt, setResendAvailableAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());

  // Said once the code is accepted, when there is more to say than that.
  const [verifiedMessage, setVerifiedMessage] = useState<string | null>(null);

  const itemId: string = props.itemId.toString();

  const post: (route: string, data?: JSONObject) => Promise<ApiResponse> = (
    route: string,
    data?: JSONObject,
  ): Promise<ApiResponse> => {
    return API.post({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `${definition.apiRoute}${route}`,
      ),
      data: {
        ...(data || {}),
        projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
        itemId: itemId,
      },
    });
  };

  const applyStatus: (next: VerificationCodeStatus) => void = (
    next: VerificationCodeStatus,
  ): void => {
    const readAt: number = Date.now();

    setStatus(next);
    setHasStatusFailed(false);
    setNow(readAt);
    setResendAvailableAt(readAt + next.resendAvailableInSeconds * 1000);

    if (next.isVerified) {
      // Verified some other way (by SMS, for a call number): the list catches up.
      setVerifiedMessage(
        translator.translateTemplate(VerificationCodeCopy.alreadyVerified, {
          destination: props.destination,
        }),
      );
      props.onVerified({});
    }
  };

  const refreshStatus: () => Promise<void> = async (): Promise<void> => {
    try {
      const response: ApiResponse = await post("/verification-status");

      if (response.isFailure()) {
        setHasStatusFailed(true);
        return;
      }

      applyStatus(
        VerificationCodeStatusJSON.fromJSON(response.data as JSONObject),
      );
    } catch {
      setHasStatusFailed(true);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, [itemId]);

  // The cooldown, counted down a second at a time while it runs.
  useEffect(() => {
    if (resendAvailableAt <= Date.now()) {
      return undefined;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      const tick: number = Date.now();
      setNow(tick);

      if (tick >= resendAvailableAt) {
        clearInterval(timer);
      }
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [resendAvailableAt]);

  const secondsUntilResend: number = Math.max(
    0,
    Math.ceil((resendAvailableAt - now) / 1000),
  );

  const sendCode: () => Promise<void> = async (): Promise<void> => {
    setIsSending(true);
    setError("");
    setWasCodeResent(false);

    try {
      const response: ApiResponse = await post("/resend-verification-code");

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        await refreshStatus();
        return;
      }

      const data: JSONObject = (response.data as JSONObject) || {};

      // The resend answers with the new code's status; asked for if it did not.
      if (data["codeState"]) {
        applyStatus(VerificationCodeStatusJSON.fromJSON(data));
      } else {
        await refreshStatus();
      }

      setCode("");
      setWasCodeResent(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSending(false);
    }
  };

  const verify: () => Promise<void> = async (): Promise<void> => {
    if (code.length !== CODE_LENGTH) {
      setError(
        translator.translateText(VerificationCodeCopy.enterTheCode) ||
          VerificationCodeCopy.enterTheCode,
      );
      return;
    }

    setIsVerifying(true);
    setError("");

    try {
      const response: ApiResponse = await post("/verify", { code: code });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsVerifying(false);
        // An expired or used-up code changes what the dialog offers.
        await refreshStatus();
        return;
      }

      const result: JSONObject = (response.data as JSONObject) || {};

      props.onVerified(result);

      if (Number(result["alsoVerifiedForCalls"] || 0) > 0) {
        setIsVerifying(false);
        setVerifiedMessage(
          translator.translateTemplate(
            VerificationCodeCopy.alsoVerifiedForCalls,
            { destination: props.destination },
          ),
        );
        return;
      }

      props.onClose();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsVerifying(false);
    }
  };

  // Once it is verified, the dialog only says so.
  if (verifiedMessage) {
    return (
      <Modal
        title={VerificationCodeCopy.verifiedTitle}
        onClose={props.onClose}
        closeButtonText={VerificationCodeCopy.doneButtonText}
      >
        <Alert
          type={AlertType.SUCCESS}
          title={verifiedMessage}
          dataTestId={VERIFICATION_CODE_STATUS_TEST_ID}
        />
      </Modal>
    );
  }

  const cannotSendReason: string | null = status?.cannotSendReason || null;
  const hasActiveCode: boolean =
    status?.codeState === VerificationCodeState.Active;

  /*
   * The field is offered while a code is waiting - and when the status could
   * not be read, so a person holding a code is never stuck behind that.
   */
  const isAskingForCode: boolean =
    hasActiveCode || (hasStatusFailed && !status);
  const canSendCode: boolean =
    !cannotSendReason && (Boolean(status) || hasStatusFailed);

  const sendCodeButtonText: string =
    (isSending
      ? translator.translateText(definition.sendingCodeButtonText)
      : translator.translateText(definition.sendCodeButtonText)) || "";

  const cooldownSentence: string = translator.translatePlural(
    VerificationCodeCopy.cooldown,
    secondsUntilResend,
  );

  const getStatusAlert: () => ReactElement | null = (): ReactElement | null => {
    if (!status) {
      if (hasStatusFailed) {
        return (
          <Alert
            type={AlertType.WARNING}
            title={VerificationCodeCopy.statusUnavailable}
            dataTestId={VERIFICATION_CODE_STATUS_TEST_ID}
          />
        );
      }

      return null;
    }

    if (status.codeState === VerificationCodeState.Active) {
      const sentence: string = translator.translateTemplate(
        definition.codeSentSentence,
        {
          destination: props.destination,
          sentAt: status.codeSentAt ? formatTime(status.codeSentAt) : "",
        },
      );

      const expiry: string = status.codeExpiresAt
        ? ` ${translator.translateTemplate(
            VerificationCodeCopy.codeExpirySentence,
            { expiresAt: formatTime(status.codeExpiresAt) },
          )}`
        : "";

      return (
        <Alert
          type={wasCodeResent ? AlertType.SUCCESS : AlertType.INFO}
          title={`${sentence}${expiry}`}
          dataTestId={VERIFICATION_CODE_STATUS_TEST_ID}
        />
      );
    }

    /*
     * With no code waiting and none that can be sent, the reason is all
     * there is to say. "The code we sent has expired" would only be noise
     * beside it - and for a number added before sends were checked, the
     * code it speaks of may never have gone out at all.
     */
    if (cannotSendReason) {
      return null;
    }

    const nextStep: string = canSendCode
      ? ` ${translator.translateText(definition.sendCodeNextStep) || ""}`
      : "";

    const sentence: string = translator.translateTemplate(
      status.codeState === VerificationCodeState.Expired
        ? definition.codeExpiredSentence
        : definition.noCodeSentence,
      { destination: props.destination },
    );

    return (
      <Alert
        type={
          status.codeState === VerificationCodeState.Expired
            ? AlertType.WARNING
            : AlertType.INFO
        }
        title={`${sentence}${nextStep}`}
        dataTestId={VERIFICATION_CODE_STATUS_TEST_ID}
      />
    );
  };

  const getResendLine: () => ReactElement | null = (): ReactElement | null => {
    if (!isAskingForCode || !canSendCode) {
      return null;
    }

    return (
      <div
        className="mt-3 flex flex-wrap items-center gap-x-1 text-sm text-gray-600"
        data-testid={VERIFICATION_CODE_RESEND_TEST_ID}
      >
        <span>{translator.translateText(VerificationCodeCopy.didNotGetIt)}</span>
        {secondsUntilResend > 0 ? (
          <span>{cooldownSentence}</span>
        ) : (
          <Button
            title={sendCodeButtonText}
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.ExtraSmall}
            onClick={() => {
              void sendCode();
            }}
            disabled={isSending || isVerifying}
            dataTestId="verification-code-send-button"
          />
        )}
      </div>
    );
  };

  /*
   * The dialog's action: Verify while a code is waiting, sending one when
   * there is none to type, and nothing at all when none can be sent.
   */
  let submitButtonText: string | undefined = undefined;
  let onSubmit: (() => void) | undefined = undefined;
  let isSubmitDisabled: boolean = false;

  if (isAskingForCode) {
    submitButtonText = VerificationCodeCopy.verifyButtonText;
    onSubmit = () => {
      void verify();
    };
    isSubmitDisabled = isSending;
  } else if (status && canSendCode) {
    submitButtonText = sendCodeButtonText;
    onSubmit = () => {
      void sendCode();
    };
    isSubmitDisabled = secondsUntilResend > 0;
  }

  return (
    <Modal
      title={definition.title}
      onClose={props.onClose}
      closeButtonText={onSubmit ? undefined : "Close"}
      submitButtonText={submitButtonText}
      onSubmit={onSubmit}
      isLoading={isVerifying || (isSending && !isAskingForCode)}
      disableSubmitButton={isSubmitDisabled}
      isBodyLoading={isLoadingStatus && !status}
      error={error || undefined}
    >
      <div className="space-y-4">
        {getStatusAlert() || <></>}

        {cannotSendReason ? (
          <Alert
            type={AlertType.WARNING}
            strongTitle={VerificationCodeCopy.cannotSendTitle}
            title={cannotSendReason}
            dataTestId="verification-code-cannot-send"
          />
        ) : (
          <></>
        )}

        {isAskingForCode ? (
          <div>
            <FieldLabelElement
              title={VerificationCodeCopy.codeFieldTitle}
              htmlFor={codeInputId}
              required={true}
            />
            <div className="relative mt-2 mb-1 rounded-md shadow-sm w-full">
              <input
                id={codeInputId}
                data-testid={VERIFICATION_CODE_INPUT_TEST_ID}
                /*
                 * A one-time code: digits, at most six. Phones offer the
                 * code from the message they just received, and a numeric
                 * keypad to type it on. No maxLength: the browser would cut
                 * a pasted "123 456" to six characters before onChange
                 * keeps its digits, and lose the last one.
                 */
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                placeholder="123456"
                autoFocus={true}
                spellCheck={false}
                value={code}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setCode(
                    event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH),
                  );
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void verify();
                  }
                }}
                className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm tracking-[0.3em] placeholder-gray-400 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
            {getResendLine() || <></>}
            {hasActiveCode ? (
              <p className="mt-2 text-xs text-gray-500">
                {translator.translateText(definition.notArrivedHint)}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {!isAskingForCode && status && canSendCode && secondsUntilResend > 0 ? (
          <p
            className="text-sm text-gray-600"
            data-testid={VERIFICATION_CODE_RESEND_TEST_ID}
          >
            {cooldownSentence}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default VerificationCodeModal;
