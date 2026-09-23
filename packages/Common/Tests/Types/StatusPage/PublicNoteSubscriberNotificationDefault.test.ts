import Incident from "../../../Models/DatabaseModels/Incident";
import PublicNoteSubscriberNotificationDefault, {
  IncidentSubscriberNotificationSetting,
} from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { describe, expect, test } from "@jest/globals";

/*
 * A public note on an incident that was declared without notifying status
 * page subscribers starts with "notify subscribers" off. Only an explicit
 * "no" on the incident may turn that default off: anything unknown keeps the
 * long-standing default of notifying, so a missing or unloaded incident never
 * silences a note by accident.
 */
describe("PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident", () => {
  test("is false when the incident was declared without notifying subscribers", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident({
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      }),
    ).toBe(false);
  });

  test("is true when the incident notified subscribers when declared", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident({
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      }),
    ).toBe(true);
  });

  test("is true when the incident setting is undefined", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident({
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: undefined,
      }),
    ).toBe(true);
  });

  test("is true when the incident setting is null, as on rows from before the setting existed", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident({
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: null,
      }),
    ).toBe(true);
  });

  test("is true when the incident setting was not selected at all", () => {
    const incident: IncidentSubscriberNotificationSetting = {};

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident),
    ).toBe(true);
  });

  test("is true when the incident could not be found", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(null),
    ).toBe(true);
  });

  test("is true when there is no incident yet", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
        undefined,
      ),
    ).toBe(true);
  });

  test("always returns a boolean, never the raw setting", () => {
    const inputs: Array<
      IncidentSubscriberNotificationSetting | null | undefined
    > = [
      null,
      undefined,
      {},
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: null },
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: undefined },
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true },
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false },
    ];

    for (const input of inputs) {
      expect(
        typeof PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
          input,
        ),
      ).toBe("boolean");
    }
  });

  test("does not change the incident it reads", () => {
    const incident: IncidentSubscriberNotificationSetting = {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
    };

    PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident);

    expect(incident).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
    });
  });
});

describe("PublicNoteSubscriberNotificationDefault with an Incident model", () => {
  test("is false for an incident declared without notifying subscribers", () => {
    const incident: Incident = new Incident();
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident),
    ).toBe(false);
  });

  test("is true for an incident that notified subscribers", () => {
    const incident: Incident = new Incident();
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = true;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident),
    ).toBe(true);
  });

  test("is true for an incident whose setting was never loaded", () => {
    const incident: Incident = new Incident();

    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBeUndefined();
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident),
    ).toBe(true);
  });

  test("is false for an incident read back from API JSON with the setting off", () => {
    const incident: Incident = Incident.fromJSONObject(
      {
        _id: "5a2b3c4d-0000-4000-8000-000000000001",
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      },
      Incident,
    );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident),
    ).toBe(false);
  });

  test("is true for an incident read back from API JSON without the setting", () => {
    const incident: Incident = Incident.fromJSONObject(
      {
        _id: "5a2b3c4d-0000-4000-8000-000000000002",
        title: "Checkout is slow",
      },
      Incident,
    );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident),
    ).toBe(true);
  });
});

describe("PublicNoteSubscriberNotificationDefault.quietIncidentDescription", () => {
  test("is a non-empty sentence", () => {
    const text: string =
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription;

    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toBe(text.trim());
    expect(text).toMatch(/^[A-Z]/);
    expect(text.endsWith(".")).toBe(true);
  });

  test("explains that subscribers were not notified when the incident was declared", () => {
    const text: string =
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription;

    expect(text).toContain("subscribers");
    expect(text).toContain("declared");
    expect(text).toContain("not notified");
  });

  test("keeps the exact wording the dashboard locale files translate", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    ).toBe(
      "Unticked by default because status page subscribers were not notified when this incident was declared.",
    );
  });
});
