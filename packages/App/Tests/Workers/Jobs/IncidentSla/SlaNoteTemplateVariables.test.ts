import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  INCIDENT_SLA_NOTE_TEMPLATE_VARIABLE_GROUPS,
  INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES,
} from "Common/Utils/Incident/IncidentSlaNoteTemplateVariables";
import { TemplateVariable } from "Common/Types/Template/TemplateVariable";

/*
 * An SLA rule's note reminders offer their variables under each reminder's
 * editor (Common/Utils/Incident/IncidentSlaNoteTemplateVariables). The worker
 * that posts the reminders fills them by name, one replace per variable. The
 * two must agree: a variable offered but not filled stays in every posted
 * note as written, and one filled but not offered is one nobody finds.
 */

const WORKER: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Workers/Jobs/IncidentSla/SendNoteReminders.ts",
);

const SLA_RULES_PAGE: string = path.resolve(
  __dirname,
  "../../../../FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSlaRules.tsx",
);

// The names the worker's processTemplate replaces: result.replace(/\{\{name\}\}/g, ...).
function filledByWorker(): Array<string> {
  const source: string = fs.readFileSync(WORKER, "utf8");

  return Array.from(
    source.matchAll(/\/\\\{\\\{(\w+)\\\}\\\}\/g/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  ).sort();
}

function offered(): Array<string> {
  return INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES.map(
    (variable: TemplateVariable): string => {
      return variable.name;
    },
  );
}

describe("the SLA reminder variables", () => {
  test("the worker's replacements are found", () => {
    expect(filledByWorker().length).toBeGreaterThanOrEqual(8);
  });

  test("are exactly the ones the worker fills", () => {
    expect([...offered()].sort()).toEqual(filledByWorker());
  });

  test("are offered once each, as one group with nothing to explain", () => {
    expect(new Set(offered()).size).toBe(offered().length);
    expect(INCIDENT_SLA_NOTE_TEMPLATE_VARIABLE_GROUPS).toEqual([
      { variables: INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES },
    ]);
  });

  test("each says what it holds, in words a label can be looked up by", () => {
    for (const variable of INCIDENT_SLA_NOTE_TEMPLATE_VARIABLES) {
      expect(variable.description.trim().length).toBeGreaterThan(0);
      expect(variable.description).not.toContain("{{");
      expect(variable.isDescriptionVerbatim).toBeUndefined();
    }
  });

  test("the SLA rules page's help lists the same variables", () => {
    const source: string = fs.readFileSync(SLA_RULES_PAGE, "utf8");
    const documented: Array<string> = Array.from(
      source.matchAll(/^- \\`\{\{(\w+)\}\}\\` - /gm),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ).sort();

    expect(documented).toEqual([...offered()].sort());
  });

  test("the default reminders use only variables that are offered", () => {
    const source: string = fs.readFileSync(WORKER, "utf8");
    const defaults: string = source.slice(
      source.indexOf("DEFAULT_INTERNAL_NOTE_TEMPLATE"),
      source.indexOf("RunCron("),
    );
    const used: Array<string> = Array.from(
      defaults.matchAll(/\{\{(\w+)\}\}/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(used.length).toBeGreaterThan(0);

    for (const name of used) {
      expect(offered()).toContain(name);
    }
  });
});
