import EscalationRules from "../../../Components/OnCallPolicy/EscalationRule/EscalationRules";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallPolicyEscalation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The policy id comes from the route and the project id from ProjectUtil.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  return (
    <Fragment>
      <EscalationRules onCallDutyPolicyId={modelId} projectId={projectId} />

      <div className="mt-6">
        <CardModelDetail
          name="On-Call Policy > Repeat Policy"
          cardProps={{
            title: "Repeat Policy",
            description:
              "If every escalation rule has been exhausted and the incident is still unacknowledged, decide whether to run the whole policy again.",
          }}
          isEditable={true}
          formFields={[
            {
              field: {
                repeatPolicyIfNoOneAcknowledges: true,
              },
              title: "Repeat if no one acknowledges",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "If enabled, the on-call policy restarts from the first escalation rule when no one acknowledges the incident.",
            },
            {
              field: {
                repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
              },
              title: "Number of times to repeat",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              description:
                "How many times to repeat the on-call policy if no one acknowledges the incident.",
              placeholder: "3",
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 2,
            modelType: OnCallDutyPolicy,
            id: "model-detail-repeat-policy",
            fields: [
              {
                field: {
                  repeatPolicyIfNoOneAcknowledges: true,
                },
                title: "Repeat if no one acknowledges",
                fieldType: FieldType.Boolean,
                description:
                  "If enabled, the on-call policy restarts from the first escalation rule when no one acknowledges the incident.",
                placeholder: "No",
              },
              {
                field: {
                  repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
                },
                title: "Number of times to repeat",
                fieldType: FieldType.Number,
                placeholder: "0",
                description:
                  "How many times to repeat the on-call policy if no one acknowledges the incident.",
              },
            ],
            modelId: modelId,
          }}
        />
      </div>
    </Fragment>
  );
};

export default OnCallPolicyEscalation;
