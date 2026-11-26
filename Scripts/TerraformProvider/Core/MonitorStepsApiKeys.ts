import { JSONObject } from "Common/Types/JSON";
import MonitorTemplateSyncFieldUtil, {
  MonitorTemplateSyncField,
} from "Common/Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorStepsIdentityUtil, {
  MonitorStepsStoredIdentity,
} from "Common/Utils/Monitor/MonitorStepsIdentityUtil";
import {
  CriteriaAlertSchema,
  CriteriaFilterSchema,
  CriteriaIncidentSchema,
  getMonitorCriteriaInstanceSchema,
  getMonitorStepSchema,
  getMonitorStepsSchema,
} from "Common/Utils/Schema/MonitorSchemas";

/*
 * WHAT ONEUPTIME HOLDS OF A MONITOR'S STEPS, KEY BY KEY, AND HOW IT MATCHES
 * THEM ACROSS A WRITE (OneUptime/oneuptime#10984).
 *
 * The provider's monitor_steps must never remove a setting it cannot write:
 * every key OneUptime stores at a step, a criteria, a filter, a window, an
 * incident or an alert template either has an attribute, or is kept as
 * OneUptime holds it on an apply (StaticFiles/monitorstepsunmanaged.go). So
 * the generator writes, from the server's own code:
 *
 *   - every key of each of those, from the API's own schemas
 *     (Common/Utils/Schema/MonitorSchemas, held to the Types' interfaces by
 *     their own test): the provider's Go test fails on a key it has neither
 *     an attribute nor a decision for (testdata/monitor_steps_api_keys.json);
 *   - how the server matches a criteria or a template sent without an id to
 *     the stored one it stands in for (MonitorStepsIdentityUtil.resolveIds),
 *     which the provider mirrors to keep a setting on the right item
 *     (testdata/monitor_steps_identity_cases.json);
 *   - the fields a monitor template's step can keep from each linked monitor
 *     when it syncs, do_not_sync_fields' values, as Go
 *     (MonitorTemplateSyncFieldUtil, monitorsteps_syncfields.go).
 */

interface SchemaLike {
  shape?: Record<string, unknown>;
  unwrap?: () => unknown;
  element?: unknown;
}

// An object schema's keys, through .optional() and the elements of a list.
function keysOf(schema: unknown): Array<string> {
  let current: unknown = schema;

  for (let depth: number = 0; depth < 8 && current; depth++) {
    const candidate: SchemaLike = current as SchemaLike;

    if (candidate.shape && typeof candidate.shape === "object") {
      return Object.keys(candidate.shape).sort();
    }

    if (typeof candidate.unwrap === "function") {
      current = candidate.unwrap();
      continue;
    }

    if (candidate.element) {
      current = candidate.element;
      continue;
    }

    break;
  }

  throw new Error("Not an object schema: its keys cannot be read.");
}

function fieldOf(schema: unknown, name: string): unknown {
  let current: unknown = schema;

  for (let depth: number = 0; depth < 8 && current; depth++) {
    const candidate: SchemaLike = current as SchemaLike;

    if (candidate.shape && typeof candidate.shape === "object") {
      if (!(name in candidate.shape)) {
        throw new Error(`The schema has no ${name}.`);
      }
      return candidate.shape[name];
    }

    if (typeof candidate.unwrap === "function") {
      current = candidate.unwrap();
      continue;
    }

    break;
  }

  throw new Error(`Not an object schema: it has no ${name} to read.`);
}

export interface MonitorStepsApiKeys {
  about: string;
  // Each level's keys, as the API's schema lists them.
  levels: Record<string, Array<string>>;
}

export function buildMonitorStepsApiKeys(): MonitorStepsApiKeys {
  return {
    about:
      "Written by Scripts/TerraformProvider/Core/MonitorStepsApiKeys.ts from the API's own schemas (Common/Utils/Schema/MonitorSchemas, OneUptime/oneuptime#10984). Do not edit.",
    levels: {
      steps: keysOf(fieldOf(getMonitorStepsSchema(), "value")),
      step: keysOf(fieldOf(getMonitorStepSchema(), "value")),
      criteria: keysOf(fieldOf(getMonitorCriteriaInstanceSchema(), "value")),
      filter: keysOf(CriteriaFilterSchema),
      window: keysOf(fieldOf(CriteriaFilterSchema, "evaluateOverTimeOptions")),
      serverMonitorOptions: keysOf(
        fieldOf(CriteriaFilterSchema, "serverMonitorOptions"),
      ),
      incident: keysOf(CriteriaIncidentSchema),
      incidentMemberRole: keysOf(
        fieldOf(CriteriaIncidentSchema, "incidentMemberRoles"),
      ),
      alert: keysOf(CriteriaAlertSchema),
    },
  };
}

// Every field a template's step can keep, of every monitor type: sorted, each once.
export function getDoNotSyncFieldValues(): Array<string> {
  const paths: Set<string> = new Set<string>();

  for (const monitorType of Object.values(MonitorType)) {
    for (const field of MonitorTemplateSyncFieldUtil.getFields(
      monitorType as MonitorType,
    )) {
      paths.add((field as MonitorTemplateSyncField).path);
    }
  }

  return Array.from(paths).sort();
}

export const MONITOR_STEPS_SYNC_FIELDS_GO_FILE: string =
  "monitorsteps_syncfields.go";

// do_not_sync_fields' values, as the provider's Go validates them.
export function monitorStepsSyncFieldsGoFile(): string {
  const values: string = getDoNotSyncFieldValues()
    .map((value: string): string => {
      return `\t${JSON.stringify(value)},`;
    })
    .join("\n");

  return `package provider

// Code generated by Scripts/TerraformProvider/Core/MonitorStepsApiKeys.ts from
// MonitorTemplateSyncFieldUtil (OneUptime/oneuptime#10984). DO NOT EDIT.

// The fields a monitor template's step can keep from each linked monitor
// when the template syncs, of every monitor type: do_not_sync_fields' values.
var monitorStepsDoNotSyncFieldValues = []string{
${values}
}
`;
}

export interface MonitorStepsIdentityCase {
  name: string;
  // The names (or titles) of the items sent, which carry no ids.
  incoming: Array<string>;
  stored: Array<MonitorStepsStoredIdentity>;
  // The index of the stored item each incoming one takes the id of, or -1.
  matches: Array<number>;
}

const ID_A: string = "a1000000-0000-4000-8000-00000010984a";
const ID_B: string = "a1000000-0000-4000-8000-00000010984b";
const ID_C: string = "a1000000-0000-4000-8000-00000010984c";

const SENT: Array<{
  name: string;
  incoming: Array<string>;
  stored: Array<MonitorStepsStoredIdentity>;
}> = [
  {
    name: "the same names in the same order",
    incoming: ["Online", "Offline"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "reordered: each follows its name",
    incoming: ["Offline", "Online"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "renamed: by position",
    incoming: ["Online", "Down"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "one added at the end gets a new id",
    incoming: ["Online", "Offline", "Degraded"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "one added at the start: the others follow their names, and it gets a new id",
    incoming: ["Degraded", "Online", "Offline"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "one removed: the other follows its name",
    incoming: ["Offline"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "a name sent twice is matched by position",
    incoming: ["Online", "Online"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "a name stored twice is matched by position",
    incoming: ["Online", "Offline"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Online" },
    ],
  },
  {
    name: "items with no name, as steps are, by position",
    incoming: ["", "", ""],
    stored: [{ id: ID_A }, { id: ID_B }],
  },
  {
    name: "names are trimmed",
    incoming: ["  Offline  ", "Online"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: " Offline" },
    ],
  },
  {
    name: "names match in their own case only",
    incoming: ["offline", "online"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "a stored item with no id is never taken",
    incoming: ["Online", "Offline"],
    stored: [
      { id: "", name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "a name takes its stored item before a position would",
    incoming: ["Degraded", "Online"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Offline" },
    ],
  },
  {
    name: "more stored than sent",
    incoming: ["Offline"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_B, name: "Degraded" },
      { id: ID_C, name: "Offline" },
    ],
  },
  {
    name: "an id stored twice is taken once",
    incoming: ["Online", "Offline"],
    stored: [
      { id: ID_A, name: "Online" },
      { id: ID_A, name: "Offline" },
    ],
  },
  {
    name: "nothing stored: every one gets a new id",
    incoming: ["Online", "Offline"],
    stored: [],
  },
];

// What the server gives each item sent without an id, as stored indexes.
export function matchesFor(data: {
  incoming: Array<string>;
  stored: Array<MonitorStepsStoredIdentity>;
}): Array<number> {
  const ids: Array<string> = MonitorStepsIdentityUtil.resolveIds({
    incoming: data.incoming.map((name: string) => {
      return { name: name, isIdOwnedByCaller: false };
    }),
    stored: data.stored,
  });

  const claimed: Set<number> = new Set<number>();

  return ids.map((id: string): number => {
    const index: number = data.stored.findIndex(
      (stored: MonitorStepsStoredIdentity, storedIndex: number): boolean => {
        return (
          Boolean(stored.id) && stored.id === id && !claimed.has(storedIndex)
        );
      },
    );

    if (index !== -1) {
      claimed.add(index);
    }

    return index;
  });
}

export function buildMonitorStepsIdentityCases(): JSONObject {
  return {
    about:
      "Written by Scripts/TerraformProvider/Core/MonitorStepsApiKeys.ts from the server's own MonitorStepsIdentityUtil.resolveIds (OneUptime/oneuptime#10984). Do not edit.",
    cases: SENT.map(
      (sent: {
        name: string;
        incoming: Array<string>;
        stored: Array<MonitorStepsStoredIdentity>;
      }): JSONObject => {
        return {
          name: sent.name,
          incoming: sent.incoming,
          stored: sent.stored.map(
            (stored: MonitorStepsStoredIdentity): JSONObject => {
              return { id: stored.id || "", name: stored.name || "" };
            },
          ),
          matches: matchesFor(sent),
        };
      },
    ),
  };
}

// The files' names, in the provider's internal/provider/testdata.
export const MONITOR_STEPS_API_KEYS_FILE: string =
  "monitor_steps_api_keys.json";
export const MONITOR_STEPS_IDENTITY_CASES_FILE: string =
  "monitor_steps_identity_cases.json";

export function monitorStepsApiKeysFile(): string {
  return `${JSON.stringify(buildMonitorStepsApiKeys(), null, 2)}\n`;
}

export function monitorStepsIdentityCasesFile(): string {
  return `${JSON.stringify(buildMonitorStepsIdentityCases(), null, 2)}\n`;
}
