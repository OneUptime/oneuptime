import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
  NotificationRuleUpdatesChoice,
  RuleWithUpdates,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { describe, expect, test } from "@jest/globals";

/*
 * A NEW ON-CALL RULE STARTS ON THE KEY UPDATES, HOWEVER IT IS MADE (#7971).
 *
 * A rule made in the Dashboard started on Key updates only - who is on call
 * now, and when nobody is - and one made through the API or with Terraform
 * posted every hand-off, override and change to the policy: only the
 * Dashboard's form filled the list in. The server now gives a new on-call
 * policy rule its kind's list when its JSON leaves updatesToPost out
 * (withNewRuleUpdates), and an edit that leaves it out keeps the rule's
 * (withKeptUpdates), so Terraform, which writes a rule's JSON as its
 * configuration has it, never turns a quiet rule noisy at its first change.
 * null asks for every update, and the Dashboard's Every update sends it for
 * such a rule.
 *
 * Every other kind of rule starts on every update, as before, and is
 * written as it is sent.
 */

const { OnCallNow, OnCallNext, NobodyOnCall, Overrides, PublicNotes } =
  NotificationRuleUpdateKind;

const ON_CALL_RULE: NotificationRuleEventType =
  NotificationRuleEventType.OnCallDutyPolicy;
const INCIDENT_RULE: NotificationRuleEventType =
  NotificationRuleEventType.Incident;

const KEY_UPDATES: Array<NotificationRuleUpdateKind> = [
  OnCallNow,
  NobodyOnCall,
];

// Every kind of rule that starts on every update.
const STARTING_ON_EVERY_UPDATE: Array<NotificationRuleEventType> =
  Object.values(NotificationRuleEventType).filter(
    (eventType: NotificationRuleEventType): boolean => {
      return eventType !== ON_CALL_RULE;
    },
  );

type Rule = RuleWithUpdates & { filters?: Array<unknown>; name?: string };

describe("which kinds of rule start on chosen updates", () => {
  test("an on-call policy's, and no other", () => {
    expect(NotificationRuleUpdates.hasNewRuleUpdates(ON_CALL_RULE)).toBe(true);

    for (const eventType of [...STARTING_ON_EVERY_UPDATE, undefined]) {
      expect({
        eventType,
        has: NotificationRuleUpdates.hasNewRuleUpdates(eventType),
      }).toEqual({ eventType, has: false });
    }
  });
});

describe("whether a rule's JSON says which updates it posts", () => {
  test("a list, an empty list and null say it", () => {
    for (const updatesToPost of [[OnCallNow], [], null]) {
      expect(
        NotificationRuleUpdates.saysUpdatesToPost({
          filters: [],
          updatesToPost,
        }),
      ).toBe(true);
    }
  });

  test("a JSON that leaves it out, or holds it undefined, says nothing", () => {
    expect(NotificationRuleUpdates.saysUpdatesToPost({ filters: [] })).toBe(
      false,
    );
    expect(
      NotificationRuleUpdates.saysUpdatesToPost({ updatesToPost: undefined }),
    ).toBe(false);
  });

  test("no JSON at all says nothing", () => {
    for (const rule of [undefined, null, "OnCallNow", 1, [OnCallNow]]) {
      expect(NotificationRuleUpdates.saysUpdatesToPost(rule)).toBe(false);
    }
  });
});

describe("a new rule's updates, as the server stores them", () => {
  test("REGRESSION: an on-call rule sent without updatesToPost starts on the key updates, as the Dashboard's does", () => {
    const rule: Rule = NotificationRuleUpdates.withNewRuleUpdates<Rule>({
      rule: { filters: [], name: "From Terraform" },
      eventType: ON_CALL_RULE,
    });

    expect(rule).toEqual({
      filters: [],
      name: "From Terraform",
      updatesToPost: KEY_UPDATES,
    });
    expect(rule.updatesToPost).toEqual(
      NotificationRuleUpdates.getNewRuleUpdatesToPost(ON_CALL_RULE),
    );

    // ...which its Updates step reads as Key updates only.
    expect(
      NotificationRuleUpdates.getChoice({
        rule: rule,
        eventType: ON_CALL_RULE,
      }),
    ).toBe(NotificationRuleUpdatesChoice.KeyUpdates);
  });

  test("a list the caller sent is kept, an empty one too", () => {
    for (const updatesToPost of [
      [OnCallNext],
      [OnCallNow, Overrides],
      [] as Array<NotificationRuleUpdateKind>,
    ]) {
      expect(
        NotificationRuleUpdates.withNewRuleUpdates<Rule>({
          rule: { filters: [], updatesToPost },
          eventType: ON_CALL_RULE,
        }),
      ).toEqual({ filters: [], updatesToPost });
    }
  });

  test("null is every update, asked for: it is kept, and the rule posts every update", () => {
    const rule: Rule = NotificationRuleUpdates.withNewRuleUpdates<Rule>({
      rule: { filters: [], updatesToPost: null },
      eventType: ON_CALL_RULE,
    });

    expect(rule).toEqual({ filters: [], updatesToPost: null });
    expect(
      NotificationRuleUpdates.getChoice({
        rule: rule,
        eventType: ON_CALL_RULE,
      }),
    ).toBe(NotificationRuleUpdatesChoice.EveryUpdate);

    for (const kind of NotificationRuleUpdates.getChoosableKinds(
      ON_CALL_RULE,
    )) {
      expect(
        NotificationRuleUpdates.wantsUpdate({
          rule: rule,
          updateKinds: [kind],
        }),
      ).toBe(true);
    }
  });

  test("every other kind of rule is stored as it is sent, and posts every update", () => {
    for (const eventType of STARTING_ON_EVERY_UPDATE) {
      expect({
        eventType,
        rule: NotificationRuleUpdates.withNewRuleUpdates<Rule>({
          rule: { filters: [] },
          eventType,
        }),
      }).toEqual({ eventType, rule: { filters: [] } });
    }
  });

  test("leaves the JSON it was given as it was, and hands out a list of the rule's own", () => {
    const sent: Rule = { filters: [] };

    const first: Rule = NotificationRuleUpdates.withNewRuleUpdates<Rule>({
      rule: sent,
      eventType: ON_CALL_RULE,
    });
    first.updatesToPost!.push(Overrides);

    expect(sent).toEqual({ filters: [] });
    expect(
      NotificationRuleUpdates.withNewRuleUpdates<Rule>({
        rule: { filters: [] },
        eventType: ON_CALL_RULE,
      }).updatesToPost,
    ).toEqual(KEY_UPDATES);
  });

  test("no JSON, or something else, is handed back as it came", () => {
    for (const rule of [undefined, null, "text", [OnCallNow]]) {
      expect(
        NotificationRuleUpdates.withNewRuleUpdates<unknown>({
          rule,
          eventType: ON_CALL_RULE,
        }),
      ).toBe(rule);
    }
  });
});

describe("an edit that leaves updatesToPost out", () => {
  test("REGRESSION: keeps the key updates of an on-call rule Terraform made, at its first change", () => {
    const written: Rule = NotificationRuleUpdates.withKeptUpdates<Rule>({
      written: { filters: [{ checkOn: "On-Call Policy" }] },
      eventType: ON_CALL_RULE,
      stored: { updatesToPost: KEY_UPDATES },
      storedEventType: ON_CALL_RULE,
    });

    expect(written).toEqual({
      filters: [{ checkOn: "On-Call Policy" }],
      updatesToPost: KEY_UPDATES,
    });
  });

  test("keeps any list the rule posts, an empty one too, and null", () => {
    for (const kept of [
      [OnCallNext, Overrides],
      [] as Array<NotificationRuleUpdateKind>,
      null,
    ]) {
      expect(
        NotificationRuleUpdates.withKeptUpdates<Rule>({
          written: { filters: [] },
          eventType: ON_CALL_RULE,
          stored: { updatesToPost: kept },
          storedEventType: ON_CALL_RULE,
        }),
      ).toEqual({ filters: [], updatesToPost: kept });
    }
  });

  test("a rule saved before rules chose their updates goes on posting every update", () => {
    const written: Rule = NotificationRuleUpdates.withKeptUpdates<Rule>({
      written: { filters: [] },
      eventType: ON_CALL_RULE,
      stored: {},
      storedEventType: ON_CALL_RULE,
    });

    expect(written).toEqual({ filters: [] });
    expect(
      NotificationRuleUpdates.getChoice({
        rule: written,
        eventType: ON_CALL_RULE,
      }),
    ).toBe(NotificationRuleUpdatesChoice.EveryUpdate);

    // ...and one whose JSON is not there to read, too.
    expect(
      NotificationRuleUpdates.withKeptUpdates<Rule>({
        written: { filters: [] },
        eventType: ON_CALL_RULE,
        stored: undefined,
        storedEventType: ON_CALL_RULE,
      }),
    ).toEqual({ filters: [] });
  });

  test("a list or null the edit sends is written as it is sent", () => {
    for (const sent of [[OnCallNext], [], null]) {
      expect(
        NotificationRuleUpdates.withKeptUpdates<Rule>({
          written: { filters: [], updatesToPost: sent },
          eventType: ON_CALL_RULE,
          stored: { updatesToPost: KEY_UPDATES },
          storedEventType: ON_CALL_RULE,
        }),
      ).toEqual({ filters: [], updatesToPost: sent });
    }
  });

  test("a rule of a kind that starts on every update is written as it is sent, as before", () => {
    expect(
      NotificationRuleUpdates.withKeptUpdates<Rule>({
        written: { filters: [] },
        eventType: INCIDENT_RULE,
        stored: { updatesToPost: [PublicNotes] },
        storedEventType: INCIDENT_RULE,
      }),
    ).toEqual({ filters: [] });
  });

  test("a rule the edit makes an on-call rule is a new one: it starts on the key updates", () => {
    expect(
      NotificationRuleUpdates.withKeptUpdates<Rule>({
        written: { filters: [] },
        eventType: ON_CALL_RULE,
        stored: { updatesToPost: [PublicNotes] },
        storedEventType: INCIDENT_RULE,
      }),
    ).toEqual({ filters: [], updatesToPost: KEY_UPDATES });
  });

  test("an on-call rule the edit makes another kind keeps none of its on-call updates", () => {
    expect(
      NotificationRuleUpdates.withKeptUpdates<Rule>({
        written: { filters: [] },
        eventType: INCIDENT_RULE,
        stored: { updatesToPost: KEY_UPDATES },
        storedEventType: ON_CALL_RULE,
      }),
    ).toEqual({ filters: [] });
  });

  test("leaves what it was given as it was", () => {
    const sent: Rule = { filters: [] };
    const stored: Rule = { updatesToPost: [OnCallNow] };

    const written: Rule = NotificationRuleUpdates.withKeptUpdates<Rule>({
      written: sent,
      eventType: ON_CALL_RULE,
      stored: stored,
      storedEventType: ON_CALL_RULE,
    });
    written.updatesToPost!.push(Overrides);

    expect(sent).toEqual({ filters: [] });
    expect(stored).toEqual({ updatesToPost: [OnCallNow] });
  });
});

describe("the Dashboard's Every update, on a rule that starts on chosen updates", () => {
  test("an on-call rule says every update with null, so the server neither fills it in nor keeps the old list", () => {
    expect(
      NotificationRuleUpdates.withChoice<Rule>({
        rule: { filters: [], updatesToPost: KEY_UPDATES },
        eventType: ON_CALL_RULE,
        choice: NotificationRuleUpdatesChoice.EveryUpdate,
      }),
    ).toEqual({ filters: [], updatesToPost: null });

    // Every box ticked is every update too.
    expect(
      NotificationRuleUpdates.withChosenKinds<Rule>({
        rule: {},
        eventType: ON_CALL_RULE,
        kinds: NotificationRuleUpdates.getChoosableKinds(ON_CALL_RULE),
      }),
    ).toEqual({ updatesToPost: null });
  });

  test("the server keeps that null on a create and on an edit", () => {
    const saved: Rule = NotificationRuleUpdates.withChoice<Rule>({
      rule: NotificationRuleUpdates.getNewRuleUpdates(ON_CALL_RULE),
      eventType: ON_CALL_RULE,
      choice: NotificationRuleUpdatesChoice.EveryUpdate,
    });

    expect(
      NotificationRuleUpdates.withNewRuleUpdates<Rule>({
        rule: saved,
        eventType: ON_CALL_RULE,
      }),
    ).toEqual({ updatesToPost: null });
    expect(
      NotificationRuleUpdates.withKeptUpdates<Rule>({
        written: saved,
        eventType: ON_CALL_RULE,
        stored: { updatesToPost: KEY_UPDATES },
        storedEventType: ON_CALL_RULE,
      }),
    ).toEqual({ updatesToPost: null });
  });

  test("Key updates only and Choose updates store their list, as before", () => {
    expect(
      NotificationRuleUpdates.withChoice<Rule>({
        rule: { updatesToPost: null },
        eventType: ON_CALL_RULE,
        choice: NotificationRuleUpdatesChoice.KeyUpdates,
      }),
    ).toEqual({ updatesToPost: KEY_UPDATES });
    expect(
      NotificationRuleUpdates.withChoice<Rule>({
        rule: { updatesToPost: null },
        eventType: ON_CALL_RULE,
        choice: NotificationRuleUpdatesChoice.ChosenUpdates,
        kinds: [OnCallNext],
      }),
    ).toEqual({ updatesToPost: [OnCallNext] });
  });

  test("every other kind of rule still takes the list out for every update", () => {
    for (const eventType of [
      INCIDENT_RULE,
      NotificationRuleEventType.Alert,
      NotificationRuleEventType.ScheduledMaintenance,
      NotificationRuleEventType.SecurityCase,
    ]) {
      expect({
        eventType,
        rule: NotificationRuleUpdates.withChoice<Rule>({
          rule: { filters: [], updatesToPost: [] },
          eventType,
          choice: NotificationRuleUpdatesChoice.EveryUpdate,
        }),
      }).toEqual({ eventType, rule: { filters: [] } });
    }
  });
});

describe("what the API tells a caller who sends something else", () => {
  test("an on-call rule is told to send null for every update, as leaving it out starts on the key updates", () => {
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: ON_CALL_RULE,
        updatesToPost: "OnCallNow",
      }),
    ).toBe(
      "updatesToPost is a list of the updates the rule posts, any of: OnCallNow, OnCallNext, NobodyOnCall, Overrides, PolicyChanges, Owners. Send null to post every update.",
    );
  });

  test("every other kind of rule is still told to leave it out", () => {
    expect(
      NotificationRuleUpdates.getValidationError({
        eventType: INCIDENT_RULE,
        updatesToPost: "PublicNotes",
      }),
    ).toContain("Leave it out to post every update.");
  });

  test("null is taken from every kind of rule", () => {
    for (const eventType of Object.values(NotificationRuleEventType)) {
      expect(
        NotificationRuleUpdates.getValidationError({
          eventType,
          updatesToPost: null,
        }),
      ).toBeNull();
    }
  });
});
