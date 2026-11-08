import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import {
  ALERT_EPISODE_MEMBERSHIP,
  EpisodeMembership,
  INCIDENT_EPISODE_MEMBERSHIP,
} from "./EpisodeMembers";
import {
  FetchedEpisodeMembers,
  fetchEpisodeMembers,
} from "./FetchEpisodeMembers";

/*
 * AN EPISODE'S FIRST MEMBER: the incident or alert that kicked it off.
 *
 * An episode groups many incidents or alerts from one root cause, and the
 * first of them - the earliest declared incident, or the earliest created
 * alert - is the "what kicked this off" view of it: its Overview charts that
 * member's telemetry, and its Root Cause page that member's metrics (issue
 * #6320). Both read it here, by the same rule, so the two pages always show
 * the same member:
 *
 * - by the episode's membership, as its member card reads them, so a member
 *   that later joined another episode too is still this one's
 *   (EpisodeMembership);
 * - among the members the reader may see, filtered as the incident or alert
 *   list filters them (fetchEpisodeMembers);
 * - earliest first; one with no start comes last, as Postgres puts NULL
 *   last in an ascending sort, and a tie goes to the lower id, as
 *   DatabaseService completes every sort - in one request or across many.
 */
export interface EpisodeFirstMemberKind<
  TMember extends BaseModel,
  TMembership extends BaseModel,
> {
  // How the episode holds its members.
  membership: EpisodeMembership<TMembership>;
  // Incident or Alert.
  modelType: { new (): TMember };
  // When a member started: what the first one is the earliest by.
  startedAtField: keyof TMember & string;
}

// An incident episode's first member: its earliest declared incident.
export const INCIDENT_EPISODE_FIRST_MEMBER: EpisodeFirstMemberKind<
  Incident,
  IncidentEpisodeMember
> = {
  membership: INCIDENT_EPISODE_MEMBERSHIP,
  modelType: Incident,
  startedAtField: "declaredAt",
};

// An alert episode's first member: its earliest created alert.
export const ALERT_EPISODE_FIRST_MEMBER: EpisodeFirstMemberKind<
  Alert,
  AlertEpisodeMember
> = {
  membership: ALERT_EPISODE_MEMBERSHIP,
  modelType: Alert,
  startedAtField: "createdAt",
};

/*
 * The episode's first member, with the columns asked for (and its start,
 * which the order reads), or null for an episode with no member the reader
 * may see. A read the reader may not make fails with its error, as
 * fetchEpisodeMembers does: the caller decides whether it can do without.
 */
export async function fetchFirstEpisodeMember<
  TMember extends BaseModel,
  TMembership extends BaseModel,
>(data: {
  episodeId: ObjectID;
  kind: EpisodeFirstMemberKind<TMember, TMembership>;
  select: Select<TMember>;
}): Promise<TMember | null> {
  const fetched: FetchedEpisodeMembers<TMember> = await fetchEpisodeMembers<
    TMember,
    TMembership
  >({
    episodeId: data.episodeId,
    membership: data.kind.membership,
    modelType: data.kind.modelType,
    select: data.select,
    sortField: data.kind.startedAtField,
    sortOrder: SortOrder.Ascending,
    limit: 1,
  });

  return fetched.members[0] || null;
}
