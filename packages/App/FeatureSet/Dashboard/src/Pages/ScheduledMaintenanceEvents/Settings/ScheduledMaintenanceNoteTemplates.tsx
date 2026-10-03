import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import NoteTemplateFormCopy from "../../../Components/NoteTemplate/NoteTemplateFormCopy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ScheduledMaintenanceNoteTemplates: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceNoteTemplate>
        modelType={ScheduledMaintenanceNoteTemplate}
        id="incident-templates-table"
        name="Settings > Scheduled Maintenance Templates"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        userPreferencesKey="scheduled-maintenance-note-templates-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-note-templates-table",
        }}
        cardProps={{
          title:
            "Public or Private Note Templates for Scheduled Maintenance Events",
          description:
            "Ready-made text for maintenance updates. Pick one when writing a public or private note on a scheduled maintenance event, or when changing its state, and edit it before posting.",
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

export default ScheduledMaintenanceNoteTemplates;
