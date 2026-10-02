import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Can you please check if we have the same issue everywhere else in the
 * project and fix it as well?"
 *
 * The issue: a template's variables printed as a list around its editor -
 * every placeholder above the note template's editor, five SLA variables run
 * into a description, a grey "Supported Template Variables" box, an
 * always-open reference table under a subscriber template's body, a "Learn
 * about dynamic templates" link to a dialog to copy them from. The fix,
 * everywhere: the field offers its variables itself (Field.templateVariables,
 * or the Markdown editor's templateVariables) - collapsed under it, behind
 * its editor's Insert variable button, and under the cursor when "{{" is
 * typed.
 *
 * This reads every template form's source and holds it to that, and keeps
 * the old lists from coming back anywhere in the Dashboard.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales" || entry.name === "node_modules") {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("every template form offers its variables in its field", () => {
  test.each([
    ["Pages/Incidents/Settings/IncidentNoteTemplates.tsx"],
    ["Pages/Incidents/Settings/IncidentNoteTemplateView.tsx"],
  ])(
    "%s: the note's variables, with the project's custom fields",
    (file: string) => {
      const source: string = readSource(file);

      expect(source).toContain("useIncidentNoteTemplateVariables()");
      expect(source).toContain(
        "templateVariables: noteTemplateVariables.groups",
      );
      expect(source).toContain("title: NoteTemplateFormCopy.noteFieldTitle");
    },
  );

  test.each([
    ["Pages/Alerts/Settings/AlertNoteTemplates.tsx"],
    ["Pages/Alerts/Settings/AlertNoteTemplateDetail.tsx"],
    [
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates.tsx",
    ],
    [
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplateView.tsx",
    ],
  ])(
    "%s: the other note templates name the field the same way (they fill no variables)",
    (file: string) => {
      const source: string = readSource(file);

      expect(source).toContain("title: NoteTemplateFormCopy.noteFieldTitle");
      expect(source).toContain(
        "description: NoteTemplateFormCopy.noteFieldDescription",
      );
      expect(source).not.toContain("templateVariables");
    },
  );

  test("the SLA rule's two reminder templates offer every reminder variable", () => {
    const source: string = readSource(
      "Pages/Incidents/Settings/IncidentSlaRules.tsx",
    );

    expect(
      countOf(
        source,
        "templateVariables: INCIDENT_SLA_NOTE_TEMPLATE_VARIABLE_GROUPS",
      ),
    ).toBe(2);
    expect(
      countOf(
        source,
        "description: IncidentSlaNoteReminderCopy.templateFieldDescription",
      ),
    ).toBe(2);
  });

  test.each([
    ["Pages/Incidents/Settings/IncidentGroupingRules.tsx", "INCIDENT"],
    ["Pages/Alerts/Settings/AlertGroupingRules.tsx", "ALERT"],
  ])(
    "%s: the episode title and description templates offer the episode variables",
    (file: string, kind: string) => {
      const source: string = readSource(file);

      expect(
        countOf(
          source,
          `templateVariables: ${kind}_EPISODE_TEMPLATE_VARIABLE_GROUPS`,
        ),
      ).toBe(2);
      // The grey box under the description is gone.
      expect(source).not.toContain("footerElement");
    },
  );

  test.each([
    ["Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx"],
    ["Components/Form/Monitor/MonitorCriteriaAlertForm.tsx"],
  ])(
    "%s: the description and remediation notes editors offer the monitor's variables",
    (file: string) => {
      const source: string = readSource(file);

      expect(countOf(source, "<MarkdownEditor")).toBe(2);
      expect(
        countOf(source, "templateVariables={templateVariableGroups}"),
      ).toBe(2);
      expect(source).toContain(
        "TemplateVariablesCatalog.getTemplateVariableGroups(",
      );
      // Only the title, a plain text box, keeps the link to the reference dialog.
      expect(countOf(source, "{templateDocsLink}")).toBe(1);
    },
  );

  test("a subscriber template's subject and body offer the event's variables", () => {
    const source: string = readSource(
      "Pages/StatusPages/Settings/SubscriberNotificationTemplates.tsx",
    );

    expect(countOf(source, "templateVariables: templateVariablesFor")).toBe(2);
    expect(source).toContain("getTemplateVariablesFooter:");
    // The always-open reference table is no longer in the body's help.
    expect(source).not.toContain(
      "getSubscriberNotificationTemplateVariablesDocumentation",
    );
    expect(source).not.toContain(
      "<IncidentCustomFieldTemplateVariables eventType",
    );
  });

  test("a subscriber template's Edit dialog offers them too", () => {
    const source: string = readSource(
      "Pages/StatusPages/Settings/SubscriberNotificationTemplateView.tsx",
    );

    expect(countOf(source, "templateVariables: templateVariableGroups")).toBe(
      3,
    );
    expect(countOf(source, "getTemplateVariablesFooter:")).toBe(2);
  });
});

describe("no Dashboard source prints a template's variables as a list again", () => {
  const SOURCES: Map<string, string> = new Map(
    listSourceFiles(DASHBOARD_SRC).map((file: string): [string, string] => {
      return [
        path.relative(DASHBOARD_SRC, file),
        fs.readFileSync(file, "utf8"),
      ];
    }),
  );

  // Words of the lists and pointers the fields' variables replaced.
  const OLD_LISTS: Array<string> = [
    "Supported Template Variables",
    "Static Variables (from first",
    "Markdown. Variables:",
    "Please refer to the documentation below for available variables",
    "Supports template variables such as",
    "Public or Private note template.",
    "description: <IncidentNoteTemplatePlaceholders",
  ];

  test("reads the Dashboard", () => {
    expect(SOURCES.size).toBeGreaterThan(100);
  });

  test.each(OLD_LISTS)("no source holds %j", (needle: string) => {
    const offenders: Array<string> = Array.from(SOURCES.entries())
      .filter(([file, source]: [string, string]): boolean => {
        // The copy module says what the field used to be titled.
        if (file.endsWith("NoteTemplateFormCopy.ts")) {
          return false;
        }

        return source.includes(needle);
      })
      .map(([file]: [string, string]): string => {
        return file;
      });

    expect(offenders).toEqual([]);
  });
});
