import LabelsElement from "../../../Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/src/Components/Types/FieldType";
import Navigation from "Common/UI/src/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallDutyScheduleView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* OnCallDutySchedule View  */}
      <CardModelDetail<OnCallDutySchedule>
        name="On-Call Schedule > On-Call Schedule Details"
        cardProps={{
          title: "On-Call Schedule Details",
          description: "Here are more details for this on-call Schedule.",
        }}
        formSteps={[
          {
            title: "On-Call Schedule Info",
            id: "on-call-Schedule-info",
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
            stepId: "on-call-Schedule-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "On-Call Schedule Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "on-call-Schedule-info",
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
          modelType: OnCallDutySchedule,
          id: "model-detail-monitors",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "On-Call Schedule ID",
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
              getElement: (item: OnCallDutySchedule): ReactElement => {
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

export default OnCallDutyScheduleView;
