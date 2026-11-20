import PageComponentProps from "../PageComponentProps";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../../Components/AISettings/ProjectAiSwitchesCard";
import {
  DATA_SECURITY_AI_SWITCHES,
  DATA_SECURITY_AI_SWITCHES_TEST_ID,
  DataSecurityAiSettingsCopy,
  ProjectAiNoticeContext,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import {
  DATA_SECURITY_AI_TABLE_IDS,
  DataSecurityAiPageCopy,
  getDataSecurityAiAskReasonSentence,
  getDataSecurityAiDecisionLines,
  getDataSecurityAiSkipSentence,
  getDataSecurityAiWorkLabel,
} from "../../Components/DataSecurity/DataSecurityAiCopy";
import { getDataSecurityIssueRoute } from "../../Components/DataSecurity/StoreIssuesTable";
import DataSecurityAiDecision from "Common/Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataSecurityAiProposalStatus,
  getDataSecurityAiPlanFingerprint,
} from "Common/Types/DataSecurity/DataSecurityAi";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * DATA SECURITY → AI (#10364): what OneUptime AI does on Data Security
 * issues, and what waits for a person.
 *
 *   - The switch that has it work on new issues on its own (on for new
 *     projects), under the notice that says when AI is off.
 *   - Waiting for you: what it proposes, riskiest first. Approve opens the
 *     proposal - what will change, why, how it is proven and how to undo
 *     it - and makes the change with the reader's own permissions; Dismiss
 *     says no with a reason, which goes on the issue's timeline.
 *   - Done by AI: what it changed without asking, as the AI rules allow,
 *     each with Undo.
 *   - Why AI did not act: the issues it looked at and left alone, and why.
 *
 * Each row opens its issue. Proposals and decisions are read through their
 * own CRUD routes, and acted on only through Data Security's
 * (DataSecurityApi): the server decides every press - who may make the
 * change, whether two people must approve it - and says why when it will
 * not, which the dialog shows.
 */

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

const ProposalReview: FunctionComponent<{
  proposal: DataSecurityAiProposal;
}> = (props: { proposal: DataSecurityAiProposal }): ReactElement => {
  const translator: Translator = useTranslator();
  const askReason: string | undefined = getDataSecurityAiAskReasonSentence(
    props.proposal.askReason,
  );

  return (
    <div className="space-y-4" data-testid="data-security-ai-proposal-review">
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

const openIssue: (item: {
  dataSecurityIssueId?: ObjectID | undefined;
}) => Promise<Route> = (item: {
  dataSecurityIssueId?: ObjectID | undefined;
}): Promise<Route> => {
  return Promise.resolve(
    getDataSecurityIssueRoute(item.dataSecurityIssueId!.toString()),
  );
};

const DataSecurityAiPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [approving, setApproving] = useState<DataSecurityAiProposal | null>(
    null,
  );
  const [dismissing, setDismissing] = useState<DataSecurityAiProposal | null>(
    null,
  );
  const [undoing, setUndoing] = useState<DataSecurityAiProposal | null>(null);
  const [modalError, setModalError] = useState<string>("");
  const [isActing, setIsActing] = useState<boolean>(false);

  // The lists, and the side menu's count of what waits beside AI.
  const refresh: () => void = (): void => {
    setRefreshToggle(ObjectID.generate().toString());
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
  };

  const closeModals: () => void = (): void => {
    setApproving(null);
    setDismissing(null);
    setUndoing(null);
    setModalError("");
  };

  // One press at a time; the dialog says why the server would not.
  const act: (press: () => Promise<void>) => Promise<void> = async (
    press: () => Promise<void>,
  ): Promise<void> => {
    if (isActing) {
      return;
    }

    setIsActing(true);
    setModalError("");

    try {
      await press();
      closeModals();
      refresh();
    } catch (error) {
      setModalError(API.getFriendlyMessage(error));
    }

    setIsActing(false);
  };

  return (
    <>
      <ProjectAiNotice context={ProjectAiNoticeContext.DataSecurity} />

      <ProjectAiSwitchesCard
        cardTitle={DataSecurityAiSettingsCopy.cardTitle}
        cardDescription={DataSecurityAiSettingsCopy.cardDescription}
        switches={DATA_SECURITY_AI_SWITCHES}
        dataTestId={DATA_SECURITY_AI_SWITCHES_TEST_ID}
      />

      <ModelTable<DataSecurityAiProposal>
        modelType={DataSecurityAiProposal}
        id={DATA_SECURITY_AI_TABLE_IDS.waiting}
        userPreferencesKey={DATA_SECURITY_AI_TABLE_IDS.waiting}
        name="Data Security AI: Waiting for you"
        query={{ status: DataSecurityAiProposalStatus.Proposed }}
        refreshToggle={refreshToggle}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        onViewPage={openIssue}
        showRefreshButton={true}
        filters={[]}
        sortBy="riskScore"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: DataSecurityAiPageCopy.waitingTitle,
          description: DataSecurityAiPageCopy.waitingDescription,
        }}
        noItemsMessage={DataSecurityAiPageCopy.waitingEmpty}
        selectMoreFields={{
          kind: true,
          plan: true,
          dataSecurityIssueId: true,
          changeMarkdown: true,
          reasonMarkdown: true,
          proofMarkdown: true,
          undoMarkdown: true,
          askReason: true,
          firstApprovedByUserId: true,
        }}
        actionButtons={[
          {
            title: DataSecurityAiPageCopy.approve,
            icon: IconProp.Check,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.Primary,
            onClick: (
              item: DataSecurityAiProposal,
              onCompleteAction: VoidFunction,
            ) => {
              closeModals();
              setApproving(item);
              onCompleteAction();
            },
          },
          {
            title: DataSecurityAiPageCopy.dismiss,
            icon: IconProp.Close,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (
              item: DataSecurityAiProposal,
              onCompleteAction: VoidFunction,
            ) => {
              closeModals();
              setDismissing(item);
              onCompleteAction();
            },
          },
        ]}
        columns={[
          {
            field: { title: true },
            title: "Proposal",
            type: FieldType.Text,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-md",
          },
          {
            field: { work: true },
            title: "Work",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataSecurityAiProposal): ReactElement => {
              return (
                <span>
                  {translator.translateText(
                    getDataSecurityAiWorkLabel(item.work),
                  )}
                </span>
              );
            },
          },
          {
            field: { createdAt: true },
            title: "Proposed",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />

      <ModelTable<DataSecurityAiProposal>
        modelType={DataSecurityAiProposal}
        id={DATA_SECURITY_AI_TABLE_IDS.done}
        userPreferencesKey={DATA_SECURITY_AI_TABLE_IDS.done}
        name="Data Security AI: Done by AI"
        query={{ status: DataSecurityAiProposalStatus.AppliedWithoutAsking }}
        refreshToggle={refreshToggle}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        onViewPage={openIssue}
        showRefreshButton={true}
        filters={[]}
        sortBy="appliedAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: DataSecurityAiPageCopy.doneTitle,
          description: DataSecurityAiPageCopy.doneDescription,
        }}
        noItemsMessage={DataSecurityAiPageCopy.doneEmpty}
        selectMoreFields={{ dataSecurityIssueId: true }}
        actionButtons={[
          {
            title: DataSecurityAiPageCopy.undo,
            icon: IconProp.ArrowUturnLeft,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.Primary,
            onClick: (
              item: DataSecurityAiProposal,
              onCompleteAction: VoidFunction,
            ) => {
              closeModals();
              setUndoing(item);
              onCompleteAction();
            },
          },
        ]}
        columns={[
          {
            field: { title: true },
            title: "Change",
            type: FieldType.Text,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-md",
          },
          {
            field: { appliedAt: true },
            title: "Made",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />

      <ModelTable<DataSecurityAiDecision>
        modelType={DataSecurityAiDecision}
        id={DATA_SECURITY_AI_TABLE_IDS.skipped}
        userPreferencesKey={DATA_SECURITY_AI_TABLE_IDS.skipped}
        name="Data Security AI: Why AI did not act"
        query={{ didAct: false }}
        refreshToggle={refreshToggle}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        onViewPage={openIssue}
        showRefreshButton={true}
        filters={[]}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: DataSecurityAiPageCopy.skippedTitle,
          description: DataSecurityAiPageCopy.skippedDescription,
        }}
        noItemsMessage={DataSecurityAiPageCopy.skippedEmpty}
        selectMoreFields={{
          dataSecurityIssueId: true,
          entries: true,
        }}
        columns={[
          {
            field: { dataSecurityIssue: { title: true } },
            title: "Issue",
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-sm",
            getExportValue: (item: DataSecurityAiDecision): string => {
              return item.dataSecurityIssue?.title || "";
            },
            getElement: (item: DataSecurityAiDecision): ReactElement => {
              return item.dataSecurityIssue?.title ? (
                <IsolatedText text={item.dataSecurityIssue.title} />
              ) : (
                <TableEmptyValue />
              );
            },
          },
          {
            field: { skipReason: true },
            title: "Why",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-md",
            getElement: (item: DataSecurityAiDecision): ReactElement => {
              const lines: Array<{ work: string; reason: string }> =
                getDataSecurityAiDecisionLines(item.entries);

              return (
                <div>
                  <p>
                    {translator.translateText(
                      getDataSecurityAiSkipSentence(item.skipReason),
                    )}
                  </p>
                  {lines.length > 0 ? (
                    <ul className="mt-1 text-sm text-gray-500">
                      {lines.map(
                        (
                          line: { work: string; reason: string },
                          index: number,
                        ): ReactElement => {
                          return (
                            <li key={index}>
                              {translator.translateTemplate(LABEL_WITH_COLON, {
                                label:
                                  translator.translateText(line.work) ||
                                  line.work,
                              })}{" "}
                              {translator.translateText(line.reason)}
                            </li>
                          );
                        },
                      )}
                    </ul>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { createdAt: true },
            title: "Looked At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />

      {approving?._id ? (
        <ConfirmModal
          title={DataSecurityAiPageCopy.approveTitle}
          description={<ProposalReview proposal={approving} />}
          submitButtonText={DataSecurityAiPageCopy.approve}
          isLoading={isActing}
          error={modalError || undefined}
          onClose={closeModals}
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
          error={modalError || undefined}
          onClose={closeModals}
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
          error={modalError || undefined}
          onClose={closeModals}
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
};

export default DataSecurityAiPage;
