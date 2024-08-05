import LabelsElement from "../../../Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Label from "Common/AppModels/Models/Label";
import OnCallDutyPolicy from "Common/AppModels/Models/OnCallDutyPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallDutyPolicyView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* OnCallDutyPolicy View  */}
      <CardModelDetail<OnCallDutyPolicy>
        name="On-Call Policy > On-Call Policy Details"
        cardProps={{
          title: "On-Call Policy Details",
          description: "Here are more details for this on-call policy.",
        }}
        formSteps={[
          {
            title: "On-Call Policy Info",
            id: "on-call-policy-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "on-call-policy-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "On-Call Policy Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "on-call-policy-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Description",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
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
          modelType: OnCallDutyPolicy,
          id: "model-detail-monitors",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "On-Call Policy ID",
            },
            {
              field: {
                name: true,
              },
              title: "Name",
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
              getElement: (item: OnCallDutyPolicy): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default OnCallDutyPolicyView;
