import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { EpisodeMembership } from "./EpisodeMembers";

/*
 * How many membership rows one request reads, and so how many ids one member
 * request names: about 200 KB of ids, well inside the 1 MB body nginx takes
 * for the API (nginx.conf sets no client_max_body_size), and far from
 * Postgres's limit on bind parameters.
 */
export const EPISODE_MEMBER_IDS_PER_REQUEST: number = 5000;

export interface FetchedEpisodeMembers<TMember extends BaseModel> {
  // The first `limit` members, in the order asked for.
  members: Array<TMember>;
  // Every member there is to show.
  totalCount: number;
}

type SortKey = number | string | null;

const getSortKey: (value: unknown) => SortKey = (value: unknown): SortKey => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return null;
};

/*
 * The order Postgres gives one request, so members read in several come out
 * as one request would have returned them: NULL above every value (last
 * ascending, first descending), and ties by id, ascending, as DatabaseService
 * completes every sort.
 */
function compareMembers<TMember extends BaseModel>(
  left: TMember,
  right: TMember,
  sortField: keyof TMember & string,
  sortOrder: SortOrder,
): number {
  const leftKey: SortKey = getSortKey(left[sortField]);
  const rightKey: SortKey = getSortKey(right[sortField]);

  if (leftKey !== rightKey) {
    let ascending: number = -1;

    if (leftKey === null) {
      ascending = 1;
    } else if (rightKey !== null && leftKey > rightKey) {
      ascending = 1;
    }

    return sortOrder === SortOrder.Descending ? -ascending : ascending;
  }

  const leftId: string = left.id?.toString() || "";
  const rightId: string = right.id?.toString() || "";

  if (leftId === rightId) {
    return 0;
  }

  return leftId < rightId ? -1 : 1;
}

/*
 * An episode's members, read the way its membership says (see
 * EpisodeMembership): the member ids from the membership rows, then the
 * incidents or alerts themselves from their own table.
 *
 * The second read is not only for the sort. A membership row reaches its
 * incident through a join, which runs none of the incident's own read rules:
 * no privacy filter, so a private incident's title would show to anyone who
 * may read memberships. Read from the incident table, every member is
 * filtered the way the incident list filters it (labels, owners, privacy),
 * and the total counts what the reader may see. The API could not do it in
 * one read anyway: it sorts only by a model's own columns, and a select
 * through the membership could not reach the incident's state and severity
 * (deep relations are refused).
 *
 * Reading both tables needs both read permissions; a reader without one
 * gets that read's error.
 */
export async function fetchEpisodeMembers<
  TMember extends BaseModel,
  TMembership extends BaseModel,
>(data: {
  episodeId: ObjectID;
  membership: EpisodeMembership<TMembership>;
  // Incident or Alert.
  modelType: { new (): TMember };
  select: Select<TMember>;
  sortField: keyof TMember & string;
  sortOrder: SortOrder;
  limit: number;
}): Promise<FetchedEpisodeMembers<TMember>> {
  const seenMemberIds: Set<string> = new Set<string>();
  const results: Array<ListResult<TMember>> = [];
  let skip: number = 0;
  let hasMoreMemberships: boolean = true;

  while (hasMoreMemberships) {
    const memberships: ListResult<TMembership> =
      await ModelAPI.getList<TMembership>({
        modelType: data.membership.modelType,
        query: {
          [data.membership.episodeIdField]: data.episodeId,
        } as unknown as Query<TMembership>,
        limit: EPISODE_MEMBER_IDS_PER_REQUEST,
        skip: skip,
        select: {
          [data.membership.memberIdField]: true,
        } as Select<TMembership>,
        sort: {
          createdAt: SortOrder.Ascending,
        } as Sort<TMembership>,
      });

    const memberIds: Array<string> = [];

    for (const membership of memberships.data) {
      const memberId: unknown = membership[data.membership.memberIdField];

      if (!(memberId instanceof ObjectID) && typeof memberId !== "string") {
        continue;
      }

      // The same member twice (two adds racing) is still one member.
      if (!seenMemberIds.has(memberId.toString())) {
        seenMemberIds.add(memberId.toString());
        memberIds.push(memberId.toString());
      }
    }

    // An empty Includes is not a query worth sending.
    if (memberIds.length > 0) {
      results.push(
        await ModelAPI.getList<TMember>({
          modelType: data.modelType,
          query: {
            _id: new Includes(memberIds),
          } as Query<TMember>,
          limit: data.limit,
          skip: 0,
          // The merge below compares members by the sort column.
          select: {
            ...data.select,
            [data.sortField]: true,
          } as Select<TMember>,
          sort: {
            [data.sortField]: data.sortOrder,
          } as Sort<TMember>,
        }),
      );
    }

    skip += memberships.data.length;
    hasMoreMemberships =
      memberships.data.length === EPISODE_MEMBER_IDS_PER_REQUEST &&
      skip < (memberships.count || 0);
  }

  return {
    members: results
      .flatMap((result: ListResult<TMember>): Array<TMember> => {
        return result.data;
      })
      .sort((left: TMember, right: TMember): number => {
        return compareMembers(left, right, data.sortField, data.sortOrder);
      })
      .slice(0, data.limit),
    totalCount: results.reduce(
      (total: number, result: ListResult<TMember>): number => {
        return total + Math.max(result.count || 0, result.data.length);
      },
      0,
    ),
  };
}
