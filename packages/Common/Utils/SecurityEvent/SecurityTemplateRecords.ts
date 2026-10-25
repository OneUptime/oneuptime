import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import SecurityPlaybook from "../../Models/DatabaseModels/SecurityPlaybook";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../Types/SecurityCase/SecurityCaseStage";
import { DetectionRuleLibraryEntry } from "../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  SecurityPlaybookTemplateDefinition,
  SecurityPlaybookTemplateValues,
} from "../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
import SecurityCasePriorities from "../SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../SecurityCase/SecurityCaseStatuses";

/*
 * The records OneUptime makes from its own templates - a Rule Library entry
 * as a project's detection rule, a playbook template as a project's
 * playbook - and how it knows one it made before. One place for every place
 * that makes them: Turn on recommended and the setup test on the server,
 * the Rule Library's Add buttons and the Playbooks page's templates in the
 * Dashboard.
 *
 * SecurityTemplatesCreatable (Common Tests) holds every library entry and
 * every template, as these build them, to everything a create checks - the
 * width of each column, the required fields, the Sigma rule, the steps - so
 * none of them can fail Turn on recommended or an Add again.
 */

function normalizeName(name: string | undefined | null): string {
  return (name || "").trim().toLowerCase();
}

/*
 * A project rule is a library rule when its Sigma YAML carries the library
 * rule's id - however the team renamed it - or it has the library rule's
 * name, whatever its case or spacing.
 */
export function isRuleFromLibraryEntry(
  rule: Pick<DetectionRule, "name" | "sigmaRuleYaml">,
  entry: Pick<DetectionRuleLibraryEntry, "id" | "title">,
): boolean {
  if ((rule.sigmaRuleYaml || "").indexOf(`id: ${entry.id}`) !== -1) {
    return true;
  }

  return normalizeName(rule.name) === normalizeName(entry.title);
}

// The project's rule of a library entry, if it has one.
export function findRuleOfLibraryEntry<
  TRule extends Pick<DetectionRule, "name" | "sigmaRuleYaml">,
>(
  rules: ReadonlyArray<TRule>,
  entry: Pick<DetectionRuleLibraryEntry, "id" | "title">,
): TRule | undefined {
  return rules.find((rule: TRule): boolean => {
    return isRuleFromLibraryEntry(rule, entry);
  });
}

// A library entry as a detection rule of the project: on, opening cases rather than alerts.
export function buildDetectionRuleFromLibrary(data: {
  projectId: ObjectID;
  entry: DetectionRuleLibraryEntry;
}): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = data.projectId;
  rule.name = data.entry.title;
  rule.description = data.entry.description;
  rule.sigmaRuleYaml = data.entry.sigmaRuleYaml;
  rule.isEnabled = true;
  rule.evaluationIntervalInMinutes = data.entry.evaluationIntervalInMinutes;
  rule.matchCountThreshold = data.entry.matchCountThreshold;
  rule.shouldCreateCase = true;
  rule.shouldCreateAlert = false;
  rule.shouldCreateIncident = false;
  rule.shouldWriteDetectionFinding = true;

  if (data.entry.groupByField) {
    rule.groupByField = data.entry.groupByField;
  }

  if (data.entry.distinctCountField) {
    rule.distinctCountField = data.entry.distinctCountField;
  }

  return rule;
}

/*
 * A project playbook is a template's when it has the template's name, or
 * one of the names given (the template's name as a reader's language words
 * it), whatever its case or spacing.
 */
export function isPlaybookFromTemplate(
  playbook: Pick<SecurityPlaybook, "name">,
  template: Pick<SecurityPlaybookTemplateDefinition, "title">,
  otherNames: ReadonlyArray<string> = [],
): boolean {
  const name: string = normalizeName(playbook.name);

  return [template.title, ...otherNames].some((candidate: string): boolean => {
    return normalizeName(candidate) === name;
  });
}

/*
 * The project's built-in case priorities and statuses, as a template names
 * them: by the level or stage each stands for (SecurityPlaybookTemplates).
 * An id is "" when the project has none of the kind, which the step's own
 * check then refuses.
 */
export function getSecurityPlaybookTemplateValues(data: {
  priorities: ReadonlyArray<unknown>;
  statuses: ReadonlyArray<unknown>;
}): SecurityPlaybookTemplateValues {
  return {
    priorityId: (level: SecurityCasePriorityLevel): string => {
      const priority: unknown = SecurityCasePriorities.getPriorityOfLevel(
        data.priorities,
        level,
      );

      return priority ? SecurityCasePriorities.toRows([priority])[0]!.id : "";
    },
    statusId: (stage: SecurityCaseStage): string => {
      const status: unknown = SecurityCaseStatuses.getStatusOfStage(
        data.statuses,
        stage,
      );

      return status ? SecurityCaseStatuses.toRows([status])[0]!.id : "";
    },
  };
}

/*
 * A template as a playbook of the project, on and ready to run: its
 * trigger, its conditions and its steps, naming the project's own case
 * priorities and statuses (`priorities`, `statuses`). The name and
 * description are the template's own, or as the reader's language words
 * them.
 */
export function buildSecurityPlaybookFromTemplate(data: {
  projectId: ObjectID;
  template: SecurityPlaybookTemplateDefinition;
  priorities: ReadonlyArray<unknown>;
  statuses: ReadonlyArray<unknown>;
  name?: string | undefined;
  description?: string | undefined;
}): SecurityPlaybook {
  const { template } = data;
  const values: SecurityPlaybookTemplateValues =
    getSecurityPlaybookTemplateValues({
      priorities: data.priorities,
      statuses: data.statuses,
    });
  const playbook: SecurityPlaybook = new SecurityPlaybook();
  playbook.projectId = data.projectId;
  playbook.name = data.name || template.title;
  playbook.description = data.description || template.description;
  playbook.isEnabled = true;
  playbook.trigger = template.trigger;
  playbook.steps = template.getSteps(values) as unknown as JSONArray;

  if (template.minimumPriorityLevel) {
    const minimumId: string = values.priorityId(template.minimumPriorityLevel);

    if (minimumId) {
      playbook.minimumSecurityCasePriorityId = new ObjectID(minimumId);
    }
  }

  if (template.detectionSource) {
    playbook.detectionSource = template.detectionSource;
  }

  return playbook;
}
