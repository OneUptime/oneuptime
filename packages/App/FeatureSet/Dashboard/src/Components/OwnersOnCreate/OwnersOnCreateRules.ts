import OwnerRulePreview, {
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewRule,
} from "Common/Types/Rules/OwnerRulePreview";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { getIdsFromFormValue } from "../Incident/IncidentStatusPageScopeForm";

/*
 * OWNERS ON A CREATE FORM.
 *
 * Declaring an incident gave no way to make the declarer's team its owner,
 * and nothing on the review said which owner rules would run, or whom they
 * would add (a customer: "OneUptime should tell me either the name of the
 * rules that will apply, or the action it will take - Team_XYZ will be
 * added"). The create forms of incidents, alerts and both kinds of episode
 * now:
 *
 *   - ask for owners under More fields, out of the way: one people and
 *     teams picker, with the declarer's own teams one click away under it
 *     ("Your teams: + Platform · + SRE · Add all"). Nothing is picked by
 *     itself - Members and Owners are teams too, and making everyone an
 *     owner is not a default;
 *   - say who will own the event on the review step, whether or not
 *     anything was picked: the person creating an incident or an alert
 *     (OneUptime makes them an owner, DatabaseService.autoOwnerOnCreate),
 *     the owners picked, and each owner rule that matches what was filled
 *     in, by name, with whom it adds that is not an owner already. The
 *     rules are worked out by the server, by the code the create runs
 *     (OwnerRulePreviewApi, Types/Rules/OwnerRulePreview) - never in the
 *     browser.
 *
 * The picks travel as the form's ownerUsers and ownerTeams, as misc data:
 * the server asks whether the creator may add them before the event is
 * saved, and adds them once it exists, as ordinary owner rows.
 *
 * React-free, so App's tests can read it. The components are
 * OwnersOnCreateField.tsx, OwnersOnCreateSummary.tsx and
 * MyTeamSuggestions.tsx.
 */

// The Owners field's line on each create form.
export const OWNERS_ON_CREATE_DESCRIPTIONS: Record<
  OwnerRulePreviewEvent,
  string
> = {
  [OwnerRulePreviewEvent.Incident]: translationKey(
    "You become an owner when you declare it. Add your team, or anyone else who should own it.",
  ),
  [OwnerRulePreviewEvent.Alert]: translationKey(
    "You become an owner when you create it. Add your team, or anyone else who should own it.",
  ),
  [OwnerRulePreviewEvent.IncidentEpisode]: translationKey(
    "Who owns this episode. They are notified when it is created or updated.",
  ),
  [OwnerRulePreviewEvent.AlertEpisode]: translationKey(
    "Who owns this episode. They are notified when it is created or updated.",
  ),
};

/*
 * The line on an incident's or alert's form for someone OneUptime does not
 * make an owner of what they create - a master admin: the usual line,
 * without its first sentence.
 */
export const OWNERS_ON_CREATE_ADD_DESCRIPTION: string = translationKey(
  "Add your team, or anyone else who should own it.",
);

/*
 * Whether OneUptime makes the person creating the event an owner: an
 * incident and an alert are operational resources, whose creator is made an
 * owner when they are saved (DatabaseService.autoOwnerOnCreate) - unless
 * the creator is a master admin, whom it never makes the owner of what they
 * create (the first person to sign up to a self-hosted OneUptime is one).
 * An episode's creator is not made an owner either.
 */
export const isCreatorMadeOwner: (
  event: OwnerRulePreviewEvent,
  isMasterAdmin: boolean,
) => boolean = (
  event: OwnerRulePreviewEvent,
  isMasterAdmin: boolean,
): boolean => {
  if (isMasterAdmin) {
    return false;
  }

  return (
    event === OwnerRulePreviewEvent.Incident ||
    event === OwnerRulePreviewEvent.Alert
  );
};

/*
 * The Owners field's line: on an incident or an alert, it says that the
 * person creating it becomes an owner - only when they do.
 */
export const getOwnersOnCreateDescription: (
  event: OwnerRulePreviewEvent,
  isMasterAdmin: boolean,
) => string = (
  event: OwnerRulePreviewEvent,
  isMasterAdmin: boolean,
): string => {
  const isEpisode: boolean =
    event === OwnerRulePreviewEvent.IncidentEpisode ||
    event === OwnerRulePreviewEvent.AlertEpisode;

  if (isEpisode || isCreatorMadeOwner(event, isMasterAdmin)) {
    return OWNERS_ON_CREATE_DESCRIPTIONS[event];
  }

  return OWNERS_ON_CREATE_ADD_DESCRIPTION;
};

// The suggestions line under the Owners picker, by how many teams it offers.
export const MY_TEAM_SUGGESTIONS_LABEL: PluralTemplate = {
  one: "Your team:",
  other: "Your teams:",
};

// One team's button, read out with the team's name.
export const ADD_MY_TEAM_LABEL: string = translationKey(
  "Add {{teamName}} as an owner",
);

// Shown when two or more teams are offered (the status page suggestions' words).
export const ADD_ALL_MY_TEAMS: string = translationKey("Add all");

// Read out once a team is added: the button it was on is gone.
export const ADDED_MY_TEAM_ANNOUNCEMENT: string = translationKey(
  "Added {{teamName}} to the owners.",
);

export const ADDED_MY_TEAMS_ANNOUNCEMENT: PluralTemplate = {
  one: "Added {{count}} team to the owners.",
  other: "Added {{count}} teams to the owners.",
};

/*
 * The review step's line while nothing is picked. The field's own line,
 * shown above it, already says that the person creating an incident or an
 * alert becomes its owner.
 */
export const OWNERS_SUMMARY_NOBODY_ELSE_PICKED: string = translationKey(
  "Nobody else picked.",
);

export const OWNERS_SUMMARY_NOBODY_PICKED: string =
  translationKey("Nobody picked.");

// What the review says while nothing is picked, on each event's form.
export const getNobodyPickedText: (
  event: OwnerRulePreviewEvent,
  isMasterAdmin: boolean,
) => string = (
  event: OwnerRulePreviewEvent,
  isMasterAdmin: boolean,
): string => {
  return isCreatorMadeOwner(event, isMasterAdmin)
    ? OWNERS_SUMMARY_NOBODY_ELSE_PICKED
    : OWNERS_SUMMARY_NOBODY_PICKED;
};

export const OWNER_RULES_ADD_HEADING: string = translationKey(
  "Added by owner rules",
);

export const OWNER_RULES_CHECKING: string = translationKey(
  "Checking which owner rules will run...",
);

export const OWNER_RULES_COULD_NOT_CHECK: string = translationKey(
  "Could not check which owner rules will run. They still run when it is created.",
);

// A rule saved without a name, as its line calls it.
export const UNNAMED_OWNER_RULE: string = translationKey("Unnamed rule");

// A rule's line when everyone it adds is an owner already.
export const OWNER_RULE_ADDS_NOBODY_NEW: string = translationKey(
  "Everyone it adds is already an owner.",
);

// A team of the person filling in the form.
export interface MyTeam {
  id: string;
  name: string;
}

/*
 * The event as the create form holds it, as the preview asks about it: the
 * title and description as typed, and every id in whatever shape the form
 * keeps it (ids, models, {_id, name} objects, dropdown options). An incident
 * keeps its severity in incidentSeverity, an alert in alertSeverity, and an
 * alert its one monitor in monitor. An episode has no monitors or other
 * resources.
 */
export const getOwnerRulePreviewDraft: (
  event: OwnerRulePreviewEvent,
  values: unknown,
) => OwnerRulePreviewDraft = (
  event: OwnerRulePreviewEvent,
  values: unknown,
): OwnerRulePreviewDraft => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};

  const text: (key: string) => string = (key: string): string => {
    const value: unknown = record[key];
    return typeof value === "string" ? value : "";
  };

  const isIncidentKind: boolean =
    event === OwnerRulePreviewEvent.Incident ||
    event === OwnerRulePreviewEvent.IncidentEpisode;

  const draft: OwnerRulePreviewDraft = OwnerRulePreview.emptyDraft();

  draft.title = text("title");
  draft.description = text("description");
  draft.severityId =
    getIdsFromFormValue(
      record[isIncidentKind ? "incidentSeverity" : "alertSeverity"],
    )[0] || null;
  draft.labelIds = getIdsFromFormValue(record["labels"]);

  if (
    event === OwnerRulePreviewEvent.IncidentEpisode ||
    event === OwnerRulePreviewEvent.AlertEpisode
  ) {
    return draft;
  }

  draft.monitorIds =
    event === OwnerRulePreviewEvent.Alert
      ? getIdsFromFormValue(record["monitor"]).slice(0, 1)
      : getIdsFromFormValue(record["monitors"]);
  draft.hostIds = getIdsFromFormValue(record["hosts"]);
  draft.kubernetesClusterIds = getIdsFromFormValue(
    record["kubernetesClusters"],
  );
  draft.dockerHostIds = getIdsFromFormValue(record["dockerHosts"]);
  draft.podmanHostIds = getIdsFromFormValue(record["podmanHosts"]);
  draft.serviceIds = getIdsFromFormValue(record["services"]);

  return draft;
};

/*
 * The preview's request body, its ids sorted so equal drafts are one key:
 * the review asks once per draft, however often it is drawn.
 */
export const getOwnerRulePreviewRequestKey: (
  draft: OwnerRulePreviewDraft,
) => string = (draft: OwnerRulePreviewDraft): string => {
  const sorted: (ids: Array<string>) => Array<string> = (
    ids: Array<string>,
  ): Array<string> => {
    return [...ids].sort();
  };

  return JSON.stringify(
    OwnerRulePreview.draftToJSON({
      ...draft,
      labelIds: sorted(draft.labelIds),
      monitorIds: sorted(draft.monitorIds),
      hostIds: sorted(draft.hostIds),
      kubernetesClusterIds: sorted(draft.kubernetesClusterIds),
      dockerHostIds: sorted(draft.dockerHostIds),
      podmanHostIds: sorted(draft.podmanHostIds),
      serviceIds: sorted(draft.serviceIds),
    }),
  );
};

// The rules worth a line: each that adds someone, in the order they run.
export const getOwnerRulesToShow: (
  rules: Array<OwnerRulePreviewRule>,
) => Array<OwnerRulePreviewRule> = (
  rules: Array<OwnerRulePreviewRule>,
): Array<OwnerRulePreviewRule> => {
  return rules.filter((rule: OwnerRulePreviewRule): boolean => {
    return rule.userIds.length > 0 || rule.teamIds.length > 0;
  });
};

// The people and teams a rule's line on the review names.
export interface OwnerRuleNewOwners {
  userIds: Array<string>;
  teamIds: Array<string>;
}

/*
 * Whom a rule will add that is not an owner already. The people and teams
 * picked in the field are owners whatever the rules say, and so is the
 * person creating an incident or an alert (isCreatorMadeOwner); OneUptime
 * adds an owner once. So a rule's line names only the rest - "Platform"
 * picked, a rule bringing Platform and Database reads "Database" - and says
 * so when that is nobody (OWNER_RULE_ADDS_NOBODY_NEW).
 */
export const getOwnersNewFromRule: (data: {
  rule: OwnerRulePreviewRule;
  pickedUserIds: unknown;
  pickedTeamIds: unknown;
  // The person creating the event, when OneUptime makes them an owner.
  creatorUserId: string | null;
}) => OwnerRuleNewOwners = (data: {
  rule: OwnerRulePreviewRule;
  pickedUserIds: unknown;
  pickedTeamIds: unknown;
  creatorUserId: string | null;
}): OwnerRuleNewOwners => {
  const ownerUserIds: Set<string> = new Set<string>(
    getIdsFromFormValue([
      ...getIdsFromFormValue(data.pickedUserIds),
      ...(data.creatorUserId ? [data.creatorUserId] : []),
    ]),
  );
  const ownerTeamIds: Set<string> = new Set<string>(
    getIdsFromFormValue(data.pickedTeamIds),
  );

  const isNew: (owners: Set<string>) => (id: string) => boolean = (
    owners: Set<string>,
  ): ((id: string) => boolean) => {
    return (id: string): boolean => {
      return !owners.has(id.toLowerCase());
    };
  };

  return {
    userIds: data.rule.userIds.filter(isNew(ownerUserIds)),
    teamIds: data.rule.teamIds.filter(isNew(ownerTeamIds)),
  };
};

/*
 * The teams of the person filling in the form that are not picked yet, in
 * the order they are offered: by name, as the teams list shows them.
 */
export const getTeamsToSuggest: (data: {
  myTeams: Array<MyTeam>;
  pickedTeamIds: unknown;
}) => Array<MyTeam> = (data: {
  myTeams: Array<MyTeam>;
  pickedTeamIds: unknown;
}): Array<MyTeam> => {
  const picked: Set<string> = new Set<string>(
    getIdsFromFormValue(data.pickedTeamIds),
  );

  const seen: Set<string> = new Set<string>();

  return data.myTeams.filter((team: MyTeam): boolean => {
    const id: string = team.id.toLowerCase();

    if (!id || picked.has(id) || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
};

/*
 * The owners' team ids once `teamIds` are added: those picked first, as
 * they were, then the added ones not picked yet.
 */
export const addTeamsToPicked: (data: {
  pickedTeamIds: unknown;
  teamIds: Array<string>;
}) => Array<string> = (data: {
  pickedTeamIds: unknown;
  teamIds: Array<string>;
}): Array<string> => {
  const result: Array<string> = getIdsFromFormValue(data.pickedTeamIds);

  for (const teamId of data.teamIds) {
    const id: string = teamId.toLowerCase();

    if (id && !result.includes(id)) {
      result.push(id);
    }
  }

  return result;
};
