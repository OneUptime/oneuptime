import PageComponentProps from "../PageComponentProps";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "./ProjectColumnEditGate";
import { getEnableAiConfirmation } from "../../Components/AISettings/EnableAiConfirmation";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import ProjectAiContextCard from "../../Components/AISettings/ProjectAiContextCard";
import {
  ENABLE_AI_COLUMN,
  ENABLE_AI_SWITCH_TEST_ID,
  EnableAiCopy,
  getProjectAiDailyLimitColumns,
  getProjectAiDailyLimitFieldError,
  getProjectAiRunLimitFieldError,
  getProjectAiRunLimitsFoldedItem,
  getProjectAiRunLimitsFromItem,
  PROJECT_AI_ADVANCED_SECTION_TEST_ID,
  PROJECT_AI_DAILY_LIMITS_CARD_KEY,
  PROJECT_AI_RUN_LIMIT_FIELDS,
  PROJECT_AI_RUN_LIMITS_CARD_KEY,
  ProjectAiDailyLimitsCopy,
  ProjectAiNoticeContext,
  ProjectAiRunLimitField,
  ProjectAiRunLimitsCopy,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import useProjectAiDailyLimits, {
  ProjectAiDailyLimitsSection,
} from "../../Components/AISettings/useProjectAiDailyLimits";
import {
  FIX_APPROVALS_CARD_KEY,
  FIX_APPROVALS_SWITCH_TEST_ID,
  FixApprovalsCopy,
  getFixApprovalsFoldedItem,
  TWO_APPROVALS_COLUMN,
} from "../../Components/AISettings/FixApprovalsCopy";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import {
  PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
  PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
} from "Common/Types/AI/ProjectAiDailyLimits";
import {
  PROJECT_AI_RUN_LIMIT_COLUMNS,
  ProjectAiRunLimitValues,
} from "Common/Types/AI/ProjectAiRunLimits";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Field from "Common/UI/Components/ModelDetail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The project's AI switch, Enable AI, on a page every install shows. It used
 * to sit on AI Credits, which the settings menu lists only when billing is
 * on — so on a self-hosted install it could be reached only by typing its
 * URL. It is the master switch: auto-remediation and AI commands on Runners
 * had switches of their own once, and both now follow it. Every message
 * that sends people to turn AI on names this page, with the AI section it
 * is in: "Project Settings → AI → AI Features".
 *
 * It is the switch itself, saving the moment it is flipped (the shared
 * ModelSwitchCard). It used to sit behind "Edit AI Features" and a dialog.
 * Turning it off stops every AI feature in the project at once, so that
 * asks first; turning it on saves at once. Its column takes Project Owner
 * or Manage Billing - narrower than the Project table, which also lets
 * Project Admin and Edit Project in - so for everyone else the switch is
 * locked and says which permission it needs.
 *
 * Under it, only when it is so: the project has no LLM provider for AI to
 * use (ProjectAiNotice).
 *
 * Then the project's AI context (ProjectAiContextCard): what OneUptime AI
 * should know about the project's systems, read first by every
 * investigation, fix, postmortem draft and Ask AI chat.
 *
 * Then, folded under More settings like the incident and alert AI pages'
 * limits, the project's own Daily limits: a ceiling on everything AI does
 * in the project each day - tokens everywhere, and AI credits spent where
 * AI is billed - above the incident and alert limits (Common/Types/AI/
 * ProjectAiDailyLimits). Folded, it says what applies and what AI used
 * today. The card writes the limit columns alone, and like Enable AI they
 * take Project Owner or Manage Billing, so its Edit is gated on them.
 *
 * Beside them, Limits per run (issue #6440): how far one OneUptime AI run
 * may go - its model calls, tool calls, tokens and time - for every kind of
 * run, from an investigation to a code task. None is set by default: a run
 * goes as far as its work needs, and only its time limit (120 minutes
 * unless set) and loop detection stop it. A run a limit stops says which
 * one, linked here (ProjectAiRunLimitsCopy). The card writes its four
 * columns alone, which take Project Owner or Manage Billing.
 *
 * Then, under the same More settings, Fix approvals (#6148's follow-up): one
 * switch, off by default, that asks two people to approve a fix OneUptime
 * AI proposes when it holds a riskier change (FixApprovalsCopy). Folded,
 * the header says "Fix approvals: Two people" while it is on.
 */
const AIFeatures: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const translator: Translator = useTranslator();
  const dailyLimits: ProjectAiDailyLimitsSection = useProjectAiDailyLimits();
  /*
   * Whether two people approve a riskier fix, as the switch last said: the
   * folded header names the card, and says "Two people" while it is on.
   */
  const [isTwoApprovalsOn, setIsTwoApprovalsOn] = useState<boolean | null>(
    null,
  );
  /*
   * The limits per run as the card last read them: the folded header shows
   * a chip on the card's name once one is set.
   */
  const [runLimits, setRunLimits] = useState<ProjectAiRunLimitValues | null>(
    null,
  );

  if (!projectId) {
    return <></>;
  }

  const runLimitsGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: [...PROJECT_AI_RUN_LIMIT_COLUMNS],
    buttonTitle: "Edit",
  });

  const runLimitFormFields: Fields<Project> = PROJECT_AI_RUN_LIMIT_FIELDS.map(
    (limit: ProjectAiRunLimitField) => {
      return {
        field: { [limit.column]: true },
        title: limit.title,
        description: limit.description,
        required: false,
        fieldType: FormFieldSchemaType.Number,
        placeholder: limit.placeholder,
        customValidation: (values: FormValues<Project>): string | null => {
          return getProjectAiRunLimitFieldError({
            column: limit.column,
            value: (values as Record<string, unknown>)[limit.column],
            fieldTitle: limit.title,
            translator,
          });
        },
      };
    },
  ) as Fields<Project>;

  const runLimitDetailFields: Array<Field<Project>> =
    PROJECT_AI_RUN_LIMIT_FIELDS.map((limit: ProjectAiRunLimitField) => {
      return {
        field: { [limit.column]: true },
        title: limit.title,
        placeholder: limit.placeholder,
        fieldType: FieldType.Number,
      };
    }) as Array<Field<Project>>;

  /*
   * Spend is offered only where AI is billed: elsewhere nothing is spent,
   * and the server refuses a spend limit there.
   */
  const isBillingEnabled: boolean = BILLING_ENABLED;

  const dailyGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: getProjectAiDailyLimitColumns(isBillingEnabled),
    buttonTitle: "Edit",
  });

  const formFields: Fields<Project> = [
    {
      field: {
        aiDailyTokenLimit: true,
      },
      title: "Daily AI Token Limit",
      description:
        "The most tokens OneUptime AI may use in this project each day, for everything. Leave empty for no limit.",
      required: false,
      fieldType: FormFieldSchemaType.Number,
      placeholder: "No limit",
      customValidation: (values: FormValues<Project>): string | null => {
        return getProjectAiDailyLimitFieldError({
          column: PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
          value: (values as Record<string, unknown>)[
            PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN
          ],
          fieldTitle: "Daily AI Token Limit",
          translator,
        });
      },
    },
  ];

  const detailFields: Array<Field<Project>> = [
    {
      field: {
        aiDailyTokenLimit: true,
      },
      title: "Daily AI Token Limit",
      placeholder: "No limit",
      fieldType: FieldType.Number,
    },
  ];

  if (isBillingEnabled) {
    formFields.push({
      field: {
        aiDailySpendLimitInUSD: true,
      },
      title: "Daily AI Spend Limit (USD)",
      description:
        "The most AI credits, in US dollars, OneUptime AI may spend here each day. Your own LLM provider is not counted. Leave empty for no limit.",
      required: false,
      fieldType: FormFieldSchemaType.Number,
      placeholder: "No limit",
      customValidation: (values: FormValues<Project>): string | null => {
        return getProjectAiDailyLimitFieldError({
          column: PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
          value: (values as Record<string, unknown>)[
            PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN
          ],
          fieldTitle: "Daily AI Spend Limit (USD)",
          translator,
        });
      },
    });

    detailFields.push({
      field: {
        aiDailySpendLimitInUSD: true,
      },
      title: "Daily AI Spend Limit (USD)",
      placeholder: "No limit",
      fieldType: FieldType.Number,
    });
  }

  return (
    <>
      <ModelSwitchCard<Project>
        modelType={Project}
        modelId={projectId}
        column={ENABLE_AI_COLUMN}
        cardTitle={EnableAiCopy.cardTitle}
        cardDescription={EnableAiCopy.cardDescription}
        title={EnableAiCopy.switchTitle}
        getDescription={(): string => {
          return EnableAiCopy.switchDescription;
        }}
        getConfirmation={getEnableAiConfirmation}
        dataTestId={ENABLE_AI_SWITCH_TEST_ID}
      />

      {/*
       * Under the switch rather than above it: turning AI on can bring the
       * provider notice up, and it must not push the switch away from the
       * pointer that just pressed it.
       */}
      <ProjectAiNotice context={ProjectAiNoticeContext.AiFeatures} />

      {/*
       * What OneUptime AI should know about the project's systems, read
       * first by everything it does for the team (issue #5198). In sight,
       * not folded: it is what makes the answers about this project's own
       * systems, and with none written it takes one line.
       */}
      <ProjectAiContextCard />

      <AdvancedPageSection
        description={ProjectAiDailyLimitsCopy.sectionDescription}
        items={[
          ...dailyLimits.items,
          getProjectAiRunLimitsFoldedItem(runLimits),
          getFixApprovalsFoldedItem(isTwoApprovalsOn),
        ]}
        summary={dailyLimits.summary}
        dataTestId={PROJECT_AI_ADVANCED_SECTION_TEST_ID}
      >
        <CardModelDetail<Project>
          name="Project AI Daily Limits"
          cardProps={{
            title: "Daily limits",
            description:
              "How much OneUptime AI may use each day across the whole project, whatever it is doing. Each day starts at midnight UTC.",
            buttons: dailyGate.lockedButtons,
            /*
             * Its place in More settings: the name the folded header lists
             * it by, so a link to it lands here.
             */
            id: PROJECT_AI_DAILY_LIMITS_CARD_KEY,
          }}
          isEditable={dailyGate.isEditable}
          editButtonText="Edit"
          editModalTitle="Daily limits"
          formFields={formFields}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-ai-daily-limits",
            onItemLoaded: dailyLimits.onCardLoaded,
            fields: detailFields,
            modelId: projectId,
          }}
        />

        {/*
         * How far one run may go (issue #6440): nothing set by default, so
         * a run is held only to its time limit and loop detection. Its
         * place is where a run a limit stopped links to.
         */}
        <CardModelDetail<Project>
          name="Project AI Limits per Run"
          cardProps={{
            title: ProjectAiRunLimitsCopy.cardTitle,
            description: ProjectAiRunLimitsCopy.cardDescription,
            buttons: runLimitsGate.lockedButtons,
            id: PROJECT_AI_RUN_LIMITS_CARD_KEY,
          }}
          isEditable={runLimitsGate.isEditable}
          editButtonText="Edit"
          editModalTitle={ProjectAiRunLimitsCopy.cardTitle}
          formFields={runLimitFormFields}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-ai-run-limits",
            onItemLoaded: (item: Project): void => {
              setRunLimits(
                getProjectAiRunLimitsFromItem(
                  item as unknown as Record<string, unknown>,
                ),
              );
            },
            fields: runLimitDetailFields,
            modelId: projectId,
          }}
        />

        {/*
         * Two people approve a riskier fix: one switch that saves the
         * moment it is flipped. It takes Project Owner or Project Admin
         * (the column's update list); anyone else sees it locked, with the
         * permission it needs.
         */}
        <ModelSwitchCard<Project>
          modelType={Project}
          modelId={projectId}
          column={TWO_APPROVALS_COLUMN}
          cardTitle={FixApprovalsCopy.cardTitle}
          cardDescription={FixApprovalsCopy.cardDescription}
          title={FixApprovalsCopy.switchTitle}
          getDescription={(): string => {
            return FixApprovalsCopy.switchDescription;
          }}
          onChange={(isOn: boolean): void => {
            setIsTwoApprovalsOn(isOn);
          }}
          dataTestId={FIX_APPROVALS_SWITCH_TEST_ID}
          cardId={FIX_APPROVALS_CARD_KEY}
        />
      </AdvancedPageSection>
    </>
  );
};

export default AIFeatures;
