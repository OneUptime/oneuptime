import { describe, expect, test } from "@jest/globals";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import getOwnersFormField, {
  getOwnersPeoplePickerConfig,
  OWNER_RULE_OWNERS_DESCRIPTION,
  OWNERS_ADD_BUTTON_TEXT,
  OWNERS_FORM_FIELD_KEY,
} from "../../../../UI/Components/PeoplePicker/OwnersFormField";
import {
  getPeoplePickerValueKeys,
  PeoplePickerKind,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * The one Owners field every form that asks for owners uses, in place of an
 * "Owner - Teams" and an "Owner - Users" dropdown. What it must keep: the
 * two form values the dropdowns wrote, so nothing about what is saved
 * changes; people listed before teams, as the Owners page lists them; and
 * whatever the form says about the field (its step, its help, its section).
 */

describe("getOwnersFormField", () => {
  test("is one people picker titled Owners, keyed 'owners', never sent itself", () => {
    const field: Field<IncidentTemplate> = getOwnersFormField<IncidentTemplate>(
      { stepId: "owners" },
    );

    expect(field.title).toBe("Owners");
    expect(field.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(field.field).toEqual({ [OWNERS_FORM_FIELD_KEY]: true });
    expect(OWNERS_FORM_FIELD_KEY).toBe("owners");
    // The picks travel in ownerUsers / ownerTeams; "owners" is never sent.
    expect(field.formOnly).toBe(true);
    expect(field.required).toBe(false);
    expect(field.stepId).toBe("owners");
  });

  test("keeps people in ownerUsers and teams in ownerTeams, people first", () => {
    const field: Field<MonitorOwnerRule> =
      getOwnersFormField<MonitorOwnerRule>({});

    expect(field.peoplePicker?.kinds).toEqual([
      { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
      { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
    ]);
  });

  test("says what its button and search box are for", () => {
    const field: Field<MonitorOwnerRule> =
      getOwnersFormField<MonitorOwnerRule>({});

    expect(field.peoplePicker?.addButtonText).toBe(OWNERS_ADD_BUTTON_TEXT);
    expect(OWNERS_ADD_BUTTON_TEXT).toBe("Add owner");
    expect(field.peoplePicker?.searchPlaceholder).toBe(
      "Search people or teams...",
    );
    expect(field.peoplePicker?.emptyText).toBe("No people or teams available.");
  });

  test("writes owners under other names when the form keeps them there", () => {
    const field: Field<ServiceLevelObjectiveBurnRateRule> =
      getOwnersFormField<ServiceLevelObjectiveBurnRateRule>({
        fieldKey: "alertOwners",
        usersKey: "alertOwnerUsers",
        teamsKey: "alertOwnerTeams",
        title: "Alert Owners",
      });

    expect(field.field).toEqual({ alertOwners: true });
    expect(field.title).toBe("Alert Owners");
    expect(getPeoplePickerValueKeys(field.peoplePicker!)).toEqual([
      "alertOwnerUsers",
      "alertOwnerTeams",
    ]);
  });

  test("carries what the form says about the field", () => {
    const showIf: (values: FormValues<ServiceLevelObjectiveBurnRateRule>) => boolean =
      (): boolean => {
        return true;
      };

    const field: Field<ServiceLevelObjectiveBurnRateRule> =
      getOwnersFormField<ServiceLevelObjectiveBurnRateRule>({
        stepId: "alert-details",
        description: "Who owns the alert.",
        collapsibleSection: {
          id: "alert-ownership",
          title: "Ownership & Labels",
          isConfigured: (): boolean => {
            return false;
          },
        },
        showIf,
        required: true,
      });

    expect(field.stepId).toBe("alert-details");
    expect(field.description).toBe("Who owns the alert.");
    expect(field.collapsibleSection?.id).toBe("alert-ownership");
    expect(field.showIf).toBe(showIf);
    expect(field.required).toBe(true);
  });

  test("cannot be turned into another kind of field by its options", () => {
    const field: Field<MonitorOwnerRule> = getOwnersFormField<MonitorOwnerRule>(
      {
        // Not options it takes; a caller passing them anyway changes nothing.
        ...({
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          formOnly: false,
        } as object),
      },
    );

    expect(field.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(field.formOnly).toBe(true);
  });

  test("builds a new field each time, so no form can change another's", () => {
    const first: Field<MonitorOwnerRule> =
      getOwnersFormField<MonitorOwnerRule>({});
    const second: Field<MonitorOwnerRule> =
      getOwnersFormField<MonitorOwnerRule>({});

    expect(first).not.toBe(second);
    expect(first.peoplePicker).not.toBe(second.peoplePicker);
    expect(first).toEqual(second);
  });
});

describe("the owner rules' Owners field", () => {
  test("says what happens when the rule matches", () => {
    expect(OWNER_RULE_OWNERS_DESCRIPTION).toBe(
      "When this rule matches, these people and teams are added as owners. Owners already assigned are not added twice.",
    );
  });
});

describe("getOwnersPeoplePickerConfig", () => {
  test("defaults to ownerUsers and ownerTeams", () => {
    expect(getPeoplePickerValueKeys(getOwnersPeoplePickerConfig())).toEqual([
      "ownerUsers",
      "ownerTeams",
    ]);
  });

  test("keeps a form's own names, as the Forms On Submit settings use", () => {
    expect(
      getPeoplePickerValueKeys(
        getOwnersPeoplePickerConfig({
          usersKey: "ownerUserIds",
          teamsKey: "ownerTeamIds",
        }),
      ),
    ).toEqual(["ownerUserIds", "ownerTeamIds"]);
  });
});
