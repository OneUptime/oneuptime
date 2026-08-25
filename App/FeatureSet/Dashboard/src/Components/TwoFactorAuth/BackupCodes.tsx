import Card from "Common/UI/Components/Card/Card";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
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

const BackupCodes: FunctionComponent = (): ReactElement => {
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

  type LoadStatusFunction = () => Promise<void>;

  const loadStatus: LoadStatusFunction = async (): Promise<void> => {
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
      setStatusError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsStatusLoading(false);
  };

  useAsyncEffect(async () => {
    await loadStatus();
  }, []);

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

      await loadStatus();
    } catch (err) {
      setGenerateError(API.getFriendlyErrorMessage(err as Error));
    }

    isGeneratingRef.current = false;
    setIsGenerating(false);
  };

  type DownloadCodesFunction = () => void;

  const downloadCodes: DownloadCodesFunction = (): void => {
    if (!generatedCodes) {
      return;
    }

    const content: string = [
      "OneUptime two factor authentication backup codes",
      `Generated: ${OneUptimeDate.getCurrentDateAsFormattedString()}`,
      "",
      "Each code can be used once. Keep this file somewhere safe and",
      "separate from the device that runs your authenticator app.",
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

    if (!status || status.total === 0) {
      return (
        <Alert
          type={AlertType.WARNING}
          strongTitle="You have no backup codes."
          title="Without them, losing your authenticator app or security key means an administrator has to reset two factor authentication on your account before you can sign in again."
        />
      );
    }

    if (status.unused === 0) {
      return (
        <Alert
          type={AlertType.DANGER}
          strongTitle="You have used all of your backup codes."
          title="Generate a new set now. Until you do, you have no way back into this account if your authenticator app or security key becomes unavailable."
        />
      );
    }

    return (
      <div>
        <Alert
          type={
            status.unused <= LOW_CODE_THRESHOLD
              ? AlertType.WARNING
              : AlertType.SUCCESS
          }
          strongTitle={`${status.unused} of ${status.total} backup codes remaining.`}
          title={
            status.unused <= LOW_CODE_THRESHOLD
              ? "You are running low. Generate a new set so you do not run out."
              : "Each code can be used once."
          }
        />
        {status.generatedAt && (
          <p className="text-sm text-gray-500 mt-2">
            {`Generated ${OneUptimeDate.getDateAsLocalFormattedString(
              status.generatedAt,
            )}.`}
          </p>
        )}
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
      <Card
        title="Backup Codes"
        description="Single-use codes that sign you in when your authenticator app or security key is not available. Keep them somewhere other than the device that generates your codes."
        buttons={[
          {
            title: isKnownToHaveNoCodes
              ? "Generate Backup Codes"
              : "Regenerate Backup Codes",
            buttonStyle: isKnownToHaveNoCodes
              ? ButtonStyleType.PRIMARY
              : ButtonStyleType.NORMAL,
            icon: IconProp.Key,
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

      {showConfirmModal && (
        <ConfirmModal
          title="Regenerate backup codes?"
          description="Every backup code you are currently holding will stop working immediately, including any you have written down or printed. You will be shown a new set once, and only once."
          submitButtonText="Regenerate"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isGenerating}
          error={generateError || undefined}
          onClose={() => {
            setShowConfirmModal(false);
            setGenerateError("");
          }}
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
          }}
        >
          <div>
            <Alert
              type={AlertType.WARNING}
              strongTitle="This is the only time these codes will be shown."
              title="Save them somewhere safe before you close this window. If you lose them, you can generate a new set -- but the codes below will be gone."
            />

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {generatedCodes.map((code: string, index: number) => {
                return (
                  <div
                    key={index}
                    className="font-mono text-sm tracking-wider text-gray-900"
                    data-testid="backup-code"
                  >
                    {code}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <CopyTextButton
                textToBeCopied={generatedCodes.join("\n")}
                size="sm"
                variant="soft"
                label="Copy codes"
                copiedLabel="Copied"
              />
              <Button
                title="Download as .txt"
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={IconProp.Download}
                onClick={downloadCodes}
              />
            </div>

            <label className="mt-5 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="backup-codes-saved-checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600"
                checked={hasSavedCodes}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setHasSavedCodes(event.target.checked);
                }}
              />
              <span className="text-sm text-gray-700">
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
