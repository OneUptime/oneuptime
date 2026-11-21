import PageComponentProps from "../PageComponentProps";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../../Components/AISettings/ProjectAiSwitchesCard";
import {
  DATA_SECURITY_AI_SWITCHES,
  DATA_SECURITY_AI_SWITCHES_TEST_ID,
  DataSecurityAiSettingsCopy,
  ProjectAiNoticeContext,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import {
  DATA_SECURITY_AI_TABLE_IDS,
  DataSecurityAiPageCopy,
  DataSecurityAiRulesCopy,
  getDataSecurityAiDecisionLines,
  getDataSecurityAiSkipSentence,
  getDataSecurityAiWorkLabel,
} from "../../Components/DataSecurity/DataSecurityAiCopy";
import {
  DATA_SECURITY_AI_PROPOSAL_DIALOG_SELECT,
  DataSecurityAiProposalActions,
  useDataSecurityAiProposalActions,
} from "../../Components/DataSecurity/DataSecurityAiProposalActions";
import DataSecurityAiRulesTable from "../../Components/DataSecurity/DataSecurityAiRulesTable";
import { getDataSecurityIssueRoute } from "../../Components/DataSecurity/StoreIssuesTable";
import DataSecurityAiDecision from "Common/Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DataSecurityAiProposalStatus } from "Common/Types/DataSecurity/DataSecurityAi";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
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
 *   - AI Rules: which issues it works on, and what each kind of work may do.
 *
 * A proposal says which rule decided it, or that the project's defaults
 * did: what a rule allows is what the lists show. Each row opens its issue.
 * Proposals and decisions are read through their own CRUD routes, and
 * acted on only through Data Security's (DataSecurityAiProposalActions):
 * the server decides every press - who may make the change, whether two
 * people must approve it - and says why when it will not, which the dialog
 * shows.
 */

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
  const actions: DataSecurityAiProposalActions =
    useDataSecurityAiProposalActions((): void => {
      setRefreshToggle(ObjectID.generate().toString());
    });

  // The rule that decided a proposal, or the project's defaults.
  const ruleColumn: {
    field: { autoRemediationRuleName: true };
    title: string;
    type: FieldType;
    hideOnMobile: boolean;
    getElement: (item: DataSecurityAiProposal) => ReactElement;
  } = {
    field: { autoRemediationRuleName: true },
    title: DataSecurityAiRulesCopy.ruleColumn,
    type: FieldType.Element,
    hideOnMobile: true,
    getElement: (item: DataSecurityAiProposal): ReactElement => {
      return item.autoRemediationRuleName ? (
        <IsolatedText text={item.autoRemediationRuleName} />
      ) : (
        <span className="text-gray-500">
          {translator.translateText(DataSecurityAiRulesCopy.projectDefaults)}
        </span>
      );
    },
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
        selectMoreFields={DATA_SECURITY_AI_PROPOSAL_DIALOG_SELECT}
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
              actions.approve(item);
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
              actions.dismiss(item);
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
          ruleColumn,
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
              actions.undo(item);
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
          ruleColumn,
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

      <DataSecurityAiRulesTable />

      {actions.dialogs}
    </>
  );
};

export default DataSecurityAiPage;
