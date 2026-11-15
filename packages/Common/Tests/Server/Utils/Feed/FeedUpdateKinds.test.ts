import { AlertEpisodeFeedEventType } from "../../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import { IncidentEpisodeFeedEventType } from "../../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { OnCallDutyPolicyFeedEventType } from "../../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { ScheduledMaintenanceFeedEventType } from "../../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import FeedUpdateKinds, {
  ALERT_EPISODE_FEED_UPDATE_KINDS,
  ALERT_FEED_UPDATE_KINDS,
  INCIDENT_EPISODE_FEED_UPDATE_KINDS,
  INCIDENT_FEED_UPDATE_KINDS,
  ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS,
  SCHEDULED_MAINTENANCE_FEED_UPDATE_KINDS,
} from "../../../../Server/Utils/Feed/FeedUpdateKinds";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY FEED ENTRY IS ONE KIND OF UPDATE A RULE CAN CHOOSE (#7581).
 *
 * A rule of Key updates only posts a public note and leaves a private one
 * out because a table says which update each kind of feed entry is
 * (Server/Utils/Feed/FeedUpdateKinds). Each table is typed as a Record of
 * its feed's event types, so a new kind of entry does not compile without
 * an answer; this holds the answers to what the rules can choose:
 *
 *   - every kind of entry has one, and each is an update that kind of rule
 *     can tick, or one every rule posts (the first message, a video call) -
 *     never one its rules cannot pick, which no channel could ever stop;
 *   - every update a rule can tick is something its record posts: a feed
 *     entry's type, or a kind its writer names (a resolve, a severity
 *     change) - never a box that changes nothing;
 *   - each feed service, and each writer that knows more than its entry's
 *     type, hands the kinds to the message it posts.
 */

const COMMON: string = path.resolve(__dirname, "../../../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(COMMON, relativePath), "utf-8");
}

// The source with its whitespace squeezed, so Prettier's line breaks do not matter.
function squeezed(relativePath: string): string {
  return source(relativePath).replace(/\s+/g, "");
}

interface FeedTable {
  name: string;
  eventType: NotificationRuleEventType;
  feedEventTypes: Array<string>;
  table: Readonly<Record<string, NotificationRuleUpdateKind>>;
  createdEntry: string;
  // The feed service that posts its entries, and the event type field it reads.
  service: string;
  feedEventTypeField: string;
  /*
   * The kinds its writers name for an entry beyond its type: resolving or
   * reopening it (the state timeline), a severity change (the record's
   * update hook).
   */
  namedByWriters: Array<NotificationRuleUpdateKind>;
}

const TABLES: Array<FeedTable> = [
  {
    name: "INCIDENT_FEED_UPDATE_KINDS",
    eventType: NotificationRuleEventType.Incident,
    feedEventTypes: Object.values(IncidentFeedEventType),
    table: INCIDENT_FEED_UPDATE_KINDS,
    createdEntry: IncidentFeedEventType.IncidentCreated,
    service: "Server/Services/IncidentFeedService.ts",
    feedEventTypeField: "incidentFeedEventType",
    namedByWriters: [
      NotificationRuleUpdateKind.ResolvedAndReopened,
      NotificationRuleUpdateKind.SeverityChanges,
    ],
  },
  {
    name: "ALERT_FEED_UPDATE_KINDS",
    eventType: NotificationRuleEventType.Alert,
    feedEventTypes: Object.values(AlertFeedEventType),
    table: ALERT_FEED_UPDATE_KINDS,
    createdEntry: AlertFeedEventType.AlertCreated,
    service: "Server/Services/AlertFeedService.ts",
    feedEventTypeField: "alertFeedEventType",
    namedByWriters: [
      NotificationRuleUpdateKind.ResolvedAndReopened,
      NotificationRuleUpdateKind.SeverityChanges,
    ],
  },
  {
    name: "INCIDENT_EPISODE_FEED_UPDATE_KINDS",
    eventType: NotificationRuleEventType.IncidentEpisode,
    feedEventTypes: Object.values(IncidentEpisodeFeedEventType),
    table: INCIDENT_EPISODE_FEED_UPDATE_KINDS,
    createdEntry: IncidentEpisodeFeedEventType.EpisodeCreated,
    service: "Server/Services/IncidentEpisodeFeedService.ts",
    feedEventTypeField: "incidentEpisodeFeedEventType",
    namedByWriters: [NotificationRuleUpdateKind.ResolvedAndReopened],
  },
  {
    name: "ALERT_EPISODE_FEED_UPDATE_KINDS",
    eventType: NotificationRuleEventType.AlertEpisode,
    feedEventTypes: Object.values(AlertEpisodeFeedEventType),
    table: ALERT_EPISODE_FEED_UPDATE_KINDS,
    createdEntry: AlertEpisodeFeedEventType.EpisodeCreated,
    service: "Server/Services/AlertEpisodeFeedService.ts",
    feedEventTypeField: "alertEpisodeFeedEventType",
    namedByWriters: [NotificationRuleUpdateKind.ResolvedAndReopened],
  },
  {
    name: "SCHEDULED_MAINTENANCE_FEED_UPDATE_KINDS",
    eventType: NotificationRuleEventType.ScheduledMaintenance,
    feedEventTypes: Object.values(ScheduledMaintenanceFeedEventType),
    table: SCHEDULED_MAINTENANCE_FEED_UPDATE_KINDS,
    createdEntry: ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
    service: "Server/Services/ScheduledMaintenanceFeedService.ts",
    feedEventTypeField: "scheduledMaintenanceFeedEventType",
    namedByWriters: [],
  },
  // An on-call policy's feed (#7549).
  {
    name: "ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS",
    eventType: NotificationRuleEventType.OnCallDutyPolicy,
    feedEventTypes: Object.values(OnCallDutyPolicyFeedEventType),
    table: ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS,
    createdEntry: OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated,
    service: "Server/Services/OnCallDutyPolicyFeedService.ts",
    feedEventTypeField: "onCallDutyPolicyFeedEventType",
    // Who is next: the handoff's lines say it (OnCallHandoffPosts).
    namedByWriters: [NotificationRuleUpdateKind.OnCallNext],
  },
];

describe("the feed tables", () => {
  test("cover every kind of rule that chooses its updates, and only those", () => {
    expect(
      TABLES.map((table: FeedTable): string => {
        return table.eventType;
      }).sort(),
    ).toEqual(
      Object.values(NotificationRuleEventType)
        .filter((eventType: NotificationRuleEventType): boolean => {
          return NotificationRuleUpdates.canChooseUpdates(eventType);
        })
        .sort(),
    );
  });

  test("say which update every kind of feed entry is", () => {
    for (const table of TABLES) {
      expect({
        table: table.name,
        entries: Object.keys(table.table).sort(),
      }).toEqual({
        table: table.name,
        entries: [...table.feedEventTypes].sort(),
      });

      for (const entry of table.feedEventTypes) {
        expect({
          table: table.name,
          entry,
          isKind: NotificationRuleUpdates.isUpdateKind(table.table[entry]),
        }).toEqual({ table: table.name, entry, isKind: true });
      }
    }
  });

  test("answer only with updates the rules can tick, or the ones every rule posts", () => {
    for (const table of TABLES) {
      const choosable: Array<NotificationRuleUpdateKind> =
        NotificationRuleUpdates.getChoosableKinds(table.eventType);

      for (const entry of table.feedEventTypes) {
        const kind: NotificationRuleUpdateKind = table.table[entry]!;

        expect({ table: table.name, entry, kind, pickable: true }).toEqual({
          table: table.name,
          entry,
          kind,
          pickable:
            choosable.includes(kind) ||
            NotificationRuleUpdates.isAlwaysPosted(kind),
        });
      }
    }
  });

  test("leave no box on a rule's Updates step that its record never posts", () => {
    for (const table of TABLES) {
      const answered: Set<NotificationRuleUpdateKind> =
        new Set<NotificationRuleUpdateKind>(Object.values(table.table));

      const onlyNamed: Array<NotificationRuleUpdateKind> =
        NotificationRuleUpdates.getChoosableKinds(table.eventType).filter(
          (kind: NotificationRuleUpdateKind): boolean => {
            return !answered.has(kind);
          },
        );

      expect({ table: table.name, onlyNamed }).toEqual({
        table: table.name,
        onlyNamed: table.namedByWriters,
      });
    }
  });

  test("make the record's first message the first message, which every rule posts", () => {
    for (const table of TABLES) {
      expect({
        table: table.name,
        kind: table.table[table.createdEntry],
      }).toEqual({
        table: table.name,
        kind: NotificationRuleUpdateKind.Created,
      });

      expect(
        Object.entries(table.table).filter(
          ([, kind]: [string, NotificationRuleUpdateKind]): boolean => {
            return kind === NotificationRuleUpdateKind.Created;
          },
        ),
      ).toEqual([[table.createdEntry, NotificationRuleUpdateKind.Created]]);
    }
  });

  test("a video call's Join button is posted everywhere, and a failed call is not", () => {
    expect(
      INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.VideoCallStarted],
    ).toBe(NotificationRuleUpdateKind.VideoCallStarted);
    expect(ALERT_FEED_UPDATE_KINDS[AlertFeedEventType.VideoCallStarted]).toBe(
      NotificationRuleUpdateKind.VideoCallStarted,
    );
    expect(
      INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.VideoCallFailed],
    ).toBe(NotificationRuleUpdateKind.Other);
    expect(ALERT_FEED_UPDATE_KINDS[AlertFeedEventType.VideoCallFailed]).toBe(
      NotificationRuleUpdateKind.Other,
    );
  });
});

describe("what the customer's quiet channel hears of an incident", () => {
  test("public notes and the postmortem, and not private notes", () => {
    expect(INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.PublicNote]).toBe(
      NotificationRuleUpdateKind.PublicNotes,
    );
    expect(
      INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.PublicNoteApproval],
    ).toBe(NotificationRuleUpdateKind.PublicNotes);
    expect(INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.PrivateNote]).toBe(
      NotificationRuleUpdateKind.PrivateNotes,
    );
    expect(
      INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.PostmortemNote],
    ).toBe(NotificationRuleUpdateKind.Postmortem);
  });

  test("owners and the incident's roles are Owners; pages are Paging; AI is AI", () => {
    for (const entry of [
      IncidentFeedEventType.OwnerUserAdded,
      IncidentFeedEventType.OwnerTeamAdded,
      IncidentFeedEventType.OwnerUserRemoved,
      IncidentFeedEventType.OwnerTeamRemoved,
      IncidentFeedEventType.IncidentMemberAdded,
      IncidentFeedEventType.IncidentMemberRemoved,
    ]) {
      expect(INCIDENT_FEED_UPDATE_KINDS[entry]).toBe(
        NotificationRuleUpdateKind.Owners,
      );
    }

    for (const entry of [
      IncidentFeedEventType.OnCallPolicy,
      IncidentFeedEventType.OnCallNotification,
      IncidentFeedEventType.OnCallRuleExecuted,
    ]) {
      expect(INCIDENT_FEED_UPDATE_KINDS[entry]).toBe(
        NotificationRuleUpdateKind.Paging,
      );
    }

    for (const entry of [
      IncidentFeedEventType.RootCause,
      IncidentFeedEventType.AutoRemediation,
      IncidentFeedEventType.VideoCallSummary,
    ]) {
      expect(INCIDENT_FEED_UPDATE_KINDS[entry]).toBe(
        NotificationRuleUpdateKind.AI,
      );
    }
  });

  test("a state change is another state change until its writer says it resolved or reopened the incident", () => {
    expect(
      INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.IncidentStateChanged],
    ).toBe(NotificationRuleUpdateKind.StateChanges);
    expect(
      INCIDENT_FEED_UPDATE_KINDS[IncidentFeedEventType.IncidentUpdated],
    ).toBe(NotificationRuleUpdateKind.Edits);
  });

  test("an alert's public note entry is not a public note: an alert has no status page", () => {
    expect(ALERT_FEED_UPDATE_KINDS[AlertFeedEventType.PublicNote]).toBe(
      NotificationRuleUpdateKind.Other,
    );
  });
});

describe("what an on-call channel hears of its policy (#7549)", () => {
  test("a handoff is who is on call now; a gap is nobody on call", () => {
    expect(
      ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS[
        OnCallDutyPolicyFeedEventType.RosterHandoff
      ],
    ).toBe(NotificationRuleUpdateKind.OnCallNow);
    expect(
      ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS[
        OnCallDutyPolicyFeedEventType.CoverageGapStarted
      ],
    ).toBe(NotificationRuleUpdateKind.NobodyOnCall);
  });

  test("overrides, changes to the policy and its owners are each an update of their own", () => {
    for (const [entry, kind] of [
      [
        OnCallDutyPolicyFeedEventType.UserOverrideAdded,
        NotificationRuleUpdateKind.Overrides,
      ],
      // An override edited: its cover or its times (#7630, #7631).
      [
        OnCallDutyPolicyFeedEventType.UserOverrideChanged,
        NotificationRuleUpdateKind.Overrides,
      ],
      [
        OnCallDutyPolicyFeedEventType.UserOverrideRemoved,
        NotificationRuleUpdateKind.Overrides,
      ],
      [
        OnCallDutyPolicyFeedEventType.OnCallDutyScheduleAdded,
        NotificationRuleUpdateKind.PolicyChanges,
      ],
      [
        OnCallDutyPolicyFeedEventType.OnCallDutyScheduleRemoved,
        NotificationRuleUpdateKind.PolicyChanges,
      ],
      [
        OnCallDutyPolicyFeedEventType.UserAdded,
        NotificationRuleUpdateKind.PolicyChanges,
      ],
      [
        OnCallDutyPolicyFeedEventType.UserRemoved,
        NotificationRuleUpdateKind.PolicyChanges,
      ],
      [
        OnCallDutyPolicyFeedEventType.TeamAdded,
        NotificationRuleUpdateKind.PolicyChanges,
      ],
      [
        OnCallDutyPolicyFeedEventType.TeamRemoved,
        NotificationRuleUpdateKind.PolicyChanges,
      ],
      [
        OnCallDutyPolicyFeedEventType.OwnerUserAdded,
        NotificationRuleUpdateKind.Owners,
      ],
      [
        OnCallDutyPolicyFeedEventType.OwnerUserRemoved,
        NotificationRuleUpdateKind.Owners,
      ],
      [
        OnCallDutyPolicyFeedEventType.OwnerTeamAdded,
        NotificationRuleUpdateKind.Owners,
      ],
      [
        OnCallDutyPolicyFeedEventType.OwnerTeamRemoved,
        NotificationRuleUpdateKind.Owners,
      ],
    ] as Array<[OnCallDutyPolicyFeedEventType, NotificationRuleUpdateKind]>) {
      expect({
        entry,
        kind: ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS[entry],
      }).toEqual({ entry, kind });
    }
  });

  test("nothing of an on-call policy is Everything else, which its rules cannot tick", () => {
    expect(Object.values(ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS)).not.toContain(
      NotificationRuleUpdateKind.Other,
    );
  });
});

describe("FeedUpdateKinds.resolve", () => {
  test("is the kinds the writer named, when it named any", () => {
    const named: Array<NotificationRuleUpdateKind> = [
      NotificationRuleUpdateKind.SeverityChanges,
      NotificationRuleUpdateKind.Edits,
    ];
    const resolved: Array<NotificationRuleUpdateKind> = FeedUpdateKinds.resolve(
      {
        named: named,
        ofType: NotificationRuleUpdateKind.Edits,
      },
    );

    expect(resolved).toEqual(named);
    // A copy: the writer's list is its own.
    expect(resolved).not.toBe(named);
  });

  test("is the entry type's, when the writer named none", () => {
    for (const named of [undefined, []]) {
      expect(
        FeedUpdateKinds.resolve({
          named: named,
          ofType: NotificationRuleUpdateKind.PrivateNotes,
        }),
      ).toEqual([NotificationRuleUpdateKind.PrivateNotes]);
    }
  });
});

describe("the writers hand the kinds to the message they post", () => {
  test("each feed service posts its entry as its type's update, or as its writer named it", () => {
    for (const table of TABLES) {
      const service: string = squeezed(table.service);

      expect({ service: table.service, resolves: true }).toEqual({
        service: table.service,
        resolves: service.includes(
          `updateKinds:FeedUpdateKinds.resolve({named:data.workspaceNotification.updateKinds,ofType:${table.name}[data.${table.feedEventTypeField}],}),`,
        ),
      });
      expect({ service: table.service, passes: true }).toEqual({
        service: table.service,
        passes: service.includes("updateKinds:data.updateKinds,"),
      });
    }
  });

  test("each state timeline says when a change resolved or reopened its record", () => {
    for (const timeline of [
      "Server/Services/IncidentStateTimelineService.ts",
      "Server/Services/AlertStateTimelineService.ts",
      "Server/Services/IncidentEpisodeStateTimelineService.ts",
      "Server/Services/AlertEpisodeStateTimelineService.ts",
    ]) {
      expect({ timeline, says: true }).toEqual({
        timeline,
        says: squeezed(timeline).includes(
          "updateKinds:[NotificationRuleUpdates.getStateChangeKind({",
        ),
      });
    }
  });

  test("an incident's and an alert's update hook says when the severity changed", () => {
    for (const hook of [
      "Server/Services/IncidentService.ts",
      "Server/Services/AlertService.ts",
    ]) {
      const code: string = squeezed(hook);

      expect({ hook, severity: true, passed: true }).toEqual({
        hook,
        severity: code.includes(
          "updateKinds.push(NotificationRuleUpdateKind.SeverityChanges);",
        ),
        passed: code.includes("updateKinds:Array.from(newSet(updateKinds)),"),
      });
    }

    // An incident's postmortem status is the postmortem's.
    expect(squeezed("Server/Services/IncidentService.ts")).toContain(
      "updateKinds.push(NotificationRuleUpdateKind.Postmortem);",
    );
  });

  test("an on-call policy's handoff lines say who is next where a rule wants that, and only there", () => {
    const posts: string = squeezed("Server/Utils/OnCall/OnCallHandoffPosts.ts");

    // The line with who is next, the line without, and who is next alone.
    expect(posts).toContain(
      "alsoWantedUpdateKinds:[NotificationRuleUpdateKind.OnCallNext]",
    );
    expect(posts).toContain(
      "notWantedUpdateKinds:[NotificationRuleUpdateKind.OnCallNext]",
    );
    expect(posts).toContain(
      "updateKinds:[NotificationRuleUpdateKind.OnCallNext],notWantedUpdateKinds:[NotificationRuleUpdateKind.OnCallNow]",
    );
    expect(
      squeezed("Server/Services/OnCallDutyPolicyFeedService.ts"),
    ).toContain("alsoWantedUpdateKinds:data.alsoWantedUpdateKinds");
  });

  test("every entry that names an escalation rule, or an override, gives the channels a short line instead", () => {
    for (const [writer, written] of [
      // Added and removed: an entry each, and a line each.
      ["Server/Services/OnCallDutyPolicyEscalationRuleUserService.ts", 2],
      ["Server/Services/OnCallDutyPolicyEscalationRuleTeamService.ts", 2],
      ["Server/Services/OnCallDutyPolicyEscalationRuleScheduleService.ts", 2],
      // An override added, changed (#7630, #7631) and removed.
      ["Server/Services/OnCallDutyPolicyUserOverrideService.ts", 3],
    ] as Array<[string, number]>) {
      const code: string = squeezed(writer);
      const entries: number =
        code.split(
          "OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem(",
        ).length - 1;
      const lines: number = (
        code.match(/chatInfoInMarkdown:[^,]*OnCallChatText\.\w+\(/g) || []
      ).length;

      expect({ writer, entries, lines }).toEqual({
        writer,
        entries: written,
        lines: written,
      });
    }

    // The override's three lines, one of each.
    const overrides: string = squeezed(
      "Server/Services/OnCallDutyPolicyUserOverrideService.ts",
    );

    for (const line of [
      "OnCallChatText.overrideAdded(",
      "OnCallChatText.overrideChanged(",
      "OnCallChatText.overrideRemoved(",
    ]) {
      expect({ line, times: overrides.split(line).length - 1 }).toEqual({
        line,
        times: 1,
      });
    }
  });

  test("a person, team or schedule taken out of an escalation rule is a change to the policy, not an owner removed", () => {
    // How a writer filed a removal as an owner's (before issue #7549).
    const OWNER_REMOVED: RegExp =
      /OnCallDutyPolicyFeedEventType\.Owner(User|Team)Removed/;

    for (const [writer, entry] of [
      [
        "Server/Services/OnCallDutyPolicyEscalationRuleUserService.ts",
        "UserRemoved",
      ],
      [
        "Server/Services/OnCallDutyPolicyEscalationRuleTeamService.ts",
        "TeamRemoved",
      ],
      [
        "Server/Services/OnCallDutyPolicyEscalationRuleScheduleService.ts",
        "OnCallDutyScheduleRemoved",
      ],
    ] as Array<[string, string]>) {
      const code: string = squeezed(writer);

      expect({ writer, files: true, asOwner: false }).toEqual({
        writer,
        files: code.includes(
          `onCallDutyPolicyFeedEventType:OnCallDutyPolicyFeedEventType.${entry},`,
        ),
        asOwner: OWNER_REMOVED.test(code),
      });
      expect(
        ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS[
          entry as OnCallDutyPolicyFeedEventType
        ],
      ).toBe(NotificationRuleUpdateKind.PolicyChanges);
    }
  });

  test("an on-call policy's run message is Paging, wherever it is posted", () => {
    const run: string = squeezed(
      "Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage.ts",
    );

    expect(
      run.split("updateKinds:[NotificationRuleUpdateKind.Paging]").length - 1,
    ).toBe(2);
  });
});
