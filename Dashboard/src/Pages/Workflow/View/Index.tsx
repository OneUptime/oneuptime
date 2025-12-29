import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";

const Delete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);

  return (
    <Fragment>
      <CardModelDetail<Workflow>
        name="Workflow > Workflow Details"
        cardProps={{
          title: "Workflow Details",
          description: "Here are more details for this workflow.",
        }}
        isEditable={true}
        formSteps={[
          {
            title: "Workflow Info",
            id: "workflow-info",
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
            stepId: "workflow-info",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Status Page Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "workflow-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "workflow-info",
            fieldType: FormFieldSchemaType.Toggle,
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
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: Workflow,
          id: "model-detail-workflow",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Workflow ID",
              fieldType: FieldType.ObjectID,
            },
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
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Element,
              getElement: (item: Workflow): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill text="Enabled" color={Green500} isMinimal={true} />
                  );
                }
                return <Pill text="Disabled" color={Red500} isMinimal={true} />;
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              getElement: (item: Workflow): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default Delete;
