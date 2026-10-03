import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentPostmortemTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentPostmortemTemplate>
        modelType={IncidentPostmortemTemplate}
        id="incident-postmortem-templates-table"
        name="Settings > Incident Postmortem Templates"
        isDeleteable={false}
        createEditModalWidth={ModalWidth.Large}
        userPreferencesKey="incident-postmortem-templates-table"
        saveFilterProps={{
          tableId: "incident-postmortem-templates-table",
        }}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Postmortem Templates",
          description:
            "The headings and questions every postmortem should answer. Apply one on an incident's or an episode's Postmortem page, then fill it in.",
        }}
        noItemsMessage="No postmortem templates found."
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        /*
         * One page: the template's name and description, then its body.
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
              postmortemNote: true,
            },
            title: "Postmortem Template",
            description:
              "The postmortem's text when this template is applied. It can still be edited before it is saved.",
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

export default IncidentPostmortemTemplates;
