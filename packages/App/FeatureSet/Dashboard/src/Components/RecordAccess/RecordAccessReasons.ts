import { formatNameList } from "../AiAccess/AiAccessModes";
import {
  PRIVATE_RECORD_REASONS,
  PrivateRecordReasons,
} from "../PrivateRecord/PrivateRecordScopeProvider";
import {
  RecordAccessKind,
  RecordAccessRefusal,
  RecordAccessRefusalReason,
} from "Common/Types/RecordAccess/RecordAccess";
import {
  composedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHY THE SERVER REFUSES A CHANGE ON THE RECORD A PAGE IS OPEN ON, IN THE
 * READER'S LANGUAGE (#10272).
 *
 * Said after the lock's first sentence, which says what they tried: "You do
 * not have permission to change this incident's roles. Your permission is
 * limited to incidents labelled Payments." One wording per kind of record,
 * whole, for the languages that agree their words with it. The labels and
 * the teams are named as the project wrote them.
 */
export interface RecordAccessReasons {
  // Labels: {{labels}}, the labels the reader's permission reaches.
  labels: string;
  owned: string;
  // LabelsOrOwned: {{labels}}, as for labels.
  labelsOrOwned: string;
  // BlockedLabels: {{labels}}, the labels of this record a block takes away.
  blockedLabels: string;
  // Any other reason the rule weighs, and a permission the page thought held.
  other: string;
}

export type RecordAccessNoun = "incident" | "alert" | "episode" | "event";

export const RECORD_ACCESS_REASONS: Readonly<
  Record<RecordAccessNoun, RecordAccessReasons>
> = {
  incident: {
    labels: translationKey(
      "Your permission is limited to incidents labelled {{labels}}.",
    ),
    owned: translationKey(
      "Your permission is limited to incidents you or your teams own.",
    ),
    labelsOrOwned: translationKey(
      "Your permission is limited to incidents labelled {{labels}} and to incidents you or your teams own.",
    ),
    blockedLabels: translationKey(
      "A team you are on blocks this on incidents labelled {{labels}}.",
    ),
    other: translationKey("Your permissions do not reach this incident."),
  },
  alert: {
    labels: translationKey(
      "Your permission is limited to alerts labelled {{labels}}.",
    ),
    owned: translationKey(
      "Your permission is limited to alerts you or your teams own.",
    ),
    labelsOrOwned: translationKey(
      "Your permission is limited to alerts labelled {{labels}} and to alerts you or your teams own.",
    ),
    blockedLabels: translationKey(
      "A team you are on blocks this on alerts labelled {{labels}}.",
    ),
    other: translationKey("Your permissions do not reach this alert."),
  },
  episode: {
    labels: translationKey(
      "Your permission is limited to episodes labelled {{labels}}.",
    ),
    owned: translationKey(
      "Your permission is limited to episodes you or your teams own.",
    ),
    labelsOrOwned: translationKey(
      "Your permission is limited to episodes labelled {{labels}} and to episodes you or your teams own.",
    ),
    blockedLabels: translationKey(
      "A team you are on blocks this on episodes labelled {{labels}}.",
    ),
    other: translationKey("Your permissions do not reach this episode."),
  },
  event: {
    labels: translationKey(
      "Your permission is limited to maintenance events labelled {{labels}}.",
    ),
    owned: translationKey(
      "Your permission is limited to maintenance events you or your teams own.",
    ),
    labelsOrOwned: translationKey(
      "Your permission is limited to maintenance events labelled {{labels}} and to maintenance events you or your teams own.",
    ),
    blockedLabels: translationKey(
      "A team you are on blocks this on maintenance events labelled {{labels}}.",
    ),
    other: translationKey(
      "Your permissions do not reach this maintenance event.",
    ),
  },
};

// The word a kind of record goes by in these sentences.
export const getRecordAccessNoun: (
  kind: RecordAccessKind,
) => RecordAccessNoun = (kind: RecordAccessKind): RecordAccessNoun => {
  switch (kind) {
    case RecordAccessKind.Incident:
      return "incident";
    case RecordAccessKind.Alert:
      return "alert";
    case RecordAccessKind.IncidentEpisode:
    case RecordAccessKind.AlertEpisode:
      return "episode";
    case RecordAccessKind.ScheduledMaintenance:
      return "event";
  }
};

// A private record's wording, by the kind of record (PrivateRecordScopeProvider).
const getPrivateReasons: (kind: RecordAccessKind) => PrivateRecordReasons = (
  kind: RecordAccessKind,
): PrivateRecordReasons => {
  switch (kind) {
    case RecordAccessKind.Alert:
      return PRIVATE_RECORD_REASONS.alert;
    case RecordAccessKind.IncidentEpisode:
    case RecordAccessKind.AlertEpisode:
      return PRIVATE_RECORD_REASONS.episode;
    default:
      return PRIVATE_RECORD_REASONS.incident;
  }
};

/*
 * The sentence a lock says after its first, for a refusal of the server's
 * on a record of the kind `kind`. A label or a team the server could not
 * name leaves the sentence that needs none.
 */
export const getRecordAccessRefusalSentence: (data: {
  kind: RecordAccessKind;
  refusal: RecordAccessRefusal;
  translator: Translator;
}) => string = (data: {
  kind: RecordAccessKind;
  refusal: RecordAccessRefusal;
  translator: Translator;
}): string => {
  const reasons: RecordAccessReasons =
    RECORD_ACCESS_REASONS[getRecordAccessNoun(data.kind)];
  const translator: Translator = data.translator;

  const say: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  const withLabels: (key: string) => string = (key: string): string => {
    const names: Array<string> = data.refusal.labelNames;

    return translator.translateTemplate(key, {
      labels: composedValue((sentence: Translator): string => {
        return formatNameList(names, "or", sentence);
      }),
    });
  };

  const hasLabels: boolean = data.refusal.labelNames.length > 0;

  switch (data.refusal.reason) {
    case RecordAccessRefusalReason.Labels:
      return hasLabels ? withLabels(reasons.labels) : say(reasons.other);
    case RecordAccessRefusalReason.Owned:
      return say(reasons.owned);
    case RecordAccessRefusalReason.LabelsOrOwned:
      return hasLabels ? withLabels(reasons.labelsOrOwned) : say(reasons.owned);
    case RecordAccessRefusalReason.BlockedLabels:
      return hasLabels ? withLabels(reasons.blockedLabels) : say(reasons.other);
    case RecordAccessRefusalReason.Private: {
      const privateReasons: PrivateRecordReasons = getPrivateReasons(data.kind);
      const teams: Array<string> = data.refusal.teamNames;

      if (teams.length === 0) {
        return say(privateReasons.unnamedTeams);
      }

      if (teams.length === 1) {
        return translator.translateTemplate(privateReasons.oneTeam, {
          team: teams[0]!,
        });
      }

      return translator.translateTemplate(privateReasons.severalTeams, {
        teams: composedValue((sentence: Translator): string => {
          return formatNameList(teams, "and", sentence);
        }),
      });
    }
    case RecordAccessRefusalReason.Permission:
    case RecordAccessRefusalReason.Other:
      return say(reasons.other);
  }
};
