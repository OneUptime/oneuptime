import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import OnCallDutyPolicyFeedElement from "../../../Components/OnCallPolicy/OnCallDutyPolicyFeed";
import OnCallPolicySummary from "../../../Components/OnCallPolicy/OnCallPolicySummary";
import ResponderReadinessCard from "../../../Components/OnCallPolicy/Readiness/ResponderReadinessCard";

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
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
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
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          getLabelsFormField<OnCallDutyPolicy>(),
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

      <OverviewCustomFields
        modelId={modelId}
        modelType={OnCallDutyPolicy}
        customFieldType={OnCallDutyPolicyCustomField}
        resourceName="On-Call Policy"
      />

      {/* At-a-glance overview of how this policy escalates. */}
      <OnCallPolicySummary
        onCallDutyPolicyId={modelId}
        projectId={ProjectUtil.getCurrentProjectId()!}
      />

      {/*
       * Whether the people this policy pages can actually be reached. It sits
       * directly under the escalation summary because the two answer halves of
       * the same question: the summary says who gets paged, this says whether
       * that page lands.
       */}
      <ResponderReadinessCard onCallDutyPolicyId={modelId} />

      <OnCallDutyPolicyFeedElement onCallDutyPolicyId={modelId} />
    </Fragment>
  );
};

export default OnCallDutyPolicyView;
