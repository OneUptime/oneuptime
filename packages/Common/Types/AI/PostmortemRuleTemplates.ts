/*
 * THE TEMPLATES A POSTMORTEM RULE NAMES.
 *
 * A postmortem rule (Models/DatabaseModels/AIPostmortemRule) says which
 * resolved incidents OneUptime AI drafts a postmortem for, and which of the
 * project's postmortem templates the draft may follow:
 *
 *   - none: OneUptime AI's standard outline, as every draft was before
 *     rules existed;
 *   - one: that template;
 *   - several: OneUptime AI reads the incident and picks the one that fits
 *     it best (Server/Utils/AI/SRE/PostmortemTemplatePick).
 *
 * Several are listed for the model to choose from, so a rule names at most
 * MAX_POSTMORTEM_RULE_TEMPLATES - enough for any one kind of incident, and
 * few enough that the choice reads every one of them whole. The service
 * refuses a rule that names more (AIPostmortemRuleService), whoever writes
 * it: the form, the API or Terraform.
 *
 * Shared by the server and the Dashboard, so it imports nothing.
 */

export const MAX_POSTMORTEM_RULE_TEMPLATES: number = 10;

export const POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE: string = `A postmortem rule can name at most ${MAX_POSTMORTEM_RULE_TEMPLATES} templates. Split the incidents it matches between two rules, or name fewer templates.`;

// The id of one entry of a relation list, however it was written.
function getEntryId(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry.trim() || null;
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record: Record<string, unknown> = entry as Record<string, unknown>;
  const id: unknown = record["_id"] ?? record["id"];

  if (typeof id === "string") {
    return id.trim() || null;
  }

  if (id && typeof id === "object" && "toString" in id) {
    const text: string = String(id);
    return text.trim() || null;
  }

  return null;
}

/*
 * How many templates a written list names, each counted once: ids written
 * as text, as { _id } / { id }, or as models. Anything that is not a list
 * names none.
 */
export function countPostmortemRuleTemplates(templates: unknown): number {
  if (!Array.isArray(templates)) {
    return 0;
  }

  const ids: Set<string> = new Set<string>();

  for (const entry of templates) {
    const id: string | null = getEntryId(entry);

    if (id) {
      ids.add(id.toLowerCase());
    }
  }

  return ids.size;
}

/*
 * Why a rule cannot be saved with these templates, or null when it can: a
 * list of at most MAX_POSTMORTEM_RULE_TEMPLATES. Whether each template is
 * the project's own is checked with every other reference the rule writes
 * (ProjectReferencesService).
 */
export function getPostmortemRuleTemplatesProblem(
  templates: unknown,
): string | null {
  return countPostmortemRuleTemplates(templates) >
    MAX_POSTMORTEM_RULE_TEMPLATES
    ? POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE
    : null;
}
