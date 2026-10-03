/*
 * The first line of the Template variables list under an incident or alert
 * grouping rule's episode title and description templates. The variables and
 * their groups ("From the first incident", "Updated as incidents join") are
 * in Common/Utils/Episode/EpisodeTemplateVariables.
 *
 * Kept in one React-free module so App/Tests/Dashboard/TemplateVariablesI18n
 * can check that each has an entry in all seventeen Dashboard locale files.
 */

export const EpisodeTemplateVariablesCopy: {
  incidentVariablesDescription: string;
  alertVariablesDescription: string;
} = {
  incidentVariablesDescription:
    "When this rule creates an episode, these variables are filled in from its incidents.",
  alertVariablesDescription:
    "When this rule creates an episode, these variables are filled in from its alerts.",
};

export default EpisodeTemplateVariablesCopy;
