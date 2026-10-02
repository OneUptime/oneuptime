import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import UptimePrecision from "../../../../Types/StatusPage/UptimePrecision";
import type { ModelField } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Field from "../../../../UI/Components/ModelDetail/Field";
import getOwnersFormField from "../../../../UI/Components/PeoplePicker/OwnersFormField";
import { getRuleCriteriaSummaryText } from "../../../../UI/Components/RuleCriteria/RuleCriteriaSummary";
import { getLegacyRuleCriteriaFields } from "../../../../UI/Components/RuleCriteria/RuleCriteriaModelForm";
import getRuleDetailFields, {
  RuleDetailFields,
} from "../../../../UI/Components/RuleRun/RuleDetailFields";
import FieldType from "../../../../UI/Components/Types/FieldType";
import DropdownUtil from "../../../../UI/Utils/Dropdown";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import { ReactElement } from "react";

/*
 * Contract under test - a rule's view page shows what its form edits.
 *
 * The detail fields are derived from the form fields rather than written a
 * second time for each of ~60 rule kinds. What has to hold: every field the
 * form edits is shown, in the form's order; match criteria appear once, as the
 * same summary the table shows, in place of the legacy criteria inputs; each
 * relation selects what it renders (a label's colour, a user's email when it
 * has no name); and nothing selects a column its model does not have.
 *
 * Owners are one people picker in the form - people and teams together - so
 * they are one Owners field on the view page too, not a list per kind.
 */

function titles<
  T extends MonitorOwnerRule | MonitorLabelRule | StatusPageMonitorRule,
>(detail: RuleDetailFields<T>): Array<string | undefined> {
  return detail.fields.map((field: Field<T>) => {
    return field.title;
  });
}

function fieldTitled<
  T extends MonitorOwnerRule | MonitorLabelRule | StatusPageMonitorRule,
>(detail: RuleDetailFields<T>, title: string): Field<T> {
  const field: Field<T> | undefined = detail.fields.find(
    (candidate: Field<T>) => {
      return candidate.title === title;
    },
  );

  if (!field) {
    throw new Error(`No detail field titled ${title}`);
  }

  return field;
}

function renderElement<T extends BaseModel>(
  field: Field<T>,
  item: T,
): HTMLElement {
  return render(field.getElement!(item) as ReactElement).container;
}

const OWNER_FORM: Array<ModelField<MonitorOwnerRule>> = [
  {
    field: { name: true },
    title: "Name",
    stepId: "basic-info",
    fieldType: FormFieldSchemaType.Text,
  },
  {
    field: { description: true },
    title: "Description",
    stepId: "basic-info",
    fieldType: FormFieldSchemaType.LongText,
  },
  {
    field: { isEnabled: true },
    title: "Enabled",
    stepId: "basic-info",
    fieldType: FormFieldSchemaType.Toggle,
  },
  {
    field: { notifyOwners: true },
    title: "Notify Owners",
    stepId: "basic-info",
    fieldType: FormFieldSchemaType.Toggle,
  },
  {
    field: { monitorLabels: true },
    title: "Monitor Labels",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
  },
  {
    field: { monitorNamePattern: true },
    title: "Monitor Name Pattern",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
  },
  getOwnersFormField<MonitorOwnerRule>({ stepId: "owners" }),
];

describe("getRuleDetailFields", () => {
  it("shows every form field in order, with criteria collapsed into one summary", () => {
    const detail: RuleDetailFields<MonitorOwnerRule> = getRuleDetailFields({
      model: new MonitorOwnerRule(),
      formFields: OWNER_FORM,
    });

    expect(titles(detail)).toEqual([
      "Name",
      "Description",
      "Enabled",
      "Notify Owners",
      "Match Criteria",
      "Owners",
    ]);

    expect(
      detail.fields.map((field: Field<MonitorOwnerRule>) => {
        return field.fieldType;
      }),
    ).toEqual([
      FieldType.Text,
      FieldType.LongText,
      FieldType.Boolean,
      FieldType.Boolean,
      FieldType.Element,
      FieldType.Element,
    ]);
  });

  it("selects what every field renders, including the criteria summary's inputs", () => {
    const detail: RuleDetailFields<MonitorOwnerRule> = getRuleDetailFields({
      model: new MonitorOwnerRule(),
      formFields: OWNER_FORM,
    });

    expect(detail.selectMoreFields).toEqual({
      name: true,
      description: true,
      isEnabled: true,
      notifyOwners: true,
      criteria: true,
      monitorLabels: true,
      monitorNamePattern: true,
      // Everything a chip shows: the name, a person's email and picture.
      ownerUsers: { _id: true, name: true, email: true, profilePictureId: true },
      ownerTeams: { _id: true, name: true },
    });
  });

  it("renders the same criteria summary the rule table shows", () => {
    const detail: RuleDetailFields<MonitorOwnerRule> = getRuleDetailFields({
      model: new MonitorOwnerRule(),
      formFields: OWNER_FORM,
    });

    const rule: MonitorOwnerRule = new MonitorOwnerRule();
    rule.monitorNamePattern = "prod-.*";

    const expected: string = getRuleCriteriaSummaryText({
      fields: getLegacyRuleCriteriaFields(OWNER_FORM),
      item: rule,
    });

    expect(expected).not.toBe("Matches all resources");
    expect(
      renderElement(fieldTitled(detail, "Match Criteria"), rule),
    ).toHaveTextContent(expected);
  });

  it("names every owner in one list, people then teams, a user by email when unnamed, and None for none", () => {
    const detail: RuleDetailFields<MonitorOwnerRule> = getRuleDetailFields({
      model: new MonitorOwnerRule(),
      formFields: OWNER_FORM,
    });

    const named: User = new User();
    named._id = "0000000e-0000-4000-8000-000000000001";
    named.name = "Ada Lovelace" as never;
    const unnamed: User = new User();
    unnamed._id = "0000000e-0000-4000-8000-000000000002";
    unnamed.email = "bob@example.com" as never;
    const team: Team = new Team();
    team._id = "0000000b-0000-4000-8000-000000000001";
    team.name = "Platform";

    const rule: MonitorOwnerRule = new MonitorOwnerRule();
    rule.ownerTeams = [team];
    rule.ownerUsers = [named, unnamed];

    const element: HTMLElement = renderElement(
      fieldTitled(detail, "Owners"),
      rule,
    );
    const chips: Array<Element> = Array.from(
      element.querySelectorAll('[data-testid="people-chip"]'),
    );

    expect(
      chips.map((chip: Element): string | null => {
        return chip.getAttribute("data-kind");
      }),
    ).toEqual(["user", "user", "team"]);
    expect(chips[0]).toHaveTextContent("Ada Lovelace");
    expect(chips[1]).toHaveTextContent("bob@example.com");
    expect(chips[2]).toHaveTextContent("Platform");
    // Nothing to remove on a view page: Edit is where owners change.
    expect(element.querySelector("button")).toBeNull();

    expect(
      renderElement(fieldTitled(detail, "Owners"), new MonitorOwnerRule()),
    ).toHaveTextContent("None");
  });

  it("follows the picker's own title and step condition", () => {
    const detail: RuleDetailFields<MonitorOwnerRule> = getRuleDetailFields({
      model: new MonitorOwnerRule(),
      formFields: [
        getOwnersFormField<MonitorOwnerRule>({
          title: "Assign To",
          showIf: (values: FormValues<MonitorOwnerRule>): boolean => {
            return Boolean(values.notifyOwners);
          },
        }),
      ],
    });

    const field: Field<MonitorOwnerRule> = fieldTitled(detail, "Assign To");
    const rule: MonitorOwnerRule = new MonitorOwnerRule();

    expect(field.showIf!(rule)).toBe(false);
    rule.notifyOwners = true;
    expect(field.showIf!(rule)).toBe(true);
  });

  it("adds nothing for a picker whose values are not columns of the rule", () => {
    const detail: RuleDetailFields<MonitorLabelRule> = getRuleDetailFields({
      model: new MonitorLabelRule(),
      formFields: [getOwnersFormField<MonitorLabelRule>({})],
    });

    expect(detail.fields).toEqual([]);
    expect(detail.selectMoreFields).toEqual({});
  });

  it("still names the rows of a relation dropdown that is not a picker", () => {
    const detail: RuleDetailFields<MonitorOwnerRule> = getRuleDetailFields({
      model: new MonitorOwnerRule(),
      formFields: [
        {
          field: { ownerTeams: true },
          title: "Teams",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: { type: Team, labelField: "name", valueField: "_id" },
        },
        {
          field: { ownerUsers: true },
          title: "Users",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          fetchDropdownOptions: async () => {
            return [];
          },
        },
      ],
    });

    expect(detail.selectMoreFields).toEqual({
      ownerTeams: { name: true },
      ownerUsers: { name: true, email: true },
    });

    const named: User = new User();
    named.name = "Ada Lovelace" as never;
    const unnamed: User = new User();
    unnamed.email = "bob@example.com" as never;

    const rule: MonitorOwnerRule = new MonitorOwnerRule();
    rule.ownerUsers = [named, unnamed];

    expect(renderElement(fieldTitled(detail, "Users"), rule)).toHaveTextContent(
      "Ada Lovelace, bob@example.com",
    );
    expect(renderElement(fieldTitled(detail, "Teams"), rule)).toHaveTextContent(
      "None",
    );
  });

  it("renders labels to add as labels, selecting their colour", () => {
    const detail: RuleDetailFields<MonitorLabelRule> = getRuleDetailFields({
      model: new MonitorLabelRule(),
      formFields: [
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
        },
      ],
    });

    expect(detail.selectMoreFields).toEqual({
      labelsToAdd: { name: true, color: true },
    });

    const label: Label = new Label();
    label.name = "production";
    const rule: MonitorLabelRule = new MonitorLabelRule();
    rule.labelsToAdd = [label];

    expect(
      renderElement(fieldTitled(detail, "Labels to Add"), rule),
    ).toHaveTextContent("production");
  });

  it("adds no criteria summary to a form without match criteria", () => {
    const detail: RuleDetailFields<MonitorLabelRule> = getRuleDetailFields({
      model: new MonitorLabelRule(),
      formFields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
        },
      ],
    });

    expect(titles(detail)).toEqual(["Name"]);
    expect(detail.selectMoreFields).toEqual({ name: true });
  });

  it("renders a status page rule's group, uptime precision and conditional fields", () => {
    const detail: RuleDetailFields<StatusPageMonitorRule> = getRuleDetailFields(
      {
        model: new StatusPageMonitorRule(),
        formFields: [
          {
            field: { statusPageGroup: true },
            title: "Add Monitors To Group",
            stepId: "group",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: async () => {
              return [];
            },
          },
          {
            field: { showUptimePercent: true },
            title: "Show Uptime %",
            stepId: "advanced",
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: { uptimePercentPrecision: true },
            title: "Select Uptime Precision",
            stepId: "advanced",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
            showIf: (item: FormValues<StatusPageMonitorRule>): boolean => {
              return Boolean(item.showUptimePercent);
            },
          },
          {
            field: { name: true },
            title: "Custom",
            fieldType: FormFieldSchemaType.CustomComponent,
          },
        ],
      },
    );

    expect(titles(detail)).toEqual([
      "Add Monitors To Group",
      "Show Uptime %",
      "Select Uptime Precision",
    ]);
    expect(detail.selectMoreFields).toEqual({
      statusPageGroup: { name: true },
      showUptimePercent: true,
      uptimePercentPrecision: true,
    });

    const rule: StatusPageMonitorRule = new StatusPageMonitorRule();
    rule.statusPageGroup = { name: "Core Platform" } as never;
    rule.uptimePercentPrecision = UptimePrecision.ONE_DECIMAL;

    expect(
      renderElement(fieldTitled(detail, "Add Monitors To Group"), rule),
    ).toHaveTextContent("Core Platform");
    expect(
      renderElement(fieldTitled(detail, "Select Uptime Precision"), rule),
    ).toHaveTextContent(String(UptimePrecision.ONE_DECIMAL));

    const precision: Field<StatusPageMonitorRule> = fieldTitled(
      detail,
      "Select Uptime Precision",
    );
    expect(precision.showIf!(rule)).toBe(false);
    rule.showUptimePercent = true;
    expect(precision.showIf!(rule)).toBe(true);
  });
});
