import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import PublicNoteSubscriberNotificationDefault, {
  IncidentEpisodeSubscriberNotificationSetting,
  IncidentSubscriberNotificationSetting,
  ScheduledMaintenanceStateChangeSubscriberNotificationSetting,
  ScheduledMaintenanceSubscriberNotificationSetting,
  ScheduledMaintenanceTargetState,
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

/*
 * The rule every event type shares: only an explicit "no" when the event
 * started turns the default off.
 */
describe("PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting", () => {
  test("is false only for an explicit false", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(false),
    ).toBe(false);
  });

  test("is true for an explicit true", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(true),
    ).toBe(true);
  });

  test("is true when the setting is null, as on rows from before the setting existed", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(null),
    ).toBe(true);
  });

  test("is true when the setting is unknown", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(undefined),
    ).toBe(true);
  });

  test("always returns a boolean, never the raw setting", () => {
    const inputs: Array<boolean | null | undefined> = [
      null,
      undefined,
      true,
      false,
    ];

    for (const input of inputs) {
      expect(
        typeof PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(
          input,
        ),
      ).toBe("boolean");
    }
  });

  test("the incident, episode and scheduled maintenance helpers all follow it", () => {
    const flags: Array<boolean | null | undefined> = [
      null,
      undefined,
      true,
      false,
    ];

    for (const flag of flags) {
      const expected: boolean =
        PublicNoteSubscriberNotificationDefault.shouldNotifyForSetting(flag);

      expect(
        PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident({
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: flag,
        }),
      ).toBe(expected);
      expect(
        PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode({
          shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: flag,
        }),
      ).toBe(expected);
      expect(
        PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
          {
            shouldStatusPageSubscribersBeNotifiedOnEventCreated: flag,
          },
        ),
      ).toBe(expected);
    }
  });
});

/*
 * The same rule for a public note on an incident episode: it follows whether
 * subscribers were told the episode was created.
 */
describe("PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode", () => {
  test("is false when the episode was created without notifying subscribers", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode({
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
      }),
    ).toBe(false);
  });

  test("is true when the episode notified subscribers when created", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode({
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      }),
    ).toBe(true);
  });

  test("is true when the episode setting is undefined", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode({
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: undefined,
      }),
    ).toBe(true);
  });

  test("is true when the episode setting is null, as on rows from before the setting existed", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode({
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: null,
      }),
    ).toBe(true);
  });

  test("is true when the episode setting was not selected at all", () => {
    const episode: IncidentEpisodeSubscriberNotificationSetting = {};

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        episode,
      ),
    ).toBe(true);
  });

  test("is true when the episode could not be found", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        null,
      ),
    ).toBe(true);
  });

  test("is true when there is no episode yet", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        undefined,
      ),
    ).toBe(true);
  });

  test("always returns a boolean, never the raw setting", () => {
    const inputs: Array<
      IncidentEpisodeSubscriberNotificationSetting | null | undefined
    > = [
      null,
      undefined,
      {},
      { shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: null },
      { shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: undefined },
      { shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true },
      { shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false },
    ];

    for (const input of inputs) {
      expect(
        typeof PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
          input,
        ),
      ).toBe("boolean");
    }
  });

  test("does not change the episode it reads", () => {
    const episode: IncidentEpisodeSubscriberNotificationSetting = {
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
    };

    PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
      episode,
    );

    expect(episode).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
    });
  });
});

describe("PublicNoteSubscriberNotificationDefault with an IncidentEpisode model", () => {
  test("is false for an episode created without notifying subscribers", () => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated = false;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        episode,
      ),
    ).toBe(false);
  });

  test("is true for an episode that notified subscribers", () => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated = true;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        episode,
      ),
    ).toBe(true);
  });

  test("is true for an episode whose setting was never loaded", () => {
    const episode: IncidentEpisode = new IncidentEpisode();

    expect(
      episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated,
    ).toBeUndefined();
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        episode,
      ),
    ).toBe(true);
  });

  test("is false for an episode read back from API JSON with the setting off", () => {
    const episode: IncidentEpisode = IncidentEpisode.fromJSONObject(
      {
        _id: "5a2b3c4d-0000-4000-8000-000000000011",
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
      },
      IncidentEpisode,
    );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        episode,
      ),
    ).toBe(false);
  });

  test("is true for an episode read back from API JSON with the setting on", () => {
    const episode: IncidentEpisode = IncidentEpisode.fromJSONObject(
      {
        _id: "5a2b3c4d-0000-4000-8000-000000000012",
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      },
      IncidentEpisode,
    );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        episode,
      ),
    ).toBe(true);
  });

  test("is true for an episode read back from API JSON without the setting", () => {
    const episode: IncidentEpisode = IncidentEpisode.fromJSONObject(
      {
        _id: "5a2b3c4d-0000-4000-8000-000000000013",
        title: "Checkout and payments are down",
      },
      IncidentEpisode,
    );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        episode,
      ),
    ).toBe(true);
  });
});

/*
 * And for a public note on a scheduled maintenance event: it follows whether
 * subscribers were told the event was created.
 */
describe("PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance", () => {
  test("is false when the event was created without notifying subscribers", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        {
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
        },
      ),
    ).toBe(false);
  });

  test("is true when the event notified subscribers when created", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        {
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
        },
      ),
    ).toBe(true);
  });

  test("is true when the event setting is undefined", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        {
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: undefined,
        },
      ),
    ).toBe(true);
  });

  test("is true when the event setting is null, as on rows from before the setting existed", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        {
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: null,
        },
      ),
    ).toBe(true);
  });

  test("is true when the event setting was not selected at all", () => {
    const scheduledMaintenance: ScheduledMaintenanceSubscriberNotificationSetting =
      {};

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(true);
  });

  test("is true when the event could not be found", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        null,
      ),
    ).toBe(true);
  });

  test("is true when there is no event yet", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        undefined,
      ),
    ).toBe(true);
  });

  test("always returns a boolean, never the raw setting", () => {
    const inputs: Array<
      ScheduledMaintenanceSubscriberNotificationSetting | null | undefined
    > = [
      null,
      undefined,
      {},
      { shouldStatusPageSubscribersBeNotifiedOnEventCreated: null },
      { shouldStatusPageSubscribersBeNotifiedOnEventCreated: undefined },
      { shouldStatusPageSubscribersBeNotifiedOnEventCreated: true },
      { shouldStatusPageSubscribersBeNotifiedOnEventCreated: false },
    ];

    for (const input of inputs) {
      expect(
        typeof PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
          input,
        ),
      ).toBe("boolean");
    }
  });

  test("does not change the event it reads", () => {
    const scheduledMaintenance: ScheduledMaintenanceSubscriberNotificationSetting =
      {
        shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
      };

    PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
      scheduledMaintenance,
    );

    expect(scheduledMaintenance).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
    });
  });

  test("only reads the event-created setting, not the ongoing or ended ones", () => {
    const scheduledMaintenance: ScheduledMaintenance =
      new ScheduledMaintenance();
    scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
      false;
    scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
      false;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(true);
  });
});

describe("PublicNoteSubscriberNotificationDefault with a ScheduledMaintenance model", () => {
  test("is false for an event created without notifying subscribers", () => {
    const scheduledMaintenance: ScheduledMaintenance =
      new ScheduledMaintenance();
    scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
      false;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(false);
  });

  test("is true for an event that notified subscribers", () => {
    const scheduledMaintenance: ScheduledMaintenance =
      new ScheduledMaintenance();
    scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
      true;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(true);
  });

  test("is true for an event whose setting was never loaded", () => {
    const scheduledMaintenance: ScheduledMaintenance =
      new ScheduledMaintenance();

    expect(
      scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    ).toBeUndefined();
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(true);
  });

  test("is false for an event read back from API JSON with the setting off", () => {
    const scheduledMaintenance: ScheduledMaintenance =
      ScheduledMaintenance.fromJSONObject(
        {
          _id: "5a2b3c4d-0000-4000-8000-000000000021",
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
        },
        ScheduledMaintenance,
      );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(false);
  });

  test("is true for an event read back from API JSON with the setting on", () => {
    const scheduledMaintenance: ScheduledMaintenance =
      ScheduledMaintenance.fromJSONObject(
        {
          _id: "5a2b3c4d-0000-4000-8000-000000000022",
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
        },
        ScheduledMaintenance,
      );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(true);
  });

  test("is true for an event read back from API JSON without the setting", () => {
    const scheduledMaintenance: ScheduledMaintenance =
      ScheduledMaintenance.fromJSONObject(
        {
          _id: "5a2b3c4d-0000-4000-8000-000000000023",
          title: "Database upgrade",
        },
        ScheduledMaintenance,
      );

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        scheduledMaintenance,
      ),
    ).toBe(true);
  });
});

/*
 * Each helper reads only its own event's setting. A quiet flag that belongs
 * to a different kind of event must not silence the note.
 */
describe("PublicNoteSubscriberNotificationDefault reads only its own event's setting", () => {
  type EveryEventSetting = IncidentSubscriberNotificationSetting &
    IncidentEpisodeSubscriberNotificationSetting &
    ScheduledMaintenanceSubscriberNotificationSetting;

  test("the incident helper ignores the episode and scheduled maintenance settings", () => {
    const setting: EveryEventSetting = {
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
    };

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(setting),
    ).toBe(true);
  });

  test("the episode helper ignores the incident and scheduled maintenance settings", () => {
    const setting: EveryEventSetting = {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
    };

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        setting,
      ),
    ).toBe(true);
  });

  test("the scheduled maintenance helper ignores the incident and episode settings", () => {
    const setting: EveryEventSetting = {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
    };

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        setting,
      ),
    ).toBe(true);
  });

  test("each helper turns off for its own setting alone", () => {
    const setting: EveryEventSetting = {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
    };

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(setting),
    ).toBe(false);
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        setting,
      ),
    ).toBe(true);
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        setting,
      ),
    ).toBe(true);
  });

  test("an incident model with its setting off does not silence an episode or scheduled maintenance note", () => {
    const incident: Incident = new Incident();
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        incident as unknown as IncidentEpisodeSubscriberNotificationSetting,
      ),
    ).toBe(true);
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        incident as unknown as ScheduledMaintenanceSubscriberNotificationSetting,
      ),
    ).toBe(true);
  });

  test("an episode or scheduled maintenance model with its setting off does not silence an incident note", () => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated = false;

    const scheduledMaintenance: ScheduledMaintenance =
      new ScheduledMaintenance();
    scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
      false;

    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
        episode as unknown as IncidentSubscriberNotificationSetting,
      ),
    ).toBe(true);
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
        scheduledMaintenance as unknown as IncidentSubscriberNotificationSetting,
      ),
    ).toBe(true);
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
        episode as unknown as ScheduledMaintenanceSubscriberNotificationSetting,
      ),
    ).toBe(true);
    expect(
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
        scheduledMaintenance as unknown as IncidentEpisodeSubscriberNotificationSetting,
      ),
    ).toBe(true);
  });
});

describe("PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription", () => {
  test("is a non-empty sentence", () => {
    const text: string =
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription;

    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toBe(text.trim());
    expect(text).toMatch(/^[A-Z]/);
    expect(text.endsWith(".")).toBe(true);
  });

  test("explains that subscribers were not notified when the episode was created", () => {
    const text: string =
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription;

    expect(text).toContain("subscribers");
    expect(text).toContain("episode");
    expect(text).toContain("created");
    expect(text).toContain("not notified");
  });

  test("keeps the exact wording the dashboard locale files translate", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
    ).toBe(
      "Unticked by default because status page subscribers were not notified when this episode was created.",
    );
  });
});

describe("PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription", () => {
  test("is a non-empty sentence", () => {
    const text: string =
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription;

    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toBe(text.trim());
    expect(text).toMatch(/^[A-Z]/);
    expect(text.endsWith(".")).toBe(true);
  });

  test("explains that subscribers were not notified when the event was created", () => {
    const text: string =
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription;

    expect(text).toContain("subscribers");
    expect(text).toContain("scheduled maintenance event");
    expect(text).toContain("created");
    expect(text).toContain("not notified");
  });

  test("keeps the exact wording the dashboard locale files translate", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    ).toBe(
      "Unticked by default because status page subscribers were not notified when this scheduled maintenance event was created.",
    );
  });
});

describe("PublicNoteSubscriberNotificationDefault quiet descriptions", () => {
  test("each event type explains itself in its own words", () => {
    const descriptions: Array<string> = [
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    ];

    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  test("all start the same way, so they read as one family under the checkbox", () => {
    const descriptions: Array<string> = [
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    ];

    for (const description of descriptions) {
      expect(
        description.startsWith(
          "Unticked by default because status page subscribers were not notified when this ",
        ),
      ).toBe(true);
    }
  });

  test("the episode and scheduled maintenance descriptions do not talk about declaring an incident", () => {
    expect(
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
    ).not.toContain("incident");
    expect(
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
    ).not.toContain("declared");
    expect(
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    ).not.toContain("incident");
    expect(
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    ).not.toContain("declared");
  });
});

/*
 * Moving a scheduled maintenance event to another state by hand. The state
 * change modal's checkbox also decides whether subscribers hear about the
 * change itself, and the event has its own "Event Ongoing" and "Event Ended"
 * settings that the automatic workers honour. So on an event created without
 * notifying subscribers, a move into an ongoing state follows "Event Ongoing",
 * a move into an ended or resolved state follows "Event Ended", and any other
 * move starts unticked, like a public note. An event that notified
 * subscribers when it was created keeps the old default of notifying on every
 * move, whatever its Ongoing and Ended settings say.
 */
describe("PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenanceStateChange", () => {
  type Flag = boolean | null | undefined;

  type TargetState = ScheduledMaintenanceTargetState | null | undefined;

  type EventSetting =
    | ScheduledMaintenanceStateChangeSubscriberNotificationSetting
    | null
    | undefined;

  // Which of the event's own settings announces a move into a state.
  type Announcement = "ongoing" | "ended" | "none";

  type TargetCase = {
    target: string;
    targetState: TargetState;
    announcement: Announcement;
  };

  type MatrixRow = {
    created: Flag;
    target: string;
    targetState: TargetState;
    ongoing: Flag;
    ended: Flag;
    expected: boolean;
  };

  /*
   * A ScheduledMaintenanceState also says whether it is the scheduled state.
   * The helper does not read that flag.
   */
  type TargetStateWithScheduled = ScheduledMaintenanceTargetState & {
    isScheduledState?: boolean | null | undefined;
  };

  const flags: Array<Flag> = [true, false, null, undefined];

  // Every Event Created value except an explicit "no".
  const notifyingCreatedFlags: Array<Flag> = [true, undefined, null];

  const createdFlags: Array<Flag> = [...notifyingCreatedFlags, false];

  const ongoingState: ScheduledMaintenanceTargetState = {
    isOngoingState: true,
  };

  const endedState: ScheduledMaintenanceTargetState = {
    isEndedState: true,
  };

  const resolvedState: ScheduledMaintenanceTargetState = {
    isResolvedState: true,
  };

  const scheduledState: TargetStateWithScheduled = {
    isScheduledState: true,
    isOngoingState: false,
    isEndedState: false,
    isResolvedState: false,
  };

  const targetCases: Array<TargetCase> = [
    {
      target: "an ongoing state",
      targetState: ongoingState,
      announcement: "ongoing",
    },
    {
      target: "an ongoing state with every other flag off",
      targetState: {
        isOngoingState: true,
        isEndedState: false,
        isResolvedState: false,
      },
      announcement: "ongoing",
    },
    {
      target: "an ended state",
      targetState: endedState,
      announcement: "ended",
    },
    {
      target: "a resolved state",
      targetState: resolvedState,
      announcement: "ended",
    },
    {
      target: "a state that is both ended and resolved",
      targetState: { isEndedState: true, isResolvedState: true },
      announcement: "ended",
    },
    {
      target: "a resolved state whose ended flag is off",
      targetState: {
        isOngoingState: false,
        isEndedState: false,
        isResolvedState: true,
      },
      announcement: "ended",
    },
    {
      // The helper checks ongoing first.
      target: "a state flagged both ongoing and ended",
      targetState: { isOngoingState: true, isEndedState: true },
      announcement: "ongoing",
    },
    {
      target: "the scheduled state",
      targetState: scheduledState,
      announcement: "none",
    },
    {
      target: "a custom state with no flags",
      targetState: {},
      announcement: "none",
    },
    {
      target: "a custom state with every flag off",
      targetState: {
        isOngoingState: false,
        isEndedState: false,
        isResolvedState: false,
      },
      announcement: "none",
    },
    {
      target: "a custom state with every flag null",
      targetState: {
        isOngoingState: null,
        isEndedState: null,
        isResolvedState: null,
      },
      announcement: "none",
    },
    {
      target: "an unknown state (null)",
      targetState: null,
      announcement: "none",
    },
    {
      target: "an unknown state (undefined)",
      targetState: undefined,
      announcement: "none",
    },
  ];

  const announcedTargetCases: Array<TargetCase> = targetCases.filter(
    (targetCase: TargetCase) => {
      return targetCase.announcement !== "none";
    },
  );

  const unannouncedTargetCases: Array<TargetCase> = targetCases.filter(
    (targetCase: TargetCase) => {
      return targetCase.announcement === "none";
    },
  );

  const makeEvent: (
    created: Flag,
    ongoing: Flag,
    ended: Flag,
  ) => ScheduledMaintenanceStateChangeSubscriberNotificationSetting = (
    created: Flag,
    ongoing: Flag,
    ended: Flag,
  ): ScheduledMaintenanceStateChangeSubscriberNotificationSetting => {
    return {
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: created,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: ongoing,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: ended,
    };
  };

  const shouldNotify: (
    event: EventSetting,
    targetState: TargetState,
  ) => boolean = (event: EventSetting, targetState: TargetState): boolean => {
    return PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenanceStateChange(
      event,
      targetState,
    );
  };

  /*
   * An unknown (null or undefined) setting keeps the long-standing default of
   * notifying; only an explicit false turns it off. Written out as a table so
   * the matrix below checks the helper against the rule rather than against a
   * copy of its code.
   */
  const settingStartsTicked: Map<Flag, boolean> = new Map<Flag, boolean>([
    [true, true],
    [false, false],
    [null, true],
    [undefined, true],
  ]);

  const expectedDefault: (
    created: Flag,
    announcement: Announcement,
    ongoing: Flag,
    ended: Flag,
  ) => boolean = (
    created: Flag,
    announcement: Announcement,
    ongoing: Flag,
    ended: Flag,
  ): boolean => {
    if (notifyingCreatedFlags.includes(created)) {
      return true;
    }

    if (announcement === "ongoing") {
      return settingStartsTicked.get(ongoing) === true;
    }

    if (announcement === "ended") {
      return settingStartsTicked.get(ended) === true;
    }

    return false;
  };

  const matrix: Array<MatrixRow> = [];

  for (const created of createdFlags) {
    for (const targetCase of targetCases) {
      for (const ongoing of flags) {
        for (const ended of flags) {
          matrix.push({
            created: created,
            target: targetCase.target,
            targetState: targetCase.targetState,
            ongoing: ongoing,
            ended: ended,
            expected: expectedDefault(
              created,
              targetCase.announcement,
              ongoing,
              ended,
            ),
          });
        }
      }
    }
  }

  describe("across every combination", () => {
    test("covers every Event Created, target state, Event Ongoing and Event Ended value", () => {
      expect(matrix).toHaveLength(
        createdFlags.length * targetCases.length * flags.length * flags.length,
      );
    });

    // One test over the whole matrix, listing every row that disagrees.
    test("matches the rule for every combination", () => {
      const mismatches: Array<string> = matrix
        .filter((row: MatrixRow): boolean => {
          return (
            shouldNotify(
              makeEvent(row.created, row.ongoing, row.ended),
              row.targetState,
            ) !== row.expected
          );
        })
        .map((row: MatrixRow): string => {
          return `moving to ${row.target} with Event Created ${String(row.created)}, Event Ongoing ${String(row.ongoing)} and Event Ended ${String(row.ended)} should start ticked: ${String(row.expected)}`;
        });

      expect(mismatches).toEqual([]);
    });
  });

  describe("on an event that notified subscribers when it was created", () => {
    type NotifyingRow = {
      created: Flag;
      target: string;
      targetState: TargetState;
    };

    const notifyingRows: Array<NotifyingRow> = [];

    for (const created of notifyingCreatedFlags) {
      for (const targetCase of targetCases) {
        notifyingRows.push({
          created: created,
          target: targetCase.target,
          targetState: targetCase.targetState,
        });
      }
    }

    test.each(notifyingRows)(
      "keeps the old default of notifying when moving to $target with Event Created $created, whatever Event Ongoing and Event Ended say",
      (row: NotifyingRow) => {
        for (const ongoing of flags) {
          for (const ended of flags) {
            expect(
              shouldNotify(
                makeEvent(row.created, ongoing, ended),
                row.targetState,
              ),
            ).toBe(true);
          }
        }
      },
    );

    test("is true even with Event Ongoing and Event Ended both off", () => {
      const event: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
        makeEvent(true, false, false);

      expect(shouldNotify(event, ongoingState)).toBe(true);
      expect(shouldNotify(event, endedState)).toBe(true);
      expect(shouldNotify(event, resolvedState)).toBe(true);
      expect(shouldNotify(event, scheduledState)).toBe(true);
      expect(shouldNotify(event, {})).toBe(true);
      expect(shouldNotify(event, null)).toBe(true);
      expect(shouldNotify(event, undefined)).toBe(true);
    });

    test("is true for an event whose Event Created setting was not loaded, even with Event Ongoing and Event Ended off", () => {
      const event: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
        {
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
        };

      for (const targetCase of targetCases) {
        expect(shouldNotify(event, targetCase.targetState)).toBe(true);
      }
    });
  });

  describe("on an event created without notifying subscribers", () => {
    /*
     * [Event Ongoing, Event Ended, starts ticked] for a move into an ongoing
     * state: only the Event Ongoing column matters.
     */
    const quietMoveToOngoing: Array<[Flag, Flag, boolean]> = [
      [true, true, true],
      [true, false, true],
      [true, null, true],
      [true, undefined, true],
      [false, true, false],
      [false, false, false],
      [false, null, false],
      [false, undefined, false],
      [null, true, true],
      [null, false, true],
      [null, null, true],
      [null, undefined, true],
      [undefined, true, true],
      [undefined, false, true],
      [undefined, null, true],
      [undefined, undefined, true],
    ];

    test.each(quietMoveToOngoing)(
      "moving to an ongoing state with Event Ongoing %p and Event Ended %p starts ticked: %p",
      (ongoing: Flag, ended: Flag, expected: boolean) => {
        expect(
          shouldNotify(makeEvent(false, ongoing, ended), ongoingState),
        ).toBe(expected);
      },
    );

    /*
     * [Event Ongoing, Event Ended, starts ticked] for a move into an ended or
     * resolved state: only the Event Ended column matters.
     */
    const quietMoveToEnded: Array<[Flag, Flag, boolean]> = [
      [true, true, true],
      [false, true, true],
      [null, true, true],
      [undefined, true, true],
      [true, false, false],
      [false, false, false],
      [null, false, false],
      [undefined, false, false],
      [true, null, true],
      [false, null, true],
      [null, null, true],
      [undefined, null, true],
      [true, undefined, true],
      [false, undefined, true],
      [null, undefined, true],
      [undefined, undefined, true],
    ];

    const quietEndedRows: Array<[string, TargetState, Flag, Flag, boolean]> =
      [];

    for (const targetCase of targetCases) {
      if (targetCase.announcement !== "ended") {
        continue;
      }

      for (const [ongoing, ended, expected] of quietMoveToEnded) {
        quietEndedRows.push([
          targetCase.target,
          targetCase.targetState,
          ongoing,
          ended,
          expected,
        ]);
      }
    }

    test("the ended table covers ended, resolved and ended-and-resolved states", () => {
      expect(quietEndedRows).toHaveLength(4 * quietMoveToEnded.length);
    });

    test.each(quietEndedRows)(
      "moving to %s with Event Ongoing %p and Event Ended %p starts ticked: %p",
      (
        _target: string,
        targetState: TargetState,
        ongoing: Flag,
        ended: Flag,
        expected: boolean,
      ) => {
        expect(
          shouldNotify(makeEvent(false, ongoing, ended), targetState),
        ).toBe(expected);
      },
    );

    test("moving to an ongoing state follows Event Ongoing, not Event Ended", () => {
      expect(shouldNotify(makeEvent(false, true, false), ongoingState)).toBe(
        true,
      );
      expect(shouldNotify(makeEvent(false, false, true), ongoingState)).toBe(
        false,
      );
    });

    test("moving to an ended state follows Event Ended, not Event Ongoing", () => {
      expect(shouldNotify(makeEvent(false, false, true), endedState)).toBe(
        true,
      );
      expect(shouldNotify(makeEvent(false, true, false), endedState)).toBe(
        false,
      );
    });

    test("moving to a resolved state follows Event Ended, not Event Ongoing", () => {
      expect(shouldNotify(makeEvent(false, false, true), resolvedState)).toBe(
        true,
      );
      expect(shouldNotify(makeEvent(false, true, false), resolvedState)).toBe(
        false,
      );
    });

    test("marking an event ended early still tells subscribers when Event Ended is on", () => {
      // Created quietly, set to announce going ongoing and ending.
      const event: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
        makeEvent(false, true, true);

      expect(shouldNotify(event, endedState)).toBe(true);
      expect(shouldNotify(event, resolvedState)).toBe(true);
      expect(shouldNotify(event, ongoingState)).toBe(true);
    });

    test.each(unannouncedTargetCases)(
      "moving to $target starts unticked, even with Event Ongoing and Event Ended on",
      (targetCase: TargetCase) => {
        for (const ongoing of flags) {
          for (const ended of flags) {
            expect(
              shouldNotify(
                makeEvent(false, ongoing, ended),
                targetCase.targetState,
              ),
            ).toBe(false);
          }
        }
      },
    );

    test("a move neither setting announces starts the same as a public note on the event", () => {
      for (const created of createdFlags) {
        for (const targetCase of unannouncedTargetCases) {
          for (const ongoing of flags) {
            for (const ended of flags) {
              const event: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
                makeEvent(created, ongoing, ended);

              expect(shouldNotify(event, targetCase.targetState)).toBe(
                PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
                  event,
                ),
              );
            }
          }
        }
      }
    });

    test("an explicit Event Ongoing or Event Ended setting gives the answer the automatic change would", () => {
      /*
       * The workers that move an event to ongoing or ended notify subscribers
       * when Boolean(setting) is true.
       */
      const explicitFlags: Array<boolean> = [true, false];

      for (const setting of explicitFlags) {
        expect(
          shouldNotify(makeEvent(false, setting, !setting), ongoingState),
        ).toBe(Boolean(setting));
        expect(
          shouldNotify(makeEvent(false, !setting, setting), endedState),
        ).toBe(Boolean(setting));
        expect(
          shouldNotify(makeEvent(false, !setting, setting), resolvedState),
        ).toBe(Boolean(setting));
      }
    });

    test("an unknown Event Ongoing or Event Ended setting keeps the long-standing default of notifying", () => {
      const unknownFlags: Array<Flag> = [null, undefined];

      for (const unknown of unknownFlags) {
        expect(
          shouldNotify(makeEvent(false, unknown, false), ongoingState),
        ).toBe(true);
        expect(shouldNotify(makeEvent(false, false, unknown), endedState)).toBe(
          true,
        );
        expect(
          shouldNotify(makeEvent(false, false, unknown), resolvedState),
        ).toBe(true);
      }
    });

    test("with Event Ongoing and Event Ended both off, every move starts unticked", () => {
      const event: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
        makeEvent(false, false, false);

      for (const targetCase of targetCases) {
        expect(shouldNotify(event, targetCase.targetState)).toBe(false);
      }
    });

    test("with Event Ongoing and Event Ended both on, only the moves they announce start ticked", () => {
      const event: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
        makeEvent(false, true, true);

      for (const targetCase of announcedTargetCases) {
        expect(shouldNotify(event, targetCase.targetState)).toBe(true);
      }

      for (const targetCase of unannouncedTargetCases) {
        expect(shouldNotify(event, targetCase.targetState)).toBe(false);
      }
    });
  });

  /*
   * A real state is only one of ongoing, ended or resolved. The helper checks
   * ongoing first, so a state flagged as ongoing and something else follows
   * Event Ongoing. These tests pin that order down; they do not bless such a
   * state.
   */
  describe("on a state flagged as more than one kind", () => {
    const ongoingAndMore: Array<[string, ScheduledMaintenanceTargetState]> = [
      ["ongoing and ended", { isOngoingState: true, isEndedState: true }],
      ["ongoing and resolved", { isOngoingState: true, isResolvedState: true }],
      [
        "ongoing, ended and resolved",
        { isOngoingState: true, isEndedState: true, isResolvedState: true },
      ],
    ];

    test.each(ongoingAndMore)(
      "a state flagged %s takes the ongoing branch and follows Event Ongoing",
      (_name: string, targetState: ScheduledMaintenanceTargetState) => {
        expect(shouldNotify(makeEvent(false, false, true), targetState)).toBe(
          false,
        );
        expect(shouldNotify(makeEvent(false, true, false), targetState)).toBe(
          true,
        );
        expect(shouldNotify(makeEvent(false, null, false), targetState)).toBe(
          true,
        );
      },
    );

    test("a state flagged ended and resolved follows Event Ended", () => {
      const targetState: ScheduledMaintenanceTargetState = {
        isEndedState: true,
        isResolvedState: true,
      };

      expect(shouldNotify(makeEvent(false, false, true), targetState)).toBe(
        true,
      );
      expect(shouldNotify(makeEvent(false, true, false), targetState)).toBe(
        false,
      );
    });

    test("an ongoing flag that is off does not stop a resolved state following Event Ended", () => {
      const targetState: ScheduledMaintenanceTargetState = {
        isOngoingState: false,
        isResolvedState: true,
      };

      expect(shouldNotify(makeEvent(false, false, true), targetState)).toBe(
        true,
      );
      expect(shouldNotify(makeEvent(false, true, false), targetState)).toBe(
        false,
      );
    });
  });

  describe("when the event or the target state is missing", () => {
    type MissingEventRow = {
      event: string;
      setting: EventSetting;
      target: string;
      targetState: TargetState;
    };

    const missingEvents: Array<[string, EventSetting]> = [
      ["a missing event (null)", null],
      ["a missing event (undefined)", undefined],
      ["an event with no settings loaded", {}],
    ];

    const missingEventRows: Array<MissingEventRow> = [];

    for (const [eventName, setting] of missingEvents) {
      for (const targetCase of targetCases) {
        missingEventRows.push({
          event: eventName,
          setting: setting,
          target: targetCase.target,
          targetState: targetCase.targetState,
        });
      }
    }

    test.each(missingEventRows)(
      "is true for $event moving to $target",
      (row: MissingEventRow) => {
        expect(shouldNotify(row.setting, row.targetState)).toBe(true);
      },
    );

    test.each([null, undefined])(
      "a quiet event moving to an unknown state (%p) starts unticked",
      (targetState: null | undefined) => {
        expect(shouldNotify(makeEvent(false, true, true), targetState)).toBe(
          false,
        );
      },
    );
  });

  describe("return value and inputs", () => {
    test("always returns a boolean, never a raw setting", () => {
      for (const row of matrix) {
        expect(
          typeof shouldNotify(
            makeEvent(row.created, row.ongoing, row.ended),
            row.targetState,
          ),
        ).toBe("boolean");
      }

      const missingEvents: Array<EventSetting> = [null, undefined, {}];

      for (const event of missingEvents) {
        for (const targetCase of targetCases) {
          expect(typeof shouldNotify(event, targetCase.targetState)).toBe(
            "boolean",
          );
        }
      }
    });

    test("does not change the event or the target state it reads", () => {
      for (const row of matrix) {
        const event: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
          makeEvent(row.created, row.ongoing, row.ended);
        const eventBefore: ScheduledMaintenanceStateChangeSubscriberNotificationSetting =
          { ...event };

        const targetStateBefore: TargetState = row.targetState
          ? { ...row.targetState }
          : row.targetState;

        shouldNotify(event, row.targetState);

        expect(event).toStrictEqual(eventBefore);
        expect(row.targetState).toStrictEqual(targetStateBefore);
      }
    });

    test("works on frozen inputs", () => {
      const event: Readonly<ScheduledMaintenanceStateChangeSubscriberNotificationSetting> =
        Object.freeze(makeEvent(false, false, true));
      const targetState: Readonly<ScheduledMaintenanceTargetState> =
        Object.freeze({ isEndedState: true });

      expect(shouldNotify(event, targetState)).toBe(true);
      expect(shouldNotify(event, Object.freeze({ ...ongoingState }))).toBe(
        false,
      );
    });
  });

  describe("with ScheduledMaintenance and ScheduledMaintenanceState models", () => {
    const makeModelEvent: (
      created: boolean,
      ongoing: boolean,
      ended: boolean,
    ) => ScheduledMaintenance = (
      created: boolean,
      ongoing: boolean,
      ended: boolean,
    ): ScheduledMaintenance => {
      const scheduledMaintenance: ScheduledMaintenance =
        new ScheduledMaintenance();
      scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
        created;
      scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
        ongoing;
      scheduledMaintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
        ended;
      return scheduledMaintenance;
    };

    const makeModelState: (
      name: string,
      kind: "scheduled" | "ongoing" | "ended" | "resolved" | "custom",
    ) => ScheduledMaintenanceState = (
      name: string,
      kind: "scheduled" | "ongoing" | "ended" | "resolved" | "custom",
    ): ScheduledMaintenanceState => {
      const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
      state.name = name;
      state.isScheduledState = kind === "scheduled";
      state.isOngoingState = kind === "ongoing";
      state.isEndedState = kind === "ended";
      state.isResolvedState = kind === "resolved";
      return state;
    };

    const scheduledModelState: ScheduledMaintenanceState = makeModelState(
      "Scheduled",
      "scheduled",
    );
    const ongoingModelState: ScheduledMaintenanceState = makeModelState(
      "Ongoing",
      "ongoing",
    );
    const endedModelState: ScheduledMaintenanceState = makeModelState(
      "Ended",
      "ended",
    );
    const resolvedModelState: ScheduledMaintenanceState = makeModelState(
      "Completed",
      "resolved",
    );
    const customModelState: ScheduledMaintenanceState = makeModelState(
      "Paused",
      "custom",
    );

    test("a quiet event moving to an ongoing state follows Event Ongoing", () => {
      expect(
        shouldNotify(makeModelEvent(false, true, false), ongoingModelState),
      ).toBe(true);
      expect(
        shouldNotify(makeModelEvent(false, false, true), ongoingModelState),
      ).toBe(false);
    });

    test("a quiet event moving to an ended state follows Event Ended", () => {
      expect(
        shouldNotify(makeModelEvent(false, false, true), endedModelState),
      ).toBe(true);
      expect(
        shouldNotify(makeModelEvent(false, true, false), endedModelState),
      ).toBe(false);
    });

    test("a quiet event moving to a resolved state follows Event Ended", () => {
      expect(
        shouldNotify(makeModelEvent(false, false, true), resolvedModelState),
      ).toBe(true);
      expect(
        shouldNotify(makeModelEvent(false, true, false), resolvedModelState),
      ).toBe(false);
    });

    test("a quiet event moving to the scheduled state or a custom state starts unticked", () => {
      const event: ScheduledMaintenance = makeModelEvent(false, true, true);

      expect(shouldNotify(event, scheduledModelState)).toBe(false);
      expect(shouldNotify(event, customModelState)).toBe(false);
    });

    test("a quiet event moving to a state whose flags were never loaded starts unticked", () => {
      const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();

      expect(state.isOngoingState).toBeUndefined();
      expect(state.isEndedState).toBeUndefined();
      expect(state.isResolvedState).toBeUndefined();
      expect(shouldNotify(makeModelEvent(false, true, true), state)).toBe(
        false,
      );
    });

    test("an event that notified subscribers keeps notifying on every move, even with Event Ongoing and Event Ended off", () => {
      const event: ScheduledMaintenance = makeModelEvent(true, false, false);

      expect(shouldNotify(event, scheduledModelState)).toBe(true);
      expect(shouldNotify(event, ongoingModelState)).toBe(true);
      expect(shouldNotify(event, endedModelState)).toBe(true);
      expect(shouldNotify(event, resolvedModelState)).toBe(true);
      expect(shouldNotify(event, customModelState)).toBe(true);
    });

    test("an event whose settings were never loaded keeps notifying", () => {
      const event: ScheduledMaintenance = new ScheduledMaintenance();

      expect(
        event.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
      ).toBeUndefined();
      expect(shouldNotify(event, scheduledModelState)).toBe(true);
      expect(shouldNotify(event, ongoingModelState)).toBe(true);
      expect(shouldNotify(event, endedModelState)).toBe(true);
    });

    test("a quiet event read back from API JSON follows its own Ongoing and Ended settings", () => {
      const event: ScheduledMaintenance = ScheduledMaintenance.fromJSONObject(
        {
          _id: "5a2b3c4d-0000-4000-8000-000000000031",
          title: "Database upgrade",
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
        },
        ScheduledMaintenance,
      );

      expect(shouldNotify(event, ongoingModelState)).toBe(false);
      expect(shouldNotify(event, endedModelState)).toBe(true);
      expect(shouldNotify(event, resolvedModelState)).toBe(true);
      expect(shouldNotify(event, scheduledModelState)).toBe(false);
    });

    test("a quiet event read back from API JSON without its Ongoing and Ended settings keeps notifying on those moves", () => {
      const event: ScheduledMaintenance = ScheduledMaintenance.fromJSONObject(
        {
          _id: "5a2b3c4d-0000-4000-8000-000000000032",
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
        },
        ScheduledMaintenance,
      );

      expect(
        event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
      ).toBeUndefined();
      expect(shouldNotify(event, ongoingModelState)).toBe(true);
      expect(shouldNotify(event, endedModelState)).toBe(true);
      expect(shouldNotify(event, scheduledModelState)).toBe(false);
    });

    test("an event read back from API JSON without the Event Created setting keeps notifying", () => {
      const event: ScheduledMaintenance = ScheduledMaintenance.fromJSONObject(
        {
          _id: "5a2b3c4d-0000-4000-8000-000000000033",
          title: "Database upgrade",
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
        },
        ScheduledMaintenance,
      );

      expect(shouldNotify(event, scheduledModelState)).toBe(true);
      expect(shouldNotify(event, ongoingModelState)).toBe(true);
      expect(shouldNotify(event, endedModelState)).toBe(true);
    });

    test("states read back from API JSON are recognised", () => {
      const event: ScheduledMaintenance = makeModelEvent(false, true, false);

      const ongoing: ScheduledMaintenanceState =
        ScheduledMaintenanceState.fromJSONObject(
          {
            _id: "5a2b3c4d-0000-4000-8000-000000000041",
            name: "Ongoing",
            isScheduledState: false,
            isOngoingState: true,
            isEndedState: false,
            isResolvedState: false,
          },
          ScheduledMaintenanceState,
        );

      const ended: ScheduledMaintenanceState =
        ScheduledMaintenanceState.fromJSONObject(
          {
            _id: "5a2b3c4d-0000-4000-8000-000000000042",
            name: "Ended",
            isScheduledState: false,
            isOngoingState: false,
            isEndedState: true,
            isResolvedState: false,
          },
          ScheduledMaintenanceState,
        );

      const nameOnly: ScheduledMaintenanceState =
        ScheduledMaintenanceState.fromJSONObject(
          {
            _id: "5a2b3c4d-0000-4000-8000-000000000043",
            name: "Ongoing",
          },
          ScheduledMaintenanceState,
        );

      expect(shouldNotify(event, ongoing)).toBe(true);
      expect(shouldNotify(event, ended)).toBe(false);

      // The state's name is not what counts: only its flags do.
      expect(shouldNotify(event, nameOnly)).toBe(false);
    });

    test("does not change the models it reads", () => {
      const event: ScheduledMaintenance = makeModelEvent(false, false, true);

      shouldNotify(event, resolvedModelState);

      expect(event.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
        false,
      );
      expect(
        event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
      ).toBe(false);
      expect(
        event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
      ).toBe(true);
      expect(resolvedModelState.isScheduledState).toBe(false);
      expect(resolvedModelState.isOngoingState).toBe(false);
      expect(resolvedModelState.isEndedState).toBe(false);
      expect(resolvedModelState.isResolvedState).toBe(true);
    });
  });
});
