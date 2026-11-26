import {
  CLOUD_COST_REPORT_SKIP_REASON_LABELS,
  CloudCostReportContent,
  isCloudCostReportSkipReason,
} from "Common/Types/Cloud/CloudCostReport";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudCostReportPreview from "./CloudCostReportPreview";
import {
  fetchCloudCostReportPreview,
  sendCloudCostReportCopy,
} from "./CloudCostReportApi";

/*
 * PREVIEW A COST REPORT (#11009): what the report says now - its last
 * period, as the next send would have it - read as the person may read it,
 * the way the email lays it out; who its last send left out, and why; and
 * Send Me a Copy, which emails it to the person now.
 */

export const REPORT_PREVIEW_TITLE: string = translationKey("Report Preview");
export const REPORT_PREVIEW_DESCRIPTION: string = translationKey(
  "What the report says now, as you may read it. Each person it goes to gets the figures they may read.",
);
export const REPORT_PREVIEW_FAILED: string = translationKey(
  "The report could not be read.",
);
export const SEND_ME_A_COPY: string = translationKey("Send Me a Copy");
export const COPY_SENT: string = translationKey("A copy is on its way to {{email}}.");
export const LAST_SEND_LEFT_OUT: string = translationKey(
  "Its last send left these out:",
);

export interface ComponentProps {
  reportId: ObjectID;
  // What the report's last send did (CloudCostReport.lastSendResult).
  lastSendResult?: JSONObject | undefined;
  onClose: () => void;
}

const CloudCostReportPreviewModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [content, setContent] = useState<CloudCostReportContent | null>(null);
  const [error, setError] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sentTo, setSentTo] = useState<string>("");
  const [sendError, setSendError] = useState<string>("");

  useEffect(() => {
    let ignore: boolean = false;

    fetchCloudCostReportPreview(props.reportId)
      .then((found: CloudCostReportContent): void => {
        if (!ignore) {
          setContent(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [props.reportId.toString()]);

  const skipped: Array<{ who: string; reason: string; detail?: string }> =
    Array.isArray(props.lastSendResult?.["skipped"])
      ? (props.lastSendResult!["skipped"] as Array<{
          who: string;
          reason: string;
          detail?: string;
        }>)
      : [];

  // Why one was left out, in the reader's words, with its channel's own.
  const getReason: (skip: { reason: string; detail?: string }) => string = (
    skip: { reason: string; detail?: string },
  ): string => {
    const label: string = isCloudCostReportSkipReason(skip.reason)
      ? translator.translateText(
          CLOUD_COST_REPORT_SKIP_REASON_LABELS[skip.reason],
        ) || CLOUD_COST_REPORT_SKIP_REASON_LABELS[skip.reason]
      : skip.reason;

    return skip.detail ? `${label} ${skip.detail}` : label;
  };

  return (
    <Modal
      title={REPORT_PREVIEW_TITLE}
      description={REPORT_PREVIEW_DESCRIPTION}
      onClose={props.onClose}
      modalWidth={ModalWidth.Large}
      isBodyLoading={!content && !error}
      error={error}
      errorWhatFailed={
        error
          ? translator.translateText(REPORT_PREVIEW_FAILED) ||
            REPORT_PREVIEW_FAILED
          : undefined
      }
      submitButtonText={SEND_ME_A_COPY}
      submitButtonStyleType={ButtonStyleType.NORMAL}
      isLoading={isSending}
      disableSubmitButton={!content || Boolean(sentTo)}
      onSubmit={() => {
        setIsSending(true);
        setSendError("");

        sendCloudCostReportCopy(props.reportId)
          .then((email: string): void => {
            setSentTo(email);
          })
          .catch((err: Error): void => {
            setSendError(API.getFriendlyMessage(err));
          })
          .finally((): void => {
            setIsSending(false);
          });
      }}
    >
      <div data-testid="cloud-cost-report-preview-modal">
        {sentTo ? (
          <div className="mb-4">
            <Alert
              type={AlertType.SUCCESS}
              title={translator.translateTemplate(COPY_SENT, { email: sentTo })}
              dataTestId="cloud-cost-report-copy-sent"
            />
          </div>
        ) : (
          <></>
        )}
        {sendError ? (
          <div className="mb-4">
            <Alert
              type={AlertType.DANGER}
              title={sendError}
            />
          </div>
        ) : (
          <></>
        )}
        {content ? <CloudCostReportPreview content={content} /> : <></>}
        {skipped.length > 0 ? (
          <div
            className="mt-5 border-t border-gray-100 pt-4"
            data-testid="cloud-cost-report-left-out"
          >
            <p className="text-sm font-medium text-gray-700">
              {translator.translateText(LAST_SEND_LEFT_OUT)}
            </p>
            <ul className="mt-2 space-y-1">
              {skipped.slice(0, 20).map(
                (
                  skip: { who: string; reason: string; detail?: string },
                  index: number,
                ): ReactElement => {
                  return (
                    <li key={index} className="text-xs text-gray-600">
                      <bdi className="font-medium text-gray-800">
                        {skip.who}
                      </bdi>{" "}
                      <span>{getReason(skip)}</span>
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudCostReportPreviewModal;
