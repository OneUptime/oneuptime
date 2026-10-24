import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Pages/Settings/ProjectColumnEditGate";
import {
  AI_CONTEXT_CARD_ANCHOR,
  AI_CONTEXT_CARD_COPY,
  AI_CONTEXT_TEST_IDS,
  getAiContextFieldError,
} from "./AiContextCopy";
import AiContextLengthFooter from "./AiContextLengthFooter";
import AiContextView from "./AiContextView";
import Project from "Common/Models/DatabaseModels/Project";
import {
  AI_CONTEXT_COLUMN,
  AiContextOwner,
  readAiContext,
} from "Common/Types/AI/AiContext";
import ObjectID from "Common/Types/ObjectID";
import { FieldFooterProps } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The project's AI context (issue #5198), on Project Settings → AI → AI
 * Features under Enable AI: what OneUptime AI should know about the
 * project's systems, which it reads first in every investigation, fix,
 * postmortem draft and Ask AI chat (Common/Types/AI/AiContext).
 *
 * Not folded under More settings: it is the one thing on the page that
 * makes OneUptime AI's answers about the team's own systems, so it is in
 * sight - and with none written, it takes one quiet line.
 *
 * Its button says what it does: "Add AI context" while there is none,
 * "Edit" once there is. The dialog has the one Markdown field, counted as
 * it is written against the limit the server holds it to, with an outline
 * to start from while it is empty. Like the project's other AI settings it
 * is a Project Owner's or Project Admin's to change (the column's own
 * update list): for everyone else the button is locked and says which
 * permission it needs.
 */
const ProjectAiContextCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  // Null until the card has read the project: no button text to guess.
  const [hasContext, setHasContext] = useState<boolean | null>(null);

  if (!projectId) {
    return <></>;
  }

  const buttonTitle: string =
    hasContext === false
      ? AI_CONTEXT_CARD_COPY.addButtonText
      : AI_CONTEXT_CARD_COPY.editButtonText;

  const gate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: [AI_CONTEXT_COLUMN],
    buttonTitle,
  });

  const formFields: Fields<Project> = [
    {
      field: {
        aiContext: true,
      },
      title: AI_CONTEXT_CARD_COPY.fieldTitle,
      description: AI_CONTEXT_CARD_COPY.fieldDescription,
      fieldType: FormFieldSchemaType.Markdown,
      required: false,
      // Empty is an answer of its own - no notes - not "(Optional)".
      hideOptionalLabel: true,
      placeholder: AI_CONTEXT_CARD_COPY.fieldPlaceholder,
      // Notes are text: a model is never given an image's bytes.
      allowImageUpload: false,
      dataTestId: "project-ai-context-field",
      customValidation: (values: FormValues<Project>): string | null => {
        return getAiContextFieldError({
          value: (values as { aiContext?: unknown }).aiContext,
          owner: AiContextOwner.Project,
          translator,
        });
      },
      getFooterElement: (
        values: FormValues<Project>,
        _error?: string,
        footer?: FieldFooterProps,
      ): ReactElement => {
        return (
          <AiContextLengthFooter
            value={(values as { aiContext?: unknown }).aiContext}
            owner={AiContextOwner.Project}
            footer={footer}
            offersOutline={true}
          />
        );
      },
    },
  ];

  return (
    <CardModelDetail<Project>
      name="Project AI Context"
      cardProps={{
        title: AI_CONTEXT_CARD_COPY.cardTitle,
        description: AI_CONTEXT_CARD_COPY.cardDescription,
        buttons: gate.lockedButtons,
        // ".../settings/ai-features#ai-context" lands here.
        id: AI_CONTEXT_CARD_ANCHOR,
      }}
      isEditable={gate.isEditable}
      editButtonText={buttonTitle}
      editModalTitle={AI_CONTEXT_CARD_COPY.editModalTitle}
      editModalDescription={AI_CONTEXT_CARD_COPY.editModalDescription}
      createEditModalWidth={ModalWidth.Large}
      formFields={formFields}
      modelDetailProps={{
        modelType: Project,
        id: AI_CONTEXT_TEST_IDS.card,
        modelId: projectId,
        onItemLoaded: (item: Project): void => {
          setHasContext(Boolean(readAiContext(item.aiContext)));
        },
        fields: [
          {
            field: {
              aiContext: true,
            },
            fieldType: FieldType.Element,
            getElement: (item: Project): ReactElement => {
              return <AiContextView text={item.aiContext} />;
            },
          },
        ],
      }}
    />
  );
};

export default ProjectAiContextCard;
