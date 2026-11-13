import Project from "../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../Types/Database/TableColumnType";
import NewIncidentSubscriberNotificationDefault, {
  NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN,
  NewIncidentNotifyDefaultSetting,
} from "../../../Types/StatusPage/NewIncidentSubscriberNotificationDefault";
import { describe, expect, test } from "@jest/globals";

/*
 * WHETHER "NOTIFY STATUS PAGE SUBSCRIBERS" STARTS TICKED ON DECLARE NEW
 * INCIDENT (#7606).
 *
 * A project says how the box starts
 * (Project.notifyStatusPageSubscribersOfNewIncidentsByDefault, on for every
 * project). Only an explicit "off" may start it unticked: a project that
 * could not be read, or that holds no value, starts it ticked, as the box
 * always started - so nothing unknown ever silences an incident's
 * subscribers by accident, and nothing unknown ever emails them that the
 * project did not already allow.
 */
describe("NewIncidentSubscriberNotificationDefault.isTickedByDefault", () => {
  test("is false only when the project turned it off", () => {
    expect(
      NewIncidentSubscriberNotificationDefault.isTickedByDefault({
        notifyStatusPageSubscribersOfNewIncidentsByDefault: false,
      }),
    ).toBe(false);
  });

  test("is true when the project keeps it on, as every project starts", () => {
    expect(
      NewIncidentSubscriberNotificationDefault.isTickedByDefault({
        notifyStatusPageSubscribersOfNewIncidentsByDefault: true,
      }),
    ).toBe(true);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
  ])(
    "is true when the project's value is %s",
    (_label: string, value: boolean | null | undefined) => {
      expect(
        NewIncidentSubscriberNotificationDefault.isTickedByDefault({
          notifyStatusPageSubscribersOfNewIncidentsByDefault: value,
        }),
      ).toBe(true);
    },
  );

  test("is true when the value was not selected at all", () => {
    const project: NewIncidentNotifyDefaultSetting = {};

    expect(
      NewIncidentSubscriberNotificationDefault.isTickedByDefault(project),
    ).toBe(true);
  });

  test.each([
    ["no project", undefined],
    ["a project that could not be read", null],
  ])("is true with %s", (_label: string, project: null | undefined) => {
    expect(
      NewIncidentSubscriberNotificationDefault.isTickedByDefault(project),
    ).toBe(true);
  });

  test("reads a Project model as it comes back from the server", () => {
    const off: Project = new Project();
    off.notifyStatusPageSubscribersOfNewIncidentsByDefault = false;

    const on: Project = new Project();
    on.notifyStatusPageSubscribersOfNewIncidentsByDefault = true;

    expect(
      NewIncidentSubscriberNotificationDefault.isTickedByDefault(off),
    ).toBe(false);
    expect(NewIncidentSubscriberNotificationDefault.isTickedByDefault(on)).toBe(
      true,
    );
    // A project read without the column says nothing, so the box is ticked.
    expect(
      NewIncidentSubscriberNotificationDefault.isTickedByDefault(new Project()),
    ).toBe(true);
  });

  test("anything but the boolean false keeps the box ticked", () => {
    for (const value of [0, "", "false", "off", 1, "true", [], {}]) {
      expect([
        value,
        NewIncidentSubscriberNotificationDefault.isTickedByDefault({
          notifyStatusPageSubscribersOfNewIncidentsByDefault:
            value as unknown as boolean,
        }),
      ]).toEqual([value, true]);
    }
  });
});

describe("NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN", () => {
  test("names the Project column, a boolean", () => {
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN).toBe(
      "notifyStatusPageSubscribersOfNewIncidentsByDefault",
    );

    const project: Project = new Project();

    expect(project.hasColumn(NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN)).toBe(true);
    expect(
      project.getTableColumnMetadata(NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN).type,
    ).toBe(TableColumnType.Boolean);
  });

  test("is the column isTickedByDefault reads", () => {
    const project: NewIncidentNotifyDefaultSetting = {
      [NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN]: false,
    };

    expect(
      NewIncidentSubscriberNotificationDefault.isTickedByDefault(project),
    ).toBe(false);
  });
});
