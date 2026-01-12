import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentPostmortemTemplateView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <CardModelDetail
        name="Basic Details"
        cardProps={{
          title: "Basic Details",
          description: "Here are more details for this postmortem template.",
        }}
        isEditable={true}
        editButtonText="Edit Details"
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
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Template Description",
            validation: {
              minLength: 2,
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: IncidentPostmortemTemplate,
          id: "model-detail-incident-postmortem-template",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Postmortem Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.Text,
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail
        name="Postmortem Template"
        editButtonText="Edit Postmortem Template"
        cardProps={{
          title: "Postmortem Template",
          description:
            "Here is the Markdown content for this postmortem template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formFields={[
          {
            field: {
              postmortemNote: true,
            },
            title: "Postmortem Template",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
            validation: {
              minLength: 2,
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: IncidentPostmortemTemplate,
          id: "model-detail-incident-postmortem-template-note",
          fields: [
            {
              field: {
                postmortemNote: true,
              },
              title: "Postmortem Template",
              fieldType: FieldType.Markdown,
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={IncidentPostmortemTemplate}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default IncidentPostmortemTemplateView;
