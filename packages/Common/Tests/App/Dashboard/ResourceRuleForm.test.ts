import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import {
  FILLED_IN_RULE_NAME_KEY,
  followPicksWithRuleName,
  followSwitchWithRuleName,
  getFollowedRuleName,
  getInheritingLabelRuleActionFields,
  getInheritingOwnerRuleActionFields,
  getInheritingRuleName,
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
  getLabelRuleName,
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
  getOwnerRuleName,
  getRuleNameAfterPick,
  INHERIT_LABELS_SECTION_ID,
  INHERIT_OWNERS_SECTION_ID,
  INHERITED_FROM_TERMS,
  InheritingRuleRecord,
  isAnythingPicked,
  isLabelPickRequired,
  isOwnerPickRequired,
  LABEL_INHERITANCE_WORDING,
  LABEL_RULE_INHERIT_NAME_WORDING,
  LABEL_RULE_INHERITING_LABELS_DESCRIPTION,
  LABEL_RULE_INHERITING_NAME_DESCRIPTION,
  LABEL_RULE_LABELS_DESCRIPTION,
  LABEL_RULE_NAME_DESCRIPTION,
  OWNER_INHERITANCE_WORDING,
  OWNER_RULE_INHERIT_NAME_WORDING,
  OWNER_RULE_INHERITING_NAME_DESCRIPTION,
  OWNER_RULE_INHERITING_OWNERS_DESCRIPTION,
  OWNER_RULE_NAME_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
  RuleAddsKind,
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
import {
  fillTemplate,
  toSentenceTerm,
} from "../../../UI/Utils/TranslateTemplate";
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
 * A RULE THAT ONLY INHERITS IS NAMED AFTER WHAT IT INHERITS FROM.
 *
 * An incident, alert or scheduled maintenance rule may pick nothing and only
 * inherit; its name used to stay empty until somebody typed one. It is now
 * filled in from its switches, the way a rule is named after its picks -
 * "Inherit labels from monitors, hosts" - and follows them while the name is
 * still the form's own. Once something is picked, the picks name the rule.
 */

type SwitchesFunction = (kind: RuleAddsKind) => ReadonlyArray<string>;

const switchesOf: SwitchesFunction = (
  kind: RuleAddsKind,
): ReadonlyArray<string> => {
  return kind === "labels" ? INHERITED_LABEL_COLUMNS : INHERITED_OWNER_COLUMNS;
};

type SwitchedOnFunction = (
  kind: RuleAddsKind,
  on: Array<number>,
) => FormValues<Entity>;

// A form's values with the switches at these places of the list on.
const switchedOn: SwitchedOnFunction = (
  kind: RuleAddsKind,
  on: Array<number>,
): FormValues<Entity> => {
  const values: Record<string, unknown> = {};

  switchesOf(kind).forEach((column: string, index: number): void => {
    values[column] = on.includes(index);
  });

  return values as FormValues<Entity>;
};

describe("the name of a rule that only inherits", () => {
  test("is empty while no switch is on", () => {
    for (const kind of ["labels", "owners"] as Array<RuleAddsKind>) {
      for (const record of RECORDS) {
        expect(getInheritingRuleName({ kind, record, values: {} })).toBe("");
        expect(
          getInheritingRuleName({
            kind,
            record,
            values: switchedOn(kind, []),
          }),
        ).toBe("");
        expect(getInheritingRuleName({ kind, record, values: null })).toBe("");
      }
    }
  });

  test("names what one switch inherits from", () => {
    expect(
      getInheritingRuleName({
        kind: "labels",
        record: "incident",
        values: { inheritLabelsFromMonitors: true },
      }),
    ).toBe("Inherit labels from monitors");
    expect(
      getInheritingRuleName({
        kind: "owners",
        record: "scheduledMaintenance",
        values: { inheritOwnersFromServices: true },
      }),
    ).toBe("Inherit owners from services");
    expect(
      getInheritingRuleName({
        kind: "labels",
        record: "incident",
        values: { inheritLabelsFromKubernetesClusters: true },
      }),
    ).toBe("Inherit labels from Kubernetes clusters");
  });

  test("an alert inherits from its one monitor, as its switch says", () => {
    expect(
      getInheritingRuleName({
        kind: "labels",
        record: "alert",
        values: { inheritLabelsFromMonitors: true },
      }),
    ).toBe("Inherit labels from monitor");
    expect(
      getInheritingRuleName({
        kind: "owners",
        record: "alert",
        values: { inheritOwnersFromMonitors: true },
      }),
    ).toBe("Inherit owners from monitor");
  });

  test("lists every switch that is on, in the order the form shows them", () => {
    expect(
      getInheritingRuleName({
        kind: "labels",
        record: "incident",
        values: {
          inheritLabelsFromServices: true,
          inheritLabelsFromMonitors: true,
          inheritLabelsFromDockerHosts: false,
          inheritLabelsFromHosts: true,
        },
      }),
    ).toBe("Inherit labels from monitors, hosts, services");
  });

  test("names all six, and still fits the Name column", () => {
    for (const record of RECORDS) {
      for (const kind of ["labels", "owners"] as Array<RuleAddsKind>) {
        const name: string = getInheritingRuleName({
          kind,
          record,
          values: switchedOn(kind, [0, 1, 2, 3, 4, 5]),
        });

        expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
        expect(name).toBe(
          `Inherit ${kind} from ${record === "alert" ? "monitor" : "monitors"}, hosts, Kubernetes clusters, Docker hosts, Podman hosts, services`,
        );
      }
    }
  });

  test("counts a switch only when it is on", () => {
    for (const value of ["true", 1, "on", null, undefined, false]) {
      expect(
        getInheritingRuleName({
          kind: "labels",
          record: "incident",
          values: { inheritLabelsFromHosts: value },
        }),
      ).toBe("");
    }
  });

  test("reads only its own kind's switches", () => {
    expect(
      getInheritingRuleName({
        kind: "labels",
        record: "incident",
        values: switchedOn("owners", [0, 1, 2]),
      }),
    ).toBe("");
    expect(
      getInheritingRuleName({
        kind: "owners",
        record: "incident",
        values: switchedOn("labels", [0]),
      }),
    ).toBe("");
  });

  test("names each switch's source, the six of every event", () => {
    for (const record of RECORDS) {
      expect(INHERITED_FROM_TERMS[record]).toHaveLength(6);
      expect(INHERITED_FROM_TERMS[record].slice(1)).toEqual([
        "Hosts",
        "Kubernetes Clusters",
        "Docker Hosts",
        "Podman Hosts",
        "Services",
      ]);
    }

    expect(INHERITED_FROM_TERMS.incident[0]).toBe("Monitors");
    expect(INHERITED_FROM_TERMS.scheduledMaintenance[0]).toBe("Monitors");
    expect(INHERITED_FROM_TERMS.alert[0]).toBe("Monitor");
  });

  test("is worded like the picks' names: whole sentences with a slot for the list", () => {
    expect(LABEL_RULE_INHERIT_NAME_WORDING).toEqual({
      picksSlot: "sources",
      allPicks: "Inherit labels from {{sources}}",
      somePicks: {
        one: "Inherit labels from {{sources}} and {{count}} more",
        other: "Inherit labels from {{sources}} and {{count}} more",
      },
    });
    expect(OWNER_RULE_INHERIT_NAME_WORDING).toEqual({
      picksSlot: "sources",
      allPicks: "Inherit owners from {{sources}}",
      somePicks: {
        one: "Inherit owners from {{sources}} and {{count}} more",
        other: "Inherit owners from {{sources}} and {{count}} more",
      },
    });
  });
});

describe("whether a rule picks anything", () => {
  test("a label rule picks its labels", () => {
    expect(isAnythingPicked("labels", {})).toBe(false);
    expect(isAnythingPicked("labels", { labelsToAdd: [] })).toBe(false);
    expect(isAnythingPicked("labels", { labelsToAdd: null })).toBe(false);
    expect(isAnythingPicked("labels", null)).toBe(false);
    expect(isAnythingPicked("labels", { labelsToAdd: ["id-production"] })).toBe(
      true,
    );
    // An Edit form holds the rule's labels as it read them.
    expect(
      isAnythingPicked("labels", {
        labelsToAdd: [{ _id: "id-production", name: "production" }],
      }),
    ).toBe(true);
    // Owners are not labels.
    expect(isAnythingPicked("labels", { ownerUsers: ["ada"] })).toBe(false);
  });

  test("an owner rule picks its people, or its teams", () => {
    expect(isAnythingPicked("owners", {})).toBe(false);
    expect(isAnythingPicked("owners", { ownerUsers: [], ownerTeams: [] })).toBe(
      false,
    );
    expect(isAnythingPicked("owners", { ownerUsers: ["ada"] })).toBe(true);
    expect(isAnythingPicked("owners", { ownerTeams: ["platform"] })).toBe(true);
    expect(isAnythingPicked("owners", { labelsToAdd: ["id-production"] })).toBe(
      false,
    );
  });
});

describe("the name, as what the rule adds changes", () => {
  test("follows while it is the form's own, as with picks", () => {
    // Empty: filled in.
    expect(
      getFollowedRuleName({
        name: "",
        filledInName: undefined,
        previousName: "",
        nextName: "Inherit labels from monitors",
      }),
    ).toBe("Inherit labels from monitors");

    // The name the form filled in last.
    expect(
      getFollowedRuleName({
        name: "Inherit labels from monitors",
        filledInName: "Inherit labels from monitors",
        previousName: "Inherit labels from monitors",
        nextName: "Inherit labels from monitors, hosts",
      }),
    ).toBe("Inherit labels from monitors, hosts");

    // An Edit form's rule, never renamed: the name it made before.
    expect(
      getFollowedRuleName({
        name: "Inherit owners from services",
        filledInName: undefined,
        previousName: "Inherit owners from services",
        nextName: "Inherit owners from hosts, services",
      }),
    ).toBe("Inherit owners from hosts, services");
  });

  test("is emptied with the last switch, so the next one is followed again", () => {
    expect(
      getFollowedRuleName({
        name: "Inherit labels from monitors",
        filledInName: "Inherit labels from monitors",
        previousName: "Inherit labels from monitors",
        nextName: "",
      }),
    ).toBe("");
  });

  test("never replaces a name somebody typed", () => {
    expect(
      getFollowedRuleName({
        name: "Copy the monitors' labels",
        filledInName: "Inherit labels from monitors",
        previousName: "Inherit labels from monitors",
        nextName: "Inherit labels from monitors, hosts",
      }),
    ).toBeNull();
    expect(
      getFollowedRuleName({
        name: "Copy the monitors' labels",
        filledInName: undefined,
        previousName: "Inherit labels from monitors",
        nextName: "",
      }),
    ).toBeNull();
  });

  test("stays as it is when it already is the new name", () => {
    expect(
      getFollowedRuleName({
        name: "Inherit labels from hosts",
        filledInName: "Inherit labels from hosts",
        previousName: "Inherit labels from monitors",
        nextName: "Inherit labels from hosts",
      }),
    ).toBeNull();
  });
});

describe("the onChange of an Inherit switch", () => {
  type SetValuesMock = (values: FormValues<Entity>) => void;

  test("names a rule that picks nothing after the switch turned on", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followSwitchWithRuleName<Entity>({
      kind: "labels",
      record: "incident",
      column: "inheritLabelsFromMonitors",
    })(
      true,
      { name: "", criteria: { conditions: [] } } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues.mock.calls[0]![0]).toEqual({
      name: "Inherit labels from monitors",
      [FILLED_IN_RULE_NAME_KEY]: "Inherit labels from monitors",
      // Everything else the form holds is handed back as it was.
      criteria: { conditions: [] },
    });
  });

  test("adds the next switch to the name it filled in", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followSwitchWithRuleName<Entity>({
      kind: "owners",
      record: "alert",
      column: "inheritOwnersFromServices",
    })(
      true,
      {
        name: "Inherit owners from monitor",
        [FILLED_IN_RULE_NAME_KEY]: "Inherit owners from monitor",
        inheritOwnersFromMonitors: true,
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    expect(setNewFormValues.mock.calls[0]![0]).toEqual({
      name: "Inherit owners from monitor, services",
      [FILLED_IN_RULE_NAME_KEY]: "Inherit owners from monitor, services",
      inheritOwnersFromMonitors: true,
    });
  });

  test("takes a switch turned off out of the name, and empties it with the last", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followSwitchWithRuleName<Entity>({
      kind: "labels",
      record: "scheduledMaintenance",
      column: "inheritLabelsFromHosts",
    })(
      false,
      {
        name: "Inherit labels from monitors, hosts",
        [FILLED_IN_RULE_NAME_KEY]: "Inherit labels from monitors, hosts",
        inheritLabelsFromMonitors: true,
        inheritLabelsFromHosts: true,
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    expect(setNewFormValues.mock.calls[0]![0]).toMatchObject({
      name: "Inherit labels from monitors",
    });

    followSwitchWithRuleName<Entity>({
      kind: "labels",
      record: "scheduledMaintenance",
      column: "inheritLabelsFromMonitors",
    })(
      false,
      {
        name: "Inherit labels from monitors",
        [FILLED_IN_RULE_NAME_KEY]: "Inherit labels from monitors",
        inheritLabelsFromMonitors: true,
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    expect(setNewFormValues.mock.calls[1]![0]).toMatchObject({
      name: "",
      [FILLED_IN_RULE_NAME_KEY]: "",
    });
  });

  test("follows on an Edit form whose rule was never renamed", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followSwitchWithRuleName<Entity>({
      kind: "labels",
      record: "incident",
      column: "inheritLabelsFromPodmanHosts",
    })(
      true,
      {
        name: "Inherit labels from services",
        inheritLabelsFromServices: true,
        labelsToAdd: [],
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    expect(setNewFormValues.mock.calls[0]![0]).toMatchObject({
      name: "Inherit labels from Podman hosts, services",
    });
  });

  test("leaves a typed name alone", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followSwitchWithRuleName<Entity>({
      kind: "labels",
      record: "incident",
      column: "inheritLabelsFromHosts",
    })(
      true,
      {
        name: "Copy what the monitors carry",
        [FILLED_IN_RULE_NAME_KEY]: "Inherit labels from monitors",
        inheritLabelsFromMonitors: true,
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("leaves the name of a rule that picks something to its picks", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followSwitchWithRuleName<Entity>({
      kind: "labels",
      record: "incident",
      column: "inheritLabelsFromHosts",
    })(
      true,
      {
        name: "Add production",
        [FILLED_IN_RULE_NAME_KEY]: "Add production",
        labelsToAdd: ["id-production"],
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    followSwitchWithRuleName<Entity>({
      kind: "owners",
      record: "incident",
      column: "inheritOwnersFromHosts",
    })(
      true,
      {
        name: "Add Platform as owners",
        [FILLED_IN_RULE_NAME_KEY]: "Add Platform as owners",
        ownerTeams: ["platform"],
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });
});

describe("the picks of a rule that can inherit", () => {
  type SetValuesMock = (values: FormValues<Entity>) => void;

  const inheritName: (values: Record<string, unknown>) => string = (
    values: Record<string, unknown>,
  ): string => {
    return getInheritingRuleName({
      kind: "labels",
      record: "incident",
      values,
    });
  };

  test("name the rule once picked, over the name its switches gave it", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followPicksWithRuleName<Entity>(getLabelRuleName, inheritName)(
      ["id-production"],
      {
        name: "Inherit labels from monitors",
        [FILLED_IN_RULE_NAME_KEY]: "Inherit labels from monitors",
        inheritLabelsFromMonitors: true,
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
      changeOf(["production"], []),
    );

    expect(setNewFormValues.mock.calls[0]![0]).toMatchObject({
      name: "Add production",
      [FILLED_IN_RULE_NAME_KEY]: "Add production",
    });
  });

  test("taken away, give the name back to the switches", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followPicksWithRuleName<Entity>(getLabelRuleName, inheritName)(
      [],
      {
        name: "Add production",
        [FILLED_IN_RULE_NAME_KEY]: "Add production",
        inheritLabelsFromMonitors: true,
        inheritLabelsFromHosts: true,
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
      changeOf([], ["production"]),
    );

    expect(setNewFormValues.mock.calls[0]![0]).toMatchObject({
      name: "Inherit labels from monitors, hosts",
      [FILLED_IN_RULE_NAME_KEY]: "Inherit labels from monitors, hosts",
    });
  });

  test("taken away with no switch on, empty the name as before", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followPicksWithRuleName<Entity>(getLabelRuleName, inheritName)(
      [],
      {
        name: "Add production",
        [FILLED_IN_RULE_NAME_KEY]: "Add production",
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
      changeOf([], ["production"]),
    );

    expect(setNewFormValues.mock.calls[0]![0]).toMatchObject({ name: "" });
  });

  test("never replace a name somebody typed", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();

    followPicksWithRuleName<Entity>(getLabelRuleName, inheritName)(
      ["id-production"],
      {
        name: "Production incidents",
        [FILLED_IN_RULE_NAME_KEY]: "Inherit labels from monitors",
        inheritLabelsFromMonitors: true,
      } as FormValues<Entity>,
      setNewFormValues as unknown as SetValuesMock,
      changeOf(["production"], []),
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });
});

describe.each(RECORDS)(
  "the %s forms, which can inherit, name a rule after its switches",
  (record: InheritingRuleRecord) => {
    type SetValuesMock = (values: FormValues<Entity>) => void;

    test.each([
      [
        "labels",
        (): Array<Field<Entity>> => {
          return getInheritingLabelRuleActionFields<Entity>(record);
        },
      ],
      [
        "owners",
        (): Array<Field<Entity>> => {
          return getInheritingOwnerRuleActionFields<Entity>(record);
        },
      ],
    ] as Array<[RuleAddsKind, () => Array<Field<Entity>>]>)(
      "every %s switch names the rule as it turns on",
      (kind: RuleAddsKind, fieldsOf: () => Array<Field<Entity>>) => {
        const fields: Array<Field<Entity>> = fieldsOf();

        switchesOf(kind).forEach((column: string, index: number): void => {
          const setNewFormValues: MockFunction = getJestMockFunction();
          const switchField: Field<Entity> = fieldByKey(fields, column);

          expect(switchField.onChange).toBeDefined();

          switchField.onChange!(
            true,
            {} as FormValues<Entity>,
            setNewFormValues as unknown as SetValuesMock,
          );

          const source: string = INHERITED_FROM_TERMS[record][index]!;
          const inSentence: string = source
            .split(" ")
            .map((word: string): string => {
              return ["Kubernetes", "Docker", "Podman"].includes(word)
                ? word
                : word.toLowerCase();
            })
            .join(" ");

          expect(setNewFormValues.mock.calls[0]![0]).toEqual({
            name: `Inherit ${kind} from ${inSentence}`,
            [FILLED_IN_RULE_NAME_KEY]: `Inherit ${kind} from ${inSentence}`,
          });
        });
      },
    );

    test("the name says it follows what is inherited too", () => {
      expect(
        fieldByKey(getInheritingLabelRuleActionFields<Entity>(record), "name")
          .description,
      ).toBe(LABEL_RULE_INHERITING_NAME_DESCRIPTION);
      expect(
        fieldByKey(getInheritingOwnerRuleActionFields<Entity>(record), "name")
          .description,
      ).toBe(OWNER_RULE_INHERITING_NAME_DESCRIPTION);
    });

    test("taking every label away names the rule after its switches", () => {
      const setNewFormValues: MockFunction = getJestMockFunction();

      fieldByKey(
        getInheritingLabelRuleActionFields<Entity>(record),
        "labelsToAdd",
      ).onChange!(
        [],
        {
          name: "Add production",
          [FILLED_IN_RULE_NAME_KEY]: "Add production",
          inheritLabelsFromServices: true,
        } as FormValues<Entity>,
        setNewFormValues as unknown as SetValuesMock,
        changeOf([], ["production"]),
      );

      expect(setNewFormValues.mock.calls[0]![0]).toMatchObject({
        name: "Inherit labels from services",
      });
    });

    test("taking every owner away names the rule after its switches", () => {
      const setNewFormValues: MockFunction = getJestMockFunction();

      fieldByKey(getInheritingOwnerRuleActionFields<Entity>(record), "owners")
        .onChange!(
        { ownerUsers: [], ownerTeams: [] },
        {
          name: "Add Platform as owners",
          [FILLED_IN_RULE_NAME_KEY]: "Add Platform as owners",
          inheritOwnersFromHosts: true,
        } as FormValues<Entity>,
        setNewFormValues as unknown as SetValuesMock,
        changeOf([], ["Platform"]),
      );

      expect(setNewFormValues.mock.calls[0]![0]).toMatchObject({
        name: "Inherit owners from hosts",
      });
    });
  },
);

describe("the forms that cannot inherit", () => {
  test("keep their name's help about what they add", () => {
    expect(
      fieldByKey(getLabelRuleActionFields<Entity>(), "name").description,
    ).toBe(LABEL_RULE_NAME_DESCRIPTION);
    expect(
      fieldByKey(getOwnerRuleActionFields<Entity>(), "name").description,
    ).toBe(OWNER_RULE_NAME_DESCRIPTION);
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
            "Inherit labels from {{sources}}":
              "Beschriftungen erben von: {{sources}}",
            "Inherit labels from {{sources}} and {{count}} more":
              "Beschriftungen erben von: {{sources}} und {{count}} weitere",
            "Inherit labels from {{sources}} and {{count}} more_one":
              "Beschriftungen erben von: {{sources}} und {{count}} weitere",
            Monitors: "Monitore",
            Hosts: "Hosts",
            "Kubernetes Clusters":
              "Kubernetes-Cluster mit einer sehr langen Bezeichnung",
            "Docker Hosts": "Docker-Hosts mit einer sehr langen Bezeichnung",
            "Podman Hosts": "Podman-Hosts",
            Services: "Dienste",
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

  test("a rule that only inherits is named in the reader's words, sources too", () => {
    expect(
      getInheritingRuleName({
        kind: "labels",
        record: "incident",
        values: {
          inheritLabelsFromMonitors: true,
          inheritLabelsFromHosts: true,
        },
      }),
    ).toBe("Beschriftungen erben von: Monitore, Hosts");
  });

  test("the sources left out are counted, and the name fits its column", () => {
    const name: string = getInheritingRuleName({
      kind: "labels",
      record: "incident",
      values: switchedOn("labels", [0, 1, 2, 3, 4, 5]),
    });

    expect(name.length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name).toMatch(
      /^Beschriftungen erben von: Monitore, Hosts(, [^,]+)* und \d+ weitere$/,
    );
  });

  /*
   * The owners' sentence has no German wording in this locale: the name is
   * English, its sources too - never German words in an English sentence.
   */
  test("a sentence the language has no wording for stays wholly English", () => {
    expect(
      getInheritingRuleName({
        kind: "owners",
        record: "incident",
        values: {
          inheritOwnersFromMonitors: true,
          inheritOwnersFromServices: true,
        },
      }),
    ).toBe("Inherit owners from monitors, services");
  });
});

/*
 * With the Dashboard's own locale files: every language words both names,
 * keeps the {{sources}} slot, and fills it with its own words for what is
 * inherited from, cased for the middle of its sentence.
 */
describe("in every language the Dashboard ships", () => {
  const LOCALES_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  type LocaleFunction = (code: string) => Record<string, string>;

  const readLocale: LocaleFunction = (code: string): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIRECTORY, `${code}.json`), "utf8"),
    ) as Record<string, string>;
  };

  const LANGUAGES: Array<string> = fs
    .readdirSync(LOCALES_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    })
    .sort();

  const NAME_KEYS: Array<string> = [
    LABEL_RULE_INHERIT_NAME_WORDING.allPicks,
    LABEL_RULE_INHERIT_NAME_WORDING.somePicks.other,
    OWNER_RULE_INHERIT_NAME_WORDING.allPicks,
    OWNER_RULE_INHERIT_NAME_WORDING.somePicks.other,
  ];

  test("covers all sixteen", () => {
    expect(LANGUAGES).toHaveLength(16);
  });

  test.each(LANGUAGES)(
    "%s words both names, keeping the list's slot",
    (code: string) => {
      const locale: Record<string, string> = readLocale(code);

      for (const key of NAME_KEYS) {
        const wording: string | undefined = locale[key];

        expect({ code, key, translated: wording !== key }).toEqual({
          code,
          key,
          translated: true,
        });
        expect(wording).toContain("{{sources}}");
      }

      for (const key of [
        LABEL_RULE_INHERITING_NAME_DESCRIPTION,
        OWNER_RULE_INHERITING_NAME_DESCRIPTION,
      ]) {
        expect({ code, key, translated: locale[key] !== key }).toEqual({
          code,
          key,
          translated: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s names a rule that only inherits in its own words",
    async (code: string) => {
      const locale: Record<string, string> = readLocale(code);

      if (!i18next.isInitialized) {
        await i18next.init({
          fallbackLng: false,
          keySeparator: false,
          nsSeparator: false,
          interpolation: { escapeValue: false },
        });
      }

      i18next.addResourceBundle(code, "translation", locale, true, true);
      await i18next.changeLanguage(code);

      const sourceIn: (term: string) => string = (term: string): string => {
        return toSentenceTerm(locale[term] || term, code);
      };

      expect(
        getInheritingRuleName({
          kind: "labels",
          record: "incident",
          values: {
            inheritLabelsFromMonitors: true,
            inheritLabelsFromHosts: true,
          },
        }),
      ).toBe(
        fillTemplate(locale["Inherit labels from {{sources}}"]!, {
          sources: `${sourceIn("Monitors")}, ${sourceIn("Hosts")}`,
        }),
      );

      expect(
        getInheritingRuleName({
          kind: "owners",
          record: "alert",
          values: { inheritOwnersFromMonitors: true },
        }),
      ).toBe(
        fillTemplate(locale["Inherit owners from {{sources}}"]!, {
          sources: sourceIn("Monitor"),
        }),
      );
    },
  );
});
