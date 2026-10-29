import Dictionary from "../Dictionary";
import { Argument, ComponentInputType } from "./Component";

/*
 * LINKING WHAT AN INCIDENT OR ALERT A WORKFLOW CREATES IS ABOUT.
 *
 * Issue #5341: an alert that arrives from another tool names the router,
 * switch, host or service it is about - "WAN-RTR-01", "10.0.4.1" - and a
 * workflow could only link it by writing each resource's OneUptime ID into
 * JSON Object, under the right list ("hosts", "networkDevices", ...), which
 * nobody receiving a webhook knows. Create One Incident and Create One
 * Alert now have one more setting, Affected Resources: names, addresses or
 * IDs, typed or taken from an earlier step. Each is looked up across every
 * kind of resource the record can be linked to, and what matches is added
 * to what JSON Object and the template already link.
 *
 * Monitors are not among them: they have their own fields in JSON Object
 * (an incident's monitors, an alert's monitorId), because linking a monitor
 * to an incident a person or a workflow declares pauses its checks - a
 * choice to make on purpose, never a side effect of a name that matched.
 *
 * Keyed by the table of the record the step creates; the server resolves
 * the references (Server/Utils/AffectedResources/AffectedResourceReferences)
 * as the step, a Project Admin of the workflow's project.
 */

export const AFFECTED_RESOURCES_ARGUMENT_ID: string = "affectedResources";

/*
 * The most references one step resolves, and the most resources it links:
 * a list longer than this is a payload pasted by mistake, not a set of
 * resources one incident is about.
 */
export const MAX_AFFECTED_RESOURCE_REFERENCES: number = 25;
export const MAX_LINKED_AFFECTED_RESOURCES: number = 50;

// The longest single reference: a name, an address or an ID.
export const MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH: number = 200;

const SETTINGS: Dictionary<{ noun: string }> = {
  Incident: { noun: "incident" },
  Alert: { noun: "alert" },
};

type GetAffectedResourcesArgumentFunction = (
  tableName: string | undefined,
) => Argument | null;

// The Affected Resources setting of this table's Create One step, if any.
export const getAffectedResourcesArgument: GetAffectedResourcesArgumentFunction =
  (tableName: string | undefined): Argument | null => {
    const setting: { noun: string } | undefined = tableName
      ? SETTINGS[tableName]
      : undefined;

    if (!setting) {
      return null;
    }

    return {
      id: AFFECTED_RESOURCES_ARGUMENT_ID,
      name: "Affected Resources",
      type: ComponentInputType.Text,
      required: false,
      description: `The hosts, network devices, clusters, databases or services this ${setting.noun} is about, by name, address or ID, separated by commas. Each one found is linked; monitors go in JSON Object.`,
      placeholder: "Example: WAN-RTR-01, 10.0.4.1",
    };
  };

// The tables whose Create One step has the setting.
export const getAffectedResourcesSettingTableNames: () => Array<string> =
  (): Array<string> => {
    return Object.keys(SETTINGS).sort();
  };

/*
 * The references a setting holds, each once, in the order written: split at
 * commas, semicolons and line breaks, trimmed, empty ones dropped, each cut
 * to MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH. A list (an earlier step's value
 * that is an array) gives its entries. Read in one pass, never with a
 * regular expression: the value can be a webhook's text, any length.
 */
export const readAffectedResourceReferences: (value: unknown) => {
  references: Array<string>;
  leftOut: number;
} = (
  value: unknown,
): {
  references: Array<string>;
  leftOut: number;
} => {
  const references: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  let leftOut: number = 0;

  const add: (raw: string) => void = (raw: string): void => {
    const reference: string = raw
      .trim()
      .substring(0, MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH)
      .trim();

    if (!reference) {
      return;
    }

    const key: string = reference.toLowerCase();

    if (seen.has(key)) {
      return;
    }

    seen.add(key);

    if (references.length >= MAX_AFFECTED_RESOURCE_REFERENCES) {
      leftOut++;
      return;
    }

    references.push(reference);
  };

  const split: (text: string) => void = (text: string): void => {
    let current: string = "";

    for (const character of text) {
      if (
        character === "," ||
        character === ";" ||
        character === "\n" ||
        character === "\r"
      ) {
        add(current);
        current = "";
        continue;
      }

      current += character;
    }

    add(current);
  };

  const values: Array<unknown> = Array.isArray(value) ? value : [value];

  for (const item of values) {
    if (typeof item === "string") {
      split(item);
    } else if (typeof item === "number" && Number.isFinite(item)) {
      add(String(item));
    }
  }

  return { references, leftOut };
};
