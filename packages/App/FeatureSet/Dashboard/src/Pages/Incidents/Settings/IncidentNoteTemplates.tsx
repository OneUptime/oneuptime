import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import useIncidentNoteTemplateVariables, {
  IncidentNoteTemplateVariables,
} from "../../../Components/Incident/IncidentNoteTemplatePlaceholders";
import NoteTemplateFormCopy from "../../../Components/NoteTemplate/NoteTemplateFormCopy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentNoteTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  // What the note can use, the project's custom fields included.
  const noteTemplateVariables: IncidentNoteTemplateVariables =
    useIncidentNoteTemplateVariables();

  return (
    <Fragment>
      <ModelTable<IncidentNoteTemplate>
        modelType={IncidentNoteTemplate}
        id="incident-templates-table"
        name="Settings > Incident Templates"
        isDeleteable={false}
        userPreferencesKey="incident-templates-table"
        saveFilterProps={{
          tableId: "incident-note-templates-table",
        }}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Public or Private Note Templates for Incidents",
          description:
            "Ready-made text for incident updates. Pick one when writing a public or private note on an incident or an episode, or when acknowledging or resolving one, and edit it before posting.",
        }}
        noItemsMessage={"No note templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        /*
         * One page: the template's name and description, then the note.
         * Three rows walk no steps (LongFormStepsGuard).
         */
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Template Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Template Description",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              note: true,
            },
            title: NoteTemplateFormCopy.noteFieldTitle,
            description: NoteTemplateFormCopy.noteFieldDescription,
            fieldType: FormFieldSchemaType.Markdown,
            /*
             * The {{variables}} it can use, filled in from the incident:
             * collapsed under the editor, behind its Insert variable button,
             * and under the cursor when "{{" is typed.
             */
            templateVariables: noteTemplateVariables.groups,
            templateVariablesDescription: noteTemplateVariables.description,
            required: true,
            validation: {
              minLength: 2,
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              templateName: true,
            },
            type: FieldType.Text,
            title: "Template Name",
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              templateName: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncidentNoteTemplates;
