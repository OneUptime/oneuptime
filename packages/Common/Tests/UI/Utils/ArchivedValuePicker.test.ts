import ArchivedValuePicker, {
  ARCHIVED_VALUE_TAG,
} from "../../../UI/Utils/ArchivedValuePicker";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Team from "../../../Models/DatabaseModels/Team";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What every picker of a state, a severity, a monitor status, a label or
 * an incident role reads its choices with: the values that are not
 * archived, and - in a record's own form - an archived value it already
 * has, shown and marked, never offered again.
 */

const LIVE: string = "0193c0de-1111-4111-8111-000000000001";
const ARCHIVED: string = "0193c0de-1111-4111-8111-000000000002";
const OTHER_ARCHIVED: string = "0193c0de-1111-4111-8111-000000000003";

describe("which models' pickers are narrowed", () => {
  test("the eight values records pick from", () => {
    for (const modelType of [
      IncidentState,
      IncidentSeverity,
      AlertState,
      AlertSeverity,
      MonitorStatus,
      ScheduledMaintenanceState,
      Label,
      IncidentRole,
    ]) {
      expect(ArchivedValuePicker.isArchivableValueModel(modelType)).toBe(true);
    }
  });

  test("not other models, even archivable resources, and not nothing", () => {
    expect(ArchivedValuePicker.isArchivableValueModel(Monitor)).toBe(false);
    expect(ArchivedValuePicker.isArchivableValueModel(Team)).toBe(false);
    expect(ArchivedValuePicker.isArchivableValueModel(undefined)).toBe(false);
    expect(ArchivedValuePicker.isArchivableValueModel(null)).toBe(false);
  });
});

describe("the query a picker lists with", () => {
  test("a value's picker lists the live values, beside the caller's own query", () => {
    expect(
      ArchivedValuePicker.getPickerQuery(Label, { projectId: "p" }),
    ).toEqual({ projectId: "p", isArchived: false });
    expect(
      ArchivedValuePicker.getPickerQuery(IncidentState, undefined),
    ).toEqual({ isArchived: false });
  });

  test("a caller that says which keeps its say: a list of archived values", () => {
    expect(
      ArchivedValuePicker.getPickerQuery(Label, { isArchived: true }),
    ).toEqual({ isArchived: true });
  });

  test("any other model's query is left as it is", () => {
    const query: Record<string, unknown> = { projectId: "p" };

    expect(ArchivedValuePicker.getPickerQuery(Monitor, query)).toBe(query);
    expect(ArchivedValuePicker.getPickerQuery(Monitor, null)).toEqual({});
  });

  test("the caller's query is not changed", () => {
    const query: Record<string, unknown> = { projectId: "p" };

    ArchivedValuePicker.getPickerQuery(Label, query);

    expect(query).toEqual({ projectId: "p" });
  });

  test("a selected value is read with its archive switch, for a value model only", () => {
    expect(ArchivedValuePicker.getSelectedValueSelect(IncidentRole)).toEqual({
      isArchived: true,
    });
    expect(ArchivedValuePicker.getSelectedValueSelect(Monitor)).toEqual({});
  });
});

describe("telling an archived value", () => {
  test("off a model and off its JSON", () => {
    const label: Label = new Label();
    label.isArchived = true;

    expect(ArchivedValuePicker.isArchived(label)).toBe(true);
    expect(ArchivedValuePicker.isArchived({ isArchived: true })).toBe(true);
  });

  test("a live one, one read without the switch, and what is not a value", () => {
    const label: Label = new Label();
    label.isArchived = false;

    expect(ArchivedValuePicker.isArchived(label)).toBe(false);
    expect(ArchivedValuePicker.isArchived(new Label())).toBe(false);
    expect(ArchivedValuePicker.isArchived({ isArchived: "true" })).toBe(false);
    expect(ArchivedValuePicker.isArchived(null)).toBe(false);
    expect(ArchivedValuePicker.isArchived("Label")).toBe(false);
  });

  test("the live values of a list, in their order", () => {
    expect(
      ArchivedValuePicker.getLiveValues([
        { _id: "a", isArchived: false },
        { _id: "b", isArchived: true },
        { _id: "c" },
      ]),
    ).toEqual([{ _id: "a", isArchived: false }, { _id: "c" }]);
  });
});

describe("a picker's options", () => {
  const values: Array<Record<string, unknown>> = [
    { _id: LIVE, isArchived: false },
    { _id: ARCHIVED, isArchived: true },
    { _id: OTHER_ARCHIVED, isArchived: true },
  ];

  const options: Array<DropdownOption> = [
    { value: LIVE, label: "Critical" },
    { value: ARCHIVED, label: "[DONOTUSE] Very critical" },
    { value: OTHER_ARCHIVED, label: "Old" },
  ];

  test("only the live values for a new choice", () => {
    expect(ArchivedValuePicker.getPickerOptions({ values, options })).toEqual([
      { value: LIVE, label: "Critical" },
    ]);
  });

  test("an archived value the record keeps is shown, marked Archived, never offered", () => {
    /*
     * Marked by isArchived alone: the dropdown draws the Archived tag beside
     * its name (ArchivedTag), so no description says it a second time.
     */
    expect(
      ArchivedValuePicker.getPickerOptions({
        values,
        options,
        keptIds: [ARCHIVED.toUpperCase()],
      }),
    ).toEqual([
      { value: LIVE, label: "Critical" },
      {
        value: ARCHIVED,
        label: "[DONOTUSE] Very critical",
        isArchived: true,
        isDisabled: true,
      },
    ]);
    expect(ARCHIVED_VALUE_TAG).toBe("Archived");
  });

  test("an option with no value read is left as it is", () => {
    expect(
      ArchivedValuePicker.getPickerOptions({
        values: [],
        options: [{ value: "x", label: "Unknown" }],
      }),
    ).toEqual([{ value: "x", label: "Unknown" }]);
  });
});

describe("the ids a saved record names", () => {
  test("found anywhere in it, whatever their case", () => {
    expect(
      ArchivedValuePicker.getIdsNamedIn(
        {
          criteria: [{ incidents: [{ incidentSeverityId: ARCHIVED }] }],
          monitorStatusId: { _type: "ObjectID", value: LIVE.toUpperCase() },
        },
        [ARCHIVED, LIVE, OTHER_ARCHIVED],
      ),
    ).toEqual([ARCHIVED, LIVE]);
  });

  test("nothing in nothing", () => {
    expect(ArchivedValuePicker.getIdsNamedIn(undefined, [LIVE])).toEqual([]);
    expect(ArchivedValuePicker.getIdsNamedIn(null, [LIVE])).toEqual([]);
    expect(ArchivedValuePicker.getIdsNamedIn({ a: 1 }, ["", LIVE])).toEqual([]);
  });

  test("a record that can't be read as JSON names nothing", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(ArchivedValuePicker.getIdsNamedIn(circular, [LIVE])).toEqual([]);
  });
});

/*
 * A new record made from another one - a Duplicate - takes only the values a
 * new record may have: an archived label (state, status) stays with the
 * record it is on. The server would refuse the copy for it.
 */
describe("a new record made from another one", () => {
  const LIVE_LABEL: string = "5e000000-0000-4000-8000-0000000000a1";
  const ARCHIVED_LABEL: string = "5e000000-0000-4000-8000-0000000000a2";
  const SEVERITY: string = "5e000000-0000-4000-8000-0000000000b1";

  const label: (id: string, isArchived: boolean) => Label = (
    id: string,
    isArchived: boolean,
  ): Label => {
    const value: Label = new Label();
    value._id = id;
    value.name = id === LIVE_LABEL ? "payments" : "legacy-db";
    value.isArchived = isArchived;
    return value;
  };

  test("the original is read with the archive switch beside every value it copies", () => {
    expect(
      ArchivedValuePicker.getCopySelect(Monitor, {
        description: true,
        monitorSteps: true,
        labels: true,
      }),
    ).toEqual({
      description: true,
      monitorSteps: true,
      labels: { _id: true, isArchived: true },
    });
  });

  test("a relation's own columns stay beside the switch, a single relation too", () => {
    expect(
      ArchivedValuePicker.getCopySelect(IncidentTemplate, {
        incidentSeverity: { name: true },
        labels: { _id: true, color: true },
      }),
    ).toEqual({
      incidentSeverity: { name: true, _id: true, isArchived: true },
      labels: { _id: true, color: true, isArchived: true },
    });
  });

  test("relations to records that are never archived values are read as asked", () => {
    expect(
      ArchivedValuePicker.getCopySelect(IncidentTemplate, {
        onCallDutyPolicies: true,
        templateName: true,
      }),
    ).toEqual({ onCallDutyPolicies: true, templateName: true });
  });

  test("an archived label is left behind; the others are kept as the plain select read them", () => {
    const original: Monitor = new Monitor();
    original.description = "Checkout API";
    original.labels = [label(LIVE_LABEL, false), label(ARCHIVED_LABEL, true)];

    const copy: Monitor = ArchivedValuePicker.withoutArchivedValues(original, {
      description: true,
      labels: true,
    });

    expect(copy.description).toBe("Checkout API");
    expect(
      (copy.labels || []).map((value: Label): string => {
        return value._id?.toString() || "";
      }),
    ).toEqual([LIVE_LABEL]);
    // Its id alone, as a plain "labels: true" reads it: sent as before.
    expect(copy.labels![0]).toBeInstanceOf(Label);
    expect(copy.labels![0]!.isArchived).toBeUndefined();
    expect(copy.labels![0]!.name).toBeUndefined();
  });

  test("an archived single value is taken off, with its id column", () => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = SEVERITY;
    severity.isArchived = true;

    const original: IncidentTemplate = new IncidentTemplate();
    original.templateName = "Payments outage";
    original.incidentSeverity = severity;
    original.incidentSeverityId = new ObjectID(SEVERITY);

    const copy: IncidentTemplate = ArchivedValuePicker.withoutArchivedValues(
      original,
      { templateName: true, incidentSeverity: true, incidentSeverityId: true },
    );

    expect(copy.templateName).toBe("Payments outage");
    expect(copy.incidentSeverity).toBeUndefined();
    expect(copy.incidentSeverityId).toBeUndefined();
  });

  test("a live single value is kept as its id", () => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = SEVERITY;
    severity.isArchived = false;

    const original: IncidentTemplate = new IncidentTemplate();
    original.incidentSeverity = severity;

    const copy: IncidentTemplate = ArchivedValuePicker.withoutArchivedValues(
      original,
      { incidentSeverity: true },
    );

    expect(copy.incidentSeverity).toBeInstanceOf(IncidentSeverity);
    expect(copy.incidentSeverity!._id?.toString()).toBe(SEVERITY);
    expect(copy.incidentSeverity!.isArchived).toBeUndefined();
  });

  test("a record with none of them is copied untouched", () => {
    const original: Monitor = new Monitor();
    original.description = "No labels";

    const copy: Monitor = ArchivedValuePicker.withoutArchivedValues(original, {
      description: true,
      labels: true,
    });

    expect(copy.description).toBe("No labels");
    expect(copy.labels).toBeUndefined();
  });
});
