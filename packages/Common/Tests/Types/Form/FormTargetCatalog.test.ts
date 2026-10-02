import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import ColumnLength from "../../../Types/Database/ColumnLength";
import {
  FORM_DESCRIPTION_MAX_LENGTH,
  FORM_INCIDENT_TITLE_MAX_LENGTH,
  FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
  FORM_TARGET_FIELDS,
  FormTargetFieldDefinition,
  FormTargetOptionsSource,
  getFormTargetField,
  getFormTargetFields,
  getFormTargetFieldsThatMustBeAsked,
  isChoiceTargetField,
} from "../../../Types/Form/FormTargetCatalog";
import FormTargetType, {
  DEFAULT_FORM_TARGET_TYPE,
  FORM_TARGET_TYPES,
  FORM_TARGET_TYPE_TEXT,
  isFormTargetType,
  readFormTargetType,
} from "../../../Types/Form/FormTargetType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a form can create, and which fields of it a question can fill in.
 *
 * These lists are the contract between the form builder's palette, the
 * questions stored in Form.fields, the public page and the server's target
 * handlers: a key here is the record's property the answer is written to,
 * and the values of FormTargetType are stored in two tables, so they are
 * pinned exactly.
 */

type KeysFunction = (targetType: FormTargetType) => Array<string>;

const keys: KeysFunction = (targetType: FormTargetType): Array<string> => {
  return getFormTargetFields(targetType).map(
    (field: FormTargetFieldDefinition): string => {
      return field.key;
    },
  );
};

describe("FormTargetType", () => {
  test("stores exactly Incident and ScheduledMaintenance", () => {
    expect(Object.values(FormTargetType)).toEqual([
      "Incident",
      "ScheduledMaintenance",
    ]);
    expect(FORM_TARGET_TYPES).toEqual([
      FormTargetType.Incident,
      FormTargetType.ScheduledMaintenance,
    ]);
  });

  test("a form creates incidents unless someone chose otherwise", () => {
    expect(DEFAULT_FORM_TARGET_TYPE).toBe(FormTargetType.Incident);
  });

  test.each(FORM_TARGET_TYPES.map((target: FormTargetType) => {
    return [target];
  }))("%s has a title, a noun, a noun with its article and a description", (
    target: FormTargetType,
  ) => {
    const text: (typeof FORM_TARGET_TYPE_TEXT)[FormTargetType] =
      FORM_TARGET_TYPE_TEXT[target];

    expect(text.title.trim()).not.toBe("");
    expect(text.noun).toBe(text.noun.toLowerCase());
    expect(text.nounWithArticle.endsWith(text.noun)).toBe(true);
    expect(text.nounWithArticle).toMatch(/^(a|an) /);
    // A whole sentence, so the dashboard can translate it on its own.
    expect(text.description).toMatch(/^[A-Z].*\.$/);
    expect(text.description).not.toContain("{{");
  });

  test("the words are the ones the dashboard and the docs use", () => {
    expect(FORM_TARGET_TYPE_TEXT[FormTargetType.Incident]).toEqual({
      title: "Incident",
      noun: "incident",
      nounWithArticle: "an incident",
      description:
        "Each submission declares an incident, so your on-call team is told straight away. Use it for problem reports.",
    });
    expect(FORM_TARGET_TYPE_TEXT[FormTargetType.ScheduledMaintenance]).toEqual(
      {
        title: "Scheduled Maintenance",
        noun: "scheduled maintenance event",
        nounWithArticle: "a scheduled maintenance event",
        description:
          "Each submission schedules a maintenance event. Use it for change and maintenance requests.",
      },
    );
  });

  test.each([
    ["Incident", true],
    ["ScheduledMaintenance", true],
    ["incident", false],
    ["Scheduled Maintenance", false],
    ["", false],
    [null, false],
    [undefined, false],
    [1, false],
    [{}, false],
    [["Incident"], false],
  ])("isFormTargetType(%p) is %p", (value: unknown, expected: boolean) => {
    expect(isFormTargetType(value)).toBe(expected);
  });

  test("readFormTargetType keeps a stored target and reads anything else as the default", () => {
    expect(readFormTargetType("ScheduledMaintenance")).toBe(
      FormTargetType.ScheduledMaintenance,
    );
    expect(readFormTargetType("Incident")).toBe(FormTargetType.Incident);

    for (const value of [undefined, null, "", "Alert", 7, {}]) {
      expect(readFormTargetType(value)).toBe(DEFAULT_FORM_TARGET_TYPE);
    }
  });
});

describe("the incident fields", () => {
  test("are the title, description, severity, monitors, labels and impact start, in the palette's order", () => {
    expect(keys(FormTargetType.Incident)).toEqual([
      "title",
      "description",
      "incidentSeverityId",
      "monitors",
      "labels",
      "impactStartedAt",
    ]);
  });

  test("the title is a line of text the incident's column can hold", () => {
    const title: FormTargetFieldDefinition = getFormTargetField(
      FormTargetType.Incident,
      "title",
    )!;

    expect(title.inputType).toBe(CustomFieldType.Text);
    expect(title.maxLength).toBe(FORM_INCIDENT_TITLE_MAX_LENGTH);
    expect(FORM_INCIDENT_TITLE_MAX_LENGTH).toBe(ColumnLength.LongText);
    // Required by an incident, but the form's name stands in for it.
    expect(title.isRequiredByTarget).toBe(true);
    expect(title.hasDefault).toBe(true);
  });

  test("the description is Markdown, up to 20,000 characters", () => {
    const description: FormTargetFieldDefinition = getFormTargetField(
      FormTargetType.Incident,
      "description",
    )!;

    expect(description.inputType).toBe(CustomFieldType.Markdown);
    expect(description.maxLength).toBe(FORM_DESCRIPTION_MAX_LENGTH);
    expect(FORM_DESCRIPTION_MAX_LENGTH).toBe(20000);
    expect(description.isRequiredByTarget).toBe(false);
  });

  test("the severity is one choice of every severity unless narrowed", () => {
    const severity: FormTargetFieldDefinition = getFormTargetField(
      FormTargetType.Incident,
      "incidentSeverityId",
    )!;

    expect(severity.inputType).toBe(CustomFieldType.Dropdown);
    expect(severity.optionsSource).toBe(
      FormTargetOptionsSource.IncidentSeverity,
    );
    // Severities are not secret: offering all of them is fine.
    expect(severity.mustChooseOptions).toBe(false);
    expect(severity.isRequiredByTarget).toBe(true);
    // The form's settings or its template supply one.
    expect(severity.hasDefault).toBe(true);
  });

  test.each([
    ["monitors", FormTargetOptionsSource.Monitor],
    ["labels", FormTargetOptionsSource.Label],
  ])(
    "%s are a multi-select of only the records the form offers",
    (key: string, source: FormTargetOptionsSource) => {
      const field: FormTargetFieldDefinition = getFormTargetField(
        FormTargetType.Incident,
        key,
      )!;

      expect(field.inputType).toBe(CustomFieldType.MultiSelectDropdown);
      expect(field.optionsSource).toBe(source);
      expect(field.mustChooseOptions).toBe(true);
      expect(field.isRequiredByTarget).toBe(false);
    },
  );

  test("the impact start is a date and time", () => {
    const field: FormTargetFieldDefinition = getFormTargetField(
      FormTargetType.Incident,
      "impactStartedAt",
    )!;

    expect(field.inputType).toBe(CustomFieldType.DateTime);
    expect(field.optionsSource).toBeUndefined();
  });

  test("nothing must be asked: an incident form can ask nothing at all", () => {
    expect(getFormTargetFieldsThatMustBeAsked(FormTargetType.Incident)).toEqual(
      [],
    );
  });
});

describe("the scheduled maintenance fields", () => {
  test("are the title, description, start, end, monitors, status pages and labels", () => {
    expect(keys(FormTargetType.ScheduledMaintenance)).toEqual([
      "title",
      "description",
      "startsAt",
      "endsAt",
      "monitors",
      "statusPages",
      "labels",
    ]);
  });

  test("the title fits the event's shorter column", () => {
    const title: FormTargetFieldDefinition = getFormTargetField(
      FormTargetType.ScheduledMaintenance,
      "title",
    )!;

    expect(title.maxLength).toBe(FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH);
    expect(FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH).toBe(
      ColumnLength.ShortText,
    );
  });

  test("the start and the end must be asked: nothing else supplies them", () => {
    const mustBeAsked: Array<string> = getFormTargetFieldsThatMustBeAsked(
      FormTargetType.ScheduledMaintenance,
    ).map((field: FormTargetFieldDefinition): string => {
      return field.key;
    });

    expect(mustBeAsked).toEqual(["startsAt", "endsAt"]);

    for (const key of mustBeAsked) {
      const field: FormTargetFieldDefinition = getFormTargetField(
        FormTargetType.ScheduledMaintenance,
        key,
      )!;

      expect(field.inputType).toBe(CustomFieldType.DateTime);
      expect(field.isRequiredByTarget).toBe(true);
      expect(field.hasDefault).toBe(false);
    }
  });

  test("status pages are offered only as the form chooses", () => {
    const field: FormTargetFieldDefinition = getFormTargetField(
      FormTargetType.ScheduledMaintenance,
      "statusPages",
    )!;

    expect(field.optionsSource).toBe(FormTargetOptionsSource.StatusPage);
    expect(field.mustChooseOptions).toBe(true);
  });

  test("an event has no severity and no impact start", () => {
    expect(
      getFormTargetField(
        FormTargetType.ScheduledMaintenance,
        "incidentSeverityId",
      ),
    ).toBeUndefined();
    expect(
      getFormTargetField(FormTargetType.ScheduledMaintenance, "impactStartedAt"),
    ).toBeUndefined();
  });
});

describe("every field of every target", () => {
  const ALL: Array<[FormTargetType, FormTargetFieldDefinition]> = [];

  for (const target of FORM_TARGET_TYPES) {
    for (const field of getFormTargetFields(target)) {
      ALL.push([target, field]);
    }
  }

  test("each target lists its keys once", () => {
    for (const target of FORM_TARGET_TYPES) {
      expect(new Set(keys(target)).size).toBe(keys(target).length);
    }
  });

  test.each(ALL)(
    "%s / %o has whole words to show and translate",
    (_target: FormTargetType, field: FormTargetFieldDefinition) => {
      expect(field.title.trim()).not.toBe("");
      expect(field.defaultLabel.trim()).not.toBe("");
      expect(field.description).toMatch(/^[A-Z].*\.$/);

      for (const text of [
        field.title,
        field.description,
        field.defaultLabel,
        field.defaultHelpText || "",
      ]) {
        expect(text).not.toContain("{{");
      }
    },
  );

  test.each(ALL)(
    "%s / %o is answered with a type a question can have",
    (_target: FormTargetType, field: FormTargetFieldDefinition) => {
      expect([
        CustomFieldType.Text,
        CustomFieldType.Markdown,
        CustomFieldType.Dropdown,
        CustomFieldType.MultiSelectDropdown,
        CustomFieldType.DateTime,
      ]).toContain(field.inputType);

      // A field answered by choosing reads its options from a record type.
      expect(isChoiceTargetField(field)).toBe(
        field.inputType === CustomFieldType.Dropdown ||
          field.inputType === CustomFieldType.MultiSelectDropdown,
      );
      expect(Boolean(field.optionsSource)).toBe(isChoiceTargetField(field));

      if (!field.optionsSource) {
        expect(field.mustChooseOptions).toBeUndefined();
      }
    },
  );

  test("FORM_TARGET_FIELDS is what getFormTargetFields reads", () => {
    for (const target of FORM_TARGET_TYPES) {
      expect(getFormTargetFields(target)).toBe(FORM_TARGET_FIELDS[target]);
    }
  });

  test("an unknown target has no fields", () => {
    expect(getFormTargetFields("Alert" as FormTargetType)).toEqual([]);
  });

  test.each([[undefined], [null], [42], [""], ["Title"], ["nope"]])(
    "getFormTargetField finds nothing for %p",
    (key: unknown) => {
      expect(getFormTargetField(FormTargetType.Incident, key)).toBeUndefined();
    },
  );

  test("isChoiceTargetField is false for no field at all", () => {
    expect(isChoiceTargetField(undefined)).toBe(false);
  });
});

describe("the modules stay pure", () => {
  // A relative import of another pure module of Common, or nothing.
  test.each([["FormTargetType.ts"], ["FormTargetCatalog.ts"]])(
    "%s imports no React, database, server or UI code",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(__dirname, "../../../Types/Form", file),
        "utf8",
      );

      const imports: Array<string> = Array.from(
        source.matchAll(/from\s+"([^"]+)"/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      for (const specifier of imports) {
        expect(specifier).toMatch(/^\.\.?\//);
        expect(specifier).not.toMatch(/Server|UI|Models|react/);
      }
    },
  );
});
