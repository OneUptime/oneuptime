import { describe, expect, test } from "@jest/globals";
import {
  clearPlaceholdersExcept,
  replaceAllLiterally,
} from "../../../../Server/Utils/Rules/GroupingRuleEpisodeTemplate";

/*
 * Episode title and description templates are filled with an incident's (or
 * alert's) title, description, monitor's name and severity. A string
 * replacement reads "$&", "$`", "$'" and "$1" in the value as patterns, so a
 * title such as "Price $& up" came out of an episode template mangled - and a
 * title typed on a form could copy other parts of the template into itself.
 * replaceAllLiterally puts every value in exactly as written.
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

/*
 * The grouping engines store an episode's title and description templates
 * with the first incident's (or alert's) values filled in, and fill only the
 * count into them again as members join or leave. A variable left in them -
 * {{monitorName}} for an incident with no monitor - was cleared from the
 * title the episode opened with, ": Checkout failing (1)", and came back
 * into it as soon as another incident joined: "{{monitorName}}: Checkout
 * failing (2)". clearPlaceholdersExcept leaves only the count.
 */
describe("clearPlaceholdersExcept", () => {
  const COUNT: string = "{{incidentCount}}";

  // The title or description written from a stored template, count and all.
  function render(text: string, count: number): string {
    return text
      .replace(/\{\{incidentCount\}\}/g, count.toString())
      .replace(/\{\{[^}]+\}\}/g, "");
  }

  test("clears a variable with no value, and one no incident has, keeping the count", () => {
    expect(
      clearPlaceholdersExcept(
        "{{monitorName}}: Checkout failing ({{incidentCount}}){{nonsense}}",
        COUNT,
      ),
    ).toBe(": Checkout failing ({{incidentCount}})");
  });

  test("keeps every count, wherever it is", () => {
    expect(
      clearPlaceholdersExcept(
        "{{incidentCount}}/{{incidentCount}} {{{incidentCount}}}",
        COUNT,
      ),
    ).toBe("{{incidentCount}}/{{incidentCount}} {{{incidentCount}}}");
  });

  test("clears the other kind's count, and one written with spaces", () => {
    expect(
      clearPlaceholdersExcept(
        "{{alertCount}} alerts, {{ incidentCount }} or {{incidentCount}} incidents",
        COUNT,
      ),
    ).toBe(" alerts,  or {{incidentCount}} incidents");
  });

  test.each([
    ["no placeholder", "No placeholders here"],
    ["single braces", "{a} {b} { {c} }"],
    ["empty braces", "{{}}"],
    ["a placeholder never closed", "Down: {{monitorName"],
    ["one never opened", "Down: monitorName}}"],
    ["nothing", ""],
  ])("leaves text with %s as it is", (_label: string, text: string) => {
    expect(clearPlaceholdersExcept(text, COUNT)).toBe(text);
  });

  test.each([
    "{{monitorName}}: Checkout failing ({{incidentCount}})",
    "[{{incidentSeverity}}] {{monitorName}} - {{incidentCount}} incidents {{nonsense}}",
    "{{incidentDescription}}",
    "{{a}}{{incidentCount}}{{b}}",
    "{{{incidentCount}}} and {{{monitorName}}}",
    "Count: {{incidentCount}}{{incidentCount}} {{ incidentCount }}",
    "{incidentCount} {{alertCount}}",
    "",
  ])(
    "leaves %j reading as before once the count is filled in, with nothing but the count in braces",
    (template: string) => {
      const stored: string = clearPlaceholdersExcept(template, COUNT);

      for (const count of [1, 2, 37]) {
        expect(render(stored, count)).toBe(render(template, count));
      }

      expect(stored.split(COUNT).join("")).not.toMatch(/\{\{[^}]+\}\}/);
    },
  );
});
