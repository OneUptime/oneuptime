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
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import { MOBILE_PASSKEY_ENROLMENT_OPTIONS_API_URL } from "../Utils/ApiPaths";
import MobilePasskeyEnrolment, {
  MobilePasskeyEnrolmentEnd,
  MobilePasskeyEnrolmentRequest,
} from "../Utils/MobilePasskeyEnrolment";

/*
 * SETTING UP A PASSKEY FOR THE MOBILE APP, IN THE PHONE'S BROWSER (#9817).
 *
 * When sign-in in the mobile app requires a second step and the person
 * picks a passkey, the app opens this page in the phone's own browser, on
 * this server's address: an app has no browser prompt of its own, and a
 * passkey is made for the address it is made on. The page reads the
 * passkey's options once, with the id in its fragment (Utils/
 * MobilePasskeyEnrolment), runs the phone's prompt - its face, fingerprint
 * or screen lock, or a security key - and hands the new passkey's public
 * answer back to the app, which saves it with the password it holds. No
 * password reaches this page, and nothing here signs anybody in.
 *
 * Where this browser cannot create a passkey - no WebAuthn, or a page not
 * on HTTPS - the page says so and hands the app "unsupported" at once, and
 * the app goes on with an authenticator app instead. Cancel hands it
 * "access_denied".
 */

type Stage = "idle" | "preparing" | "prompt" | "complete";

/*
 * What an attempt that made no passkey says under the button: a
 * translation key, so it follows the footer's language switcher.
 */
type Notice =
  | "mobilePasskeyEnrolment.notCompleted"
  | "mobilePasskeyEnrolment.expired"
  | "mobilePasskeyEnrolment.failed"
  | "login.twoFactorEnrolment.securityKeyAlreadyRegistered";

const MobilePasskeyEnrolmentPage: () => JSX.Element = () => {
  const { t } = useTranslation();
  const [request] = React.useState<MobilePasskeyEnrolmentRequest | null>(() => {
    return MobilePasskeyEnrolment.getRequest(window.location.hash);
  });
  const [supported] = React.useState<boolean>(WebAuthn.isSupported);
  const secure: boolean = window.location.protocol === "https:";
  const [stage, setStage] = React.useState<Stage>("idle");
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [isProblem, setIsProblem] = React.useState<boolean>(false);
  const [callbackUrl, setCallbackUrl] = React.useState<string>("");
  // The options, once read: they are read once, and a retry reuses them.
  const options: React.MutableRefObject<JSONObject | null> =
    React.useRef<JSONObject | null>(null);
  const attempt: React.MutableRefObject<AbortController | null> =
    React.useRef<AbortController | null>(null);
  const button: React.MutableRefObject<HTMLDivElement | null> =
    React.useRef<HTMLDivElement | null>(null);

  const canCreate: boolean = Boolean(request) && secure && supported;

  const handBack: (end: MobilePasskeyEnrolmentEnd) => void = (
    end: MobilePasskeyEnrolmentEnd,
  ): void => {
    if (!request) {
      return;
    }

    MobilePasskeyEnrolment.returnToApp(
      MobilePasskeyEnrolment.endCallback(request, window.location.origin, end),
    );
  };

  React.useEffect(() => {
    // Nothing to make here: the app goes on with an authenticator app.
    if (request && (!secure || !supported)) {
      handBack("unsupported");
    }

    return () => {
      attempt.current?.abort();
      attempt.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (notice) {
      button.current?.querySelector("button")?.focus();
    }
  }, [notice]);

  const readOptions: (
    signal: AbortSignal,
  ) => Promise<JSONObject | null> = async (
    signal: AbortSignal,
  ): Promise<JSONObject | null> => {
    if (options.current) {
      return options.current;
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: MOBILE_PASSKEY_ENROLMENT_OPTIONS_API_URL,
        data: { handOffId: request!.handOffId },
        options: { signal: signal },
      });

    if (
      response instanceof HTTPErrorResponse ||
      !response.data ||
      typeof response.data["options"] !== "object"
    ) {
      return null;
    }

    options.current = response.data["options"] as JSONObject;

    // Read once: the address has no more use for the id.
    MobilePasskeyEnrolment.forgetFragment();

    return options.current;
  };

  const create: () => Promise<void> = async (): Promise<void> => {
    if (!request || !canCreate || attempt.current || callbackUrl) {
      return;
    }

    const controller: AbortController = new AbortController();
    attempt.current = controller;
    setNotice(null);
    setIsProblem(false);
    setStage("preparing");

    try {
      const passkeyOptions: JSONObject | null = await readOptions(
        controller.signal,
      );

      if (attempt.current !== controller || controller.signal.aborted) {
        return;
      }

      if (!passkeyOptions) {
        setStage("idle");
        setIsProblem(true);
        setNotice("mobilePasskeyEnrolment.expired");
        return;
      }

      setStage("prompt");

      const credential: JSONObject = await WebAuthn.register(
        passkeyOptions,
        controller.signal,
      );

      if (attempt.current !== controller || controller.signal.aborted) {
        return;
      }

      const callback: string = MobilePasskeyEnrolment.successCallback(
        request,
        window.location.origin,
        credential,
      );

      setCallbackUrl(callback);
      setStage("complete");
      MobilePasskeyEnrolment.returnToApp(callback);
    } catch (err) {
      if (attempt.current !== controller || controller.signal.aborted) {
        return;
      }

      setStage("idle");

      if (
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "AbortError")
      ) {
        setIsProblem(false);
        setNotice("mobilePasskeyEnrolment.notCompleted");
      } else if (err instanceof Error && err.name === "InvalidStateError") {
        setIsProblem(true);
        setNotice("login.twoFactorEnrolment.securityKeyAlreadyRegistered");
      } else {
        setIsProblem(true);
        setNotice("mobilePasskeyEnrolment.failed");
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
    handBack("access_denied");
  };

  const loading: boolean = stage === "preparing" || stage === "prompt";

  return (
    <main className="flex min-h-full flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <ProductLogo />
        <h1 className="mt-6 text-center text-xl tracking-tight text-gray-900 sm:text-2xl">
          {t("mobilePasskeyEnrolment.title")}
        </h1>
        <p className="mt-2 text-center text-sm leading-6 text-gray-600">
          {t("mobilePasskeyEnrolment.description")}
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
              {t("mobilePasskeyEnrolment.invalid")}
            </p>
          ) : !secure || !supported ? (
            <>
              <p role="alert" className="mb-4 text-sm leading-6 text-red-800">
                {t(
                  !secure
                    ? "mobilePasskeyEnrolment.insecure"
                    : "mobilePasskeyEnrolment.unsupported",
                )}
              </p>
              {/*
               * Handed back at once already; this is for a browser that
               * would not leave the page without a tap.
               */}
              <Button
                title={t("mobilePasskey.returnToApp")}
                isTitleTranslated={true}
                dataTestId="mobile-passkey-enrolment-unsupported"
                buttonStyle={ButtonStyleType.PRIMARY}
                className="w-full justify-center"
                style={{ width: "100%", marginInlineStart: "0px" }}
                onClick={() => {
                  handBack("unsupported");
                }}
              />
            </>
          ) : callbackUrl ? (
            <>
              <p
                role="status"
                className="mb-4 text-center text-sm leading-6 text-gray-600"
              >
                {t("mobilePasskeyEnrolment.complete")}
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
              <div ref={button}>
                <Button
                  title={t(
                    stage === "preparing"
                      ? "login.passkey.preparing"
                      : stage === "prompt"
                        ? "login.passkey.waiting"
                        : notice
                          ? "mobilePasskeyEnrolment.tryAgain"
                          : "mobilePasskeyEnrolment.create",
                  )}
                  isTitleTranslated={true}
                  dataTestId="mobile-passkey-enrolment-create"
                  buttonStyle={ButtonStyleType.PRIMARY}
                  className="w-full justify-center"
                  style={{ width: "100%", marginInlineStart: "0px" }}
                  isLoading={loading}
                  disabled={loading}
                  onClick={() => {
                    void create();
                  }}
                />
              </div>
              <div role="status" aria-live="polite" aria-atomic="true">
                {stage === "prompt" && (
                  <p className="mt-3 text-center text-sm leading-6 text-gray-600">
                    {t("login.passkey.waitingDescription")}
                  </p>
                )}
                {notice && !isProblem && (
                  <p className="mt-3 text-sm leading-6 text-gray-600">
                    {t(notice)}
                  </p>
                )}
              </div>
              {notice && isProblem && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {t(notice)}
                </p>
              )}
            </>
          )}
          {canCreate && !callbackUrl && (
            <div className="mt-5 text-center">
              <Button
                title={t("mobilePasskey.cancel")}
                isTitleTranslated={true}
                dataTestId="mobile-passkey-enrolment-cancel"
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

export default MobilePasskeyEnrolmentPage;
