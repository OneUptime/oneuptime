import PageComponentProps from "../../PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchesCard from "Common/UI/Components/ModelSwitch/ModelSwitchesCard";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

// The two Project switches this page edits, and the only page that edits them.
export const LINKED_ALERTS_FIELDS: Array<
  | "acknowledgeLinkedAlertsWhenIncidentAcknowledged"
  | "resolveLinkedAlertsWhenIncidentResolved"
> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

// The data-testid of the card's body, and of each switch.
export const LINKED_ALERTS_SWITCHES_TEST_ID: string =
  "incident-linked-alerts-switches";

export const LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID: string =
  "linked-alerts-acknowledge-switch";

export const LINKED_ALERTS_RESOLVE_SWITCH_TEST_ID: string =
  "linked-alerts-resolve-switch";

/*
 * Incidents → Settings → Linked Alerts: whether the alerts linked to an
 * incident follow it when it is acknowledged or resolved. Both switches are
 * on for new projects; a project that existed before keeps what it had.
 *
 * Each is a switch that saves the moment it is flipped (the shared
 * ModelSwitchesCard), as the AI behaviours beside it in Incidents →
 * Settings are. They used to sit behind an Update button and a dialog. Both
 * take Project Owner or Project Admin, narrower than the Project table's
 * update list (which also lets Edit Project and Manage Billing in), so for
 * anyone else each switch is locked and says which permission it needs.
 */
const IncidentLinkedAlertsSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelSwitchesCard<Project>
      modelType={Project}
      modelId={projectId}
      cardTitle={translationKey("Linked Alerts")}
      cardDescription={translationKey(
        "Choose whether the alerts linked to an incident follow it when the incident is acknowledged or resolved. Both are on for new projects. Alerts are never moved back to an earlier state, and reopening an incident does not reopen its alerts.",
      )}
      switches={[
        {
          column: "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
          title: "Acknowledge Linked Alerts When Incident Is Acknowledged",
          getDescription: (): string => {
            return translationKey(
              "When the incident is acknowledged, acknowledge every alert linked to it. This stops those alerts' on-call escalations. It stops their reminders only when the alert reminder rule is set to stop reminders on Acknowledged. Alerts linked to an incident that is already acknowledged are acknowledged as they are linked.",
            );
          },
          dataTestId: LINKED_ALERTS_ACKNOWLEDGE_SWITCH_TEST_ID,
        },
        {
          column: "resolveLinkedAlertsWhenIncidentResolved",
          title: "Resolve Linked Alerts When Incident Is Resolved",
          getDescription: (): string => {
            return translationKey(
              "When the incident is resolved, resolve every alert linked to it - except alerts that are still linked to another incident that is not resolved yet. Alerts linked to an incident that is already resolved are resolved as they are linked.",
            );
          },
          dataTestId: LINKED_ALERTS_RESOLVE_SWITCH_TEST_ID,
        },
      ]}
      dataTestId={LINKED_ALERTS_SWITCHES_TEST_ID}
    />
  );
};

export default IncidentLinkedAlertsSettings;
