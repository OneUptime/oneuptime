import PageComponentProps from "../../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

const IncidentMoreSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="Incident Number Prefix"
        cardProps={{
          title: "Number Prefix",
          description:
            "Configure custom prefixes for incident and incident episode numbers. For example, set 'INC-' to display incident numbers as 'INC-42' instead of '#42'. Leave empty to use the default '#' prefix.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              incidentNumberPrefix: true,
            },
            title: "Incident Number Prefix",
            description:
              "Custom prefix for incident numbers (e.g., 'INC-'). Leave empty for default '#'.",
            required: false,
            placeholder: "INC-",
            fieldType: FormFieldSchemaType.Text,
            validation: {
              maxLength: 20,
            },
          },
          {
            field: {
              incidentEpisodeNumberPrefix: true,
            },
            title: "Incident Episode Number Prefix",
            description:
              "Custom prefix for incident episode numbers (e.g., 'IE-'). Leave empty for default '#'.",
            required: false,
            placeholder: "IE-",
            fieldType: FormFieldSchemaType.Text,
            validation: {
              maxLength: 20,
            },
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-incident-prefix",
          fields: [
            {
              field: {
                incidentNumberPrefix: true,
              },
              title: "Incident Number Prefix",
              placeholder: "# (default)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                incidentEpisodeNumberPrefix: true,
              },
              title: "Incident Episode Number Prefix",
              placeholder: "# (default)",
              fieldType: FieldType.Text,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {/*
       * A card of its own: a CardModelDetail writes every field it holds on
       * Update, so sharing a card with the number prefixes would let saving
       * one overwrite the other.
       */}
      <CardModelDetail<Project>
        name="Linked Alerts"
        cardProps={{
          title: "Linked Alerts",
          description:
            "Choose whether the alerts linked to an incident follow it when the incident is acknowledged or resolved. Both are off by default. Alerts are never moved back to an earlier state, and reopening an incident does not reopen its alerts.",
        }}
        isEditable={true}
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
    </>
  );
};

export default IncidentMoreSettings;
