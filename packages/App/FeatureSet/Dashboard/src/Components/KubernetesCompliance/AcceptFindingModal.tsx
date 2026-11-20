import {
  ACCEPTANCE_EXPIRY_OPTIONS,
  KubernetesAcceptScope,
  KubernetesAcceptanceExpiry,
} from "./KubernetesComplianceModel";
import { JSONObject } from "Common/Types/JSON";
import { KubernetesComplianceObject } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * ACCEPT ONE OBJECT'S FINDING (#9874).
 *
 * A CNI DaemonSet runs privileged, a node exporter mounts the host's /proc:
 * on purpose. Turning the control off for their namespace would hide the
 * next workload that breaks it there, so the finding is accepted for this
 * object alone - for this control, or every control of the framework - with
 * why, and optionally for a while. The object stays listed, as accepted,
 * and counts as passing; Revoke puts it back. The same dialog accepts a
 * finding again once its acceptance expired, with the reason it had.
 */

export const ACCEPT_FINDING_TEST_ID: string = "kubernetes-compliance-accept";

const DESCRIPTION: string = translationKey(
  "{{object}} is listed as accepted and counts as passing. Every other object is still scored, and you can revoke it at any time.",
);

export interface AcceptFindingValues {
  reason: string;
  scope: KubernetesAcceptScope;
  expiry: KubernetesAcceptanceExpiry;
}

export interface ComponentProps {
  object: KubernetesComplianceObject;
  /*
   * The reason it had, when it is accepted again; or, for the OneUptime
   * agent's own workload, why it needs what the control fails (#9929).
   */
  initialReason?: string | undefined;
  // What it is accepted for at first: this control only, unless said.
  initialScope?: KubernetesAcceptScope | undefined;
  onClose: () => void;
  // Saves the acceptance; the dialog shows what failed when it throws.
  onAccept: (values: AcceptFindingValues) => Promise<void>;
}

// An object as the dialog names it: "DaemonSet kube-system/cilium".
export function getAcceptedObjectName(
  object: KubernetesComplianceObject,
): string {
  return object.namespace && object.kind !== "Namespace"
    ? `${object.kind} ${object.namespace}/${object.name}`
    : `${object.kind} ${object.name}`;
}

const AcceptFindingModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  return (
    <BasicFormModal<JSONObject>
      title="Accept Finding"
      description={
        <TranslatedSentence
          template={DESCRIPTION}
          slots={{
            object: (
              <span className="font-mono font-medium text-gray-900">
                {getAcceptedObjectName(props.object)}
              </span>
            ),
          }}
        />
      }
      submitButtonText="Accept Finding"
      modalWidth={ModalWidth.Medium}
      isSubmitting={isSubmitting}
      error={error}
      onClose={props.onClose}
      formProps={{
        name: "kubernetes-compliance-accept-finding",
        initialValues: {
          reason: props.initialReason || "",
          scope: props.initialScope || KubernetesAcceptScope.Control,
          expiry: KubernetesAcceptanceExpiry.Never,
        },
        fields: [
          {
            field: { reason: true },
            title: "Why is it accepted?",
            description: "Kept with the finding, for whoever reviews it.",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder:
              "e.g. Cilium's agent programs the node's network, so it runs privileged.",
            dataTestId: `${ACCEPT_FINDING_TEST_ID}-reason`,
          },
          {
            field: { scope: true },
            title: "Accept it for",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                value: KubernetesAcceptScope.Control,
                label: "This control only",
              },
              {
                value: KubernetesAcceptScope.Framework,
                label: "Every control of this framework",
              },
            ],
            dataTestId: `${ACCEPT_FINDING_TEST_ID}-scope`,
          },
          {
            field: { expiry: true },
            title: "Expires",
            description: "Once it expires, the finding fails again.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: ACCEPTANCE_EXPIRY_OPTIONS.map(
              (option: {
                value: KubernetesAcceptanceExpiry;
                label: string;
              }) => {
                return { value: option.value, label: option.label };
              },
            ),
            dataTestId: `${ACCEPT_FINDING_TEST_ID}-expiry`,
          },
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        setIsSubmitting(true);
        setError("");

        try {
          await props.onAccept({
            reason:
              typeof values["reason"] === "string"
                ? (values["reason"] as string).trim()
                : "",
            scope:
              values["scope"] === KubernetesAcceptScope.Framework
                ? KubernetesAcceptScope.Framework
                : KubernetesAcceptScope.Control,
            expiry:
              (values["expiry"] as KubernetesAcceptanceExpiry) ||
              KubernetesAcceptanceExpiry.Never,
          });
          setIsSubmitting(false);
        } catch (err) {
          setError(API.getFriendlyMessage(err));
          setIsSubmitting(false);
        }
      }}
    />
  );
};

export default AcceptFindingModal;
