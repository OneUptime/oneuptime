import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleInvites, {
  NOTIFICATION_RULE_INVITEE_SWITCH,
  NotificationRuleInvitee,
  NotificationRuleInviteSwitches,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import { describe, expect, test } from "@jest/globals";

/*
 * Who joins the channel a rule creates: which kinds of people a rule for
 * each kind of record can add, and what a rule that does not say about
 * incident roles does - the switch the Incident Commander was missing.
 */

const ALL_EVENT_TYPES: Array<NotificationRuleEventType> = Object.values(
  NotificationRuleEventType,
);

describe("NotificationRuleInvites.getInvitees", () => {
  test.each([
    [
      NotificationRuleEventType.Incident,
      [
        NotificationRuleInvitee.OnCallResponders,
        NotificationRuleInvitee.IncidentRoles,
        NotificationRuleInvitee.Owners,
      ],
    ],
    [
      NotificationRuleEventType.IncidentEpisode,
      [
        NotificationRuleInvitee.OnCallResponders,
        NotificationRuleInvitee.IncidentRoles,
        NotificationRuleInvitee.Owners,
      ],
    ],
    [
      NotificationRuleEventType.Alert,
      [
        NotificationRuleInvitee.OnCallResponders,
        NotificationRuleInvitee.Owners,
      ],
    ],
    [
      NotificationRuleEventType.AlertEpisode,
      [
        NotificationRuleInvitee.OnCallResponders,
        NotificationRuleInvitee.Owners,
      ],
    ],
    [
      NotificationRuleEventType.ScheduledMaintenance,
      [NotificationRuleInvitee.Owners],
    ],
    [NotificationRuleEventType.Monitor, [NotificationRuleInvitee.Owners]],
    [
      NotificationRuleEventType.OnCallDutyPolicy,
      [NotificationRuleInvitee.Owners],
    ],
    // No owners, and no channel of its own: a case's rules post to channels that exist.
    [NotificationRuleEventType.SecurityCase, []],
  ] as Array<[NotificationRuleEventType, Array<NotificationRuleInvitee>]>)(
    "a %s rule can add %j, in the form's order",
    (
      eventType: NotificationRuleEventType,
      invitees: Array<NotificationRuleInvitee>,
    ) => {
      expect(NotificationRuleInvites.getInvitees(eventType)).toEqual(invitees);
    },
  );

  test("every kind of record with owners is answered, and only records an on-call policy pages for have on-call responders", () => {
    for (const eventType of ALL_EVENT_TYPES.filter(
      (kind: NotificationRuleEventType): boolean => {
        return kind !== NotificationRuleEventType.SecurityCase;
      },
    )) {
      const invitees: Array<NotificationRuleInvitee> =
        NotificationRuleInvites.getInvitees(eventType);

      expect(invitees).toContain(NotificationRuleInvitee.Owners);
      expect(invitees.includes(NotificationRuleInvitee.OnCallResponders)).toBe(
        [
          NotificationRuleEventType.Incident,
          NotificationRuleEventType.Alert,
          NotificationRuleEventType.IncidentEpisode,
          NotificationRuleEventType.AlertEpisode,
        ].includes(eventType),
      );
    }
  });

  test("an unknown kind of record has nobody to add", () => {
    expect(NotificationRuleInvites.getInvitees(undefined)).toEqual([]);
    expect(NotificationRuleInvites.getInvitees("Status Page" as never)).toEqual(
      [],
    );
  });
});

describe("NotificationRuleInvites.isInviting", () => {
  test("each kind follows its own switch", () => {
    for (const invitee of [
      NotificationRuleInvitee.OnCallResponders,
      NotificationRuleInvitee.IncidentRoles,
      NotificationRuleInvitee.Owners,
    ]) {
      const on: NotificationRuleInviteSwitches = {
        [NOTIFICATION_RULE_INVITEE_SWITCH[invitee]]: true,
      };
      const off: NotificationRuleInviteSwitches = {
        shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
        shouldInviteIncidentRolesToNewChannel: false,
        shouldInviteOwnersToNewChannel: false,
      };

      expect(
        NotificationRuleInvites.isInviting({
          rule: on,
          eventType: NotificationRuleEventType.Incident,
          invitee: invitee,
        }),
      ).toBe(true);
      expect(
        NotificationRuleInvites.isInviting({
          rule: off,
          eventType: NotificationRuleEventType.Incident,
          invitee: invitee,
        }),
      ).toBe(false);
    }
  });

  test("a kind the record does not have is never added, whatever the rule holds", () => {
    const everything: NotificationRuleInviteSwitches = {
      shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
      shouldInviteIncidentRolesToNewChannel: true,
      shouldInviteOwnersToNewChannel: true,
    };

    expect(
      NotificationRuleInvites.isInviting({
        rule: everything,
        eventType: NotificationRuleEventType.Alert,
        invitee: NotificationRuleInvitee.IncidentRoles,
      }),
    ).toBe(false);
    expect(
      NotificationRuleInvites.isInviting({
        rule: everything,
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        invitee: NotificationRuleInvitee.OnCallResponders,
      }),
    ).toBe(false);
    expect(
      NotificationRuleInvites.isInviting({
        rule: everything,
        eventType: NotificationRuleEventType.Monitor,
        invitee: NotificationRuleInvitee.Owners,
      }),
    ).toBe(true);
  });

  test("no rule adds nobody", () => {
    expect(
      NotificationRuleInvites.isInviting({
        rule: undefined,
        eventType: NotificationRuleEventType.Incident,
        invitee: NotificationRuleInvitee.Owners,
      }),
    ).toBe(false);
    expect(
      NotificationRuleInvites.isInviting({
        rule: null,
        eventType: NotificationRuleEventType.Incident,
        invitee: NotificationRuleInvitee.IncidentRoles,
      }),
    ).toBe(false);
  });

  /*
   * A rule saved before roles had a switch - or through the API or
   * Terraform without it - adds the people given a role when it adds the
   * owners (as it always did: roles were read off the owners' switch) or
   * the people paged on call (the customer's rule).
   */
  describe("a rule that does not say about incident roles", () => {
    test.each([
      [false, false, false],
      [true, false, true],
      [false, true, true],
      [true, true, true],
    ])(
      "owners %s, on-call responders %s: adds the people given a role: %s",
      (owners: boolean, onCall: boolean, expected: boolean) => {
        for (const eventType of [
          NotificationRuleEventType.Incident,
          NotificationRuleEventType.IncidentEpisode,
        ]) {
          expect(
            NotificationRuleInvites.isInviting({
              rule: {
                shouldInviteOwnersToNewChannel: owners,
                shouldAutomaticallyInviteOnCallUsersToNewChannel: onCall,
              },
              eventType: eventType,
              invitee: NotificationRuleInvitee.IncidentRoles,
            }),
          ).toBe(expected);
        }
      },
    );

    test("a switch said out loud wins, either way", () => {
      expect(
        NotificationRuleInvites.isInviting({
          rule: {
            shouldInviteOwnersToNewChannel: true,
            shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
            shouldInviteIncidentRolesToNewChannel: false,
          },
          eventType: NotificationRuleEventType.Incident,
          invitee: NotificationRuleInvitee.IncidentRoles,
        }),
      ).toBe(false);
      expect(
        NotificationRuleInvites.isInviting({
          rule: {
            shouldInviteOwnersToNewChannel: false,
            shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
            shouldInviteIncidentRolesToNewChannel: true,
          },
          eventType: NotificationRuleEventType.Incident,
          invitee: NotificationRuleInvitee.IncidentRoles,
        }),
      ).toBe(true);
    });

    test("a value that is not true or false in the stored JSON does not say", () => {
      expect(
        NotificationRuleInvites.isInviting({
          rule: {
            shouldInviteOwnersToNewChannel: true,
            shouldInviteIncidentRolesToNewChannel: "no" as never,
          },
          eventType: NotificationRuleEventType.Incident,
          invitee: NotificationRuleInvitee.IncidentRoles,
        }),
      ).toBe(true);
    });
  });
});

describe("NotificationRuleInvites.getInvited", () => {
  test("lists the kinds the rule adds, in the form's order", () => {
    expect(
      NotificationRuleInvites.getInvited({
        rule: {
          shouldInviteOwnersToNewChannel: true,
          shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
        },
        eventType: NotificationRuleEventType.Incident,
      }),
    ).toEqual([
      NotificationRuleInvitee.OnCallResponders,
      NotificationRuleInvitee.IncidentRoles,
      NotificationRuleInvitee.Owners,
    ]);

    expect(
      NotificationRuleInvites.getInvited({
        rule: { shouldAutomaticallyInviteOnCallUsersToNewChannel: true },
        eventType: NotificationRuleEventType.Alert,
      }),
    ).toEqual([NotificationRuleInvitee.OnCallResponders]);

    expect(
      NotificationRuleInvites.getInvited({
        rule: {},
        eventType: NotificationRuleEventType.Monitor,
      }),
    ).toEqual([]);
  });
});

describe("NotificationRuleInvites.getNewRuleSwitches", () => {
  test("a new rule adds everybody its kind of record has", () => {
    expect(
      NotificationRuleInvites.getNewRuleSwitches(
        NotificationRuleEventType.Incident,
      ),
    ).toEqual({
      shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
      shouldInviteIncidentRolesToNewChannel: true,
      shouldInviteOwnersToNewChannel: true,
    });

    expect(
      NotificationRuleInvites.getNewRuleSwitches(
        NotificationRuleEventType.Alert,
      ),
    ).toEqual({
      shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
      shouldInviteOwnersToNewChannel: true,
    });

    expect(
      NotificationRuleInvites.getNewRuleSwitches(
        NotificationRuleEventType.ScheduledMaintenance,
      ),
    ).toEqual({ shouldInviteOwnersToNewChannel: true });
  });

  test("and the switches read back as adding them", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      expect(
        NotificationRuleInvites.getInvited({
          rule: NotificationRuleInvites.getNewRuleSwitches(eventType),
          eventType: eventType,
        }),
      ).toEqual(NotificationRuleInvites.getInvitees(eventType));
    }
  });
});

describe("NotificationRuleInvites.withSwitchesAsTheyAct", () => {
  test("a rule that does not say about roles gets the value it acts on, said out loud", () => {
    expect(
      NotificationRuleInvites.withSwitchesAsTheyAct({
        rule: {
          shouldInviteOwnersToNewChannel: false,
          shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
        },
        eventType: NotificationRuleEventType.Incident,
      }),
    ).toEqual({
      shouldInviteOwnersToNewChannel: false,
      shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
      shouldInviteIncidentRolesToNewChannel: true,
    });

    const ownersOff: NotificationRuleInviteSwitches = {
      shouldInviteOwnersToNewChannel: false,
    };

    expect(
      NotificationRuleInvites.withSwitchesAsTheyAct({
        rule: ownersOff,
        eventType: NotificationRuleEventType.Incident,
      }).shouldInviteIncidentRolesToNewChannel,
    ).toBe(false);
  });

  test("a rule that says, or a kind of record without roles, is handed back as it is", () => {
    const says: NotificationRuleInviteSwitches = {
      shouldInviteOwnersToNewChannel: true,
      shouldInviteIncidentRolesToNewChannel: false,
    };

    expect(
      NotificationRuleInvites.withSwitchesAsTheyAct({
        rule: says,
        eventType: NotificationRuleEventType.Incident,
      }),
    ).toBe(says);

    const alertRule: NotificationRuleInviteSwitches = {
      shouldInviteOwnersToNewChannel: true,
    };

    expect(
      NotificationRuleInvites.withSwitchesAsTheyAct({
        rule: alertRule,
        eventType: NotificationRuleEventType.Alert,
      }),
    ).toBe(alertRule);
  });
});
