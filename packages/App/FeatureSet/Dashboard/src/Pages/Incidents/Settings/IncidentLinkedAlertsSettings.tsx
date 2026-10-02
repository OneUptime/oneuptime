import PageComponentProps from "../../PageComponentProps";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Settings/ProjectColumnEditGate";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";

export type ComponentProps = PageComponentProps;

// The two Project switches this page edits, and the only page that edits them.
export const LINKED_ALERTS_FIELDS: Array<
  | "acknowledgeLinkedAlertsWhenIncidentAcknowledged"
  | "resolveLinkedAlertsWhenIncidentResolved"
> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

/*
 * Incidents → Settings → Linked Alerts: whether the alerts linked to an
 * incident follow it when it is acknowledged or resolved. Both switches are
 * on for new projects; a project that existed before keeps what it had.
 */
const IncidentLinkedAlertsSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  /*
   * The permission snapshot arrives on an API response header, so it can be
   * empty on the first paint. Loading the card re-renders the page, which
   * reads the permissions again.
   */
  const [, setIsCardLoaded] = useState<boolean>(false);

  /*
   * Both switches take Project Owner or Project Admin. The Project table's
   * update list, which the card would otherwise gate on, also lets Edit
   * Project and Manage Billing in, and their save would be refused.
   */
  const editGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: LINKED_ALERTS_FIELDS,
    buttonTitle: "Update",
  });

  return (
    <CardModelDetail<Project>
      name="Linked Alerts"
      cardProps={{
        title: "Linked Alerts",
        description:
          "Choose whether the alerts linked to an incident follow it when the incident is acknowledged or resolved. Both are on for new projects. Alerts are never moved back to an earlier state, and reopening an incident does not reopen its alerts.",
        buttons: editGate.lockedButtons,
      }}
      isEditable={editGate.isEditable}
      editButtonText={"Update"}
      formFields={[
        {
          field: {
            acknowledgeLinkedAlertsWhenIncidentAcknowledged: true,
          },
          title: "Acknowledge Linked Alerts When Incident Is Acknowledged",
          description:
            "When the incident is acknowledged, acknowledge every alert linked to it. This stops those alerts' on-call escalations. It stops their reminders only when the alert reminder rule is set to stop reminders on Acknowledged. Alerts linked to an incident that is already acknowledged are acknowledged as they are linked.",
          required: false,
          fieldType: FormFieldSchemaType.Toggle,
        },
        {
          field: {
            resolveLinkedAlertsWhenIncidentResolved: true,
          },
          title: "Resolve Linked Alerts When Incident Is Resolved",
          description:
            "When the incident is resolved, resolve every alert linked to it - except alerts that are still linked to another incident that is not resolved yet. Alerts linked to an incident that is already resolved are resolved as they are linked.",
          required: false,
          fieldType: FormFieldSchemaType.Toggle,
        },
      ]}
      modelDetailProps={{
        modelType: Project,
        id: "model-detail-project-incident-linked-alerts",
        onItemLoaded: () => {
          setIsCardLoaded(true);
        },
        fields: [
          {
            field: {
              acknowledgeLinkedAlertsWhenIncidentAcknowledged: true,
            },
            title: "Acknowledge Linked Alerts When Incident Is Acknowledged",
            fieldType: FieldType.Boolean,
          },
          {
            field: {
              resolveLinkedAlertsWhenIncidentResolved: true,
            },
            title: "Resolve Linked Alerts When Incident Is Resolved",
            fieldType: FieldType.Boolean,
          },
        ],
        modelId: ProjectUtil.getCurrentProjectId()!,
      }}
    />
  );
};

export default IncidentLinkedAlertsSettings;
