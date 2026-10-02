import {
  TemplateVariable,
  TemplateVariableGroups,
} from "../../Types/Template/TemplateVariable";

/*
 * The {{variables}} an incident or alert grouping rule's episode title and
 * description templates can use. The grouping engines fill exactly these
 * (Server/Services/IncidentGroupingEngineService and AlertGroupingEngineService,
 * then IncidentEpisodeService/AlertEpisodeService for the count; pinned by
 * Common/Tests/Utils/Episode/EpisodeTemplateVariables):
 *
 *   - four from the episode's first incident (or alert), filled in once when
 *     the episode is created;
 *   - the count, filled in again each time an incident joins or leaves.
 *
 * The grouping rule forms offer them under the two template fields, where a
 * grey box listed them under the description field only. Each description is
 * English, and the key its translation is looked up by.
 */

export const INCIDENT_EPISODE_TEMPLATE_STATIC_VARIABLES: ReadonlyArray<TemplateVariable> =
  [
    { name: "incidentTitle", description: "Title" },
    { name: "incidentDescription", description: "Description" },
    { name: "incidentSeverity", description: "Severity" },
    { name: "monitorName", description: "Monitor Name" },
  ];

export const INCIDENT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES: ReadonlyArray<TemplateVariable> =
  [
    {
      name: "incidentCount",
      description: "Number of incidents in the episode",
    },
  ];

export const INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS: TemplateVariableGroups =
  [
    {
      title: "From the first incident",
      variables: INCIDENT_EPISODE_TEMPLATE_STATIC_VARIABLES,
    },
    {
      title: "Updated as incidents join",
      variables: INCIDENT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
    },
  ];

export const ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES: ReadonlyArray<TemplateVariable> =
  [
    { name: "alertTitle", description: "Title" },
    { name: "alertDescription", description: "Description" },
    { name: "alertSeverity", description: "Severity" },
    { name: "monitorName", description: "Monitor Name" },
  ];

export const ALERT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES: ReadonlyArray<TemplateVariable> =
  [
    {
      name: "alertCount",
      description: "Number of alerts in the episode",
    },
  ];

export const ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS: TemplateVariableGroups = [
  {
    title: "From the first alert",
    variables: ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES,
  },
  {
    title: "Updated as alerts join",
    variables: ALERT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
  },
];
