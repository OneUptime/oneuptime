// UX rule: Docs/ux/README.md#ask-only-what-you-cannot-work-out
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every form that asks which status pages show a scheduled maintenance event
 * or an announcement suggests the pages that show the affected monitors,
 * under the picker, one click to add (Components/StatusPage/
 * StatusPageSuggestions). Before, the picker was a plain list of every
 * status page, and people guessed which ones listed the monitors they had
 * just picked.
 *
 * This reads every Dashboard source with the TypeScript parser and finds
 * each status page picker - a form field on `statusPages` whose dropdown
 * lists StatusPage - so a form written later, or a picker moved to a new
 * file, is held to the same rule: its footer is
 * getStatusPageSuggestionsFooter, or the file is listed below with the
 * reason it does not suggest.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

/*
 * Pickers that do not suggest, and why. An incident already reaches every
 * status page that lists its monitors; picking pages for it only narrows
 * that (IncidentStatusPageScope), so the pages showing its monitors are
 * what it gets with nothing picked. Those pickers warn about a picked page
 * that lists none of the monitors instead (IncidentStatusPageScopeNotices).
 */
const DOES_NOT_SUGGEST: Record<string, string> = {
  "Pages/Incidents/Create.tsx":
    "an incident's status pages narrow where its monitors reach",
  "Pages/Incidents/Settings/IncidentTemplates.tsx":
    "an incident template's status pages narrow where its monitors reach",
  "Pages/Incidents/Settings/IncidentTemplatesView.tsx":
    "an incident template's status pages narrow where its monitors reach",
  "Pages/Incidents/View/Settings.tsx":
    "an incident's status pages narrow where its monitors reach",
};

/*
 * The pickers that suggest, by file: how many each holds. A maintenance
 * event's picker is one field, defined once (#9131), that its forms and its
 * templates' draw: MAINTENANCE_PICKER_FORMS.
 */
const MAINTENANCE_PICKER: string =
  "Components/ScheduledMaintenance/MaintenanceStatusPagesFormField.tsx";

const SUGGESTING_PICKERS: Record<string, number> = {
  [MAINTENANCE_PICKER]: 1,
  "Components/Announcement/AnnouncementFormFields.tsx": 2,
};

// The forms that draw the maintenance event's picker, by the record it is on.
const MAINTENANCE_PICKER_FORMS: Record<string, string> = {
  "Pages/ScheduledMaintenanceEvents/Create.tsx": "ScheduledMaintenance",
  "Pages/ScheduledMaintenanceEvents/View/Index.tsx": "ScheduledMaintenance",
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx":
    "ScheduledMaintenanceTemplate",
};

function readDashboardSource(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8");
}

/*
 * The options a form hands the maintenance event's picker:
 * getMaintenanceStatusPagesFormField<Model>({ ... }).
 */
function maintenancePickerCall(file: string): string {
  const source: string = readDashboardSource(file);
  const start: number = source.search(
    /getMaintenanceStatusPagesFormField\s*<\s*\w+\s*>\s*\(\{/,
  );

  expect({ file, drawsThePicker: start >= 0 }).toEqual({
    file,
    drawsThePicker: true,
  });

  let depth: number = 0;

  for (let index: number = source.indexOf("(", start); ; index++) {
    const character: string = source[index] as string;

    if (character === "(") {
      depth++;
    }

    if (character === ")") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

// A footer built by getStatusPageSuggestionsFooter<Model>(...).
const SUGGESTIONS_FOOTER: RegExp =
  /^getStatusPageSuggestionsFooter\s*<\s*\w+\s*>\s*\(/;

interface Picker {
  file: string;
  line: number;
  footer: string | null;
}

function listSourceFiles(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return literal.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === name
      );
    },
  ) as ts.PropertyAssignment | undefined;
}

// A status page picker: { field: { statusPages: ... }, dropdownModal: { type: StatusPage } }.
function isStatusPagePicker(literal: ts.ObjectLiteralExpression): boolean {
  const field: ts.PropertyAssignment | undefined = propertyNamed(
    literal,
    "field",
  );

  if (
    !field ||
    !ts.isObjectLiteralExpression(field.initializer) ||
    !propertyNamed(field.initializer, "statusPages")
  ) {
    return false;
  }

  const dropdownModal: ts.PropertyAssignment | undefined = propertyNamed(
    literal,
    "dropdownModal",
  );

  if (
    !dropdownModal ||
    !ts.isObjectLiteralExpression(dropdownModal.initializer)
  ) {
    return false;
  }

  const type: ts.PropertyAssignment | undefined = propertyNamed(
    dropdownModal.initializer,
    "type",
  );

  return type?.initializer.getText() === "StatusPage";
}

// The pickers in one source, named by its path under Dashboard/src.
function findPickersIn(name: string, text: string): Array<Picker> {
  const source: ts.SourceFile = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const pickers: Array<Picker> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && isStatusPagePicker(node)) {
      const footer: ts.PropertyAssignment | undefined = propertyNamed(
        node,
        "getFooterElement",
      );

      pickers.push({
        file: name,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        footer: footer ? footer.initializer.getText(source) : null,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return pickers;
}

const PICKERS: Array<Picker> = listSourceFiles(DASHBOARD_SRC).flatMap(
  (file: string): Array<Picker> => {
    return findPickersIn(
      path.relative(DASHBOARD_SRC, file).split(path.sep).join("/"),
      fs.readFileSync(file, "utf8"),
    );
  },
);

function isSuggesting(picker: Picker): boolean {
  return Boolean(picker.footer && SUGGESTIONS_FOOTER.test(picker.footer));
}

describe("status page pickers suggest the pages that show the affected monitors", () => {
  test("the scan finds the pickers it is meant to hold, so it is not vacuous", () => {
    const files: Array<string> = Array.from(
      new Set(
        PICKERS.map((picker: Picker): string => {
          return picker.file;
        }),
      ),
    ).sort();

    expect(files).toEqual(
      [
        ...Object.keys(SUGGESTING_PICKERS),
        ...Object.keys(DOES_NOT_SUGGEST),
      ].sort(),
    );
  });

  test("every scheduled maintenance and announcement picker suggests", () => {
    const problems: Array<string> = [];

    for (const picker of PICKERS) {
      if (DOES_NOT_SUGGEST[picker.file]) {
        continue;
      }

      if (!isSuggesting(picker)) {
        problems.push(
          `${picker.file}:${picker.line} - its footer is ${picker.footer || "missing"}; use getStatusPageSuggestionsFooter, or list the file in DOES_NOT_SUGGEST with the reason`,
        );
      }
    }

    expect(problems).toEqual([]);

    for (const [file, count] of Object.entries(SUGGESTING_PICKERS)) {
      expect(
        `${file}: ${
          PICKERS.filter((picker: Picker): boolean => {
            return picker.file === file && isSuggesting(picker);
          }).length
        }`,
      ).toBe(`${file}: ${count}`);
    }
  });

  test("the incident pickers, which narrow rather than add, do not suggest", () => {
    for (const picker of PICKERS) {
      if (!DOES_NOT_SUGGEST[picker.file]) {
        continue;
      }

      expect(`${picker.file}: ${isSuggesting(picker)}`).toBe(
        `${picker.file}: false`,
      );
    }
  });

  test("each picker suggests for its own kind of event", () => {
    for (const picker of PICKERS.filter(isSuggesting)) {
      const expected: string = picker.file.startsWith(
        "Components/Announcement/",
      )
        ? "StatusPageEventType.Announcement"
        : "StatusPageEventType.ScheduledEvent";

      expect(`${picker.file}:${picker.line} ${picker.footer}`).toContain(
        `eventType: ${expected}`,
      );
    }
  });

  test("every maintenance event and template form draws the one maintenance picker, for its own record", () => {
    for (const [file, model] of Object.entries(MAINTENANCE_PICKER_FORMS)) {
      expect(maintenancePickerCall(file)).toContain(
        `getMaintenanceStatusPagesFormField<${model}>({`,
      );
    }

    // The picker hands its options' monitors on to its suggestions.
    const picker: Picker | undefined = PICKERS.find((candidate: Picker) => {
      return candidate.file === MAINTENANCE_PICKER;
    });

    expect(picker?.footer).toContain("monitorsOf: options.monitorsOf");
  });

  test("the Edit dialogs that leave the resources to their own card read the monitors from the record", () => {
    // Create holds the monitors on the form itself.
    expect(
      maintenancePickerCall("Pages/ScheduledMaintenanceEvents/Create.tsx"),
    ).not.toContain("monitorsOf:");

    const view: string = maintenancePickerCall(
      "Pages/ScheduledMaintenanceEvents/View/Index.tsx",
    );

    expect(view).toContain("monitorsOf:");
    expect(view).toContain("modelType: ScheduledMaintenance");

    const template: string = maintenancePickerCall(
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
    );

    expect(template).toContain("monitorsOf:");
    expect(template).toContain("data.excludeAffectedResources");
    expect(template).toContain("modelType: ScheduledMaintenanceTemplate");

    // The template page hands its Edit the template it is showing.
    expect(
      fs.readFileSync(
        path.join(
          DASHBOARD_SRC,
          "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView.tsx",
        ),
        "utf8",
      ),
    ).toMatch(
      /getTemplateFormFields\(\{\s*isViewPage: true,\s*excludeAffectedResources: true,\s*templateId: modelId,\s*\}\)/,
    );
  });

  test("the scanner itself tells a picker from a select of status pages", () => {
    const sample: string = `
      const select = { statusPages: true, monitors: true };
      const fields = [
        {
          field: { statusPages: true },
          dropdownModal: { type: StatusPage, labelField: "name", valueField: "_id" },
          getFooterElement: getStatusPageSuggestionsFooter<X>({ eventType: StatusPageEventType.ScheduledEvent }),
        },
        {
          field: { statusPages: true },
          dropdownModal: { type: StatusPage, labelField: "name", valueField: "_id" },
        },
        {
          field: { monitors: true },
          dropdownModal: { type: Monitor, labelField: "name", valueField: "_id" },
        },
      ];
    `;
    const pickers: Array<Picker> = findPickersIn("Sample.tsx", sample);

    expect(pickers).toHaveLength(2);
    expect(pickers.map(isSuggesting)).toEqual([true, false]);
  });
});
