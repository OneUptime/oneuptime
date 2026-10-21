import ArchivedValuePicker, {
  ARCHIVED_VALUE_TAG,
} from "../../../UI/Utils/ArchivedValuePicker";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Team from "../../../Models/DatabaseModels/Team";
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
