import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
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

export const getMonitorTypeTitle: (
  monitorType: MonitorType | undefined,
) => string = (monitorType: MonitorType | undefined): string => {
  if (!monitorType) {
    return "Unknown";
  }

  const typeProps: MonitorTypeProps | undefined =
    MonitorTypeHelper.getAllMonitorTypeProps().find(
      (item: MonitorTypeProps) => {
        return item.monitorType === monitorType;
      },
    );

  return typeProps?.title || monitorType;
};

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
      formSteps={[
        {
          title: "Monitor Info",
          id: "monitor-info",
        },
        {
          title: "Labels",
          id: "labels",
        },
      ]}
      formFields={[
        {
          field: {
            name: true,
          },
          stepId: "monitor-info",
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Monitor Name",
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          stepId: "monitor-info",
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Description",
        },
        {
          field: {
            labels: true,
          },
          stepId: "labels",
          title: "Labels ",
          description:
            "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Labels",
        },
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
              return <span>{getMonitorTypeTitle(item.monitorType)}</span>;
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
