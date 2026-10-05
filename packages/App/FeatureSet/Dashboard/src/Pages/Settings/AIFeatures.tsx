import PageComponentProps from "../PageComponentProps";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "./ProjectColumnEditGate";
import { getEnableAiConfirmation } from "../../Components/AISettings/EnableAiConfirmation";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import {
  ENABLE_AI_COLUMN,
  ENABLE_AI_SWITCH_TEST_ID,
  EnableAiCopy,
  getProjectAiDailyLimitColumns,
  getProjectAiDailyLimitFieldError,
  PROJECT_AI_ADVANCED_SECTION_TEST_ID,
  ProjectAiDailyLimitsCopy,
  ProjectAiNoticeContext,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import useProjectAiDailyLimits, {
  ProjectAiDailyLimitsSection,
} from "../../Components/AISettings/useProjectAiDailyLimits";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import {
  PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
  PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
} from "Common/Types/AI/ProjectAiDailyLimits";
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
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The project's AI switch, Enable AI, on a page every install shows. It used
 * to sit on AI Credits, which the settings menu lists only when billing is
 * on — so on a self-hosted install it could be reached only by typing its
 * URL. It is the master switch: auto-remediation and AI commands on Runners
 * had switches of their own once, and both now follow it. Every message
 * that sends people to turn AI on names this page: "Project Settings → AI
 * Features".
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
 * Then, folded under More settings like the incident and alert AI pages'
 * limits, the project's own Daily limits: a ceiling on everything AI does
 * in the project each day - tokens everywhere, and AI credits spent where
 * AI is billed - above the incident and alert limits (Common/Types/AI/
 * ProjectAiDailyLimits). Folded, it says what applies and what AI used
 * today. The card writes the limit columns alone, and like Enable AI they
 * take Project Owner or Manage Billing, so its Edit is gated on them.
 */
const AIFeatures: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const translator: Translator = useTranslator();
  const dailyLimits: ProjectAiDailyLimitsSection = useProjectAiDailyLimits();

  if (!projectId) {
    return <></>;
  }

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
        "The most tokens OneUptime AI may use in this project each day, whatever it is doing: Ask AI, investigations, fix pull requests, workflows, runbooks and the rest. Leave empty for no limit.",
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
        "The most AI credits, in US dollars, OneUptime AI may spend in this project each day. Only AI billed to your AI credits counts, so AI on your own LLM provider is never stopped by it. Leave empty for no limit.",
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

      <AdvancedPageSection
        description={ProjectAiDailyLimitsCopy.sectionDescription}
        items={dailyLimits.items}
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
      </AdvancedPageSection>
    </>
  );
};

export default AIFeatures;
