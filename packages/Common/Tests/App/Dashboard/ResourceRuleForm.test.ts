import { beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import {
  FILLED_IN_RULE_NAME_KEY,
  followPicksWithRuleName,
  getInheritingLabelRuleActionFields,
  getInheritingOwnerRuleActionFields,
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
  getLabelRuleName,
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
  getOwnerRuleName,
  getRuleNameAfterPick,
  INHERIT_LABELS_SECTION_ID,
  INHERIT_OWNERS_SECTION_ID,
  InheritingRuleRecord,
  isLabelPickRequired,
  isOwnerPickRequired,
  LABEL_INHERITANCE_WORDING,
  LABEL_RULE_INHERITING_LABELS_DESCRIPTION,
  LABEL_RULE_LABELS_DESCRIPTION,
  LABEL_RULE_NAME_DESCRIPTION,
  OWNER_INHERITANCE_WORDING,
  OWNER_RULE_INHERITING_OWNERS_DESCRIPTION,
  OWNER_RULE_NAME_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
  RuleInheritanceWording,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";
import {
  INHERITED_LABEL_COLUMNS,
  INHERITED_OWNER_COLUMNS,
} from "../../../UI/Components/RuleRun/RuleAction";
import Label from "../../../Models/DatabaseModels/Label";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { DropdownChange } from "../../../UI/Components/Dropdown/DropdownChange";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { OWNER_RULE_OWNERS_DESCRIPTION } from "../../../UI/Components/PeoplePicker/OwnersFormField";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The shared form of every Label Rules and Owner Rules page (Dashboard
 * Utils/Form/ResourceRuleForm): Match, then what the rule adds - required
 * of a new rule - and a name filled in from it that follows the picks until
 * somebody types a name of their own. An incident, alert or scheduled
 * maintenance rule can inherit instead, from switches folded under Inherit
 * Labels / Inherit Owners.
 *
 * Read here as plain data and functions; ResourceRuleFormsRender.test.tsx
 * drives the real pages, and Tests/UI/Components/Forms/
 * ResourceRuleFormsGuard.test.ts holds every page to the form.
 */

type Entity = Record<string, unknown>;

type KeyOfFunction = (field: Field<Entity>) => string;

const keyOf: KeyOfFunction = (field: Field<Entity>): string => {
  return Object.keys(field.field || {})[0] || "";
};

type FieldByKeyFunction = (
  fields: Array<Field<Entity>>,
  key: string,
) => Field<Entity>;

// A new rule's values: nothing picked, nothing inherited.
const NEW_RULE: FormValues<Entity> = {} as FormValues<Entity>;

type IsRequiredFunction = (
  field: Field<Entity>,
  values: FormValues<Entity>,
) => boolean;

// What BasicForm and Validation ask a field's `required`.
const isRequired: IsRequiredFunction = (
  field: Field<Entity>,
  values: FormValues<Entity>,
): boolean => {
  return typeof field.required === "function"
    ? field.required(values)
    : Boolean(field.required);
};

const fieldByKey: FieldByKeyFunction = (
  fields: Array<Field<Entity>>,
  key: string,
): Field<Entity> => {
  const field: Field<Entity> | undefined = fields.find(
    (candidate: Field<Entity>): boolean => {
      return keyOf(candidate) === key;
    },
  );

  if (!field) {
    throw new Error(`No ${key} field.`);
  }

  return field;
};

type ChangeFunction = (
  picked: Array<string>,
  before: Array<string>,
) => DropdownChange;

// What a dropdown (or the people picker) reports: the picks, by name.
const changeOf: ChangeFunction = (
  picked: Array<string>,
  before: Array<string>,
): DropdownChange => {
  return {
    selectedOptions: picked.map((name: string) => {
      return { label: name, value: `id-${name}` };
    }),
    previousOptions: before.map((name: string) => {
      return { label: name, value: `id-${name}` };
    }),
  };
};

describe("a label rule's name, after the labels it adds", () => {
  test("is empty while nothing is picked", () => {
    expect(getLabelRuleName([])).toBe("");
    expect(getLabelRuleName(["", "  "])).toBe("");
  });

  test("names every label it adds, in the order they were picked", () => {
    expect(getLabelRuleName(["production"])).toBe("Add production");
    expect(getLabelRuleName(["production", "eu-west"])).toBe(
      "Add production, eu-west",
    );
    expect(getLabelRuleName(["eu-west", "production"])).toBe(
      "Add eu-west, production",
    );
  });

  test("names each label once, without the spaces around it", () => {
    expect(getLabelRuleName(["  production ", "production", "eu-west"])).toBe(
      "Add production, eu-west",
    );
  });

  test("counts the labels that do not fit, and always fits the Name column", () => {
    const labels: Array<string> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): string => {
        return `team-${index}-production-cluster`;
      },
    );

    const name: string = getLabelRuleName(labels);

    expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name).toMatch(
      /^Add team-0-production-cluster, team-1-production-cluster(, [^,]+)* and \d+ more$/,
    );

    const shown: number = name.split(", ").length;
    expect(name).toContain(` and ${labels.length - shown} more`);
  });

  test("shortens a label too long to fit on its own", () => {
    const name: string = getLabelRuleName(["x".repeat(400)]);

    expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name.startsWith("Add xxxx")).toBe(true);
    expect(name.endsWith("…")).toBe(true);

    const withMore: string = getLabelRuleName(["y".repeat(400), "prod"]);
    expect(withMore.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(withMore).toMatch(/^Add y+… and 1 more$/);
  });

  test("fits the ShortText column every label and owner rule keeps its name in", () => {
    expect(RULE_NAME_MAX_LENGTH).toBe(ColumnLength.ShortText);
  });
});

describe("an owner rule's name, after the owners it adds", () => {
  test("names the people and teams it adds as owners", () => {
    expect(getOwnerRuleName([])).toBe("");
    expect(getOwnerRuleName(["Platform"])).toBe("Add Platform as owners");
    expect(getOwnerRuleName(["Ada Lovelace", "Platform"])).toBe(
      "Add Ada Lovelace, Platform as owners",
    );
  });

  test("counts the owners that do not fit", () => {
    const owners: Array<string> = Array.from(
      { length: 10 },
      (_value: unknown, index: number): string => {
        return `Person With A Long Name ${index}`;
      },
    );

    const name: string = getOwnerRuleName(owners);

    expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name).toMatch(/ and \d+ more as owners$/);
  });
});

describe("the name, as the picks change", () => {
  test("is filled in while it is empty", () => {
    expect(
      getRuleNameAfterPick({
        name: "",
        filledInName: undefined,
        pickedNames: ["production"],
        previousNames: [],
        makeName: getLabelRuleName,
      }),
    ).toBe("Add production");

    expect(
      getRuleNameAfterPick({
        name: undefined,
        filledInName: undefined,
        pickedNames: ["production"],
        previousNames: [],
        makeName: getLabelRuleName,
      }),
    ).toBe("Add production");
  });

  test("follows the picks while it is the form's own", () => {
    // The name the form filled in last.
    expect(
      getRuleNameAfterPick({
        name: "Add production",
        filledInName: "Add production",
        pickedNames: ["production", "eu-west"],
        previousNames: ["production"],
        makeName: getLabelRuleName,
      }),
    ).toBe("Add production, eu-west");

    // An Edit form's rule never renamed: its name is the one its picks make.
    expect(
      getRuleNameAfterPick({
        name: "Add production",
        filledInName: undefined,
        pickedNames: ["production", "eu-west"],
        previousNames: ["production"],
        makeName: getLabelRuleName,
      }),
    ).toBe("Add production, eu-west");
  });

  test("never replaces a name somebody typed", () => {
    expect(
      getRuleNameAfterPick({
        name: "Tag production hosts",
        filledInName: "Add production",
        pickedNames: ["production", "eu-west"],
        previousNames: ["production"],
        makeName: getLabelRuleName,
      }),
    ).toBeNull();

    // Nor empties it when every pick is taken away.
    expect(
      getRuleNameAfterPick({
        name: "Tag production hosts",
        filledInName: "Add production",
        pickedNames: [],
        previousNames: ["production"],
        makeName: getLabelRuleName,
      }),
    ).toBeNull();
  });

  test("is emptied with the picks it was made from, so the next pick is followed again", () => {
    expect(
      getRuleNameAfterPick({
        name: "Add production",
        filledInName: "Add production",
        pickedNames: [],
        previousNames: ["production"],
        makeName: getLabelRuleName,
      }),
    ).toBe("");
  });

  test("stays as it is when it already is the new name", () => {
    expect(
      getRuleNameAfterPick({
        name: "Add production",
        filledInName: "Add production",
        pickedNames: ["production"],
        previousNames: ["production"],
        makeName: getLabelRuleName,
      }),
    ).toBeNull();

    expect(
      getRuleNameAfterPick({
        name: "",
        filledInName: undefined,
        pickedNames: [],
        previousNames: [],
        makeName: getLabelRuleName,
      }),
    ).toBeNull();
  });
});

describe("the onChange that keeps the name following the picks", () => {
  test("fills the name in, and remembers it as the form's own", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followPicksWithRuleName<Entity>(getLabelRuleName)(
      ["id-production"],
      { name: "", criteria: { conditions: [] } } as FormValues<Entity>,
      setNewFormValues as unknown as (values: FormValues<Entity>) => void,
      changeOf(["production"], []),
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues.mock.calls[0]![0]).toEqual({
      name: "Add production",
      [FILLED_IN_RULE_NAME_KEY]: "Add production",
      // Everything else the form holds is handed back as it was.
      criteria: { conditions: [] },
    });
  });

  test("leaves a typed name alone", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followPicksWithRuleName<Entity>(getOwnerRuleName)(
      {},
      {
        name: "Database on-call",
        [FILLED_IN_RULE_NAME_KEY]: "Add Platform as owners",
      } as FormValues<Entity>,
      setNewFormValues as unknown as (values: FormValues<Entity>) => void,
      changeOf(["Platform", "Ada Lovelace"], ["Platform"]),
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("leaves the name alone when the field cannot say what was picked", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followPicksWithRuleName<Entity>(getLabelRuleName)(
      ["id-production"],
      {
        name: "Add production",
        [FILLED_IN_RULE_NAME_KEY]: "Add production",
      } as FormValues<Entity>,
      setNewFormValues as unknown as (values: FormValues<Entity>) => void,
      undefined,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });
});

describe("the label rule form", () => {
  const fields: Array<Field<Entity>> = getLabelRuleActionFields<Entity>();

  test("walks Match, then Labels", () => {
    expect(getLabelRuleFormSteps<Entity>()).toEqual([
      { title: "Match", id: "match-criteria" },
      { title: "Labels", id: "labels" },
    ]);
  });

  test("asks on its Labels step for the labels, the name, Enabled (Edit only) and the description (folded)", () => {
    expect(fields.map(keyOf)).toEqual([
      "labelsToAdd",
      "name",
      "isEnabled",
      "description",
    ]);

    for (const field of fields) {
      expect(field.stepId).toBe("labels");
    }
  });

  test("requires the labels the rule adds, picked from the project's labels", () => {
    const labels: Field<Entity> = fieldByKey(fields, "labelsToAdd");

    expect(labels.title).toBe("Labels to Add");
    expect(labels.description).toBe(LABEL_RULE_LABELS_DESCRIPTION);
    expect(isRequired(labels, NEW_RULE)).toBe(true);
    expect(labels.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(labels.dropdownModal).toEqual({
      type: Label,
      labelField: "name",
      valueField: "_id",
    });
    expect(labels.collapsibleSection).toBeUndefined();
  });

  test("requires a name that fits its column, and says it follows the labels", () => {
    const name: Field<Entity> = fieldByKey(fields, "name");

    expect(name.required).toBe(true);
    expect(name.description).toBe(LABEL_RULE_NAME_DESCRIPTION);
    expect(name.validation?.maxLength).toBe(RULE_NAME_MAX_LENGTH);
    expect(name.collapsibleSection).toBeUndefined();
  });

  test("shows Enabled on the Edit form only, and folds the description", () => {
    const enabled: Field<Entity> = fieldByKey(fields, "isEnabled");
    const description: Field<Entity> = fieldByKey(fields, "description");

    expect(enabled.doNotShowWhenCreating).toBe(true);
    expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(description.required).toBe(false);
    expect(description.collapsibleSection?.title).toBe(
      MORE_FIELDS_SECTION_TITLE,
    );
  });

  test("names the rule after the labels as they are picked", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    fieldByKey(fields, "labelsToAdd").onChange!(
      ["id-production", "id-eu-west"],
      {} as FormValues<Entity>,
      setNewFormValues as unknown as (values: FormValues<Entity>) => void,
      changeOf(["production", "eu-west"], []),
    );

    expect(setNewFormValues.mock.calls[0]![0]).toEqual({
      name: "Add production, eu-west",
      [FILLED_IN_RULE_NAME_KEY]: "Add production, eu-west",
    });
  });
});

describe("the owner rule form", () => {
  const fields: Array<Field<Entity>> = getOwnerRuleActionFields<Entity>();

  test("walks Match, then Owners", () => {
    expect(getOwnerRuleFormSteps<Entity>()).toEqual([
      { title: "Match", id: "match-criteria" },
      { title: "Owners", id: "owners" },
    ]);
  });

  test("asks on its Owners step for the owners, the name, Enabled (Edit only), Notify Owners and the description (both folded)", () => {
    expect(fields.map(keyOf)).toEqual([
      "owners",
      "name",
      "isEnabled",
      "notifyOwners",
      "description",
    ]);

    for (const field of fields) {
      expect(field.stepId).toBe("owners");
    }

    const notifyOwners: Field<Entity> = fieldByKey(fields, "notifyOwners");
    const description: Field<Entity> = fieldByKey(fields, "description");

    // One More fields section: the same section on both.
    expect(notifyOwners.collapsibleSection).toBeDefined();
    expect(notifyOwners.collapsibleSection).toBe(
      description.collapsibleSection,
    );
  });

  test("requires the people and teams it adds, in one picker", () => {
    const owners: Field<Entity> = fieldByKey(fields, "owners");

    expect(owners.title).toBe("Owners");
    expect(isRequired(owners, NEW_RULE)).toBe(true);
    expect(owners.description).toBe(OWNER_RULE_OWNERS_DESCRIPTION);
    expect(owners.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(owners.formOnly).toBe(true);
    expect(owners.peoplePicker?.kinds).toEqual([
      { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
      { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
    ]);
  });

  test("notifies owners as the server does: no default of its own, the column's applies", () => {
    const notifyOwners: Field<Entity> = fieldByKey(fields, "notifyOwners");

    expect(notifyOwners.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(notifyOwners.defaultValue).toBeUndefined();
    expect(notifyOwners.required).toBe(false);
  });

  test("requires a name, and says it follows the owners", () => {
    const name: Field<Entity> = fieldByKey(fields, "name");

    expect(name.required).toBe(true);
    expect(name.description).toBe(OWNER_RULE_NAME_DESCRIPTION);
  });

  test("names the rule after the owners as they are picked", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    fieldByKey(fields, "owners").onChange!(
      { ownerUsers: ["ada"], ownerTeams: ["platform"] },
      { name: "" } as FormValues<Entity>,
      setNewFormValues as unknown as (values: FormValues<Entity>) => void,
      changeOf(["Ada Lovelace", "Platform"], []),
    );

    expect(setNewFormValues.mock.calls[0]![0]).toEqual({
      name: "Add Ada Lovelace, Platform as owners",
      [FILLED_IN_RULE_NAME_KEY]: "Add Ada Lovelace, Platform as owners",
    });
  });
});

/*
 * Decision (follow-up of #4380): Create keeps what the rule adds required;
 * Edit does not, so a rule saved before the form asked - one that adds
 * nothing - can still be renamed, switched off or deleted.
 */
describe("a new rule, and an Edit form", () => {
  const EVERY_FORM: Array<Array<Field<Entity>>> = [
    getLabelRuleActionFields<Entity>(),
    getOwnerRuleActionFields<Entity>(),
    getInheritingLabelRuleActionFields<Entity>("incident"),
    getInheritingOwnerRuleActionFields<Entity>("alert"),
    getInheritingLabelRuleActionFields<Entity>("scheduledMaintenance"),
    getInheritingOwnerRuleActionFields<Entity>("scheduledMaintenance"),
  ];

  /*
   * ModelForm, which knows whether it creates or edits, leaves a
   * doNotRequireWhenEditing field optional on an Edit form
   * (ModelFormDoNotRequireWhenEditing.test.tsx draws both).
   */
  test("only a new rule must name what it adds: the picker is not required on Edit", () => {
    for (const fields of EVERY_FORM) {
      const picker: Field<Entity> = fields[0]!;

      expect(isRequired(picker, NEW_RULE)).toBe(true);
      expect(picker.doNotRequireWhenEditing).toBe(true);
    }
  });

  test("the name is asked of both: a rule is always called something", () => {
    for (const fields of EVERY_FORM) {
      const name: Field<Entity> = fieldByKey(fields, "name");

      expect(isRequired(name, NEW_RULE)).toBe(true);
      expect(name.doNotRequireWhenEditing).toBeUndefined();
    }
  });

  test("no other field of the step leaves its requirement to the form type", () => {
    for (const fields of EVERY_FORM) {
      expect(
        fields
          .filter((field: Field<Entity>): boolean => {
            return Boolean(field.doNotRequireWhenEditing);
          })
          .map(keyOf),
      ).toHaveLength(1);
    }
  });
});

const RECORDS: Array<InheritingRuleRecord> = [
  "incident",
  "alert",
  "scheduledMaintenance",
];

// What the switches say, for each event, as the pages used to say it.
const SWITCH_WORDING: Array<keyof RuleInheritanceWording> = [
  "monitors",
  "hosts",
  "kubernetesClusters",
  "dockerHosts",
  "podmanHosts",
  "services",
];

describe.each(RECORDS)(
  "the %s label rule form, which can inherit",
  (record: InheritingRuleRecord) => {
    const fields: Array<Field<Entity>> =
      getInheritingLabelRuleActionFields<Entity>(record);
    const wording: RuleInheritanceWording = LABEL_INHERITANCE_WORDING[record];

    test("asks for the labels, the six inherit switches, then the rest of every label rule's step", () => {
      expect(fields.map(keyOf)).toEqual([
        "labelsToAdd",
        ...INHERITED_LABEL_COLUMNS,
        "name",
        "isEnabled",
        "description",
      ]);

      for (const field of fields) {
        expect(field.stepId).toBe("labels");
      }
    });

    test("folds the six switches together under Inherit Labels, apart from More fields", () => {
      const switches: Array<Field<Entity>> = fields.slice(1, 7);
      const section: FormFieldCollapsibleSection<Entity> | undefined =
        switches[0]!.collapsibleSection;

      expect(section?.id).toBe(INHERIT_LABELS_SECTION_ID);
      expect(section?.title).toBe("Inherit Labels");
      expect(section?.description).toBe(wording.sectionDescription);
      // Not a More fields section: it opens on an Edit form that inherits.
      expect(section?.openWhenConfigured).toBeUndefined();

      for (const field of switches) {
        expect(field.collapsibleSection).toBe(section);
        expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
        expect(field.required).toBe(false);
        // Off until turned on, as the server starts them.
        expect(field.defaultValue).toBeUndefined();
      }

      expect(fieldByKey(fields, "description").collapsibleSection).not.toBe(
        section,
      );
    });

    test("says what the fold is for while nothing in it is on, and lists what is on after", () => {
      const section: FormFieldCollapsibleSection<Entity> =
        fields[1]!.collapsibleSection!;

      expect(section.getSummary!(NEW_RULE)).toEqual([
        wording.sectionDescription,
      ]);
      expect(
        section.getSummary!({
          inheritLabelsFromHosts: false,
        } as FormValues<Entity>),
      ).toEqual([wording.sectionDescription]);
      expect(
        section.getSummary!({
          inheritLabelsFromMonitors: true,
        } as FormValues<Entity>),
      ).toBeUndefined();
    });

    test("words each switch for this event, keeping the copy translators already have", () => {
      const switches: Array<Field<Entity>> = fields.slice(1, 7);

      expect(
        switches.map((field: Field<Entity>): unknown => {
          return field.description;
        }),
      ).toEqual(
        SWITCH_WORDING.map((key: keyof RuleInheritanceWording): string => {
          return wording[key];
        }),
      );

      expect(switches[0]!.title).toBe(wording.monitorsTitle);
      expect(
        switches.slice(1).map((field: Field<Entity>) => {
          return field.title;
        }),
      ).toEqual([
        "Inherit Labels From Hosts",
        "Inherit Labels From Kubernetes Clusters",
        "Inherit Labels From Docker Hosts",
        "Inherit Labels From Podman Hosts",
        "Inherit Labels From Services",
      ]);
    });

    test("a new rule must add a label, or inherit some", () => {
      const labels: Field<Entity> = fieldByKey(fields, "labelsToAdd");

      expect(labels.description).toBe(LABEL_RULE_INHERITING_LABELS_DESCRIPTION);
      expect(labels.required).toBe(isLabelPickRequired);
      expect(isRequired(labels, NEW_RULE)).toBe(true);

      for (const column of INHERITED_LABEL_COLUMNS) {
        expect(
          isRequired(labels, { [column]: true } as FormValues<Entity>),
        ).toBe(false);
      }

      // Inheriting owners is not inheriting labels.
      expect(
        isRequired(labels, {
          inheritOwnersFromMonitors: true,
        } as FormValues<Entity>),
      ).toBe(true);

      // An Edit form never insists.
      expect(labels.doNotRequireWhenEditing).toBe(true);
    });

    test("names the rule after the labels it adds, as every label rule does", () => {
      const setNewFormValues: MockFunction = getJestMockFunction();

      fieldByKey(fields, "labelsToAdd").onChange!(
        ["id-production"],
        { inheritLabelsFromMonitors: true } as FormValues<Entity>,
        setNewFormValues as unknown as (values: FormValues<Entity>) => void,
        changeOf(["production"], []),
      );

      expect(setNewFormValues.mock.calls[0]![0]).toEqual({
        inheritLabelsFromMonitors: true,
        name: "Add production",
        [FILLED_IN_RULE_NAME_KEY]: "Add production",
      });
    });
  },
);

describe.each(RECORDS)(
  "the %s owner rule form, which can inherit",
  (record: InheritingRuleRecord) => {
    const fields: Array<Field<Entity>> =
      getInheritingOwnerRuleActionFields<Entity>(record);
    const wording: RuleInheritanceWording = OWNER_INHERITANCE_WORDING[record];

    test("asks for the owners, the six inherit switches, then the rest of every owner rule's step", () => {
      expect(fields.map(keyOf)).toEqual([
        "owners",
        ...INHERITED_OWNER_COLUMNS,
        "name",
        "isEnabled",
        "notifyOwners",
        "description",
      ]);

      for (const field of fields) {
        expect(field.stepId).toBe("owners");
      }
    });

    test("folds the six switches under Inherit Owners; Notify Owners and the description under More fields", () => {
      const section: FormFieldCollapsibleSection<Entity> | undefined =
        fields[1]!.collapsibleSection;

      expect(section?.id).toBe(INHERIT_OWNERS_SECTION_ID);
      expect(section?.title).toBe("Inherit Owners");
      expect(section?.description).toBe(wording.sectionDescription);

      for (const field of fields.slice(1, 7)) {
        expect(field.collapsibleSection).toBe(section);
        expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
      }

      const moreFields: FormFieldCollapsibleSection<Entity> | undefined =
        fieldByKey(fields, "notifyOwners").collapsibleSection;

      expect(moreFields).not.toBe(section);
      expect(fieldByKey(fields, "description").collapsibleSection).toBe(
        moreFields,
      );
      expect(section!.getSummary!(NEW_RULE)).toEqual([
        wording.sectionDescription,
      ]);
      expect(
        section!.getSummary!({
          inheritOwnersFromServices: true,
        } as FormValues<Entity>),
      ).toBeUndefined();
    });

    test("words each switch for this event", () => {
      const switches: Array<Field<Entity>> = fields.slice(1, 7);

      expect(
        switches.map((field: Field<Entity>): unknown => {
          return field.description;
        }),
      ).toEqual(
        SWITCH_WORDING.map((key: keyof RuleInheritanceWording): string => {
          return wording[key];
        }),
      );
      expect(switches[0]!.title).toBe(wording.monitorsTitle);
      expect(
        switches.slice(1).map((field: Field<Entity>) => {
          return field.title;
        }),
      ).toEqual([
        "Inherit Owners From Hosts",
        "Inherit Owners From Kubernetes Clusters",
        "Inherit Owners From Docker Hosts",
        "Inherit Owners From Podman Hosts",
        "Inherit Owners From Services",
      ]);
    });

    test("a new rule must add an owner, or inherit some", () => {
      const owners: Field<Entity> = fieldByKey(fields, "owners");

      expect(owners.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
      expect(owners.description).toBe(OWNER_RULE_INHERITING_OWNERS_DESCRIPTION);
      expect(owners.required).toBe(isOwnerPickRequired);
      expect(isRequired(owners, NEW_RULE)).toBe(true);

      for (const column of INHERITED_OWNER_COLUMNS) {
        expect(
          isRequired(owners, { [column]: true } as FormValues<Entity>),
        ).toBe(false);
      }

      expect(
        isRequired(owners, {
          inheritLabelsFromMonitors: true,
        } as FormValues<Entity>),
      ).toBe(true);
      expect(owners.doNotRequireWhenEditing).toBe(true);
    });
  },
);

describe("the words of the inheriting forms", () => {
  test("an alert has one monitor, an incident and an event several", () => {
    expect(LABEL_INHERITANCE_WORDING.alert.monitorsTitle).toBe(
      "Inherit Labels From Monitor",
    );
    expect(LABEL_INHERITANCE_WORDING.incident.monitorsTitle).toBe(
      "Inherit Labels From Monitors",
    );
    expect(LABEL_INHERITANCE_WORDING.scheduledMaintenance.monitorsTitle).toBe(
      "Inherit Labels From Monitors",
    );
    expect(OWNER_INHERITANCE_WORDING.alert.monitorsTitle).toBe(
      "Inherit Owners From Monitor",
    );
    expect(OWNER_INHERITANCE_WORDING.incident.monitorsTitle).toBe(
      "Inherit Owners From Monitors",
    );
    expect(OWNER_INHERITANCE_WORDING.scheduledMaintenance.monitorsTitle).toBe(
      "Inherit Owners From Monitors",
    );
    expect(LABEL_INHERITANCE_WORDING.alert.monitors).toContain(
      "the alert's monitor ",
    );
    expect(OWNER_INHERITANCE_WORDING.alert.monitors).toContain(
      "the alert's monitor ",
    );
  });

  test("each event's sentences name that event, and no other", () => {
    const names: Record<InheritingRuleRecord, string> = {
      incident: "incident",
      alert: "alert",
      scheduledMaintenance: "event",
    };

    for (const record of RECORDS) {
      for (const wording of [
        LABEL_INHERITANCE_WORDING[record],
        OWNER_INHERITANCE_WORDING[record],
      ]) {
        const sentences: Array<string> = [
          wording.sectionDescription,
          ...SWITCH_WORDING.map((key: keyof RuleInheritanceWording): string => {
            return wording[key];
          }),
        ];

        for (const sentence of sentences) {
          expect(sentence).toContain(`the ${names[record]}`);

          for (const other of Object.values(names)) {
            if (other !== names[record]) {
              expect(sentence).not.toContain(`the ${other}`);
            }
          }
        }
      }
    }
  });
});

/*
 * The name is a whole sentence in the reader's language, the picks put
 * where its grammar wants them. The German below is a test locale keyed the
 * way Locales/en.json keys it (the plural's "other" form, plus "_one").
 */
describe("in another language", () => {
  beforeAll(async () => {
    await i18next.init({
      lng: "de",
      fallbackLng: false,
      resources: {
        de: {
          translation: {
            "Add {{labels}}": "{{labels}} hinzufügen",
            "Add {{labels}} and {{count}} more":
              "{{labels}} und {{count}} weitere hinzufügen",
            "Add {{labels}} and {{count}} more_one":
              "{{labels}} und {{count}} weiteres hinzufügen",
            "Add {{owners}} as owners": "{{owners}} als Besitzer hinzufügen",
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });
  });

  test("the name is the reader's sentence, with the picks in it", () => {
    expect(getLabelRuleName(["production", "eu-west"])).toBe(
      "production, eu-west hinzufügen",
    );
    expect(getOwnerRuleName(["Platform"])).toBe(
      "Platform als Besitzer hinzufügen",
    );
  });

  test("the count of picks left out takes the reader's plural form", () => {
    const one: string = getLabelRuleName(["a".repeat(60), "b".repeat(60)]);

    expect(one).toBe(`${"a".repeat(60)} und 1 weiteres hinzufügen`);
  });
});
