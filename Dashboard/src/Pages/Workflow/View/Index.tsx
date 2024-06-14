import LabelsElement from "../../../Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Label from "Model/Models/Label";
import Workflow from "Model/Models/Workflow";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

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
            required: true,
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
              fieldType: FieldType.Boolean,
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
