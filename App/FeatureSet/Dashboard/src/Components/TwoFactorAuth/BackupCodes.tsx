import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import Clipboard from "Common/UI/Utils/Clipboard";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";
import useAsyncEffect from "use-async-effect";

/*
 * "Backup Codes" on User Profile > Two Factor Authentication.
 *
 * THE CODES ARE SHOWN EXACTLY ONCE. Only keyed digests are stored, so once
 * this modal closes there is no way -- for the user, for a master admin, or
 * for anybody holding a database dump -- to see them again. Everything about
 * this component follows from that: the modal has no close-by-backdrop, the
 * acknowledgement is a checkbox rather than a "Done" button somebody clicks
 * reflexively, and copy and download are both offered because a user who has
 * only one of them will not have saved anything.
 *
 * A ModelTable is deliberately not used here even though the other two
 * factors on this page are tables. There is nothing per-row to show: the hash
 * is unreadable by anybody, `usedAt` is only interesting in aggregate, and a
 * table of ten identical "Unused" rows would invite a per-row delete button
 * for an operation that makes no sense (deleting one code does not make an
 * account safer; regenerating does).
 */

const BACKUP_CODE_STATUS_API_URL: URL = URL.fromString(
  APP_API_URL.toString(),
).addRoute("/user-two-factor-backup-code/status");

const BACKUP_CODE_GENERATE_API_URL: URL = URL.fromString(
  APP_API_URL.toString(),
).addRoute("/user-two-factor-backup-code/generate");

/*
 * Below this, the card nags. Chosen to match the wording of the email sent
 * when a code is spent, so a user does not get "running low" in one place and
 * silence in the other.
 */
const LOW_CODE_THRESHOLD: number = 3;

export interface BackupCodeStatus {
  total: number;
  unused: number;
  generatedAt: Date | null;
}

export interface ComponentProps {
  // Passkey enrollment can return recovery codes without displaying this card.
  hideCard?: boolean | undefined;

  /*
   * A set the SERVER minted while the user was setting a factor up, handed
   * down so this card can raise its show-once modal for it.
   *
   * Enrolment is where codes now come from -- verifying a first authenticator
   * app or registering a first security key mints them, because a recovery
   * route that has to be found and pressed for is a recovery route nobody
   * has. That response is the only copy of the plaintext, so it cannot be
   * re-fetched and it cannot be shown later: it has to be handed straight to
   * the one component that already knows how to make a user acknowledge it.
   *
   * Empty or undefined means "nothing was minted" -- which is the normal case
   * for a SECOND factor added to an account that already has codes.
   */
  codesFromEnrolment?: Array<string> | undefined;

  /*
   * Called once the user has ticked "I have saved these" and closed the modal,
   * so the page can drop the codes it is holding. Without it the same set
   * would be re-raised by the next render that passes them back in.
   */
  onEnrolmentCodesAcknowledged?: (() => void) | undefined;
}

const BackupCodes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [status, setStatus] = React.useState<BackupCodeStatus | null>(null);
  const [isStatusLoading, setIsStatusLoading] = React.useState<boolean>(true);
  const [statusError, setStatusError] = React.useState<string>("");

  const [showConfirmModal, setShowConfirmModal] =
    React.useState<boolean>(false);
  const [isGenerating, setIsGenerating] = React.useState<boolean>(false);
  const [generateError, setGenerateError] = React.useState<string>("");

  /* See the guard at the top of `generate`. */
  const isGeneratingRef: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);

  const [generatedCodes, setGeneratedCodes] =
    React.useState<Array<string> | null>(null);

  /*
   * The user has to tick "I have saved these" before the modal will close.
   * Not ceremony: closing without saving is unrecoverable, and it is the one
   * mistake on this page that cannot be undone by trying again.
   */
  const [hasSavedCodes, setHasSavedCodes] = React.useState<boolean>(false);
  const [hasCopiedCodes, setHasCopiedCodes] = React.useState<boolean>(false);
  const [copyError, setCopyError] = React.useState<string>("");
  const copyFeedbackTimeout: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimeout.current) {
        clearTimeout(copyFeedbackTimeout.current);
      }
    };
  }, []);

  type LoadStatusFunction = () => Promise<void>;

  const loadStatus: LoadStatusFunction = async (): Promise<void> => {
    if (props.hideCard) {
      return;
    }

    setIsStatusLoading(true);
    setStatusError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: BACKUP_CODE_STATUS_API_URL,
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data;
      const generatedAt: string | null =
        (data["generatedAt"] as string) || null;

      setStatus({
        total: Number(data["total"] || 0),
        unused: Number(data["unused"] || 0),
        generatedAt: generatedAt ? OneUptimeDate.fromString(generatedAt) : null,
      });
    } catch (err) {
      // A stale empty status must never skip confirmation for a newer set.
      setStatus(null);
      setStatusError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsStatusLoading(false);
  };

  useAsyncEffect(async () => {
    await loadStatus();
  }, [props.hideCard]);

  /*
   * Raise the modal for a set the enrolment just minted.
   *
   * Keyed on the JOINED codes rather than on the array itself: a new array
   * with the same contents arrives on every render of the parent, and
   * depending on the identity would re-open a modal the user has just
   * acknowledged -- with the checkbox reset, on top of whatever they moved on
   * to. Depending on the contents means the effect fires exactly once per
   * distinct set.
   *
   * The status is re-read alongside so the card behind the modal stops saying
   * "You have no backup codes" the moment it is closed.
   */
  const enrolmentCodesKey: string = (props.codesFromEnrolment || []).join(",");

  useAsyncEffect(async () => {
    if (!enrolmentCodesKey) {
      return;
    }

    setHasSavedCodes(false);
    setGeneratedCodes(props.codesFromEnrolment || []);
    setHasCopiedCodes(false);
    setCopyError("");

    await loadStatus();
  }, [enrolmentCodesKey]);

  type GenerateFunction = () => Promise<void>;

  const generate: GenerateFunction = async (): Promise<void> => {
    /*
     * Re-entry guard, belt to the button's braces below. React batches state
     * updates, so two clicks landing in the same tick both see the old
     * `isGenerating` and both get past a disabled prop -- and two concurrent
     * regenerations do not merely waste a request. Each one deletes the
     * other's rows partway through, so the set the user is shown and the set
     * the database ends up holding are different: some codes they carefully
     * saved do not exist, and some that exist were never shown to anybody.
     *
     * `isGeneratingRef` rather than the state value, because the state read
     * inside this closure is the one from the render that produced the click.
     */
    if (isGeneratingRef.current) {
      return;
    }

    isGeneratingRef.current = true;
    setIsGenerating(true);
    setGenerateError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: BACKUP_CODE_GENERATE_API_URL,
          data: {},
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const codes: Array<string> = (
        (response.data["codes"] as JSONArray) || []
      ).map((code: unknown) => {
        return String(code);
      });

      /*
       * The confirmation closes and the code modal opens in the same tick, so
       * the user never sees the page underneath between the two. Ordered this
       * way rather than the reverse because closing the confirmation last
       * leaves a frame where both are mounted.
       */
      setShowConfirmModal(false);
      setHasSavedCodes(false);
      setGeneratedCodes(codes);
      setHasCopiedCodes(false);
      setCopyError("");

      await loadStatus();
    } catch (err) {
      setGenerateError(API.getFriendlyErrorMessage(err as Error));
    }

    isGeneratingRef.current = false;
    setIsGenerating(false);
  };

  type DownloadCodesFunction = () => void;

  const copyCodes: () => Promise<void> = async (): Promise<void> => {
    if (!generatedCodes) {
      return;
    }

    setCopyError("");
    setHasCopiedCodes(false);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await Clipboard.copyToClipboard(generatedCodes.join("\n"));
      setHasCopiedCodes(true);
      if (copyFeedbackTimeout.current) {
        clearTimeout(copyFeedbackTimeout.current);
      }
      copyFeedbackTimeout.current = setTimeout(() => {
        setHasCopiedCodes(false);
      }, 2000);
    } catch {
      setCopyError("Could not copy the codes. Download them instead.");
    }
  };

  const downloadCodes: DownloadCodesFunction = (): void => {
    if (!generatedCodes) {
      return;
    }

    const content: string = [
      "OneUptime two-factor authentication backup codes",
      `Generated: ${OneUptimeDate.getCurrentDateAsFormattedString()}`,
      "",
      "Each code can be used once after entering your password.",
      "Keep this file somewhere safe, separate from your authenticator or security key.",
      "",
      ...generatedCodes,
      "",
    ].join("\n");

    const blob: Blob = new Blob([content], {
      type: "text/plain;charset=utf-8;",
    });
    const url: string = window.URL.createObjectURL(blob);
    const anchor: HTMLAnchorElement = document.createElement("a");
    anchor.href = url;
    anchor.download = "oneuptime-backup-codes.txt";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  type RenderStatusFunction = () => ReactElement;

  const renderStatus: RenderStatusFunction = (): ReactElement => {
    if (isStatusLoading) {
      return <ComponentLoader />;
    }

    if (statusError) {
      return <ErrorMessage message={statusError} />;
    }

    if (!status) {
      return <></>;
    }

    if (status.total === 0) {
      return (
        <div
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
          role="status"
          aria-label="Backup code status"
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500"
            aria-hidden="true"
          >
            <Icon icon={IconProp.Key} className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">
              Set up your recovery option
            </p>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              Generate backup codes so you can sign in if you lose access to
              your authenticator app or security key.
            </p>
          </div>
        </div>
      );
    }

    const isExhausted: boolean = status.unused === 0;
    const isLow: boolean = status.unused <= LOW_CODE_THRESHOLD;
    const tone: string = isExhausted
      ? "border-red-100 bg-red-50 text-red-700"
      : isLow
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : "border-emerald-100 bg-emerald-50 text-emerald-700";

    return (
      <div
        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
        role="status"
        aria-label="Backup code status"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${tone}`}
              aria-hidden="true"
            >
              <Icon
                icon={isLow ? IconProp.ShieldExclamation : IconProp.ShieldCheck}
                className="h-5 w-5"
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{`${status.unused} of ${status.total} backup codes remaining`}</p>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                {isExhausted
                  ? "All codes have been used. Generate a new set to restore your recovery option."
                  : isLow
                    ? "You are running low. Generate a new set before you run out."
                    : "Each code can be used once in place of your second factor."}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
          >
            {isExhausted
              ? "No codes left"
              : isLow
                ? "Running low"
                : "Ready to use"}
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-3 text-xs leading-5 text-gray-500 sm:flex-row sm:justify-between">
          <span>
            Store your codes in a password manager or another safe place.
          </span>
          {status.generatedAt && (
            <span>{`Generated ${OneUptimeDate.getDateAsLocalFormattedString(status.generatedAt)}`}</span>
          )}
        </div>
      </div>
    );
  };

  /*
   * Whether we POSITIVELY KNOW the account has no codes.
   *
   * Deliberately not `!(status && status.total > 0)`. `status` is also null
   * when the status fetch FAILED -- and reading that as "no codes" is what
   * decides, below, whether the destructive confirmation is shown at all. A
   * user whose status request 500'd would then press a button labelled
   * "Generate Backup Codes", get no warning, and have ten perfectly good codes
   * destroyed. Unknown has to behave like "there may be codes", not like
   * "there are none".
   */
  const isKnownToHaveNoCodes: boolean = Boolean(status && status.total === 0);

  return (
    <>
      {!props.hideCard && (
        <Card
          title="Backup codes"
          description="Your recovery option when you cannot use your authenticator app or security key."
          buttons={[
            {
              title: isKnownToHaveNoCodes
                ? "Generate backup codes"
                : "Regenerate codes",
              buttonStyle: isKnownToHaveNoCodes
                ? ButtonStyleType.PRIMARY
                : ButtonStyleType.NORMAL,
              icon: isKnownToHaveNoCodes ? IconProp.Key : IconProp.Refresh,
              /*
               * `isLoading` as well as `disabled`. Without it the button stays
               * live for the whole round trip -- `isStatusLoading` is false
               * throughout, because the status is not re-read until the
               * generation has already returned -- so a second click lands on an
               * enabled button and starts a second, racing regeneration.
               */
              disabled: isStatusLoading || isGenerating,
              isLoading: isGenerating,
              onClick: () => {
                setGenerateError("");

                /*
                 * The confirmation exists only when there is nothing to destroy.
                 * A first-time user has no codes to invalidate, so asking "are
                 * you sure?" would be a dialog with one sensible answer -- but
                 * anything short of KNOWING that gets the warning, because the
                 * cost of a needless dialog is a click and the cost of a missing
                 * one is ten codes.
                 */
                if (!isKnownToHaveNoCodes) {
                  setShowConfirmModal(true);
                  return;
                }

                generate().catch(() => {
                  // Surfaced through `generateError` by `generate` itself.
                });
              },
            },
          ]}
        >
          <div>
            {renderStatus()}

            {/*
             * The ONLY render site for `generateError` outside the confirmation
             * modal, and the one that matters most. A first-time user never
             * opens that modal -- there is nothing to confirm -- so before this
             * existed, a failed generation set an error string that nothing on
             * screen could show: the card still read "You have no backup codes"
             * and the button did nothing visible, on the one page in the
             * product where having no backup codes is what the user came to
             * fix.
             */}
            {generateError && (
              <div className="mt-3">
                <ErrorMessage message={generateError} />
              </div>
            )}
          </div>
        </Card>
      )}

      {showConfirmModal && (
        <ConfirmModal
          title="Regenerate backup codes?"
          description="Your current codes will stop working immediately, including any you have written down or printed. Save the new set before closing the next window."
          submitButtonText="Regenerate"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isGenerating}
          error={generateError || undefined}
          onClose={
            isGenerating
              ? undefined
              : () => {
                  if (!isGeneratingRef.current) {
                    setShowConfirmModal(false);
                    setGenerateError("");
                  }
                }
          }
          onSubmit={() => {
            generate().catch(() => {
              // Surfaced through `generateError` by `generate` itself.
            });
          }}
        />
      )}

      {generatedCodes && (
        <Modal
          title="Your backup codes"
          description="Save these codes to keep a way back into your account."
          modalWidth={ModalWidth.Medium}
          submitButtonText="Done"
          /*
           * "Done" is the ONLY way out, and it is disabled until the checkbox
           * below is ticked. No `onClose` is passed, which is what removes the
           * X, the Cancel button, the Escape key and the backdrop click --
           * every one of which is a way to lose ten codes by reflex. The
           * explicit `disableCloseOnBackdropClick` is belt and braces for
           * whoever adds an `onClose` here later without reading this.
           */
          disableSubmitButton={!hasSavedCodes}
          disableCloseOnBackdropClick={true}
          onSubmit={() => {
            setGeneratedCodes(null);
            setHasSavedCodes(false);

            if (props.onEnrolmentCodesAcknowledged) {
              props.onEnrolmentCodesAcknowledged();
            }
          }}
        >
          <div>
            <div
              className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
              role="note"
            >
              <span
                className="mt-0.5 shrink-0 text-amber-600"
                aria-hidden="true"
              >
                <Icon icon={IconProp.ShieldExclamation} className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-amber-900">
                  These codes are shown only once.
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  Save them in a password manager or download a copy. Each code
                  works once, after your password.
                </p>
              </div>
            </div>

            <div
              className="mt-5 grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2 sm:p-4"
              aria-label="Backup codes"
            >
              {generatedCodes.map((code: string, index: number) => {
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2.5"
                  >
                    <span
                      className="w-4 shrink-0 select-none text-xs tabular-nums text-gray-400"
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <code
                      className="select-all break-all font-mono text-sm font-medium tracking-wider text-gray-900"
                      data-testid="backup-code"
                    >
                      {code}
                    </code>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Button
                title={hasCopiedCodes ? "Copied" : "Copy codes"}
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={hasCopiedCodes ? IconProp.Check : IconProp.Copy}
                className={`min-h-10 !ml-0 ${hasCopiedCodes ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700" : ""}`}
                onClick={copyCodes}
              />
              <Button
                title="Download as .txt"
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={IconProp.Download}
                className="min-h-10 !ml-0"
                onClick={downloadCodes}
              />
            </div>

            <div
              aria-live="polite"
              className={copyError ? "mt-2 text-sm" : "text-sm"}
            >
              {hasCopiedCodes && (
                <span className="sr-only">
                  Backup codes copied to clipboard.
                </span>
              )}
              {copyError && (
                <p className="text-red-600" role="alert">
                  {copyError}
                </p>
              )}
            </div>

            <label
              className={`mt-5 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${hasSavedCodes ? "border-indigo-200 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
            >
              <input
                type="checkbox"
                data-testid="backup-codes-saved-checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-500"
                checked={hasSavedCodes}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setHasSavedCodes(event.target.checked);
                }}
              />
              <span className="text-sm font-medium text-gray-700">
                I have saved these codes somewhere safe.
              </span>
            </label>
          </div>
        </Modal>
      )}
    </>
  );
};

export default BackupCodes;
