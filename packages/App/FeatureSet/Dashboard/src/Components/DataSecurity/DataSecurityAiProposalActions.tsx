import DataSecurityApi from "./DataSecurityApi";
import {
  DataSecurityAiPageCopy,
  getDataSecurityAiAskReasonSentence,
} from "./DataSecurityAiCopy";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import { getDataSecurityAiPlanFingerprint } from "Common/Types/DataSecurity/DataSecurityAi";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * APPROVE, DISMISS AND UNDO A PROPOSAL OF ONEUPTIME AI'S (#10364), wherever a
 * proposal is shown: Data Security → AI's lists and an issue's AI card.
 *
 *   - Approve opens the proposal first - what will change, why, how it is
 *     proven, how to undo it and why it asks - and approves the plan it
 *     showed (its fingerprint): one that changed since is not approved.
 *   - Dismiss asks why; the reason goes on the issue's timeline.
 *   - Undo asks first, then takes the change back.
 *
 * Every press goes through Data Security's own routes (DataSecurityApi),
 * which decide it with the person's own permissions; a refusal stays in
 * the dialog in the server's words. After a press, the caller's lists and
 * the side menu's count of what waits are read again.
 */

// What a proposal's row reads so its dialogs can show and approve it.
export const DATA_SECURITY_AI_PROPOSAL_DIALOG_SELECT: {
  kind: true;
  plan: true;
  title: true;
  changeMarkdown: true;
  reasonMarkdown: true;
  proofMarkdown: true;
  undoMarkdown: true;
  askReason: true;
  firstApprovedByUserId: true;
  dataSecurityIssueId: true;
  dataStoreId: true;
} = {
  kind: true,
  plan: true,
  title: true,
  changeMarkdown: true,
  reasonMarkdown: true,
  proofMarkdown: true,
  undoMarkdown: true,
  askReason: true,
  firstApprovedByUserId: true,
  dataSecurityIssueId: true,
  // A proposal for no issue opens its store (#10372).
  dataStoreId: true,
};

export const DATA_SECURITY_AI_PROPOSAL_REVIEW_TEST_ID: string =
  "data-security-ai-proposal-review";

// The proposal the person approves, as it was drawn for them.
const PROPOSAL_REVIEW_FIELDS: Array<{
  key: "changeMarkdown" | "reasonMarkdown" | "proofMarkdown" | "undoMarkdown";
  title: string;
}> = [
  { key: "changeMarkdown", title: DataSecurityAiPageCopy.whatWillChange },
  { key: "reasonMarkdown", title: DataSecurityAiPageCopy.why },
  { key: "proofMarkdown", title: DataSecurityAiPageCopy.howItIsProven },
  { key: "undoMarkdown", title: DataSecurityAiPageCopy.howToUndoIt },
];

export const ProposalReview: FunctionComponent<{
  proposal: DataSecurityAiProposal;
}> = (props: { proposal: DataSecurityAiProposal }): ReactElement => {
  const translator: Translator = useTranslator();
  const askReason: string | undefined = getDataSecurityAiAskReasonSentence(
    props.proposal.askReason,
  );

  return (
    <div
      className="space-y-4"
      data-testid={DATA_SECURITY_AI_PROPOSAL_REVIEW_TEST_ID}
    >
      <p className="text-sm font-medium text-gray-900">
        <IsolatedText text={props.proposal.title || ""} />
      </p>
      {PROPOSAL_REVIEW_FIELDS.map(
        (field: { key: string; title: string }): ReactElement => {
          const text: string = String(
            (props.proposal as unknown as JSONObject)[field.key] || "",
          );

          if (!text) {
            return <React.Fragment key={field.key}></React.Fragment>;
          }

          return (
            <div key={field.key}>
              <h4 className="text-sm font-medium text-gray-900">
                {translator.translateText(field.title)}
              </h4>
              <div className="mt-1 text-sm text-gray-600">
                <MarkdownViewer text={text} safeMode={true} />
              </div>
            </div>
          );
        },
      )}
      {askReason ? (
        <div>
          <h4 className="text-sm font-medium text-gray-900">
            {translator.translateText(DataSecurityAiPageCopy.whyItAsks)}
          </h4>
          <p className="mt-1 text-sm text-gray-600">
            {translator.translateText(askReason)}
          </p>
        </div>
      ) : (
        <></>
      )}
      {props.proposal.firstApprovedByUserId ? (
        <p className="text-sm text-gray-600">
          {translator.translateText(DataSecurityAiPageCopy.approvedOnce)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface DataSecurityAiProposalActions {
  approve: (proposal: DataSecurityAiProposal) => void;
  dismiss: (proposal: DataSecurityAiProposal) => void;
  undo: (proposal: DataSecurityAiProposal) => void;
  // The dialogs, drawn where the caller draws them.
  dialogs: ReactElement;
}

export function useDataSecurityAiProposalActions(
  onChanged: () => void,
): DataSecurityAiProposalActions {
  const [approving, setApproving] = useState<DataSecurityAiProposal | null>(
    null,
  );
  const [dismissing, setDismissing] = useState<DataSecurityAiProposal | null>(
    null,
  );
  const [undoing, setUndoing] = useState<DataSecurityAiProposal | null>(null);
  const [error, setError] = useState<string>("");
  const [isActing, setIsActing] = useState<boolean>(false);

  const close: () => void = (): void => {
    setApproving(null);
    setDismissing(null);
    setUndoing(null);
    setError("");
  };

  // One press at a time; the dialog says why the server would not.
  const act: (press: () => Promise<void>) => Promise<void> = async (
    press: () => Promise<void>,
  ): Promise<void> => {
    if (isActing) {
      return;
    }

    setIsActing(true);
    setError("");

    try {
      await press();
      close();
      onChanged();
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    } catch (caught) {
      setError(API.getFriendlyMessage(caught));
    }

    setIsActing(false);
  };

  const dialogs: ReactElement = (
    <>
      {approving?._id ? (
        <ConfirmModal
          title={DataSecurityAiPageCopy.approveTitle}
          description={<ProposalReview proposal={approving} />}
          submitButtonText={DataSecurityAiPageCopy.approve}
          isLoading={isActing}
          error={error || undefined}
          onClose={close}
          onSubmit={() => {
            void act(async (): Promise<void> => {
              await DataSecurityApi.approveAiProposal({
                proposalId: new ObjectID(approving._id!.toString()),
                // The plan drawn above: one that changed since is not approved.
                expectedPlanFingerprint: getDataSecurityAiPlanFingerprint({
                  kind: approving.kind,
                  plan: approving.plan,
                }),
              });
            });
          }}
        />
      ) : (
        <></>
      )}

      {dismissing?._id ? (
        <BasicFormModal<JSONObject>
          title={DataSecurityAiPageCopy.dismissTitle}
          description={DataSecurityAiPageCopy.dismissDescription}
          submitButtonText={DataSecurityAiPageCopy.dismiss}
          isSubmitting={isActing}
          error={error || undefined}
          onClose={close}
          formProps={{
            name: "Dismiss proposal",
            initialValues: {},
            fields: [
              {
                field: { reason: true },
                title: DataSecurityAiPageCopy.dismissReasonTitle,
                fieldType: FormFieldSchemaType.LongText,
                placeholder: DataSecurityAiPageCopy.dismissReasonPlaceholder,
                required: true,
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            await act(async (): Promise<void> => {
              await DataSecurityApi.dismissAiProposal({
                proposalId: new ObjectID(dismissing._id!.toString()),
                reason: String((values as JSONObject)["reason"] || ""),
              });
            });
          }}
        />
      ) : (
        <></>
      )}

      {undoing?._id ? (
        <ConfirmModal
          title={DataSecurityAiPageCopy.undoTitle}
          description={DataSecurityAiPageCopy.undoDescription}
          submitButtonText={DataSecurityAiPageCopy.undo}
          isLoading={isActing}
          error={error || undefined}
          onClose={close}
          onSubmit={() => {
            void act(async (): Promise<void> => {
              await DataSecurityApi.undoAiProposal(
                new ObjectID(undoing._id!.toString()),
              );
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );

  return {
    approve: (proposal: DataSecurityAiProposal): void => {
      close();
      setApproving(proposal);
    },
    dismiss: (proposal: DataSecurityAiProposal): void => {
      close();
      setDismissing(proposal);
    },
    undo: (proposal: DataSecurityAiProposal): void => {
      close();
      setUndoing(proposal);
    },
    dialogs,
  };
}
