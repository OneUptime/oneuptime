import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import {
  ALREADY_ACKNOWLEDGED,
  ALREADY_AT_OR_PAST_STATE,
  ALREADY_RESOLVED,
  BULK_QUICK_MOVE_DESCRIPTIONS,
  BULK_QUICK_MOVE_TITLES,
  EVENT_STATE_KINDS,
  EventStateKind,
  EventStateKindDefinition,
  EventStateQuickMove,
  MARK_AS_STATE,
  QUICK_MOVE_RESULT_LABELS,
  ROW_CHANGE_STATE_DESCRIPTION,
} from "../../FeatureSet/Dashboard/src/Components/EventView/EventStateKinds";
import {
  EventStateLike,
  getMoveRefusal,
  getQuickMoveTarget,
  getRowStateId,
  getStateId,
  getStatesToOffer,
  isQuickMoveOffered,
} from "../../FeatureSet/Dashboard/src/Components/EventView/EventStateMoves";
import { BulkStateChangeNoteType } from "../../FeatureSet/Dashboard/src/Utils/BulkStateChange";

/*
 * "I dont see the button to assign to me, change priority, change status
 * here ... Please also check the entire product for missing things in more
 * menu just like this and build those as well." - the maintainer.
 *
 * Incidents, alerts, episodes and scheduled maintenance events are moved from
 * their lists - Acknowledge, Resolve, Mark as Ongoing / Ended, Change State,
 * in each row's ⋯ menu and in Bulk Actions - by one engine
 * (useEventStateActions). These hold its rules: which move a row is offered
 * (EventStateMoves), what the server is asked to leave alone and why, and
 * the catalogue of the five kinds (EventStateKinds) that says what differs
 * between them.
 */

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// A project's incident states, as the incidents list reads them.
const INCIDENT_STATES: Array<
  EventStateLike & {
    isCreatedState?: boolean;
    isAcknowledgedState?: boolean;
    isResolvedState?: boolean;
  }
> = [
  {
    _id: "a0000000-0000-4000-8000-000000000001",
    name: "Identified",
    order: 1,
    isCreatedState: true,
  },
  {
    _id: "a0000000-0000-4000-8000-000000000002",
    name: "Acknowledged",
    order: 2,
    isAcknowledgedState: true,
  },
  {
    _id: "a0000000-0000-4000-8000-000000000003",
    name: "Investigating",
    order: 3,
  },
  {
    _id: "a0000000-0000-4000-8000-000000000004",
    name: "Resolved",
    order: 4,
    isResolvedState: true,
  },
  {
    _id: "a0000000-0000-4000-8000-000000000005",
    name: "Postmortem",
    order: 5,
  },
  {
    _id: "a0000000-0000-4000-8000-000000000006",
    name: "Retired",
    order: 6,
    isArchived: true,
  },
];

const [IDENTIFIED, ACKNOWLEDGED, INVESTIGATING, RESOLVED, POSTMORTEM, RETIRED] =
  INCIDENT_STATES.map((state: EventStateLike): string => {
    return getStateId(state);
  }) as [string, string, string, string, string, string];

// A project's scheduled maintenance states.
const MAINTENANCE_STATES: Array<
  EventStateLike & {
    isScheduledState?: boolean;
    isOngoingState?: boolean;
    isEndedState?: boolean;
    isResolvedState?: boolean;
  }
> = [
  {
    _id: "b0000000-0000-4000-8000-000000000001",
    name: "Scheduled",
    order: 1,
    isScheduledState: true,
  },
  {
    _id: "b0000000-0000-4000-8000-000000000002",
    name: "Ongoing",
    order: 2,
    isOngoingState: true,
  },
  {
    _id: "b0000000-0000-4000-8000-000000000003",
    name: "Ended",
    order: 3,
    isEndedState: true,
  },
  {
    _id: "b0000000-0000-4000-8000-000000000004",
    name: "Completed",
    order: 4,
    isResolvedState: true,
  },
];

const [SCHEDULED, ONGOING, ENDED, COMPLETED] = MAINTENANCE_STATES.map(
  (state: EventStateLike): string => {
    return getStateId(state);
  },
) as [string, string, string, string];

const INCIDENT: EventStateKindDefinition =
  EVENT_STATE_KINDS[EventStateKind.Incident];
const ALERT: EventStateKindDefinition = EVENT_STATE_KINDS[EventStateKind.Alert];
const MAINTENANCE: EventStateKindDefinition =
  EVENT_STATE_KINDS[EventStateKind.ScheduledMaintenance];

type OfferedFunction = (data: {
  definition: EventStateKindDefinition;
  states: Array<EventStateLike>;
  currentStateId: string | null | undefined;
}) => Array<EventStateQuickMove>;

// The named moves a row in that state is offered, in the kind's order.
const offered: OfferedFunction = (data: {
  definition: EventStateKindDefinition;
  states: Array<EventStateLike>;
  currentStateId: string | null | undefined;
}): Array<EventStateQuickMove> => {
  return data.definition.quickMoves.filter(
    (move: EventStateQuickMove): boolean => {
      return isQuickMoveOffered({
        definition: data.definition,
        states: data.states,
        move: move,
        currentStateId: data.currentStateId,
      });
    },
  );
};

describe("where a named move goes", () => {
  test("Acknowledge and Resolve go to the project's acknowledged and resolved states", () => {
    expect(
      getStateId(
        getQuickMoveTarget({
          definition: INCIDENT,
          states: INCIDENT_STATES,
          move: EventStateQuickMove.Acknowledge,
        }),
      ),
    ).toBe(ACKNOWLEDGED);
    expect(
      getStateId(
        getQuickMoveTarget({
          definition: INCIDENT,
          states: INCIDENT_STATES,
          move: EventStateQuickMove.Resolve,
        }),
      ),
    ).toBe(RESOLVED);
  });

  test("Mark as Ongoing and Mark as Ended go to the ongoing and ended states, a project without an ended state to its completed one", () => {
    expect(
      getStateId(
        getQuickMoveTarget({
          definition: MAINTENANCE,
          states: MAINTENANCE_STATES,
          move: EventStateQuickMove.Start,
        }),
      ),
    ).toBe(ONGOING);
    expect(
      getStateId(
        getQuickMoveTarget({
          definition: MAINTENANCE,
          states: MAINTENANCE_STATES,
          move: EventStateQuickMove.End,
        }),
      ),
    ).toBe(ENDED);

    const withoutEnded: Array<EventStateLike> = MAINTENANCE_STATES.filter(
      (state: EventStateLike): boolean => {
        return getStateId(state) !== ENDED;
      },
    );

    expect(
      getStateId(
        getQuickMoveTarget({
          definition: MAINTENANCE,
          states: withoutEnded,
          move: EventStateQuickMove.End,
        }),
      ),
    ).toBe(COMPLETED);
  });

  test("a maintenance event has no Acknowledge or Resolve, and a project without the state offers no such move", () => {
    expect(
      getQuickMoveTarget({
        definition: MAINTENANCE,
        states: MAINTENANCE_STATES,
        move: EventStateQuickMove.Acknowledge,
      }),
    ).toBeNull();
    expect(
      getQuickMoveTarget({
        definition: MAINTENANCE,
        states: MAINTENANCE_STATES,
        move: EventStateQuickMove.Resolve,
      }),
    ).toBeNull();
    expect(
      getQuickMoveTarget({
        definition: INCIDENT,
        states: [],
        move: EventStateQuickMove.Acknowledge,
      }),
    ).toBeNull();
    expect(
      isQuickMoveOffered({
        definition: INCIDENT,
        states: [],
        move: EventStateQuickMove.Acknowledge,
        currentStateId: undefined,
      }),
    ).toBe(false);
  });
});

describe("which named moves a row is offered", () => {
  test.each([
    ["Identified", IDENTIFIED, ["Acknowledge", "Resolve"]],
    ["Acknowledged", ACKNOWLEDGED, ["Resolve"]],
    // Placed after Acknowledged: acknowledged already.
    ["Investigating", INVESTIGATING, ["Resolve"]],
    ["Resolved", RESOLVED, []],
    // Placed after Resolved: resolved already.
    ["Postmortem", POSTMORTEM, []],
  ] as Array<[string, string, Array<string>]>)(
    "an incident in %s is offered %j",
    (_name: string, current: string, expected: Array<string>) => {
      expect(
        offered({
          definition: INCIDENT,
          states: INCIDENT_STATES,
          currentStateId: current,
        }),
      ).toEqual(expected);
    },
  );

  test("a row whose state the list did not read is offered both, and the move asks the server", () => {
    expect(
      offered({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        currentStateId: "",
      }),
    ).toEqual(["Acknowledge", "Resolve"]);
  });

  test("an alert's list reads its own states the same way", () => {
    expect(
      offered({
        definition: ALERT,
        states: INCIDENT_STATES,
        currentStateId: ACKNOWLEDGED,
      }),
    ).toEqual(["Resolve"]);
  });

  test.each([
    ["Scheduled", SCHEDULED, ["Start", "End"]],
    ["Ongoing", ONGOING, ["End"]],
    ["Ended", ENDED, []],
    ["Completed", COMPLETED, []],
  ] as Array<[string, string, Array<string>]>)(
    "a maintenance event in %s is offered %j",
    (_name: string, current: string, expected: Array<string>) => {
      expect(
        offered({
          definition: MAINTENANCE,
          states: MAINTENANCE_STATES,
          currentStateId: current,
        }),
      ).toEqual(expected);
    },
  );
});

describe("what a move leaves alone, and why", () => {
  test("Acknowledge leaves an acknowledged record alone - or one further along", () => {
    for (const current of [ACKNOWLEDGED, INVESTIGATING, RESOLVED]) {
      expect(
        getMoveRefusal({
          definition: INCIDENT,
          states: INCIDENT_STATES,
          move: EventStateQuickMove.Acknowledge,
          currentStateId: current,
          targetStateId: ACKNOWLEDGED,
        }),
      ).toBe(ALREADY_ACKNOWLEDGED);
    }
  });

  test("Resolve leaves a resolved record alone - or one further along", () => {
    for (const current of [RESOLVED, POSTMORTEM]) {
      expect(
        getMoveRefusal({
          definition: INCIDENT,
          states: INCIDENT_STATES,
          move: EventStateQuickMove.Resolve,
          currentStateId: current,
          targetStateId: RESOLVED,
        }),
      ).toBe(ALREADY_RESOLVED);
    }
  });

  test("Change State never moves a record into the state it is in, or back up the list", () => {
    expect(
      getMoveRefusal({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        move: null,
        currentStateId: INVESTIGATING,
        targetStateId: INVESTIGATING,
      }),
    ).toBe(ALREADY_AT_OR_PAST_STATE);
    expect(
      getMoveRefusal({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        move: null,
        currentStateId: RESOLVED,
        targetStateId: INVESTIGATING,
      }),
    ).toBe(ALREADY_AT_OR_PAST_STATE);
  });

  test("a move forward is made", () => {
    expect(
      getMoveRefusal({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        move: null,
        currentStateId: IDENTIFIED,
        targetStateId: INVESTIGATING,
      }),
    ).toBeNull();
    expect(
      getMoveRefusal({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        move: EventStateQuickMove.Acknowledge,
        currentStateId: IDENTIFIED,
        targetStateId: ACKNOWLEDGED,
      }),
    ).toBeNull();
    expect(
      getMoveRefusal({
        definition: MAINTENANCE,
        states: MAINTENANCE_STATES,
        move: EventStateQuickMove.End,
        currentStateId: SCHEDULED,
        targetStateId: ENDED,
      }),
    ).toBeNull();
  });

  test("a maintenance event already ended is not ended again", () => {
    expect(
      getMoveRefusal({
        definition: MAINTENANCE,
        states: MAINTENANCE_STATES,
        move: EventStateQuickMove.End,
        currentStateId: ENDED,
        targetStateId: ENDED,
      }),
    ).toBe(ALREADY_AT_OR_PAST_STATE);
  });
});

describe("the states a row's Change State offers", () => {
  test("the ones after the row's, archived ones left out", () => {
    expect(
      getStatesToOffer({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        currentStateId: ACKNOWLEDGED,
      }).map(getStateId),
    ).toEqual([INVESTIGATING, RESOLVED, POSTMORTEM]);
  });

  test("none after the last live one: the row's Change State is not offered", () => {
    expect(
      getStatesToOffer({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        currentStateId: POSTMORTEM,
      }),
    ).toEqual([]);
  });

  test("every live state for a row whose state the list did not read", () => {
    expect(
      getStatesToOffer({
        definition: INCIDENT,
        states: INCIDENT_STATES,
        currentStateId: undefined,
      }).map(getStateId),
    ).not.toContain(RETIRED);
  });
});

describe("a row's state, as the list read it", () => {
  test("is the _id of the record's current state", () => {
    expect(
      getRowStateId({
        definition: INCIDENT,
        item: { currentIncidentState: { _id: RESOLVED, name: "Resolved" } },
      }),
    ).toBe(RESOLVED);
    expect(
      getRowStateId({
        definition: MAINTENANCE,
        item: { currentScheduledMaintenanceState: { _id: ONGOING } },
      }),
    ).toBe(ONGOING);
  });

  test("is empty when the list did not read it", () => {
    expect(getRowStateId({ definition: INCIDENT, item: {} })).toBe("");
    expect(getRowStateId({ definition: INCIDENT, item: null })).toBe("");
    expect(
      getRowStateId({
        definition: INCIDENT,
        item: { currentIncidentState: null },
      }),
    ).toBe("");
  });
});

describe("the five kinds", () => {
  const KINDS: Array<EventStateKindDefinition> = Object.values(
    EVENT_STATE_KINDS,
  ) as Array<EventStateKindDefinition>;

  test("are incidents, alerts, both episodes and scheduled maintenance", () => {
    expect(
      KINDS.map((kind: EventStateKindDefinition): string => {
        return kind.kind;
      }).sort(),
    ).toEqual(
      [
        "Alert",
        "AlertEpisode",
        "Incident",
        "IncidentEpisode",
        "ScheduledMaintenance",
      ].sort(),
    );
  });

  test.each(
    KINDS.map((kind: EventStateKindDefinition) => {
      return [kind.kind, kind];
    }),
  )(
    "%s: the timeline and the record have the columns the engine writes and reads",
    (_name: unknown, kind: unknown) => {
      const definition: EventStateKindDefinition =
        kind as EventStateKindDefinition;
      const timeline: BaseModel = new definition.timelineModelType();
      const event: BaseModel = new definition.eventModelType();

      expect(timeline.hasColumn(definition.eventIdField)).toBe(true);
      expect(timeline.hasColumn(definition.stateIdField)).toBe(true);
      expect(timeline.hasColumn("projectId")).toBe(true);
      expect(
        (
          event.getTableColumnMetadata(
            definition.currentStateColumn,
          ) as TableColumnMetadata
        ).type,
      ).toBe(TableColumnType.Entity);

      if (definition.notifiesSubscribers) {
        expect(
          timeline.hasColumn("shouldStatusPageSubscribersBeNotified"),
        ).toBe(true);
      }
    },
  );

  test("only incidents and scheduled maintenance reach status page subscribers, with public notes", () => {
    for (const kind of KINDS) {
      const reaches: boolean =
        kind.kind === EventStateKind.Incident ||
        kind.kind === EventStateKind.ScheduledMaintenance;

      expect({ kind: kind.kind, notifies: kind.notifiesSubscribers }).toEqual({
        kind: kind.kind,
        notifies: reaches,
      });
      expect({ kind: kind.kind, noteType: kind.noteType }).toEqual({
        kind: kind.kind,
        noteType: reaches
          ? BulkStateChangeNoteType.Public
          : BulkStateChangeNoteType.Private,
      });
    }
  });

  test("only an incident is private on its own, and posts a private note then", () => {
    for (const kind of KINDS) {
      expect({ kind: kind.kind, privacy: kind.hasPerEventPrivacy }).toEqual({
        kind: kind.kind,
        privacy: kind.kind === EventStateKind.Incident,
      });
    }

    expect(INCIDENT.privateNoteModelType).toBeDefined();
  });

  test("incidents, alerts and episodes are acknowledged and resolved; maintenance is started and ended", () => {
    for (const kind of KINDS) {
      expect(kind.quickMoves).toEqual(
        kind.kind === EventStateKind.ScheduledMaintenance
          ? [EventStateQuickMove.Start, EventStateQuickMove.End]
          : [EventStateQuickMove.Acknowledge, EventStateQuickMove.Resolve],
      );

      for (const move of kind.quickMoves) {
        expect(kind.quickMoveWords[move]).toBeDefined();
      }
    }
  });

  test("a row's quick move says what the record's own page says", () => {
    expect(
      INCIDENT.quickMoveWords[EventStateQuickMove.Acknowledge]!.rowTitle,
    ).toBe("Acknowledge Incident");
    expect(
      INCIDENT.quickMoveWords[EventStateQuickMove.Acknowledge]!.rowDescription,
    ).toBe(
      "This records an acknowledgement on the incident timeline and stops any on-call escalation for this incident.",
    );
    expect(ALERT.quickMoveWords[EventStateQuickMove.Resolve]!.rowTitle).toBe(
      "Resolve Alert",
    );
    expect(
      MAINTENANCE.quickMoveWords[EventStateQuickMove.Start]!.rowTitle,
    ).toBe("Mark Scheduled Maintenance as {{state}}");
  });

  test("an episode's bulk Acknowledge and Resolve say its members move too", () => {
    expect(
      EVENT_STATE_KINDS[EventStateKind.IncidentEpisode].words
        .bulkMembersSentence,
    ).toBe("The incidents in each episode are updated too.");
    expect(
      EVENT_STATE_KINDS[EventStateKind.AlertEpisode].words.bulkMembersSentence,
    ).toBe("The alerts in each episode are updated too.");
    expect(INCIDENT.words.bulkMembersSentence).toBeUndefined();
  });
});

describe("the words, in every Dashboard language", () => {
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, "en.json"), "utf8"),
  ) as Record<string, string>;

  const locales: Record<string, Record<string, string>> = Object.fromEntries(
    LANGUAGES.map((language: string): [string, Record<string, string>] => {
      return [
        language,
        JSON.parse(
          fs.readFileSync(
            path.join(DASHBOARD_LOCALES, `${language}.json`),
            "utf8",
          ),
        ) as Record<string, string>,
      ];
    }),
  );

  const sentences: Array<string> = [
    ROW_CHANGE_STATE_DESCRIPTION,
    MARK_AS_STATE,
    ALREADY_ACKNOWLEDGED,
    ALREADY_RESOLVED,
    ALREADY_AT_OR_PAST_STATE,
    ...Object.values(BULK_QUICK_MOVE_DESCRIPTIONS),
    ...Object.values(BULK_QUICK_MOVE_TITLES).map(
      (template: { other: string }): string => {
        return template.other;
      },
    ),
    ...Object.values(QUICK_MOVE_RESULT_LABELS).flatMap(
      (labels: { succeeded: { other: string }; failed: { other: string } }) => {
        return [labels.succeeded.other, labels.failed.other];
      },
    ),
    ...(
      Object.values(EVENT_STATE_KINDS) as Array<EventStateKindDefinition>
    ).flatMap((kind: EventStateKindDefinition): Array<string> => {
      return [
        kind.words.changeStateTitle,
        kind.words.changeStateBulkDescription,
        kind.words.bulkNoteTitle,
        kind.words.bulkNoteDescription,
        kind.words.rowNoteDescription,
        ...(kind.words.rowPrivateNoteDescription
          ? [kind.words.rowPrivateNoteDescription]
          : []),
        ...(kind.words.bulkMembersSentence
          ? [kind.words.bulkMembersSentence]
          : []),
        ...Object.values(kind.quickMoveWords).flatMap(
          (words: {
            rowTitle: string;
            rowDescription: string;
          }): Array<string> => {
            return [words.rowTitle, words.rowDescription];
          },
        ),
      ];
    }),
  ];

  test.each(
    [...new Set(sentences)].map((sentence: string) => {
      return [sentence];
    }),
  )("%s is a Dashboard key, worded in every language", (sentence: string) => {
    expect(english[sentence]).toBe(sentence);

    for (const language of LANGUAGES) {
      const translated: string | undefined = locales[language]![sentence];

      expect({ language, isText: typeof translated === "string" }).toEqual({
        language,
        isText: true,
      });
      expect({ language, same: translated === sentence }).toEqual({
        language,
        same: false,
      });
    }
  });
});
