import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import NoteTemplateFormCopy from "../../../Components/NoteTemplate/NoteTemplateFormCopy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const AlertNoteTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertNoteTemplate>
        modelType={AlertNoteTemplate}
        id="alert-templates-table"
        name="Settings > Alert Templates"
        userPreferencesKey="alert-templates-table"
        saveFilterProps={{
          tableId: "alert-note-templates-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Private Note Templates for Alerts",
          description:
            "Ready-made text for alert updates. Pick one when writing a private note on an alert or an episode, or when acknowledging or resolving one, and edit it before posting.",
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

export default AlertNoteTemplates;
