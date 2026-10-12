import { describe, expect, test } from "@jest/globals";
import {
  HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES,
  HUNTRESS_DEFAULT_CONNECTION_NAME,
  HUNTRESS_MORE_FIELDS_SUMMARY,
  getHuntressConnectionFormFields,
  getHuntressMoreFieldsSummary,
  getHuntressPageOnCallForOptions,
  hasHuntressOnCallPolicies,
  isHuntressConnectionNameAtDefault,
  isHuntressMoreFieldsAtDefaults,
  validateHuntressWatchedOrganizations,
} from "../../FeatureSet/Dashboard/src/Pages/Incidents/Integrations/HuntressConnectionFormFields";
import {
  HUNTRESS_PAGE_ON_CALL_FOR_LABELS,
  HUNTRESS_SEVERITY_BY_RANK_LABELS,
} from "../../FeatureSet/Dashboard/src/Components/Huntress/HuntressConnectionDisplay";
import HuntressConnection from "Common/Models/DatabaseModels/HuntressConnection";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import HuntressSeverity from "Common/Types/Huntress/HuntressSeverity";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";

/*
 * Connect Huntress, and the connection's Edit Settings: one form, one page.
 * It asks the two things that decide what happens at 3 AM - who is paged,
 * and for which reports - and folds everything else under More fields,
 * with defaults whose summary line says what they do. These tests pin the
 * fields to the columns the server reads, the defaults to the model's,
 * and the fold's "left as it starts" check to what a new connection holds.
 */

type HuntressField = ModelField<HuntressConnection>;

const FIELDS: Array<HuntressField> = getHuntressConnectionFormFields();

function columnOf(field: HuntressField): string {
  const columns: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  if (columns.length !== 1) {
    throw new Error(`Expected one column, got ${JSON.stringify(columns)}.`);
  }

  return columns[0]!;
}

function fieldFor(column: string): HuntressField {
  const field: HuntressField | undefined = FIELDS.find(
    (candidate: HuntressField): boolean => {
      return columnOf(candidate) === column;
    },
  );

  if (!field) {
    throw new Error(`The Huntress form has no ${column} field.`);
  }

  return field;
}

function values(data: Record<string, unknown>): FormValues<HuntressConnection> {
  return data as unknown as FormValues<HuntressConnection>;
}

describe("the Huntress connection form", () => {
  test("asks who is paged and for which reports, then folds the rest", () => {
    expect(FIELDS.map(columnOf)).toEqual([
      "onCallDutyPolicies",
      "pageOnCallFor",
      "name",
      "criticalIncidentSeverity",
      "highIncidentSeverity",
      "lowIncidentSeverity",
      "watchedOrganizations",
      "labels",
      "resolveIncidentWhenReportCloses",
    ]);

    const open: Array<string> = FIELDS.filter((field: HuntressField) => {
      return !field.collapsibleSection;
    }).map(columnOf);

    expect(open).toEqual(["onCallDutyPolicies", "pageOnCallFor"]);
  });

  test("folds everything else into one More fields section", () => {
    const sections: Set<unknown> = new Set(
      FIELDS.filter((field: HuntressField) => {
        return Boolean(field.collapsibleSection);
      }).map((field: HuntressField) => {
        return field.collapsibleSection;
      }),
    );

    expect(sections.size).toBe(1);
  });

  test("walks no steps: three rows or fewer", () => {
    for (const field of FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(field, "stepId")).toBe(false);
    }
  });

  test("names each field as the docs and the settings card do", () => {
    expect(
      FIELDS.map((field: HuntressField): string => {
        return field.title || "";
      }),
    ).toEqual([
      "On-Call Policies",
      "Page On-Call For",
      "Name",
      "Severity For Critical Reports",
      "Severity For High Reports",
      "Severity For Low Reports",
      "Only These Organizations",
      "Labels",
      "Resolve When Huntress Closes The Report",
    ]);
  });

  test("picks on-call policies, severities and labels from the project's own", () => {
    expect(fieldFor("onCallDutyPolicies").fieldType).toBe(
      FormFieldSchemaType.MultiSelectDropdown,
    );
    expect(fieldFor("onCallDutyPolicies").dropdownModal?.type).toBe(
      OnCallDutyPolicy,
    );
    expect(fieldFor("labels").dropdownModal?.type).toBe(Label);

    for (const column of [
      "criticalIncidentSeverity",
      "highIncidentSeverity",
      "lowIncidentSeverity",
    ]) {
      expect(fieldFor(column).dropdownModal?.type).toBe(IncidentSeverity);
      expect(fieldFor(column).required).toBe(false);
    }
  });

  test("shows each severity's rank fallback as its placeholder", () => {
    expect(fieldFor("criticalIncidentSeverity").placeholder).toBe(
      HUNTRESS_SEVERITY_BY_RANK_LABELS[HuntressSeverity.Critical],
    );
    expect(fieldFor("highIncidentSeverity").placeholder).toBe(
      HUNTRESS_SEVERITY_BY_RANK_LABELS[HuntressSeverity.High],
    );
    expect(fieldFor("lowIncidentSeverity").placeholder).toBe(
      HUNTRESS_SEVERITY_BY_RANK_LABELS[HuntressSeverity.Low],
    );
  });

  test("asks Page On-Call For only once a policy is picked", () => {
    const showIf:
      | ((values: FormValues<HuntressConnection>) => boolean)
      | undefined = fieldFor("pageOnCallFor").showIf;

    expect(showIf).toBeDefined();
    expect(showIf!(values({}))).toBe(false);
    expect(showIf!(values({ onCallDutyPolicies: [] }))).toBe(false);
    expect(showIf!(values({ onCallDutyPolicies: [{ _id: "policy-1" }] }))).toBe(
      true,
    );
    expect(hasHuntressOnCallPolicies(values({ onCallDutyPolicies: [] }))).toBe(
      false,
    );
  });

  test("offers the three Page On-Call For choices, most severe first", () => {
    const options: Array<DropdownOption> = getHuntressPageOnCallForOptions();

    expect(
      options.map((option: DropdownOption) => {
        return { value: option.value, label: option.label };
      }),
    ).toEqual([
      {
        value: HuntressSeverity.Critical,
        label: HUNTRESS_PAGE_ON_CALL_FOR_LABELS[HuntressSeverity.Critical],
      },
      {
        value: HuntressSeverity.High,
        label: HUNTRESS_PAGE_ON_CALL_FOR_LABELS[HuntressSeverity.High],
      },
      {
        value: HuntressSeverity.Low,
        label: HUNTRESS_PAGE_ON_CALL_FOR_LABELS[HuntressSeverity.Low],
      },
    ]);

    for (const option of options) {
      expect(option.description).toBeTruthy();
    }
  });
});

describe("a new connection", () => {
  test("starts as the model does: named Huntress, paging for high, resolving on close", () => {
    const model: HuntressConnection = new HuntressConnection();

    expect(HUNTRESS_DEFAULT_CONNECTION_NAME).toBe("Huntress");
    expect(HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES).toEqual({
      name: "Huntress",
      pageOnCallFor: HuntressSeverity.High,
      resolveIncidentWhenReportCloses: true,
    });

    // The columns' own defaults agree, for a connection made through the API.
    expect(model.getTableColumnMetadata("pageOnCallFor").defaultValue).toBe(
      HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES.pageOnCallFor,
    );
    expect(
      model.getTableColumnMetadata("resolveIncidentWhenReportCloses")
        .defaultValue,
    ).toBe(true);
  });

  test("leaves More fields folded with a line that says what its defaults do", () => {
    expect(
      isHuntressMoreFieldsAtDefaults(HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES),
    ).toBe(true);
    expect(
      getHuntressMoreFieldsSummary(HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES),
    ).toEqual([HUNTRESS_MORE_FIELDS_SUMMARY]);
  });

  test("stops claiming defaults as soon as anything folded changes", () => {
    const changes: Array<Record<string, unknown>> = [
      { name: "Acme MSP" },
      { criticalIncidentSeverity: { _id: "sev-1" } },
      { highIncidentSeverity: { _id: "sev-2" } },
      { lowIncidentSeverity: { _id: "sev-3" } },
      { watchedOrganizations: "Acme Corp" },
      { labels: [{ _id: "label-1" }] },
      { resolveIncidentWhenReportCloses: false },
    ];

    for (const change of changes) {
      const changed: FormValues<HuntressConnection> = values({
        ...HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES,
        ...change,
      });

      expect({
        change,
        atDefaults: isHuntressMoreFieldsAtDefaults(changed),
      }).toEqual({ change, atDefaults: false });
      expect(getHuntressMoreFieldsSummary(changed)).toBeUndefined();
    }
  });

  test("counts the default name, blank or padded, as no choice of the user's", () => {
    expect(
      isHuntressConnectionNameAtDefault(values({ name: "Huntress" })),
    ).toBe(true);
    expect(
      isHuntressConnectionNameAtDefault(values({ name: "  Huntress " })),
    ).toBe(true);
    expect(isHuntressConnectionNameAtDefault(values({ name: "" }))).toBe(true);
    expect(isHuntressConnectionNameAtDefault(values({}))).toBe(true);
    expect(isHuntressConnectionNameAtDefault(values({ name: "Acme" }))).toBe(
      false,
    );
  });
});

describe("Only These Organizations", () => {
  test("takes a list of names or ids, one per line, or nothing", () => {
    expect(validateHuntressWatchedOrganizations(values({}))).toBeNull();
    expect(
      validateHuntressWatchedOrganizations(
        values({ watchedOrganizations: "Acme Corp\n42\n  Globex  " }),
      ),
    ).toBeNull();
  });

  test("refuses a list the server would refuse, with the server's words", () => {
    const tooMany: string = Array.from(
      { length: 1001 },
      (_: unknown, i: number) => {
        return `Organization ${i}`;
      },
    ).join("\n");

    expect(
      validateHuntressWatchedOrganizations(
        values({ watchedOrganizations: tooMany }),
      ),
    ).toBe("List at most 1000 organizations, one per line.");
    expect(
      validateHuntressWatchedOrganizations(
        values({ watchedOrganizations: "x".repeat(201) }),
      ),
    ).toBeTruthy();
  });

  test("is checked by the field itself", () => {
    expect(fieldFor("watchedOrganizations").customValidation).toBe(
      validateHuntressWatchedOrganizations,
    );
    expect(fieldFor("watchedOrganizations").fieldType).toBe(
      FormFieldSchemaType.LongText,
    );
  });
});
