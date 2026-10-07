import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * What a Boolean column holds after BaseModel.fromJSON - the one door every
 * create comes through, on both sides of the wire: BaseAPI builds the new
 * record from the request body with it, and so do the workflow Create steps.
 *
 * A switch sent as "true", "yes", "on", "1" or 1 is the boolean the database
 * stores for it, and so is "false", "no", "off", "0" or 0, so the record a
 * hook reads holds what will be stored. A value the database would refuse is
 * left as it is, for DatabaseService to refuse with one plain message; a
 * column that is not a switch keeps its text.
 */

describe("BaseModel.fromJSON on Boolean columns", () => {
  it("turns a switch sent as text into the boolean the database stores", () => {
    const posted: JSONObject = {
      title: "Database upgrade",
      isVisibleOnStatusPage: "true",
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: "no",
      enableReminders: 1,
    };

    const event: ScheduledMaintenance = BaseModel.fromJSON(
      posted,
      ScheduledMaintenance,
    ) as ScheduledMaintenance;

    expect(event.isVisibleOnStatusPage).toBe(true);
    expect(event.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
      false,
    );
    expect(event.enableReminders).toBe(true);
    expect(event.title).toBe("Database upgrade");
  });

  it.each([
    ["true", true],
    [" Yes ", true],
    ["on", true],
    ["1", true],
    [1, true],
    [true, true],
    ["false", false],
    ["NO", false],
    ["off", false],
    ["0", false],
    [0, false],
    [false, false],
  ] as Array<[unknown, boolean]>)(
    "a form's Enabled sent as %p is %p",
    (sent: unknown, stored: boolean) => {
      const form: Form = BaseModel.fromJSON(
        { name: "Report an outage", isEnabled: sent } as JSONObject,
        Form,
      ) as Form;

      expect(form.isEnabled).toBe(stored);
    },
  );

  it("keeps null, and leaves a value the database would refuse for the service to refuse", () => {
    const monitor: Monitor = BaseModel.fromJSON(
      { isArchived: null, disableActiveMonitoring: "sometimes" },
      Monitor,
    ) as Monitor;

    expect(monitor.isArchived).toBeNull();
    expect(
      (monitor as unknown as Record<string, unknown>)[
        "disableActiveMonitoring"
      ],
    ).toBe("sometimes");
  });

  it("never touches a column that is not a switch", () => {
    const monitor: Monitor = BaseModel.fromJSON(
      { name: "true", description: "0" },
      Monitor,
    ) as Monitor;

    expect(monitor.name).toBe("true");
    expect(monitor.description).toBe("0");
  });

  it("reads a record the API sent back - real booleans - exactly as it was", () => {
    const monitor: Monitor = BaseModel.fromJSON(
      { isArchived: false, disableActiveMonitoring: true },
      Monitor,
    ) as Monitor;

    expect(monitor.isArchived).toBe(false);
    expect(monitor.disableActiveMonitoring).toBe(true);
  });
});
