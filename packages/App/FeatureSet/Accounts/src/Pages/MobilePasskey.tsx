import React from "react";
import { useTranslation } from "react-i18next";
import { JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import WebAuthn from "Common/UI/Utils/WebAuthn";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import {
  PASSKEY_LOGIN_API_URL,
  PASSKEY_LOGIN_OPTIONS_API_URL,
} from "../Utils/ApiPaths";
import MobilePasskey, { MobilePasskeyRequest } from "../Utils/MobilePasskey";

type Stage = "idle" | "preparing" | "prompt" | "verifying" | "complete";

const MobilePasskeyPage: () => JSX.Element = () => {
  const { t } = useTranslation();
  const [request] = React.useState<MobilePasskeyRequest | null>(() => {
    return MobilePasskey.getRequest(window.location.search);
  });
  const [supported] = React.useState<boolean>(WebAuthn.isSupported);
  const secure: boolean = window.location.protocol === "https:";
  const [stage, setStage] = React.useState<Stage>("idle");
  const [error, setError] = React.useState<string>("");
  const [notice, setNotice] = React.useState<string>("");
  const [callbackUrl, setCallbackUrl] = React.useState<string>("");
  const attempt: React.MutableRefObject<AbortController | null> =
    React.useRef<AbortController | null>(null);
  const button: React.MutableRefObject<HTMLDivElement | null> =
    React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    return () => {
      attempt.current?.abort();
      attempt.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (notice || error) {
      button.current?.querySelector("button")?.focus();
    }
  }, [notice, error]);

  const signIn: () => Promise<void> = async (): Promise<void> => {
    if (!request || !secure || !supported || attempt.current || callbackUrl) {
      return;
    }
    const controller: AbortController = new AbortController();
    attempt.current = controller;
    setError("");
    setNotice("");
    setStage("preparing");

    try {
      const optionsResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: PASSKEY_LOGIN_OPTIONS_API_URL,
          data: { mobileAuth: { ...request } },
          options: { signal: controller.signal },
        });
      if (attempt.current !== controller || controller.signal.aborted) {
        return;
      }
      if (optionsResponse instanceof HTTPErrorResponse) {
        throw optionsResponse;
      }
      setStage("prompt");
      const credential: JSONObject = await WebAuthn.authenticate(
        optionsResponse.data["options"] as JSONObject,
        controller.signal,
      );
      if (attempt.current !== controller || controller.signal.aborted) {
        return;
      }
      setStage("verifying");
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: PASSKEY_LOGIN_API_URL,
          data: { credential },
          options: { signal: controller.signal },
        });
      if (attempt.current !== controller || controller.signal.aborted) {
        return;
      }
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
      const mobileAuth: JSONObject | undefined = response.data["mobileAuth"] as
        | JSONObject
        | undefined;
      const callback: string | null = MobilePasskey.validateCallback(
        mobileAuth?.["callbackUrl"],
        request,
        window.location.origin,
      );
      if (!callback) {
        throw new Error(t("mobilePasskey.failed"));
      }
      setCallbackUrl(callback);
      setStage("complete");
      // The callback carries a one-time code. Session tokens stay off URLs.
      MobilePasskey.returnToApp(callback);
    } catch (err) {
      if (attempt.current !== controller || controller.signal.aborted) {
        return;
      }
      setStage("idle");
      if (
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "AbortError")
      ) {
        setNotice(t("login.passkey.notCompleted"));
      } else {
        setError(WebAuthn.getErrorMessage(err, "sign-in"));
      }
    } finally {
      if (attempt.current === controller) {
        attempt.current = null;
      }
    }
  };

  const cancel: () => void = (): void => {
    if (!request || callbackUrl) {
      return;
    }
    attempt.current?.abort();
    attempt.current = null;
    setStage("idle");
    setNotice(t("login.passkey.cancelled"));
    MobilePasskey.returnToApp(
      MobilePasskey.cancelCallback(request, window.location.origin),
    );
  };

  const loading: boolean = stage !== "idle" && stage !== "complete";
  return (
    <main className="flex min-h-full flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <img
          className="mx-auto h-10 w-auto sm:h-12"
          src={OneUptimeLogo}
          alt="OneUptime"
        />
        <h1 className="mt-6 text-center text-xl tracking-tight text-gray-900 sm:text-2xl">
          {t("mobilePasskey.title")}
        </h1>
        <p className="mt-2 text-center text-sm leading-6 text-gray-600">
          {t("mobilePasskey.description")}
        </p>
        <section className="mt-6 rounded-xl bg-white px-5 py-6 shadow-sm sm:px-8">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"
          >
            <Icon icon={IconProp.Fingerprint} className="h-7 w-7" />
          </div>
          <p className="mb-4 break-all rounded-lg bg-gray-50 px-3 py-2 text-center text-sm text-gray-600">
            {window.location.host}
          </p>
          {!request ? (
            <p role="alert" className="text-sm leading-6 text-red-800">
              {t("mobilePasskey.invalid")}
            </p>
          ) : !secure ? (
            <p role="alert" className="text-sm leading-6 text-red-800">
              {t("mobilePasskey.insecure")}
            </p>
          ) : callbackUrl ? (
            <>
              <p
                role="status"
                className="mb-4 text-center text-sm leading-6 text-gray-600"
              >
                {t("mobilePasskey.complete")}
              </p>
              <a
                href={callbackUrl}
                referrerPolicy="no-referrer"
                className="block rounded-md bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {t("mobilePasskey.returnToApp")}
              </a>
            </>
          ) : (
            <>
              <p className="mb-5 text-center text-sm leading-6 text-gray-600">
                {t("mobilePasskey.returnDescription")}
              </p>
              <div ref={button}>
                <Button
                  title={t(
                    loading
                      ? stage === "preparing"
                        ? "login.passkey.preparing"
                        : stage === "prompt"
                          ? "login.passkey.waiting"
                          : "login.passkey.verifying"
                      : notice || error
                        ? "login.passkey.tryAgain"
                        : "login.passkey.signIn",
                  )}
                  dataTestId="mobile-passkey-sign-in"
                  buttonStyle={ButtonStyleType.PRIMARY}
                  className="w-full justify-center"
                  style={{ width: "100%", marginLeft: 0 }}
                  isLoading={loading}
                  disabled={loading || !supported}
                  onClick={() => {
                    void signIn();
                  }}
                />
              </div>
              <div role="status" aria-live="polite" aria-atomic="true">
                {loading && (
                  <p className="mt-3 text-center text-sm leading-6 text-gray-600">
                    {t(
                      stage === "prompt"
                        ? "login.passkey.waitingDescription"
                        : stage === "preparing"
                          ? "login.passkey.preparing"
                          : "login.passkey.verifying",
                    )}
                  </p>
                )}
                {notice && (
                  <p className="mt-3 text-sm leading-6 text-gray-600">
                    {notice}
                  </p>
                )}
              </div>
              {error && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {error}
                </p>
              )}
              {!supported && (
                <p className="mt-3 text-sm leading-6 text-gray-600">
                  {t("login.passkey.unsupported")}
                </p>
              )}
              <details className="mt-5 text-sm text-gray-600">
                <summary className="cursor-pointer font-medium text-indigo-700">
                  {t("login.passkey.helpTitle")}
                </summary>
                <p className="mt-2 leading-6">{t("mobilePasskey.setup")}</p>
              </details>
            </>
          )}
          {request && !callbackUrl && (
            <div className="mt-5 text-center">
              <Button
                title={t("mobilePasskey.cancel")}
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                onClick={cancel}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

export default MobilePasskeyPage;
