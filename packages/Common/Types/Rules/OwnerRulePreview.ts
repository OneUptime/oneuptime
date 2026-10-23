import { JSONObject } from "../JSON";

/*
 * WHICH OWNER RULES WILL RUN, AND WHO THEY WILL ADD - SAID BEFORE THE EVENT
 * EXISTS.
 *
 * A customer with incident owner rules declared an incident and nothing on
 * the form's review said that rules would run, nor whom they would make an
 * owner. The create forms of incidents, alerts and their episodes now say it
 * on their review step: each owner rule that matches what has been filled in
 * - by its name - and the people and teams it will add.
 *
 * POST /<event>/owner-rule-preview answers it (incident, alert,
 * incident-episode, alert-episode). The answer is the plan the create itself
 * carries out (Server/Utils/Rules/OwnerRulePlan, the owner rule engines'
 * planRules), made of the event as the form holds it, with the person asking
 * as its creator - so the review and the create cannot disagree, and no rule
 * is ever evaluated in the browser.
 *
 * It names rules and ids only. The dashboard shows the people and teams by
 * reading them with the viewer's own permissions, as every owners list does.
 *
 * Everything here is shared by the server, which builds the answer, and the
 * dashboard, which asks and reads it.
 */

export enum OwnerRulePreviewEvent {
  Incident = "Incident",
  Alert = "Alert",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
}

// The route, under each event's own API path ("/incident/owner-rule-preview").
export const OWNER_RULE_PREVIEW_ROUTE: string = "/owner-rule-preview";

/*
 * The event as the create form holds it: what an owner rule matches on and
 * inherits from. Every id is the project's; a list an event does not have
 * (an episode's monitors) is left empty. An alert has one monitor at most.
 */
export interface OwnerRulePreviewDraft {
  title: string;
  description: string;
  severityId: string | null;
  labelIds: Array<string>;
  monitorIds: Array<string>;
  hostIds: Array<string>;
  kubernetesClusterIds: Array<string>;
  dockerHostIds: Array<string>;
  podmanHostIds: Array<string>;
  serviceIds: Array<string>;
}

// The draft's id lists, by key: the ones every event reads first.
export const OWNER_RULE_PREVIEW_DRAFT_LISTS: ReadonlyArray<
  keyof Pick<
    OwnerRulePreviewDraft,
    | "labelIds"
    | "monitorIds"
    | "hostIds"
    | "kubernetesClusterIds"
    | "dockerHostIds"
    | "podmanHostIds"
    | "serviceIds"
  >
> = [
  "labelIds",
  "monitorIds",
  "hostIds",
  "kubernetesClusterIds",
  "dockerHostIds",
  "podmanHostIds",
  "serviceIds",
];

// One rule that matches the draft and adds someone.
export interface OwnerRulePreviewRule {
  ruleId: string;
  ruleName: string;
  // Everyone it adds, each once: named, the creator's team, inherited.
  userIds: Array<string>;
  teamIds: Array<string>;
  /*
   * Of those teams, the ones it adds because the person creating the event
   * is in them (the rule's Creator's Team).
   */
  creatorTeamIds: Array<string>;
  // Whether the people and teams it adds are told (its Notify Owners).
  notifiesOwners: boolean;
}

export interface OwnerRulePreviewResult {
  // The rules, in the order they run.
  rules: Array<OwnerRulePreviewRule>;
}

const readString: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const readStrings: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item: unknown): item is string => {
    return typeof item === "string" && item.length > 0;
  });
};

export default class OwnerRulePreview {
  // The most ids one list of a draft may name: more than any form offers.
  public static readonly maxIdsPerList: number = 100;

  // The route of an event's preview, under its API path.
  public static getApiPath(event: OwnerRulePreviewEvent): string {
    switch (event) {
      case OwnerRulePreviewEvent.Incident:
        return `/incident${OWNER_RULE_PREVIEW_ROUTE}`;
      case OwnerRulePreviewEvent.Alert:
        return `/alert${OWNER_RULE_PREVIEW_ROUTE}`;
      case OwnerRulePreviewEvent.IncidentEpisode:
        return `/incident-episode${OWNER_RULE_PREVIEW_ROUTE}`;
      case OwnerRulePreviewEvent.AlertEpisode:
        return `/alert-episode${OWNER_RULE_PREVIEW_ROUTE}`;
    }
  }

  // A draft with nothing filled in.
  public static emptyDraft(): OwnerRulePreviewDraft {
    return {
      title: "",
      description: "",
      severityId: null,
      labelIds: [],
      monitorIds: [],
      hostIds: [],
      kubernetesClusterIds: [],
      dockerHostIds: [],
      podmanHostIds: [],
      serviceIds: [],
    };
  }

  public static draftToJSON(draft: OwnerRulePreviewDraft): JSONObject {
    return {
      title: draft.title,
      description: draft.description,
      severityId: draft.severityId,
      labelIds: [...draft.labelIds],
      monitorIds: [...draft.monitorIds],
      hostIds: [...draft.hostIds],
      kubernetesClusterIds: [...draft.kubernetesClusterIds],
      dockerHostIds: [...draft.dockerHostIds],
      podmanHostIds: [...draft.podmanHostIds],
      serviceIds: [...draft.serviceIds],
    };
  }

  public static resultToJSON(result: OwnerRulePreviewResult): JSONObject {
    return {
      rules: result.rules.map((rule: OwnerRulePreviewRule): JSONObject => {
        return {
          ruleId: rule.ruleId,
          ruleName: rule.ruleName,
          userIds: [...rule.userIds],
          teamIds: [...rule.teamIds],
          creatorTeamIds: [...rule.creatorTeamIds],
          notifiesOwners: rule.notifiesOwners,
        };
      }),
    };
  }

  /*
   * The answer as the dashboard reads it. Read leniently: a rule without an
   * id is left out, and a list that is not one is empty.
   */
  public static resultFromJSON(json: JSONObject): OwnerRulePreviewResult {
    const rules: Array<unknown> = Array.isArray(json["rules"])
      ? (json["rules"] as Array<unknown>)
      : [];

    return {
      rules: rules
        .filter((rule: unknown): rule is JSONObject => {
          return (
            Boolean(rule) &&
            typeof rule === "object" &&
            !Array.isArray(rule) &&
            readString((rule as JSONObject)["ruleId"]).length > 0
          );
        })
        .map((rule: JSONObject): OwnerRulePreviewRule => {
          return {
            ruleId: readString(rule["ruleId"]),
            ruleName: readString(rule["ruleName"]),
            userIds: readStrings(rule["userIds"]),
            teamIds: readStrings(rule["teamIds"]),
            creatorTeamIds: readStrings(rule["creatorTeamIds"]),
            notifiesOwners: rule["notifiesOwners"] === true,
          };
        }),
    };
  }
}
