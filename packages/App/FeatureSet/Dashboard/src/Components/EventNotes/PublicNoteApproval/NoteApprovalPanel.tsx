import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { PublicNoteApprovalState } from "Common/Types/StatusPage/PublicNoteApproval";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import ErrorMessageText from "Common/UI/Components/ErrorMessage/ErrorMessageText";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import {
  composedValue,
  formatList,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  PublicNoteApprovalActions,
  PublicNoteApprovalCopy,
  PublicNoteApprovalNoteSummary,
  getApprovalActions,
  getApproverNames,
  getStepTemplate,
} from "./PublicNoteApprovalUtil";

/*
 * Where a public note stands in its project's approval, inside the note's
 * card, and what the person reading can do about it: Approve and Reject for
 * an approver of the step it waits for; Send again (or Publish now, once
 * approval is not asked for) and Withdraw edit for whoever may edit it.
 * A published note an approver approved says who did.
 *
 * Every press is decided by the server again (PublicNoteApprovalEngine);
 * a refusal - somebody decided first - is shown here.
 */

export interface ComponentProps {
  state: PublicNoteApprovalState;
  summary?: PublicNoteApprovalNoteSummary | undefined;
  // The edit waiting for approval, for a published note.
  pendingNote?: string | undefined;
  isRequired: boolean;
  canEdit: boolean;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onResubmit: () => Promise<void>;
  onWithdrawEdit: () => Promise<void>;
}

const NoteApprovalPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const [dialog, setDialog] = useState<
    "approve" | "reject" | "withdraw" | null
  >(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  /*
   * What the press that failed was doing, as an English key looked up where
   * it is drawn - "Couldn't approve the note." - said first when the error
   * is one nobody explained.
   */
  const [whatFailed, setWhatFailed] = useState<string>("");

  const actions: PublicNoteApprovalActions = getApprovalActions({
    state: props.state,
    summary: props.summary,
    isRequired: props.isRequired,
    canEdit: props.canEdit,
  });

  const isWaiting: boolean =
    props.state === PublicNoteApprovalState.WaitingForApproval ||
    props.state === PublicNoteApprovalState.EditWaitingForApproval;
  const isRejected: boolean =
    props.state === PublicNoteApprovalState.Rejected ||
    props.state === PublicNoteApprovalState.EditRejected;
  const hasEdit: boolean =
    props.state === PublicNoteApprovalState.EditWaitingForApproval ||
    props.state === PublicNoteApprovalState.EditRejected;

  const run: (
    action: () => Promise<void>,
    failed: string,
  ) => Promise<void> = async (
    action: () => Promise<void>,
    failed: string,
  ): Promise<void> => {
    setError("");
    setIsBusy(true);

    try {
      await action();
      setDialog(null);
    } catch (err) {
      setWhatFailed(failed);
      setError(API.getFriendlyMessage(err));
    }

    setIsBusy(false);
  };

  const timeLabel: (at: string | undefined) => string = (
    at: string | undefined,
  ): string => {
    if (!at) {
      return "";
    }

    return OneUptimeDate.fromNow(OneUptimeDate.fromString(at));
  };

  // A published note nobody had to approve shows nothing here.
  if (!isWaiting && !isRejected) {
    const approvers: Array<string> = (props.summary?.approvals || []).map(
      (given: { by: string }) => {
        return given.by;
      },
    );

    if (approvers.length === 0) {
      return null;
    }

    return (
      <div
        className="flex items-center gap-1.5 px-4 pb-3 text-xs text-gray-500"
        data-testid="note-approval-approved-by"
      >
        <Icon
          icon={IconProp.ShieldCheck}
          className="h-3.5 w-3.5 text-green-600"
        />
        <span>
          {translator.translateTemplate(PublicNoteApprovalCopy.approvedBy, {
            // People's names, with the sentence's language's separator.
            names: composedValue((sentence: Translator): string => {
              return formatList(approvers, sentence);
            }),
          })}
        </span>
      </div>
    );
  }

  const step: { template: string; values: Record<string, string> } | null =
    getStepTemplate(props.summary?.step);
  const approverNames: Array<string> = getApproverNames(props.summary?.step);

  const buttonClassName: string =
    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

  return (
    <div className="px-4 pb-3" data-testid="note-approval-panel">
      <div
        className={`rounded-lg border px-3 py-2.5 text-sm ${
          isRejected
            ? "border-red-200 bg-red-50 text-red-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        {hasEdit && props.pendingNote !== undefined && (
          <div className="mb-2.5" data-testid="note-approval-proposed-edit">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
              {tx(PublicNoteApprovalCopy.proposedEdit)}
            </p>
            <div className="mt-1 rounded-md border border-white/60 bg-white px-3 py-2 text-gray-800">
              <MarkdownViewer text={props.pendingNote || ""} />
            </div>
          </div>
        )}

        {isWaiting && (
          <div
            className="flex items-start gap-2"
            data-testid="note-approval-waiting"
          >
            <Icon icon={IconProp.Clock} className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              {step && (
                <p className="font-medium" data-testid="note-approval-step">
                  {translator.translateTemplate(step.template, step.values)}
                </p>
              )}
              <p data-testid="note-approval-approvers">
                {approverNames.length > 0
                  ? translator.translateTemplate(
                      PublicNoteApprovalCopy.waitingFor,
                      {
                        approvers: composedValue(
                          (sentence: Translator): string => {
                            return formatList(approverNames, sentence);
                          },
                        ),
                      },
                    )
                  : tx(PublicNoteApprovalCopy.nobodyToApprove)}
              </p>
              {props.summary?.submittedBy && (
                <p className="mt-0.5 text-xs opacity-80">
                  {translator.translateTemplate(PublicNoteApprovalCopy.sentBy, {
                    name: props.summary.submittedBy,
                  })}{" "}
                  · {timeLabel(props.summary.submittedAt)}
                </p>
              )}
              {!actions.canApprove && props.summary?.decisionRefusal && (
                <p
                  className="mt-1 text-xs opacity-80"
                  data-testid="note-approval-refusal"
                >
                  {tx(props.summary.decisionRefusal)}
                </p>
              )}
            </div>
          </div>
        )}

        {isRejected && props.summary?.rejection && (
          <div
            className="flex items-start gap-2"
            data-testid="note-approval-rejected"
          >
            <Icon icon={IconProp.XCircle} className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">
                {translator.translateTemplate(
                  PublicNoteApprovalCopy.rejectedBy,
                  {
                    name: props.summary.rejection.by,
                  },
                )}{" "}
                <span className="font-normal opacity-80">
                  · {timeLabel(props.summary.rejection.at)}
                </span>
              </p>
              <p
                className="mt-0.5 whitespace-pre-wrap break-words"
                data-testid="note-approval-reason"
              >
                {props.summary.rejection.reason}
              </p>
            </div>
          </div>
        )}

        {(actions.canApprove ||
          actions.canReject ||
          actions.canResubmit ||
          actions.canWithdrawEdit) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {actions.canApprove && (
              <button
                type="button"
                data-testid="note-approval-approve"
                disabled={isBusy}
                onClick={() => {
                  setError("");
                  setDialog("approve");
                }}
                className={`${buttonClassName} bg-green-600 text-white ${getHandDrawnButtonStateClassName(
                  { isBusy: isBusy, hoverClassName: "hover:bg-green-700" },
                )}`}
              >
                <Icon icon={IconProp.Check} className="h-4 w-4" />
                {tx(
                  actions.isApprovalFinal
                    ? PublicNoteApprovalCopy.approveAndPublish
                    : PublicNoteApprovalCopy.approve,
                )}
              </button>
            )}
            {actions.canReject && (
              <button
                type="button"
                data-testid="note-approval-reject"
                disabled={isBusy}
                onClick={() => {
                  setError("");
                  setDialog("reject");
                }}
                className={`${buttonClassName} border border-red-200 bg-white text-red-700 ${getHandDrawnButtonStateClassName(
                  { isBusy: isBusy, hoverClassName: "hover:bg-red-50" },
                )}`}
              >
                <Icon icon={IconProp.Close} className="h-4 w-4" />
                {tx(PublicNoteApprovalCopy.reject)}
              </button>
            )}
            {actions.canResubmit && (
              <button
                type="button"
                data-testid="note-approval-resubmit"
                disabled={isBusy}
                onClick={() => {
                  void run(props.onResubmit, actions.resubmitFailed);
                }}
                className={`${buttonClassName} border border-gray-300 bg-white text-gray-700 ${getHandDrawnButtonStateClassName(
                  { isBusy: isBusy, hoverClassName: "hover:bg-gray-50" },
                )}`}
              >
                <Icon icon={IconProp.Refresh} className="h-4 w-4" />
                {tx(actions.resubmitLabel)}
              </button>
            )}
            {actions.canWithdrawEdit && (
              <button
                type="button"
                data-testid="note-approval-withdraw-edit"
                disabled={isBusy}
                onClick={() => {
                  setError("");
                  setDialog("withdraw");
                }}
                className={`${buttonClassName} border border-gray-300 bg-white text-gray-700 ${getHandDrawnButtonStateClassName(
                  { isBusy: isBusy, hoverClassName: "hover:bg-gray-50" },
                )}`}
              >
                <Icon icon={IconProp.ArrowUturnLeft} className="h-4 w-4" />
                {tx(PublicNoteApprovalCopy.withdrawEdit)}
              </button>
            )}
          </div>
        )}

        {error && !dialog && (
          <p
            role="alert"
            className="mt-2 text-xs text-red-700"
            data-testid="note-approval-error"
          >
            {/*
             * In the reader's language and read the way it is written; an
             * error nobody explained says what failed, why and what to do
             * next, with the reference to give when the server failed
             * (ErrorMessageText). It was the message as
             * API.getFriendlyMessage words it: English on every page.
             */}
            <ErrorMessageText
              message={error}
              whatFailed={whatFailed ? tx(whatFailed) : undefined}
            />
          </p>
        )}
      </div>

      {dialog === "approve" && (
        <ConfirmModal
          title={tx(PublicNoteApprovalCopy.approveTitle)}
          description={tx(
            !actions.isApprovalFinal
              ? PublicNoteApprovalCopy.approveStepDescription
              : hasEdit
                ? PublicNoteApprovalCopy.approveEditFinalDescription
                : PublicNoteApprovalCopy.approveFinalDescription,
          )}
          submitButtonText={tx(
            actions.isApprovalFinal
              ? PublicNoteApprovalCopy.approveAndPublish
              : PublicNoteApprovalCopy.approve,
          )}
          isLoading={isBusy}
          error={error || undefined}
          errorWhatFailed={tx(PublicNoteApprovalCopy.approveFailed)}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={() => {
            void run(props.onApprove, PublicNoteApprovalCopy.approveFailed);
          }}
        />
      )}

      {dialog === "reject" && (
        <BasicFormModal<JSONObject>
          title={tx(PublicNoteApprovalCopy.rejectTitle)}
          description={tx(PublicNoteApprovalCopy.rejectDescription)}
          submitButtonText={tx(PublicNoteApprovalCopy.reject)}
          submitButtonStyleType={ButtonStyleType.DANGER}
          modalWidth={ModalWidth.Medium}
          isSubmitting={isBusy}
          error={error || undefined}
          errorWhatFailed={tx(PublicNoteApprovalCopy.rejectFailed)}
          onClose={() => {
            setDialog(null);
          }}
          formProps={{
            name: "public-note-reject",
            fields: [
              {
                field: { reason: true },
                title: PublicNoteApprovalCopy.rejectReasonTitle,
                description: PublicNoteApprovalCopy.rejectReasonDescription,
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder: PublicNoteApprovalCopy.rejectReasonPlaceholder,
              },
            ],
          }}
          onSubmit={(values: FormValues<JSONObject>) => {
            const reason: string =
              typeof values["reason"] === "string"
                ? (values["reason"] as string).trim()
                : "";

            void run(() => {
              return props.onReject(reason);
            }, PublicNoteApprovalCopy.rejectFailed);
          }}
        />
      )}

      {dialog === "withdraw" && (
        <ConfirmModal
          title={tx(PublicNoteApprovalCopy.withdrawTitle)}
          description={tx(PublicNoteApprovalCopy.withdrawDescription)}
          submitButtonText={tx(PublicNoteApprovalCopy.withdrawEdit)}
          isLoading={isBusy}
          error={error || undefined}
          errorWhatFailed={tx(PublicNoteApprovalCopy.withdrawEditFailed)}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={() => {
            void run(
              props.onWithdrawEdit,
              PublicNoteApprovalCopy.withdrawEditFailed,
            );
          }}
        />
      )}
    </div>
  );
};

export default NoteApprovalPanel;
