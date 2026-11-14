import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  ALWAYS_POSTED_UPDATE_KINDS,
  NotificationRuleUpdateKind,
  NotificationRuleUpdatesChoice,
  RuleOfChannel,
  RuleWithUpdates,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH UPDATES A WORKSPACE NOTIFICATION RULE POSTS (#7581).
 *
 * The customer's #executive-alerts channel wanted to hear that an incident
 * was declared and resolved, and every state change, note, owner and page
 * buried those two. A rule of an incident, alert, episode or scheduled
 * maintenance event now says which updates it posts: every update (no
 * list - every rule saved before, and every new rule), key updates only, or
 * the ones ticked. The first message and a video call's Join button are
 * posted whatever it says.
 *
 * An on-call policy rule chooses too (#7549), from updates of its own:
 * who is on call now, who is next, nobody on call, overrides, changes to
 * the policy and its owners. A NEW on-call rule starts on the key updates -
 * who is on call now, and when nobody is - where every other kind of rule
 * starts on every update.
 */

const {
  Created,
  VideoCallStarted,
  ResolvedAndReopened,
  StateChanges,
  SeverityChanges,
  PublicNotes,
  PrivateNotes,
  Owners,
  Paging,
  EpisodeMembers,
  Postmortem,
  AI,
  Edits,
  Other,
  OnCallNow,
  OnCallNext,
  NobodyOnCall,
  Overrides,
  PolicyChanges,
} = NotificationRuleUpdateKind;

const EVERY_KIND: Array<NotificationRuleUpdateKind> = Object.values(
  NotificationRuleUpdateKind,
);

// The kinds of rule that choose their updates, and those that post every one.
const CHOOSING: Array<NotificationRuleEventType> = [
  NotificationRuleEventType.Incident,
  NotificationRuleEventType.Alert,
  NotificationRuleEventType.IncidentEpisode,
  NotificationRuleEventType.AlertEpisode,
  NotificationRuleEventType.ScheduledMaintenance,
  NotificationRuleEventType.OnCallDutyPolicy,
];

const ON_CALL_RULE: NotificationRuleEventType =
  NotificationRuleEventType.OnCallDutyPolicy;

const NOT_CHOOSING: Array<NotificationRuleEventType> = Object.values(
  NotificationRuleEventType,
).filter((eventType: NotificationRuleEventType): boolean => {
  return !CHOOSING.includes(eventType);
});

const INCIDENT_KEY: Array<NotificationRuleUpdateKind> = [
  ResolvedAndReopened,
  SeverityChanges,
  PublicNotes,
  Postmortem,
];

const INCIDENT_RULE: NotificationRuleEventType =
  NotificationRuleEventType.Incident;

function channel(
  ruleIds: { first?: string; all?: unknown } = {},
): NotificationRuleWorkspaceChannel {
  return {
    id: "C0INC42",
    name: "inc-42",
    workspaceType: WorkspaceType.Slack,
    notificationRuleId: ruleIds.first as string,
    ...(ruleIds.all !== undefined
      ? { notificationRuleIds: ruleIds.all as Array<string> }
      : {}),
  };
}

describe("the kinds of update", () => {
  test("are their names, so a rule's JSON reads as the API documents it", () => {
    for (const [name, kind] of Object.entries(NotificationRuleUpdateKind)) {
      expect(kind).toBe(name);
    }

    expect(EVERY_KIND).toEqual([
      "Created",
      "VideoCallStarted",
      "ResolvedAndReopened",
      "StateChanges",
      "SeverityChanges",
      "PublicNotes",
      "PrivateNotes",
      "Owners",
      "Paging",
      "EpisodeMembers",
      "Postmortem",
      "AI",
      "Edits",
      "Other",
      "OnCallNow",
      "OnCallNext",
      "NobodyOnCall",
      "Overrides",
      "PolicyChanges",
    ]);
  });

  test("isUpdateKind takes every kind, exactly as written, and nothing else", () => {
    for (const kind of EVERY_KIND) {
      expect(NotificationRuleUpdates.isUpdateKind(kind)).toBe(true);
    }

    for (const value of [
      "created",
      "PUBLICNOTES",
      " PublicNotes",
      "Public notes",
      "",
      "Bogus",
      1,
      0,
      true,
      null,
      undefined,
      {},
      ["PublicNotes"],
    ]) {
      expect({
        value,
        kind: NotificationRuleUpdates.isUpdateKind(value),
      }).toEqual({ value, kind: false });
    }
  });

  test("the first message and a video call are posted by every rule, and only they", () => {
    expect(ALWAYS_POSTED_UPDATE_KINDS).toEqual([Created, VideoCallStarted]);

    for (const kind of EVERY_KIND) {
      expect({
        kind,
        always: NotificationRuleUpdates.isAlwaysPosted(kind),
      }).toEqual({
        kind,
        always: kind === Created || kind === VideoCallStarted,
      });
    }
  });
});

describe("the updates each kind of rule chooses from", () => {
  test("in the order its Updates step lists them", () => {
    expect(NotificationRuleUpdates.getChoosableKinds(INCIDENT_RULE)).toEqual([
      ResolvedAndReopened,
      StateChanges,
      SeverityChanges,
      PublicNotes,
      PrivateNotes,
      Owners,
      Paging,
      Postmortem,
      AI,
      Edits,
      Other,
    ]);

    // An alert has no status page and no postmortem.
    expect(
      NotificationRuleUpdates.getChoosableKinds(
        NotificationRuleEventType.Alert,
      ),
    ).toEqual([
      ResolvedAndReopened,
      StateChanges,
      SeverityChanges,
      PrivateNotes,
      Owners,
      Paging,
      AI,
      Edits,
      Other,
    ]);

    expect(
      NotificationRuleUpdates.getChoosableKinds(
        NotificationRuleEventType.IncidentEpisode,
      ),
    ).toEqual([
      ResolvedAndReopened,
      StateChanges,
      EpisodeMembers,
      PublicNotes,
      PrivateNotes,
      Owners,
      Paging,
      Other,
    ]);

    expect(
      NotificationRuleUpdates.getChoosableKinds(
        NotificationRuleEventType.AlertEpisode,
      ),
    ).toEqual([
      ResolvedAndReopened,
      StateChanges,
      EpisodeMembers,
      PrivateNotes,
      Owners,
      Paging,
      Other,
    ]);

    // A scheduled maintenance event's every state change is one update.
    expect(
      NotificationRuleUpdates.getChoosableKinds(
        NotificationRuleEventType.ScheduledMaintenance,
      ),
    ).toEqual([StateChanges, PublicNotes, PrivateNotes, Other]);

    /*
     * An on-call policy's: who is on call, and what changed about it -
     * nothing is Everything else.
     */
    expect(NotificationRuleUpdates.getChoosableKinds(ON_CALL_RULE)).toEqual([
      OnCallNow,
      OnCallNext,
      NobodyOnCall,
      Overrides,
      PolicyChanges,
      Owners,
    ]);
  });

  test("a record's updates are never an on-call policy's, nor the other way round", () => {
    const onCallOnly: Array<NotificationRuleUpdateKind> = [
      OnCallNow,
      OnCallNext,
      NobodyOnCall,
      Overrides,
      PolicyChanges,
    ];

    for (const eventType of CHOOSING) {
      const choosable: Array<NotificationRuleUpdateKind> =
        NotificationRuleUpdates.getChoosableKinds(eventType);

      for (const kind of onCallOnly) {
        expect({
          eventType,
          kind,
          offered: eventType === ON_CALL_RULE,
        }).toEqual({ eventType, kind, offered: choosable.includes(kind) });
      }
    }

    // Owners is the one update both have.
    expect(
      NotificationRuleUpdates.getChoosableKinds(ON_CALL_RULE).filter(
        (kind: NotificationRuleUpdateKind): boolean => {
          return NotificationRuleUpdates.getChoosableKinds(
            INCIDENT_RULE,
          ).includes(kind);
        },
      ),
    ).toEqual([Owners]);
  });

  test("monitor, security and SLO rules have no choice: they post every update", () => {
    expect(NOT_CHOOSING.length).toBeGreaterThan(0);

    for (const eventType of [...NOT_CHOOSING, undefined]) {
      expect(NotificationRuleUpdates.getChoosableKinds(eventType)).toEqual([]);
      expect(NotificationRuleUpdates.getKeyKinds(eventType)).toEqual([]);
      expect(NotificationRuleUpdates.canChooseUpdates(eventType)).toBe(false);
    }

    for (const eventType of CHOOSING) {
      expect(NotificationRuleUpdates.canChooseUpdates(eventType)).toBe(true);
    }
  });

  test("never offer what every rule posts anyway", () => {
    for (const eventType of CHOOSING) {
      for (const kind of NotificationRuleUpdates.getChoosableKinds(eventType)) {
        expect({ eventType, kind, always: false }).toEqual({
          eventType,
          kind,
          always: NotificationRuleUpdates.isAlwaysPosted(kind),
        });
      }
    }
  });

  test("leave no kind of update that no rule can choose", () => {
    const offered: Set<NotificationRuleUpdateKind> =
      new Set<NotificationRuleUpdateKind>(
        CHOOSING.flatMap((eventType: NotificationRuleEventType) => {
          return NotificationRuleUpdates.getChoosableKinds(eventType);
        }),
      );

    for (const kind of EVERY_KIND) {
      expect({ kind, offered: true }).toEqual({
        kind,
        offered:
          offered.has(kind) || NotificationRuleUpdates.isAlwaysPosted(kind),
      });
    }
  });

  test("hand out a copy, so a caller cannot change what the next one reads", () => {
    const first: Array<NotificationRuleUpdateKind> =
      NotificationRuleUpdates.getChoosableKinds(INCIDENT_RULE);
    first.length = 0;

    const key: Array<NotificationRuleUpdateKind> =
      NotificationRuleUpdates.getKeyKinds(INCIDENT_RULE);
    key.push(PrivateNotes);

    expect(
      NotificationRuleUpdates.getChoosableKinds(INCIDENT_RULE),
    ).toHaveLength(11);
    expect(NotificationRuleUpdates.getKeyKinds(INCIDENT_RULE)).toEqual(
      INCIDENT_KEY,
    );
  });
});

describe("Key updates only", () => {
  test("is what a quiet channel wants to hear, for each kind of rule", () => {
    expect(NotificationRuleUpdates.getKeyKinds(INCIDENT_RULE)).toEqual(
      INCIDENT_KEY,
    );
    expect(
      NotificationRuleUpdates.getKeyKinds(NotificationRuleEventType.Alert),
    ).toEqual([ResolvedAndReopened, SeverityChanges]);
    expect(
      NotificationRuleUpdates.getKeyKinds(
        NotificationRuleEventType.IncidentEpisode,
      ),
    ).toEqual([ResolvedAndReopened, PublicNotes]);
    expect(
      NotificationRuleUpdates.getKeyKinds(
        NotificationRuleEventType.AlertEpisode,
      ),
    ).toEqual([ResolvedAndReopened]);
    expect(
      NotificationRuleUpdates.getKeyKinds(
        NotificationRuleEventType.ScheduledMaintenance,
      ),
    ).toEqual([StateChanges, PublicNotes]);
    // An on-call channel: who is on call, and when nobody is.
    expect(NotificationRuleUpdates.getKeyKinds(ON_CALL_RULE)).toEqual([
      OnCallNow,
      NobodyOnCall,
    ]);
  });

  test("leaves an on-call channel's noise out: who is next, overrides, changes to the policy, owners", () => {
    for (const noise of [OnCallNext, Overrides, PolicyChanges, Owners]) {
      expect(NotificationRuleUpdates.getKeyKinds(ON_CALL_RULE)).not.toContain(
        noise,
      );
    }
  });

  test("is a choice of the rule's own updates, in their order, and never all of them", () => {
    for (const eventType of CHOOSING) {
      const choosable: Array<NotificationRuleUpdateKind> =
        NotificationRuleUpdates.getChoosableKinds(eventType);
      const key: Array<NotificationRuleUpdateKind> =
        NotificationRuleUpdates.getKeyKinds(eventType);

      expect(key.length).toBeGreaterThan(0);
      expect(key.length).toBeLessThan(choosable.length);
      expect(key).toEqual(
        choosable.filter((kind: NotificationRuleUpdateKind): boolean => {
          return key.includes(kind);
        }),
      );
    }
  });

  test("leaves the noise out: private notes, owners, paging and edits", () => {
    for (const eventType of CHOOSING) {
      for (const noise of [PrivateNotes, Owners, Paging, Edits, AI, Other]) {
        expect(NotificationRuleUpdates.getKeyKinds(eventType)).not.toContain(
          noise,
        );
      }
    }
  });
});

describe("the updates a rule chose, as stored", () => {
  test("none - a rule saved before there was a choice - is every update", () => {
    for (const rule of [
      undefined,
      null,
      {},
      { updatesToPost: undefined },
      { updatesToPost: null },
    ]) {
      expect(
        NotificationRuleUpdates.getChosenKinds(rule as never),
      ).toBeUndefined();
      expect(
        NotificationRuleUpdates.getChoice({
          rule: rule as never,
          eventType: INCIDENT_RULE,
        }),
      ).toBe(NotificationRuleUpdatesChoice.EveryUpdate);
      expect(
        NotificationRuleUpdates.getPostedKinds({
          rule: rule as never,
          eventType: INCIDENT_RULE,
        }),
      ).toEqual(NotificationRuleUpdates.getChoosableKinds(INCIDENT_RULE));
    }
  });

  test("JSON that is not a list - typed by hand - is every update too", () => {
    for (const updatesToPost of [
      "PublicNotes",
      7,
      true,
      { 0: "PublicNotes" },
    ]) {
      expect(
        NotificationRuleUpdates.getChosenKinds({
          updatesToPost: updatesToPost as never,
        }),
      ).toBeUndefined();
    }
  });

  test("keeps the kinds it knows, once each, as they were stored", () => {
    expect(
      NotificationRuleUpdates.getChosenKinds({
        updatesToPost: [
          PublicNotes,
          "Bogus",
          ResolvedAndReopened,
          PublicNotes,
          42,
          null,
        ] as never,
      }),
    ).toEqual([PublicNotes, ResolvedAndReopened]);
  });

  test("an empty list is no update at all, besides the first message", () => {
    expect(
      NotificationRuleUpdates.getChosenKinds({ updatesToPost: [] }),
    ).toEqual([]);
    expect(
      NotificationRuleUpdates.getPostedKinds({
        rule: { updatesToPost: [] },
        eventType: INCIDENT_RULE,
      }),
    ).toEqual([]);
    expect(
      NotificationRuleUpdates.getChoice({
        rule: { updatesToPost: [] },
        eventType: INCIDENT_RULE,
      }),
    ).toBe(NotificationRuleUpdatesChoice.ChosenUpdates);
  });
});

describe("the choice a rule shows on its Updates step", () => {
  test("Key updates only is the key list, stored in any order or twice over", () => {
    for (const updatesToPost of [
      INCIDENT_KEY,
      [...INCIDENT_KEY].reverse(),
      [...INCIDENT_KEY, PublicNotes, "Bogus"],
    ]) {
      expect(
        NotificationRuleUpdates.getChoice({
          rule: { updatesToPost: updatesToPost as never },
          eventType: INCIDENT_RULE,
        }),
      ).toBe(NotificationRuleUpdatesChoice.KeyUpdates);
    }
  });

  test("anything else ticked is Choose updates", () => {
    for (const updatesToPost of [
      [ResolvedAndReopened],
      [...INCIDENT_KEY, PrivateNotes],
      [PrivateNotes, Owners],
    ]) {
      expect(
        NotificationRuleUpdates.getChoice({
          rule: { updatesToPost: updatesToPost },
          eventType: INCIDENT_RULE,
        }),
      ).toBe(NotificationRuleUpdatesChoice.ChosenUpdates);
    }
  });

  test("the same list is Key updates only for one kind of rule and a choice for another", () => {
    const alertKey: Array<NotificationRuleUpdateKind> = [
      ResolvedAndReopened,
      SeverityChanges,
    ];

    expect(
      NotificationRuleUpdates.getChoice({
        rule: { updatesToPost: alertKey },
        eventType: NotificationRuleEventType.Alert,
      }),
    ).toBe(NotificationRuleUpdatesChoice.KeyUpdates);
    expect(
      NotificationRuleUpdates.getChoice({
        rule: { updatesToPost: alertKey },
        eventType: INCIDENT_RULE,
      }),
    ).toBe(NotificationRuleUpdatesChoice.ChosenUpdates);
  });

  test("a kind of rule with no choice shows every update, whatever is stored", () => {
    for (const eventType of [...NOT_CHOOSING, undefined]) {
      expect(
        NotificationRuleUpdates.getChoice({
          rule: { updatesToPost: [PublicNotes] },
          eventType: eventType,
        }),
      ).toBe(NotificationRuleUpdatesChoice.EveryUpdate);
    }
  });

  test("the posted updates are the rule's own, in its step's order, whatever order they were stored in", () => {
    expect(
      NotificationRuleUpdates.getPostedKinds({
        rule: { updatesToPost: [Other, PublicNotes, ResolvedAndReopened] },
        eventType: INCIDENT_RULE,
      }),
    ).toEqual([ResolvedAndReopened, PublicNotes, Other]);

    // A postmortem is not an alert's: an alert rule never posts one.
    expect(
      NotificationRuleUpdates.getPostedKinds({
        rule: { updatesToPost: [Postmortem, SeverityChanges] },
        eventType: NotificationRuleEventType.Alert,
      }),
    ).toEqual([SeverityChanges]);
  });
});

describe("saving a choice", () => {
  test("ticks are stored in the step's order", () => {
    expect(
      NotificationRuleUpdates.withChosenKinds<
        RuleWithUpdates & { name: string }
      >({
        rule: { name: "kept" },
        eventType: INCIDENT_RULE,
        kinds: [Postmortem, PrivateNotes, ResolvedAndReopened],
      }),
    ).toEqual({
      name: "kept",
      updatesToPost: [ResolvedAndReopened, PrivateNotes, Postmortem],
    });
  });

  test("every box ticked is every update: the list goes, so a later kind is posted too", () => {
    expect(
      NotificationRuleUpdates.withChosenKinds({
        rule: { updatesToPost: [PublicNotes] },
        eventType: INCIDENT_RULE,
        kinds: [
          ...NotificationRuleUpdates.getChoosableKinds(INCIDENT_RULE),
        ].reverse(),
      }),
    ).toEqual({});
  });

  test("no list given is every update", () => {
    expect(
      NotificationRuleUpdates.withChosenKinds({
        rule: { updatesToPost: [PublicNotes], other: 1 },
        eventType: INCIDENT_RULE,
        kinds: undefined,
      }),
    ).toEqual({ other: 1 });
  });

  test("a kind the rule cannot post, or the first message, is never stored", () => {
    expect(
      NotificationRuleUpdates.withChosenKinds({
        rule: {},
        eventType: NotificationRuleEventType.Alert,
        kinds: [Postmortem, PublicNotes, Created, VideoCallStarted, Paging],
      }),
    ).toEqual({ updatesToPost: [Paging] });
  });

  test("a kind of rule with no choice never stores a list", () => {
    for (const eventType of [...NOT_CHOOSING, undefined]) {
      expect(
        NotificationRuleUpdates.withChosenKinds({
          rule: { updatesToPost: [PublicNotes] },
          eventType: eventType,
          kinds: [PublicNotes],
        }),
      ).toEqual({});
    }
  });

  test("leaves the rule it was given as it was", () => {
    const rule: { updatesToPost: Array<NotificationRuleUpdateKind> } = {
      updatesToPost: [PublicNotes],
    };

    NotificationRuleUpdates.withChosenKinds({
      rule: rule,
      eventType: INCIDENT_RULE,
      kinds: [PrivateNotes],
    });
    NotificationRuleUpdates.withChoice({
      rule: rule,
      eventType: INCIDENT_RULE,
      choice: NotificationRuleUpdatesChoice.EveryUpdate,
    });

    expect(rule).toEqual({ updatesToPost: [PublicNotes] });
  });

  test("starts a rule that was not there yet", () => {
    expect(
      NotificationRuleUpdates.withChosenKinds({
        rule: undefined,
        eventType: INCIDENT_RULE,
        kinds: [PublicNotes],
      }),
    ).toEqual({ updatesToPost: [PublicNotes] });
  });

  test("each choice of the step stores what it says", () => {
    expect(
      NotificationRuleUpdates.withChoice({
        rule: { updatesToPost: [PrivateNotes] },
        eventType: INCIDENT_RULE,
        choice: NotificationRuleUpdatesChoice.EveryUpdate,
      }),
    ).toEqual({});

    expect(
      NotificationRuleUpdates.withChoice({
        rule: {},
        eventType: INCIDENT_RULE,
        choice: NotificationRuleUpdatesChoice.KeyUpdates,
      }),
    ).toEqual({ updatesToPost: INCIDENT_KEY });

    expect(
      NotificationRuleUpdates.withChoice({
        rule: {},
        eventType: INCIDENT_RULE,
        choice: NotificationRuleUpdatesChoice.ChosenUpdates,
        kinds: [Owners],
      }),
    ).toEqual({ updatesToPost: [Owners] });

    // Nothing ticked: only the first message.
    expect(
      NotificationRuleUpdates.withChoice({
        rule: {},
        eventType: INCIDENT_RULE,
        choice: NotificationRuleUpdatesChoice.ChosenUpdates,
      }),
    ).toEqual({ updatesToPost: [] });
  });

  test("what is saved reads back as the choice that saved it", () => {
    for (const eventType of CHOOSING) {
      for (const choice of Object.values(NotificationRuleUpdatesChoice)) {
        const choosable: Array<NotificationRuleUpdateKind> =
          NotificationRuleUpdates.getChoosableKinds(eventType);
        const kinds: Array<NotificationRuleUpdateKind> = [
          choosable[choosable.length - 1]!,
        ];
        const saved: { updatesToPost?: Array<NotificationRuleUpdateKind> } =
          NotificationRuleUpdates.withChoice({
            rule: {},
            eventType: eventType,
            choice: choice,
            kinds: kinds,
          });

        expect({
          eventType,
          choice: NotificationRuleUpdates.getChoice({
            rule: saved,
            eventType: eventType,
          }),
        }).toEqual({ eventType, choice });
      }
    }
  });
});

describe("whether a rule posts a message", () => {
  const KEY_RULE: { updatesToPost: Array<NotificationRuleUpdateKind> } = {
    updatesToPost: INCIDENT_KEY,
  };

  test("one that says nothing of its kind - a monitor's - goes everywhere", () => {
    expect(NotificationRuleUpdates.isPostedEverywhere(undefined)).toBe(true);
    expect(NotificationRuleUpdates.isPostedEverywhere([])).toBe(true);
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: { updatesToPost: [] },
        updateKinds: undefined,
      }),
    ).toBe(true);
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: { updatesToPost: [] },
        updateKinds: [],
      }),
    ).toBe(true);
  });

  test("the first message and a video call go everywhere, even to a rule that ticked nothing", () => {
    for (const updateKinds of [
      [Created],
      [VideoCallStarted],
      [PrivateNotes, VideoCallStarted],
    ]) {
      expect(NotificationRuleUpdates.isPostedEverywhere(updateKinds)).toBe(
        true,
      );
      expect(
        NotificationRuleUpdates.wantsUpdate({
          rule: { updatesToPost: [] },
          updateKinds: updateKinds,
        }),
      ).toBe(true);
    }

    expect(NotificationRuleUpdates.isPostedEverywhere([PrivateNotes])).toBe(
      false,
    );
  });

  test("a rule that chose nothing posts every update", () => {
    for (const rule of [undefined, null, {}]) {
      for (const kind of EVERY_KIND) {
        expect(
          NotificationRuleUpdates.wantsUpdate({
            rule: rule,
            updateKinds: [kind],
          }),
        ).toBe(true);
      }
    }
  });

  test("Key updates only posts a public note and leaves a private one out", () => {
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: KEY_RULE,
        updateKinds: [PublicNotes],
      }),
    ).toBe(true);
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: KEY_RULE,
        updateKinds: [PrivateNotes],
      }),
    ).toBe(false);

    for (const kind of [StateChanges, Owners, Paging, AI, Edits, Other]) {
      expect(
        NotificationRuleUpdates.wantsUpdate({
          rule: KEY_RULE,
          updateKinds: [kind],
        }),
      ).toBe(false);
    }
  });

  test("a message of two kinds is posted where either is wanted: an edit that changes the severity", () => {
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: KEY_RULE,
        updateKinds: [Edits, SeverityChanges],
      }),
    ).toBe(true);
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: { updatesToPost: [Edits] },
        updateKinds: [Edits, SeverityChanges],
      }),
    ).toBe(true);
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: { updatesToPost: [PublicNotes] },
        updateKinds: [Edits, SeverityChanges],
      }),
    ).toBe(false);
  });
});

describe("whether a record's channel gets a message", () => {
  const KEY: RuleOfChannel = {
    id: "rule-key",
    rule: { updatesToPost: INCIDENT_KEY },
  };
  const EVERY: RuleOfChannel = { id: "rule-every", rule: {} };
  const ALSO_KEY: RuleOfChannel = {
    id: "rule-also-key",
    rule: { updatesToPost: [ResolvedAndReopened] },
  };

  function wanted(data: {
    channel: NotificationRuleWorkspaceChannel;
    rules: Array<RuleOfChannel>;
    updateKinds: Array<NotificationRuleUpdateKind> | undefined;
  }): boolean {
    return NotificationRuleUpdates.isWantedInChannel(data);
  }

  test("a channel of a Key updates rule hears of a public note and not of a private one", () => {
    const ofKey: NotificationRuleWorkspaceChannel = channel({
      first: KEY.id,
      all: [KEY.id],
    });

    expect(
      wanted({
        channel: ofKey,
        rules: [KEY, EVERY],
        updateKinds: [PublicNotes],
      }),
    ).toBe(true);
    expect(
      wanted({
        channel: ofKey,
        rules: [KEY, EVERY],
        updateKinds: [PrivateNotes],
      }),
    ).toBe(false);
  });

  test("a channel two rules share hears what either wants", () => {
    expect(
      wanted({
        channel: channel({ first: KEY.id, all: [KEY.id, EVERY.id] }),
        rules: [KEY, EVERY],
        updateKinds: [PrivateNotes],
      }),
    ).toBe(true);

    // Shared by two quiet rules, neither of which wants it.
    expect(
      wanted({
        channel: channel({ first: KEY.id, all: [KEY.id, ALSO_KEY.id] }),
        rules: [KEY, ALSO_KEY, EVERY],
        updateKinds: [PrivateNotes],
      }),
    ).toBe(false);

    // The second rule counts as much as the first.
    expect(
      wanted({
        channel: channel({ first: KEY.id, all: [KEY.id, ALSO_KEY.id] }),
        rules: [KEY, ALSO_KEY],
        updateKinds: [SeverityChanges],
      }),
    ).toBe(true);
  });

  test("a channel stored with only its first rule is that rule's", () => {
    expect(
      wanted({
        channel: channel({ first: KEY.id }),
        rules: [KEY, EVERY],
        updateKinds: [PrivateNotes],
      }),
    ).toBe(false);

    // Its stored list of rules is JSON: anything but a list is not read.
    expect(
      wanted({
        channel: channel({ first: KEY.id, all: EVERY.id }),
        rules: [KEY, EVERY],
        updateKinds: [PrivateNotes],
      }),
    ).toBe(false);
  });

  test("a channel stored before its rules were, or whose rules were all deleted, hears everything", () => {
    for (const legacy of [
      channel({}),
      channel({ first: "" }),
      channel({ first: "rule-deleted", all: ["rule-deleted"] }),
    ]) {
      expect(
        wanted({
          channel: legacy,
          rules: [KEY],
          updateKinds: [PrivateNotes],
        }),
      ).toBe(true);
    }
  });

  test("another rule of the project does not speak for the channel", () => {
    expect(
      wanted({
        channel: channel({ first: KEY.id, all: [KEY.id] }),
        rules: [KEY, EVERY],
        updateKinds: [Owners],
      }),
    ).toBe(false);
  });

  test("the first message, a video call and a message of no kind are posted in every channel", () => {
    for (const updateKinds of [[Created], [VideoCallStarted], [], undefined]) {
      expect(
        wanted({
          channel: channel({ first: ALSO_KEY.id }),
          rules: [{ id: ALSO_KEY.id, rule: { updatesToPost: [] } }],
          updateKinds: updateKinds,
        }),
      ).toBe(true);
    }
  });
});

describe("which update a move between states is", () => {
  test("resolving it, or reopening it, is Resolved and reopened", () => {
    expect(
      NotificationRuleUpdates.getStateChangeKind({
        isResolved: true,
        wasResolved: false,
      }),
    ).toBe(ResolvedAndReopened);
    expect(
      NotificationRuleUpdates.getStateChangeKind({
        isResolved: false,
        wasResolved: true,
      }),
    ).toBe(ResolvedAndReopened);
  });

  test("any other - acknowledged, or on from Resolved to Closed - is another state change", () => {
    expect(
      NotificationRuleUpdates.getStateChangeKind({
        isResolved: false,
        wasResolved: false,
      }),
    ).toBe(StateChanges);
    expect(
      NotificationRuleUpdates.getStateChangeKind({
        isResolved: true,
        wasResolved: true,
      }),
    ).toBe(StateChanges);
  });
});

describe("what is wrong with the updates a rule is saved with", () => {
  test("nothing, when it lists none: every update", () => {
    for (const eventType of [...CHOOSING, ...NOT_CHOOSING, undefined]) {
      for (const updatesToPost of [undefined, null]) {
        expect(
          NotificationRuleUpdates.getValidationError({
            eventType,
            updatesToPost,
          }),
        ).toBeNull();
      }
    }
  });

  test("nothing, when it lists updates its kind of rule can choose, or none of them", () => {
    for (const eventType of CHOOSING) {
      const choosable: Array<NotificationRuleUpdateKind> =
        NotificationRuleUpdates.getChoosableKinds(eventType);

      for (const updatesToPost of [
        [],
        choosable,
        NotificationRuleUpdates.getKeyKinds(eventType),
        [choosable[0], choosable[0]],
      ]) {
        expect(
          NotificationRuleUpdates.getValidationError({
            eventType,
            updatesToPost,
          }),
        ).toBeNull();
      }
    }
  });

  test("a list on a rule that posts every update is refused, by the rule's kind", () => {
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: NotificationRuleEventType.Monitor,
        updatesToPost: [],
      }),
    ).toBe("Monitor rules post every update: leave updatesToPost out.");
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: NotificationRuleEventType.SecurityCase,
        updatesToPost: [Paging],
      }),
    ).toBe("Security Case rules post every update: leave updatesToPost out.");
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: undefined,
        updatesToPost: [Paging],
      }),
    ).toBe("These rules post every update: leave updatesToPost out.");
  });

  test("anything but a list is refused, with what the list may hold", () => {
    for (const updatesToPost of [
      "PublicNotes",
      1,
      true,
      { PublicNotes: true },
    ]) {
      expect(
        NotificationRuleUpdates.getValidationError({
          eventType: NotificationRuleEventType.ScheduledMaintenance,
          updatesToPost,
        }),
      ).toBe(
        "updatesToPost is a list of the updates the rule posts, any of: StateChanges, PublicNotes, PrivateNotes, Other. Leave it out to post every update.",
      );
    }
  });

  test("an on-call policy rule takes its own updates, and not a record's", () => {
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: ON_CALL_RULE,
        updatesToPost: [OnCallNow, NobodyOnCall, Owners],
      }),
    ).toBeNull();
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: ON_CALL_RULE,
        updatesToPost: [OnCallNow, Paging],
      }),
    ).toBe(
      'updatesToPost lists "Paging", which On-Call Duty Policy rules cannot choose. They choose any of: OnCallNow, OnCallNext, NobodyOnCall, Overrides, PolicyChanges, Owners.',
    );
    // ...and an incident rule none of an on-call policy's.
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: INCIDENT_RULE,
        updatesToPost: [OnCallNow],
      }),
    ).toContain('updatesToPost lists "OnCallNow", which Incident rules');
  });

  test("an update the kind of rule cannot choose is refused, by name", () => {
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: NotificationRuleEventType.Alert,
        updatesToPost: [SeverityChanges, Postmortem],
      }),
    ).toBe(
      'updatesToPost lists "Postmortem", which Alert rules cannot choose. They choose any of: ResolvedAndReopened, StateChanges, SeverityChanges, PrivateNotes, Owners, Paging, AI, Edits, Other.',
    );

    // What every rule posts is not chosen.
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: INCIDENT_RULE,
        updatesToPost: [Created],
      }),
    ).toContain('updatesToPost lists "Created", which Incident rules');
  });

  test("a value typed by hand is named, and a long one only by its start", () => {
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: INCIDENT_RULE,
        updatesToPost: ["public notes"],
      }),
    ).toContain('updatesToPost lists "public notes", which Incident rules');

    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: INCIDENT_RULE,
        updatesToPost: [{ kind: PublicNotes }],
      }),
    ).toContain('updatesToPost lists {"kind":"PublicNotes"}, which');

    const long: string = "x".repeat(500);
    const error: string = NotificationRuleUpdates.getValidationError({
      eventType: INCIDENT_RULE,
      updatesToPost: [long],
    })!;

    expect(error).toContain(`updatesToPost lists "${"x".repeat(79)}, which`);
    expect(error).not.toContain("x".repeat(80));
    expect(error.length).toBeLessThan(400);
  });
});

describe("what a new rule starts with", () => {
  test("a new on-call policy rule starts on the key updates: who is on call now, and when nobody is", () => {
    expect(
      NotificationRuleUpdates.getNewRuleUpdatesToPost(ON_CALL_RULE),
    ).toEqual([OnCallNow, NobodyOnCall]);
    expect(NotificationRuleUpdates.getNewRuleUpdates(ON_CALL_RULE)).toEqual({
      updatesToPost: [OnCallNow, NobodyOnCall],
    });

    // ...which its Updates step shows as Key updates only.
    expect(
      NotificationRuleUpdates.getChoice({
        rule: NotificationRuleUpdates.getNewRuleUpdates(ON_CALL_RULE),
        eventType: ON_CALL_RULE,
      }),
    ).toBe(NotificationRuleUpdatesChoice.KeyUpdates);
    expect(
      NotificationRuleUpdates.getNewRuleUpdatesToPost(ON_CALL_RULE),
    ).toEqual(NotificationRuleUpdates.getKeyKinds(ON_CALL_RULE));
  });

  test("every other new rule starts on every update, as rules always did", () => {
    for (const eventType of [
      ...Object.values(NotificationRuleEventType).filter(
        (eventType: NotificationRuleEventType): boolean => {
          return eventType !== ON_CALL_RULE;
        },
      ),
      undefined,
    ]) {
      expect({
        eventType,
        starts: NotificationRuleUpdates.getNewRuleUpdatesToPost(eventType),
      }).toEqual({ eventType, starts: undefined });
      expect(NotificationRuleUpdates.getNewRuleUpdates(eventType)).toEqual({});
    }
  });

  test("a rule saved before - an on-call rule with no list - goes on posting every update", () => {
    for (const kind of NotificationRuleUpdates.getChoosableKinds(
      ON_CALL_RULE,
    )) {
      expect(
        NotificationRuleUpdates.wantsUpdate({
          rule: {},
          updateKinds: [kind],
        }),
      ).toBe(true);
    }

    expect(
      NotificationRuleUpdates.getChoice({ rule: {}, eventType: ON_CALL_RULE }),
    ).toBe(NotificationRuleUpdatesChoice.EveryUpdate);
  });

  test("a new on-call rule posts a handoff and a gap, and not who is next, an override or a change to the policy", () => {
    const rule: RuleWithUpdates =
      NotificationRuleUpdates.getNewRuleUpdates(ON_CALL_RULE);

    for (const [kind, wanted] of [
      [OnCallNow, true],
      [NobodyOnCall, true],
      [OnCallNext, false],
      [Overrides, false],
      [PolicyChanges, false],
      [Owners, false],
      // The policy's first message is posted by every rule.
      [Created, true],
    ] as Array<[NotificationRuleUpdateKind, boolean]>) {
      expect({
        kind,
        wanted: NotificationRuleUpdates.wantsUpdate({
          rule: rule,
          updateKinds: [kind],
        }),
      }).toEqual({ kind, wanted });
    }
  });

  test("hands out a copy, so a new rule's list is its own", () => {
    const first: Array<NotificationRuleUpdateKind> =
      NotificationRuleUpdates.getNewRuleUpdatesToPost(ON_CALL_RULE)!;
    first.push(Overrides);

    expect(
      NotificationRuleUpdates.getNewRuleUpdatesToPost(ON_CALL_RULE),
    ).toEqual([OnCallNow, NobodyOnCall]);
  });
});
