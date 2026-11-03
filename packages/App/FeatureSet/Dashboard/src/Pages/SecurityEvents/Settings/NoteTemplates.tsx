import PageComponentProps from "../../PageComponentProps";
import { SECURITY_CASE_NOTE_TEMPLATES_COPY } from "../../../Components/SecurityCase/NoteTemplates/SecurityCaseNoteTemplatesCopy";
import NoteTemplateFormCopy from "../../../Components/NoteTemplate/NoteTemplateFormCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SecurityCaseNoteTemplate from "Common/Models/DatabaseModels/SecurityCaseNoteTemplate";
import Route from "Common/Types/API/Route";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Security Events > Settings > Note Templates: the ready-made text a team
 * writes on case after case - a triage summary, a containment checklist, a
 * hand-over to the next shift - each picked from the Templates menu of a
 * case's note composer (Components/EventNotes), where it lands in the note
 * to be edited before it is posted. As an incident's and an alert's note
 * templates are; a template's page shows its note as it reads.
 */
const SecurityCaseNoteTemplatesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const copy: typeof SECURITY_CASE_NOTE_TEMPLATES_COPY =
    SECURITY_CASE_NOTE_TEMPLATES_COPY;

  return (
    <ModelTable<SecurityCaseNoteTemplate>
      modelType={SecurityCaseNoteTemplate}
      id="security-case-note-templates-table"
      name="Security Events > Settings > Note Templates"
      userPreferencesKey="security-case-note-templates-table"
      singularName={copy.singularName}
      pluralName={copy.pluralName}
      isDeleteable={true}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: copy.title,
        description: copy.description,
      }}
      noItemsMessage={copy.noItemsMessage}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      showViewIdButton={true}
      /*
       * One page: the template's name, what it is for (optional), then the
       * note itself. Three rows walk no steps (LongFormStepsGuard).
       */
      formFields={[
        {
          field: {
            templateName: true,
          },
          title: copy.nameTitle,
          description: copy.nameDescription,
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: copy.namePlaceholder,
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            templateDescription: true,
          },
          title: copy.descriptionTitle,
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: copy.descriptionPlaceholder,
        },
        {
          field: {
            note: true,
          },
          title: NoteTemplateFormCopy.noteFieldTitle,
          description: NoteTemplateFormCopy.noteFieldDescription,
          fieldType: FormFieldSchemaType.Markdown,
          required: true,
          validation: {
            minLength: 2,
          },
        },
      ]}
      showRefreshButton={true}
      viewPageRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_SETTINGS_NOTE_TEMPLATES] as Route,
      )}
      filters={[
        {
          field: {
            templateName: true,
          },
          type: FieldType.Text,
          title: copy.nameTitle,
        },
        {
          field: {
            templateDescription: true,
          },
          type: FieldType.Text,
          title: copy.descriptionTitle,
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
  );
};

export default SecurityCaseNoteTemplatesPage;
