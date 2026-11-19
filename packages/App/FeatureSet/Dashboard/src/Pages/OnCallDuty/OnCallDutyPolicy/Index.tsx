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
import SetupHealthRecordFindings from "../../../Components/SetupHealth/SetupHealthRecordFindings";
import UsedByCard from "../../../Components/UsedBy/UsedByCard";
import {
  SetupHealthCheck,
  SetupHealthRecordKind,
} from "Common/Types/SetupHealth/SetupHealth";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import { isNameTakenRefusal } from "Common/Types/Database/UniqueName";

/*
 * What the policy's own cards say already, so Setup Health's line at the
 * top leaves it out: the summary says it has no escalation rules, and which
 * levels reach nobody right now; What runs this policy (#7758) says when
 * nothing runs it, and marks Off a rule that would but is switched off.
 */
export const POLICY_PAGE_SAYS: ReadonlyArray<SetupHealthCheck> = [
  SetupHealthCheck.PolicyHasNoEscalationRules,
  SetupHealthCheck.PolicyReachesNobody,
  SetupHealthCheck.PolicyNotRun,
];

const OnCallDutyPolicyView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/*
       * Setup Health's findings about this policy (#7297), less what this
       * page's own cards say (POLICY_PAGE_SAYS): that nothing runs it is
       * What runs this policy's to say, below.
       */}
      <SetupHealthRecordFindings
        recordKind={SetupHealthRecordKind.OnCallDutyPolicy}
        recordId={modelId}
        saidByThisPage={POLICY_PAGE_SAYS}
      />

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
            placeholder: "e.g., Platform on-call",
            hideColumnDescription: true,
            validation: {
              minLength: 2,
            },
            // Another policy's name, said under the field (#9742).
            ownsServerError: isNameTakenRefusal,
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

      {/*
       * What runs it (#7758): the summary says who is paged, this says
       * when - the on-call rules, monitors and templates that page the
       * policy - and says so plainly when nothing does yet.
       */}
      <UsedByCard
        recordKind={UsedByRecordKind.OnCallPolicy}
        recordId={modelId}
      />

      <OnCallDutyPolicyFeedElement onCallDutyPolicyId={modelId} />
    </Fragment>
  );
};

export default OnCallDutyPolicyView;
