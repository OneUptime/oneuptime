import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { replaceAllLiterally } from "../../../Server/Services/IncidentGroupingEngineService";

/*
 * Episode title and description templates are filled with an incident's
 * title, description, first monitor's name and severity. A string
 * replacement reads "$&", "$`", "$'" and "$1" in the value as patterns, so a
 * title such as "Price $& up" came out of an episode template mangled - and a
 * title typed on an incident form could copy other parts of the template into
 * itself. replaceAllLiterally puts every value in exactly as written.
 */
describe("replaceAllLiterally", () => {
  test.each([
    ["$&", "Price $& up"],
    ["$`", "Before $` after"],
    ["$'", "Before $' after"],
    ["$1", "Group $1 down"],
    ["$$", "Cost $$ high"],
  ])(
    "puts a value holding %s in exactly as written",
    (_label: string, value: string) => {
      expect(
        replaceAllLiterally(
          "Episode: {{incidentTitle}} ({{incidentTitle}})",
          /\{\{incidentTitle\}\}/g,
          value,
        ),
      ).toBe(`Episode: ${value} (${value})`);
    },
  );

  test("replaces every occurrence of the placeholder", () => {
    expect(
      replaceAllLiterally(
        "{{monitorName}} / {{monitorName}} / {{monitorName}}",
        /\{\{monitorName\}\}/g,
        "api",
      ),
    ).toBe("api / api / api");
  });

  test("leaves text without the placeholder unchanged", () => {
    expect(
      replaceAllLiterally(
        "No placeholders here",
        /\{\{incidentTitle\}\}/g,
        "anything",
      ),
    ).toBe("No placeholders here");
  });
});

describe("IncidentGroupingEngineService's template substitution", () => {
  const source: string = fs
    .readFileSync(
      path.resolve(
        __dirname,
        "../../../Server/Services/IncidentGroupingEngineService.ts",
      ),
      "utf8",
    )
    .replace(/\s+/g, "");

  test.each([
    ["incidentTitle", "values.incidentTitle"],
    ["incidentDescription", "values.incidentDescription"],
    ["monitorName", "values.monitorName"],
    ["incidentSeverity", "values.incidentSeverity"],
  ])(
    "puts {{%s}} in literally, in both the render and the preprocess step",
    (placeholder: string, value: string) => {
      const literal: string = `replaceAllLiterally(result,/\\{\\{${placeholder}\\}\\}/g,${value},)`;
      const asPattern: string = `result.replace(/\\{\\{${placeholder}\\}\\}/g,${value}`;

      expect(source.split(literal).length - 1).toBe(2);
      expect(source).not.toContain(asPattern);
    },
  );
});
