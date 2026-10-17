import {
  ALERT_NOUNS,
  EpisodeMemberNouns,
  INCIDENT_NOUNS,
} from "./EpisodeMembersAdd";

/*
 * ONE EPISODE PER INCIDENT, OR PER ALERT.
 *
 * An incident can be in several incident episodes, and an alert in several
 * alert episodes. Some teams want each in one at most, so a project can say
 * so: Project.limitIncidentsToOneEpisode and Project.limitAlertsToOneEpisode,
 * the switches "An incident can be in only one episode" on Incidents ->
 * Settings -> Episodes and "An alert can be in only one episode" on Alerts ->
 * Settings -> Episodes. Both are off by default - an incident or an alert can
 * be in several episodes, as it always could.
 *
 * On, every way one joins an episode refuses one that is in another episode
 * already. Membership is the member rows (IncidentEpisodeMember /
 * AlertEpisodeMember); the record's own episode column only names the latest
 * of them (EpisodeMembershipReference).
 *
 *   - One member created on its own - POST /incident-episode-member, a
 *     workflow, Terraform, an MCP client: refused, naming the episode it is
 *     in when the caller can see that episode (getAddRefusal).
 *   - Several added together - POST /incident-episode-member/add-incidents,
 *     an episode's Add Incidents, the lists' Add to Existing Episode: each
 *     such one is not added, with IN_ANOTHER_EPISODE reason; the rest are.
 *   - An episode created with them (miscDataProps incidentIdsToAdd, the
 *     lists' Add to New Episode): the whole create is refused, naming them
 *     (getNewEpisodeRefusal), as it is for one the caller cannot see. The
 *     dashboard leaves them out before it asks.
 *   - The grouping rules: they never put one that is in an episode already
 *     into another.
 *
 * One that is in the episode it is added to already is answered as before:
 * left as it is. Taking one out of an episode is never refused. Turning the
 * switch on removes nothing: one that was in several episodes before stays
 * in them, and only joining yet another is refused.
 *
 * Shared by the server and the dashboard, so both read the same columns and
 * the same words.
 */

// The Project columns that turn it on.
export type EpisodeSingleMembershipColumn =
  | "limitIncidentsToOneEpisode"
  | "limitAlertsToOneEpisode";

export const INCIDENT_SINGLE_MEMBERSHIP_COLUMN: EpisodeSingleMembershipColumn =
  "limitIncidentsToOneEpisode";

export const ALERT_SINGLE_MEMBERSHIP_COLUMN: EpisodeSingleMembershipColumn =
  "limitAlertsToOneEpisode";

/*
 * Why one added together with others was not added: the server's words in
 * EpisodeMembersAddResult.notAdded, which the dashboard translates. Fixed
 * text, so the dialogs list every such one under one reason; which episode
 * each is in is on its own row.
 */
export const INCIDENT_IN_ANOTHER_EPISODE_REASON: string =
  "Already in another episode. An incident can be in only one episode in this project.";

export const ALERT_IN_ANOTHER_EPISODE_REASON: string =
  "Already in another episode. An alert can be in only one episode in this project.";

// The most records a refusal names one by one; any more are counted.
export const MAX_RECORDS_NAMED_IN_REFUSAL: number = 10;

export interface EpisodeSingleMembershipKind {
  column: EpisodeSingleMembershipColumn;
  nouns: EpisodeMemberNouns;
  // "Incident" / "Alert", at the start of a sentence.
  singularTitle: string;
  // "an incident can be in only one episode in this project".
  rule: string;
  // Where the switch is, as a refusal names it.
  settingLocation: string;
  inAnotherEpisodeReason: string;
}

export const INCIDENT_SINGLE_MEMBERSHIP: EpisodeSingleMembershipKind = {
  column: INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
  nouns: INCIDENT_NOUNS,
  singularTitle: "Incident",
  rule: "an incident can be in only one episode in this project",
  settingLocation: "Incidents > Settings > Episodes",
  inAnotherEpisodeReason: INCIDENT_IN_ANOTHER_EPISODE_REASON,
};

export const ALERT_SINGLE_MEMBERSHIP: EpisodeSingleMembershipKind = {
  column: ALERT_SINGLE_MEMBERSHIP_COLUMN,
  nouns: ALERT_NOUNS,
  singularTitle: "Alert",
  rule: "an alert can be in only one episode in this project",
  settingLocation: "Alerts > Settings > Episodes",
  inAnotherEpisodeReason: ALERT_IN_ANOTHER_EPISODE_REASON,
};

export default class EpisodeSingleMembership {
  /*
   * How a refusal names an incident, an alert or an episode: its number with
   * the project's prefix ("INC-12"), "#12" without one, or nothing when the
   * number is unknown.
   */
  public static getLabel(
    numberWithPrefix: string | undefined | null,
    number: number | undefined | null,
  ): string | null {
    const withPrefix: string = (numberWithPrefix || "").trim();

    if (withPrefix) {
      return withPrefix;
    }

    if (typeof number === "number") {
      return `#${number}`;
    }

    return null;
  }

  /*
   * Why one incident (or alert) may not join an episode: it is in another,
   * and the project allows one. Names the other episode when `episodeLabel`
   * is given - only ever one the caller can see - and says where the switch
   * is, for whoever wonders why.
   *
   * "Incident INC-12 is already in episode IE-3, and an incident can be in
   * only one episode in this project. Remove it from episode IE-3 first, or
   * turn this off in Incidents > Settings > Episodes."
   */
  public static getAddRefusal(data: {
    kind: EpisodeSingleMembershipKind;
    recordLabel: string | null;
    episodeLabel: string | null;
  }): string {
    const subject: string = data.recordLabel
      ? `${data.kind.singularTitle} ${data.recordLabel}`
      : `This ${data.kind.nouns.singular}`;

    const where: string = data.episodeLabel
      ? `episode ${data.episodeLabel}`
      : "another episode";

    const removeFrom: string = data.episodeLabel
      ? `episode ${data.episodeLabel}`
      : "that episode";

    return `${subject} is already in ${where}, and ${data.kind.rule}. Remove it from ${removeFrom} first, or turn this off in ${data.kind.settingLocation}.`;
  }

  /*
   * Why an episode may not be created with these incidents (or alerts):
   * they are in an episode already, and the project allows one. One label
   * per such record, null for one whose number is unknown. Names them by
   * number, the first MAX_RECORDS_NAMED_IN_REFUSAL of them, then how many
   * more; counts them when some have no number.
   *
   * "INC-12 and INC-14 are already in an episode, and an incident can be in
   * only one episode in this project. Leave them out, or remove them from
   * their episodes first."
   */
  public static getNewEpisodeRefusal(data: {
    kind: EpisodeSingleMembershipKind;
    recordLabels: Array<string | null>;
  }): string {
    const count: number = data.recordLabels.length;

    const labels: Array<string> = data.recordLabels.filter(
      (label: string | null): label is string => {
        return Boolean(label);
      },
    );

    if (count <= 1) {
      const subject: string = labels[0]
        ? `${data.kind.singularTitle} ${labels[0]}`
        : `One of the ${data.kind.nouns.plural}`;

      return `${subject} is already in an episode, and ${data.kind.rule}. Leave it out, or remove it from its episode first.`;
    }

    const subject: string =
      labels.length === count
        ? EpisodeSingleMembership.joinLabels(labels, data.kind.nouns)
        : `${count} of the ${data.kind.nouns.plural}`;

    return `${subject} are already in an episode, and ${data.kind.rule}. Leave them out, or remove them from their episodes first.`;
  }

  /*
   * "INC-12 and INC-14", "INC-1, INC-2 and INC-3", and past the most a
   * refusal names, "INC-1, ..., INC-10 and 5 more incidents".
   */
  public static joinLabels(
    labels: Array<string>,
    nouns: EpisodeMemberNouns,
  ): string {
    const named: Array<string> = labels.slice(0, MAX_RECORDS_NAMED_IN_REFUSAL);
    const notNamed: number = labels.length - named.length;

    if (notNamed > 0) {
      const noun: string = notNamed === 1 ? nouns.singular : nouns.plural;
      return `${named.join(", ")} and ${notNamed} more ${noun}`;
    }

    if (named.length <= 1) {
      return named[0] || "";
    }

    return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  }
}
