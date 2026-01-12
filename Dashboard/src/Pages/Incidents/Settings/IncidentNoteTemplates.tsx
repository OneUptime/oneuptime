import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentNoteTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentNoteTemplate>
        modelType={IncidentNoteTemplate}
        id="incident-templates-table"
        name="Settings > Incident Templates"
        isDeleteable={false}
        userPreferencesKey="incident-templates-table"
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Public or Private Note Templates for Incidents",
          description:
            "Here is a list of all the public and private note templates for incidents.",
        }}
        noItemsMessage={"No note templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Note Details",
            id: "note-details",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            stepId: "template-info",
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
            stepId: "template-info",
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
            title: "Public or Private note template.",
            fieldType: FormFieldSchemaType.Markdown,
            stepId: "note-details",
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
