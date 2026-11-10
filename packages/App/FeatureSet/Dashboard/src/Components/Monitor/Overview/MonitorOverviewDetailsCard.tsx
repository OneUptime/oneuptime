import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import MonitorTypeTitle, { getMonitorTypeTitle } from "../MonitorTypeTitle";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  // Flip to make the card read the monitor again.
  refresher: boolean;
  onSaveSuccess: () => void;
}

// The type's English title (MonitorTypeTitle), as the type picker writes it.
export { getMonitorTypeTitle };

/*
 * The monitor's own record in the side column: name, description and labels
 * (editable here, as before), plus the type, when it was created and its id.
 * On a phone the page header hides labels, so this is where they are seen.
 */
const MonitorOverviewDetailsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardModelDetail<Monitor>
      name="Monitor Details"
      cardProps={{
        title: "Details",
        description: "Name, description and labels.",
        headerLayout: "stacked",
      }}
      editButtonText="Edit"
      isEditable={true}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Monitor Name",
          hideColumnDescription: true,
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Description",
          hideColumnDescription: true,
        },
        getLabelsFormField<Monitor>(),
      ]}
      refresher={props.refresher}
      onSaveSuccess={() => {
        props.onSaveSuccess();
      }}
      modelDetailProps={{
        modelType: Monitor,
        id: "model-detail-monitors",
        modelId: props.monitorId,
        style: DetailStyle.Compact,
        showDetailsInNumberOfColumns: 1,
        fields: [
          {
            field: {
              name: true,
            },
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            placeholder: "No description",
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            fieldType: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            fieldType: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return <MonitorTypeTitle monitorType={item.monitorType} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            fieldType: FieldType.DateTime,
          },
          {
            field: {
              _id: true,
            },
            title: "Monitor ID",
            fieldType: FieldType.ObjectID,
          },
        ],
      }}
    />
  );
};

export default MonitorOverviewDetailsCard;
