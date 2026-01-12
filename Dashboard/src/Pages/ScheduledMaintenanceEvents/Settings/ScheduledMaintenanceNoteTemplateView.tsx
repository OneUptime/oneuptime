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
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TeamView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* ScheduledMaintenance View  */}
      <CardModelDetail
        name="Basic Details"
        cardProps={{
          title: "Basic Details",
          description:
            "Here are more details for this scheduled maintenance template.",
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
          modelType: ScheduledMaintenanceNoteTemplate,
          id: "model-detail-scheduled-maintenances",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Scheduled Maintenance Note Template ID",
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
        name="Note Template"
        editButtonText="Edit Note Template"
        cardProps={{
          title: "Note Template",
          description: "Here is the note template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formFields={[
          {
            field: {
              note: true,
            },
            title: "Note",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
            validation: {
              minLength: 2,
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: ScheduledMaintenanceNoteTemplate,
          id: "model-detail-scheduled-maintenances",
          fields: [
            {
              field: {
                note: true,
              },
              title: "Note Template",
              fieldType: FieldType.Markdown,
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={ScheduledMaintenanceNoteTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
            ] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default TeamView;
