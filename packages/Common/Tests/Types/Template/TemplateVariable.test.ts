import {
  MAX_TEMPLATE_VARIABLE_QUERY_LENGTH,
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
  TemplateVariableTextEdit,
  TemplateVariableTrigger,
  countTemplateVariables,
  filterTemplateVariableGroups,
  findTemplateVariableTrigger,
  formatTemplateVariable,
  hasTemplateVariables,
  insertTemplateVariable,
  templateVariableMatches,
} from "../../../Types/Template/TemplateVariable";
import { describe, expect, test } from "@jest/globals";

/*
 * The model behind every template field's variables: how a list is counted
 * and searched, how "{{" being typed is recognised, and how a picked
 * variable goes into the text.
 */

const TITLE: TemplateVariable = {
  name: "incident.title",
  description: "Title",
};
const STARTED_AT: TemplateVariable = {
  name: "incident.startedAt",
  description: "Declared At",
};
const SEVERITY: TemplateVariable = {
  name: "incident.severity",
  description: "Incident Severity",
  example: "Critical",
};
const CUSTOMER_IMPACT: TemplateVariable = {
  name: "incident.customFields.customer_impact",
  description: "Customer Impact",
  isDescriptionVerbatim: true,
};

const GROUPS: TemplateVariableGroups = [
  { title: "Incident", variables: [TITLE, STARTED_AT, SEVERITY] },
  { title: "Custom Fields", variables: [CUSTOMER_IMPACT] },
];

function namesOf(groups: Array<TemplateVariableGroup>): Array<string> {
  return groups.flatMap((group: TemplateVariableGroup): Array<string> => {
    return group.variables.map((variable: TemplateVariable): string => {
      return variable.name;
    });
  });
}

describe("formatTemplateVariable", () => {
  test("writes the name between double braces", () => {
    expect(formatTemplateVariable("incident.title")).toBe("{{incident.title}}");
    expect(formatTemplateVariable("statusPageName")).toBe(
      "{{statusPageName}}",
    );
  });
});

describe("countTemplateVariables and hasTemplateVariables", () => {
  test("count every variable across the groups", () => {
    expect(countTemplateVariables(GROUPS)).toBe(4);
    expect(countTemplateVariables([])).toBe(0);
    expect(countTemplateVariables(undefined)).toBe(0);
    expect(countTemplateVariables(null)).toBe(0);
  });

  test("a group with only a description is something to show, but nothing to count", () => {
    const groups: TemplateVariableGroups = [
      {
        title: "Custom Fields",
        description: "This project has no incident custom fields.",
        variables: [],
      },
    ];

    expect(countTemplateVariables(groups)).toBe(0);
    expect(hasTemplateVariables(groups)).toBe(true);
  });

  test("no groups, or empty groups with nothing to say, are nothing to show", () => {
    expect(hasTemplateVariables(undefined)).toBe(false);
    expect(hasTemplateVariables([])).toBe(false);
    expect(hasTemplateVariables([{ title: "Empty", variables: [] }])).toBe(
      false,
    );
    expect(hasTemplateVariables(GROUPS)).toBe(true);
  });
});

describe("templateVariableMatches", () => {
  test("everything matches an empty search", () => {
    expect(templateVariableMatches(TITLE, "")).toBe(true);
    expect(templateVariableMatches(TITLE, "   ")).toBe(true);
    expect(templateVariableMatches(TITLE, undefined)).toBe(true);
    expect(templateVariableMatches(TITLE, null)).toBe(true);
  });

  test("finds a variable by its name, in any case", () => {
    expect(templateVariableMatches(STARTED_AT, "startedat")).toBe(true);
    expect(templateVariableMatches(STARTED_AT, "STARTED")).toBe(true);
    expect(templateVariableMatches(STARTED_AT, "incident.st")).toBe(true);
  });

  test("finds a variable by what it holds, so nobody has to know its name", () => {
    expect(templateVariableMatches(STARTED_AT, "declared")).toBe(true);
    expect(templateVariableMatches(CUSTOMER_IMPACT, "impact")).toBe(true);
  });

  test("finds a variable by its example", () => {
    expect(templateVariableMatches(SEVERITY, "critical")).toBe(true);
  });

  test("every word searched for must be there", () => {
    expect(templateVariableMatches(STARTED_AT, "declared at")).toBe(true);
    expect(templateVariableMatches(STARTED_AT, "declared title")).toBe(false);
  });

  test("braces typed into the search are ignored", () => {
    expect(templateVariableMatches(TITLE, "{{incident.title}}")).toBe(true);
    expect(templateVariableMatches(TITLE, "{{tit")).toBe(true);
  });

  test("matches the description as it is shown, when it is translated", () => {
    const describe: (variable: TemplateVariable) => string = (): string => {
      return "Titel";
    };

    expect(templateVariableMatches(TITLE, "titel", describe)).toBe(true);
    // The English is still searched too.
    expect(templateVariableMatches(TITLE, "title", describe)).toBe(true);
  });

  test("a word in none of them does not match", () => {
    expect(templateVariableMatches(TITLE, "severity")).toBe(false);
  });
});

describe("filterTemplateVariableGroups", () => {
  test("with nothing searched for, keeps every group that has a variable, in order", () => {
    const filtered: Array<TemplateVariableGroup> = filterTemplateVariableGroups(
      [...GROUPS, { title: "Nothing", description: "None yet", variables: [] }],
      "",
    );

    expect(
      filtered.map((group: TemplateVariableGroup) => {
        return group.title;
      }),
    ).toEqual(["Incident", "Custom Fields"]);
    expect(namesOf(filtered)).toEqual([
      "incident.title",
      "incident.startedAt",
      "incident.severity",
      "incident.customFields.customer_impact",
    ]);
  });

  test("keeps only what matches, and drops a group left with none", () => {
    const filtered: Array<TemplateVariableGroup> = filterTemplateVariableGroups(
      GROUPS,
      "impact",
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.title).toBe("Custom Fields");
    expect(namesOf(filtered)).toEqual([
      "incident.customFields.customer_impact",
    ]);
  });

  test("keeps the group's title and description with what it found", () => {
    const filtered: Array<TemplateVariableGroup> = filterTemplateVariableGroups(
      [{ title: "Incident", description: "Its own values", variables: [TITLE] }],
      "tit",
    );

    expect(filtered[0]).toEqual({
      title: "Incident",
      description: "Its own values",
      variables: [TITLE],
    });
  });

  test("nothing at all when nothing matches", () => {
    expect(filterTemplateVariableGroups(GROUPS, "zzz")).toEqual([]);
  });

  test("does not change the groups it was given", () => {
    const before: string = JSON.stringify(GROUPS);

    filterTemplateVariableGroups(GROUPS, "impact");

    expect(JSON.stringify(GROUPS)).toBe(before);
  });
});

describe("findTemplateVariableTrigger", () => {
  function triggerAtEnd(text: string): TemplateVariableTrigger | null {
    return findTemplateVariableTrigger(text, text.length);
  }

  test("two opening braces at the cursor start a variable with nothing typed yet", () => {
    expect(triggerAtEnd("{{")).toEqual({ start: 0, end: 2, query: "" });
    expect(triggerAtEnd("Severity: {{")).toEqual({
      start: 10,
      end: 12,
      query: "",
    });
  });

  test("what is typed after them is the query", () => {
    expect(triggerAtEnd("Severity: {{sev")).toEqual({
      start: 10,
      end: 15,
      query: "sev",
    });
    expect(triggerAtEnd("{{incident.custom")).toEqual({
      start: 0,
      end: 17,
      query: "incident.custom",
    });
  });

  test("a query may be words searched for, not only a name", () => {
    expect(triggerAtEnd("{{declared at")?.query).toBe("declared at");
  });

  test("the cursor in the middle of the text uses what is before it", () => {
    const text: string = "Hello {{inc world";

    expect(findTemplateVariableTrigger(text, 11)).toEqual({
      start: 6,
      end: 11,
      query: "inc",
    });
  });

  test("covers braces an editor closed itself, so a pick leaves none behind", () => {
    expect(findTemplateVariableTrigger("{{}}", 2)).toEqual({
      start: 0,
      end: 4,
      query: "",
    });
    expect(findTemplateVariableTrigger("Hi {{ti}} there", 7)).toEqual({
      start: 3,
      end: 9,
      query: "ti",
    });
  });

  test("covers the rest of a variable the cursor is inside", () => {
    const text: string = "{{incident.title}} is down";

    expect(findTemplateVariableTrigger(text, 5)).toEqual({
      start: 0,
      end: 18,
      query: "inc",
    });
  });

  test("does not cover text after the cursor that is not the rest of a variable", () => {
    expect(findTemplateVariableTrigger("{{inc and more", 5)).toEqual({
      start: 0,
      end: 5,
      query: "inc",
    });
  });

  test("none once the braces are closed", () => {
    expect(triggerAtEnd("{{incident.title}}")).toBeNull();
    expect(triggerAtEnd("{{incident.title}} and ")).toBeNull();
    expect(triggerAtEnd("{{a}")).toBeNull();
  });

  test("the last opening braces are the ones that count", () => {
    expect(triggerAtEnd("{{a}} then {{b")).toEqual({
      start: 11,
      end: 14,
      query: "b",
    });
  });

  test("none across a line break", () => {
    expect(triggerAtEnd("{{inc\nident")).toBeNull();
  });

  test("none for a Handlebars tag or partial", () => {
    expect(triggerAtEnd("{{#each report.rows")).toBeNull();
    expect(triggerAtEnd("{{/if")).toBeNull();
    expect(triggerAtEnd("{{> Footer")).toBeNull();
  });

  test("none for triple braces, Handlebars' unescaped value", () => {
    expect(triggerAtEnd("{{{report")).toBeNull();
  });

  test("none after a space straight after the braces, or after a double space", () => {
    expect(triggerAtEnd("{{ incident")).toBeNull();
    expect(triggerAtEnd("{{declared  at")).toBeNull();
  });

  test("none past a few words", () => {
    const long: string = "a".repeat(MAX_TEMPLATE_VARIABLE_QUERY_LENGTH + 1);

    expect(triggerAtEnd(`{{${long}`)).toBeNull();
    expect(
      triggerAtEnd(`{{${"a".repeat(MAX_TEMPLATE_VARIABLE_QUERY_LENGTH)}`),
    ).not.toBeNull();
  });

  test("none for one opening brace, or none at all", () => {
    expect(triggerAtEnd("{inc")).toBeNull();
    expect(triggerAtEnd("plain text")).toBeNull();
    expect(triggerAtEnd("")).toBeNull();
  });

  test("none for a cursor that is not in the text", () => {
    expect(findTemplateVariableTrigger("{{inc", 99)).toBeNull();
    expect(findTemplateVariableTrigger("{{inc", -1)).toBeNull();
    expect(findTemplateVariableTrigger("{{inc", 1.5)).toBeNull();
    expect(
      findTemplateVariableTrigger(undefined as unknown as string, 2),
    ).toBeNull();
  });
});

describe("insertTemplateVariable", () => {
  test("puts the variable at the cursor, and the cursor after it", () => {
    const edit: TemplateVariableTextEdit = insertTemplateVariable({
      text: "Severity:  now",
      start: 10,
      end: 10,
      name: "incident.severity",
    });

    expect(edit.text).toBe("Severity: {{incident.severity}} now");
    expect(edit.caret).toBe(10 + "{{incident.severity}}".length);
  });

  test("replaces the selection, or a trigger's braces and query", () => {
    expect(
      insertTemplateVariable({
        text: "Hi {{inc there",
        start: 3,
        end: 8,
        name: "incident.title",
      }),
    ).toEqual({ text: "Hi {{incident.title}} there", caret: 21 });
  });

  test("takes the range either way round", () => {
    expect(
      insertTemplateVariable({
        text: "abcdef",
        start: 4,
        end: 2,
        name: "x",
      }).text,
    ).toBe("ab{{x}}ef");
  });

  test("keeps the range inside the text", () => {
    expect(
      insertTemplateVariable({ text: "abc", start: -5, end: 1, name: "x" })
        .text,
    ).toBe("{{x}}bc");
    expect(
      insertTemplateVariable({ text: "abc", start: 2, end: 99, name: "x" })
        .text,
    ).toBe("ab{{x}}");
    expect(
      insertTemplateVariable({ text: "", start: 0, end: 0, name: "x" }),
    ).toEqual({ text: "{{x}}", caret: 5 });
  });
});
