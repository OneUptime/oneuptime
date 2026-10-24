import { JSONObject, JSONValue } from "Common/Types/JSON";
import { SecurityPlaybookActionType } from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The names a step's ids stand for, as far as the page could read them: a
 * connection, an on-call policy, a severity, a label, a workflow, and the
 * project's case priorities and statuses. An id with no name here reads as
 * "a removed ..." - the record was deleted, or the reader may not see it.
 */
export interface StepNameLookup {
  connections: Map<string, string>;
  onCallPolicies: Map<string, string>;
  incidentSeverities: Map<string, string>;
  labels: Map<string, string>;
  workflows: Map<string, string>;
  casePriorities: Map<string, string>;
  caseStatuses: Map<string, string>;
}

export function emptyStepNameLookup(): StepNameLookup {
  return {
    connections: new Map(),
    onCallPolicies: new Map(),
    incidentSeverities: new Map(),
    labels: new Map(),
    workflows: new Map(),
    casePriorities: new Map(),
    caseStatuses: new Map(),
  };
}

function text(config: JSONObject, key: string): string {
  const value: JSONValue | undefined = config[key];

  return typeof value === "string" ? value.trim() : "";
}

function ids(config: JSONObject, key: string): Array<string> {
  const value: JSONValue | undefined = config[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const list: Array<string> = [];

  for (const item of value as Array<unknown>) {
    if (typeof item === "string" && item.length > 0) {
      list.push(item);
    }
  }

  return list;
}

/*
 * The name an id stands for. A case priority's or status's name is looked
 * up in the reader's language too (`translateName`): a new project's are
 * OneUptime's own words.
 */
function named(
  map: Map<string, string>,
  id: string,
  missing: string,
  translator: Translator,
  translateName: boolean = false,
): string {
  const name: string | undefined = map.get(id);

  if (name) {
    return translateName ? translator.translateText(name) || name : name;
  }

  return translator.translateText(missing) || missing;
}

// One short line under a step's title: what it will do, with the names it uses.
export function summarizeSecurityPlaybookStep(
  step: SecurityPlaybookStep,
  lookup: StepNameLookup,
  translator: Translator,
): string {
  const config: JSONObject = step.config || {};

  switch (step.action) {
    case SecurityPlaybookActionType.AssignCase: {
      const parts: Array<string> = [];

      if (text(config, "userId")) {
        parts.push(translator.translateText("to a person") || "to a person");
      }

      if (text(config, "teamId")) {
        parts.push(translator.translateText("to a team") || "to a team");
      }

      return parts.join(" · ");
    }
    case SecurityPlaybookActionType.SetCasePriority:
      return translator.translateTemplate("Priority becomes {{priority}}", {
        priority: named(
          lookup.casePriorities,
          text(config, "priorityId"),
          translationKey("a removed priority"),
          translator,
          true,
        ),
      });
    case SecurityPlaybookActionType.SetCaseStatus: {
      const status: string = named(
        lookup.caseStatuses,
        text(config, "statusId"),
        translationKey("a removed status"),
        translator,
        true,
      );
      const verdict: string = text(config, "verdict");

      return verdict
        ? translator.translateTemplate(
            "Status becomes {{status}} ({{verdict}})",
            {
              status,
              verdict: translator.translateText(verdict) || verdict,
            },
          )
        : translator.translateTemplate("Status becomes {{status}}", { status });
    }
    case SecurityPlaybookActionType.AddCaseNote: {
      // Only the start is shown, so only the start is read.
      const note: string = text(config, "note")
        .slice(0, 200)
        .replace(/\s+/g, " ")
        .trim();

      return note.length > 80 ? `${note.slice(0, 80)}…` : note;
    }
    case SecurityPlaybookActionType.AddCaseLabels:
      return ids(config, "labelIds")
        .map((id: string): string => {
          return named(
            lookup.labels,
            id,
            translationKey("a removed label"),
            translator,
          );
        })
        .join(", ");
    case SecurityPlaybookActionType.CheckThreatIntel: {
      const raiseId: string = text(config, "raisePriorityToId");

      return raiseId
        ? translator.translateTemplate(
            "On a match, priority rises to {{priority}}",
            {
              priority: named(
                lookup.casePriorities,
                raiseId,
                translationKey("a removed priority"),
                translator,
                true,
              ),
            },
          )
        : translator.translateText(
            "Notes every entity found in threat intel",
          ) || "";
    }
    case SecurityPlaybookActionType.LookUpEntityActivity: {
      const hours: JSONValue | undefined = config["lookbackInHours"];

      return translator.translatePlural(
        {
          one: "The last {{count}} hour of events",
          other: "The last {{count}} hours of events",
        },
        typeof hours === "number" ? hours : 24,
      );
    }
    case SecurityPlaybookActionType.EmailPeople: {
      const people: number = ids(config, "userIds").length;
      const teams: number = ids(config, "teamIds").length;

      return translator.translateTemplate("{{people}} · {{teams}}", {
        people: translator.translatePlural(
          { one: "{{count}} person", other: "{{count}} people" },
          people,
        ),
        teams: translator.translatePlural(
          { one: "{{count}} team", other: "{{count}} teams" },
          teams,
        ),
      });
    }
    case SecurityPlaybookActionType.PostToSlack:
    case SecurityPlaybookActionType.PostToMicrosoftTeams:
      return `#${text(config, "channelName")}`;
    case SecurityPlaybookActionType.PageOnCall:
      return named(
        lookup.onCallPolicies,
        text(config, "onCallPolicyId"),
        translationKey("a removed on-call policy"),
        translator,
      );
    case SecurityPlaybookActionType.DeclareIncident:
      return translator.translateTemplate("Severity: {{severity}}", {
        severity: named(
          lookup.incidentSeverities,
          text(config, "incidentSeverityId"),
          translationKey("a removed severity"),
          translator,
        ),
      });
    case SecurityPlaybookActionType.SuspendOktaUser:
    case SecurityPlaybookActionType.EndOktaSessions:
    case SecurityPlaybookActionType.ContainCrowdStrikeHost:
    case SecurityPlaybookActionType.IsolateDefenderDevice:
    case SecurityPlaybookActionType.UnsuspendOktaUser:
    case SecurityPlaybookActionType.LiftCrowdStrikeContainment:
    case SecurityPlaybookActionType.ReleaseDefenderDevice: {
      const connection: string = named(
        lookup.connections,
        text(config, "connectionId"),
        translationKey("a removed connection"),
        translator,
      );
      const isolation: string = text(config, "isolationType");

      return isolation
        ? translator.translateTemplate(
            "Through {{connection}} ({{isolation}})",
            {
              connection,
              isolation: translator.translateText(isolation) || isolation,
            },
          )
        : translator.translateTemplate("Through {{connection}}", {
            connection,
          });
    }
    case SecurityPlaybookActionType.SendWebhook:
      return text(config, "url");
    case SecurityPlaybookActionType.RunWorkflow:
      return named(
        lookup.workflows,
        text(config, "workflowId"),
        translationKey("a removed workflow"),
        translator,
      );
    default:
      return "";
  }
}
