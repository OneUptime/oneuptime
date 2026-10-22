import ObjectID from "../../ObjectID";
import NotificationRuleEventType from "./EventType";

/*
 * WHO JOINS THE CHANNEL A RULE CREATES.
 *
 * A rule that creates a Slack channel for each incident (alert, episode,
 * scheduled maintenance event, monitor, on-call policy) adds the record's
 * people to it - the kinds of people below, each as its own switch - and the
 * users and teams the rule names. Each kind joins when the channel is
 * created, if they are on the record already, and later, as they join the
 * record: the person an on-call policy pages when it is paged, the Incident
 * Commander when they are assigned (often when they acknowledge), an owner
 * when they are added. The channel is the rule's from the moment it is
 * created, so somebody joining the record later is added to it whatever the
 * record's conditions say by then.
 *
 * Shared by the server, which invites, and the Dashboard, which asks: one
 * place says which kinds a rule for each kind of record can invite, and
 * what a rule saved before a switch existed does.
 */
export enum NotificationRuleInvitee {
  // The people an on-call policy pages for the record, as they are paged.
  OnCallResponders = "OnCallResponders",
  /*
   * The people given an incident role - the Incident Commander, and any
   * other role a project adds - as they are assigned.
   */
  IncidentRoles = "IncidentRoles",
  // The record's owners - its owner users and the members of its owner teams.
  Owners = "Owners",
}

// The switches a rule's JSON holds for who joins its channel.
export interface NotificationRuleInviteSwitches {
  shouldAutomaticallyInviteOnCallUsersToNewChannel?: boolean | undefined;
  shouldInviteIncidentRolesToNewChannel?: boolean | undefined;
  shouldInviteOwnersToNewChannel?: boolean | undefined;
}

// The rule's own switch for each kind of person.
export const NOTIFICATION_RULE_INVITEE_SWITCH: Readonly<
  Record<NotificationRuleInvitee, keyof NotificationRuleInviteSwitches>
> = {
  [NotificationRuleInvitee.OnCallResponders]:
    "shouldAutomaticallyInviteOnCallUsersToNewChannel",
  [NotificationRuleInvitee.IncidentRoles]:
    "shouldInviteIncidentRolesToNewChannel",
  [NotificationRuleInvitee.Owners]: "shouldInviteOwnersToNewChannel",
};

export default class NotificationRuleInvites {
  /*
   * The kinds of people a rule for this kind of record can add to its
   * channel, in the order the rule form lists them. Records an on-call
   * policy pages for - incidents, alerts and their episodes - have on-call
   * responders; incidents and incident episodes have incident roles; every
   * record has owners.
   */
  public static getInvitees(
    eventType: NotificationRuleEventType | undefined,
  ): Array<NotificationRuleInvitee> {
    switch (eventType) {
      case NotificationRuleEventType.Incident:
      case NotificationRuleEventType.IncidentEpisode:
        return [
          NotificationRuleInvitee.OnCallResponders,
          NotificationRuleInvitee.IncidentRoles,
          NotificationRuleInvitee.Owners,
        ];
      case NotificationRuleEventType.Alert:
      case NotificationRuleEventType.AlertEpisode:
        return [
          NotificationRuleInvitee.OnCallResponders,
          NotificationRuleInvitee.Owners,
        ];
      case NotificationRuleEventType.ScheduledMaintenance:
      case NotificationRuleEventType.Monitor:
      case NotificationRuleEventType.OnCallDutyPolicy:
        return [NotificationRuleInvitee.Owners];
      // A security case has no owners and no channel of its own to add anybody to.
      case NotificationRuleEventType.SecurityCase:
        return [];
      default:
        return [];
    }
  }

  public static canInvite(data: {
    eventType: NotificationRuleEventType | undefined;
    invitee: NotificationRuleInvitee;
  }): boolean {
    return NotificationRuleInvites.getInvitees(data.eventType).includes(
      data.invitee,
    );
  }

  /*
   * Whether the rule adds this kind of person to its channel: its switch
   * for that kind is on.
   *
   * Incident roles had no switch of their own until the Incident Commander
   * was asked for by name: an incident's roles were added by the owners'
   * switch. A rule that does not say - saved before the switch, or through
   * the API or Terraform without it - adds the people given a role when it
   * adds the incident's owners or its on-call responders. A rule that adds
   * the people paged on call adds the commander leading their response
   * too: that the commander was left out of such a channel is what a
   * customer reported.
   */
  public static isInviting(data: {
    rule: NotificationRuleInviteSwitches | undefined | null;
    eventType: NotificationRuleEventType | undefined;
    invitee: NotificationRuleInvitee;
  }): boolean {
    if (
      !data.rule ||
      !NotificationRuleInvites.canInvite({
        eventType: data.eventType,
        invitee: data.invitee,
      })
    ) {
      return false;
    }

    const rule: NotificationRuleInviteSwitches = data.rule;

    if (data.invitee === NotificationRuleInvitee.IncidentRoles) {
      const saidSo: unknown = rule.shouldInviteIncidentRolesToNewChannel;

      if (typeof saidSo === "boolean") {
        return saidSo;
      }

      return (
        Boolean(rule.shouldInviteOwnersToNewChannel) ||
        (NotificationRuleInvites.canInvite({
          eventType: data.eventType,
          invitee: NotificationRuleInvitee.OnCallResponders,
        }) &&
          Boolean(rule.shouldAutomaticallyInviteOnCallUsersToNewChannel))
      );
    }

    return Boolean(rule[NOTIFICATION_RULE_INVITEE_SWITCH[data.invitee]]);
  }

  /*
   * The on-call schedules the rule names, whose on-call person joins its
   * channel (CreateChannelNotificationRule.inviteOnCallSchedulesToNewChannel),
   * each once and in the rule's order. Read from the rule as it is stored -
   * the ids the Dashboard saves, or ObjectIDs as JSON - and only real ids:
   * the rule is configuration a person or the API wrote, and a schedule id
   * that is not one must not stop its channel from being set up.
   */
  public static getOnCallScheduleIds(
    rule: { inviteOnCallSchedulesToNewChannel?: unknown } | undefined | null,
  ): Array<ObjectID> {
    const value: unknown = rule?.inviteOnCallSchedulesToNewChannel;

    if (!Array.isArray(value)) {
      return [];
    }

    const ids: Array<ObjectID> = [];

    for (const entry of value) {
      const id: string = NotificationRuleInvites.readId(entry);

      if (
        ObjectID.isValidUUID(id) &&
        !ids.some((known: ObjectID): boolean => {
          return known.toString().toLowerCase() === id.toLowerCase();
        })
      ) {
        ids.push(new ObjectID(id));
      }
    }

    return ids;
  }

  // An id as a rule stores it: a string, an ObjectID, or one as JSON.
  private static readId(entry: unknown): string {
    if (typeof entry === "string") {
      return entry.trim();
    }

    if (entry instanceof ObjectID) {
      return entry.toString().trim();
    }

    if (entry && typeof entry === "object") {
      const record: Record<string, unknown> = entry as Record<string, unknown>;

      for (const key of ["value", "_id"]) {
        if (typeof record[key] === "string") {
          return (record[key] as string).trim();
        }
      }
    }

    return "";
  }

  // The kinds of people the rule adds to its channel, in the form's order.
  public static getInvited(data: {
    rule: NotificationRuleInviteSwitches | undefined | null;
    eventType: NotificationRuleEventType | undefined;
  }): Array<NotificationRuleInvitee> {
    return NotificationRuleInvites.getInvitees(data.eventType).filter(
      (invitee: NotificationRuleInvitee): boolean => {
        return NotificationRuleInvites.isInviting({
          rule: data.rule,
          eventType: data.eventType,
          invitee: invitee,
        });
      },
    );
  }

  /*
   * The switches a new rule starts with: everyone the record has joins its
   * channel - the people paged, the people given a role and the owners.
   * Only the kinds this kind of record has.
   */
  public static getNewRuleSwitches(
    eventType: NotificationRuleEventType | undefined,
  ): NotificationRuleInviteSwitches {
    const switches: NotificationRuleInviteSwitches = {};

    for (const invitee of NotificationRuleInvites.getInvitees(eventType)) {
      switches[NOTIFICATION_RULE_INVITEE_SWITCH[invitee]] = true;
    }

    return switches;
  }

  /*
   * The rule with each of its switches as it acts: a rule that does not say
   * whether it adds the people given a role gets the value it acts on, so a
   * form shows what the rule does and saves it said out loud.
   */
  public static withSwitchesAsTheyAct<
    T extends NotificationRuleInviteSwitches,
  >(data: { rule: T; eventType: NotificationRuleEventType | undefined }): T {
    if (
      !NotificationRuleInvites.canInvite({
        eventType: data.eventType,
        invitee: NotificationRuleInvitee.IncidentRoles,
      }) ||
      typeof data.rule.shouldInviteIncidentRolesToNewChannel === "boolean"
    ) {
      return data.rule;
    }

    return {
      ...data.rule,
      shouldInviteIncidentRolesToNewChannel: NotificationRuleInvites.isInviting(
        {
          rule: data.rule,
          eventType: data.eventType,
          invitee: NotificationRuleInvitee.IncidentRoles,
        },
      ),
    };
  }
}
