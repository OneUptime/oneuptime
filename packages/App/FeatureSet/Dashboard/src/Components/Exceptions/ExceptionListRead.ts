import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  EveryMatch,
  MatchingPage,
  readEveryMatch,
} from "Common/UI/Components/BulkUpdate/BulkSelectAll";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  ExceptionListSort,
  getExceptionListSortOrder,
} from "../../Utils/ExceptionAssignment";
import { getExceptionId } from "./ExceptionRowActions";

/*
 * HOW THE EXCEPTIONS LIST READS ITS ROWS: a page of them, and - for "Select
 * all 4,213 exceptions" - every one the list's search, filters and window
 * match, up to the most one selection holds (BulkSelectAll). Both read the
 * same columns, so a row of every match is the row the list draws, and Bulk
 * Actions sees what a ticked row's menu would: whether it is resolved,
 * archived, which release it was last seen in, who it is assigned to.
 */

export const EXCEPTION_LIST_SELECT: Select<TelemetryException> = {
  fingerprint: true,
  exceptionType: true,
  message: true,
  occuranceCount: true,
  firstSeenAt: true,
  lastSeenAt: true,
  isResolved: true,
  isArchived: true,
  primaryEntityId: true,
  environment: true,
  // The row's Regressed, New and Unhandled badges.
  regressedAt: true,
  unhandled: true,
  // Resolve in next release, in the row's menu and Bulk Actions.
  lastSeenInRelease: true,
  // Who owns it: the row's chip and Assign to me.
  assignToUserId: true,
  assignToTeamId: true,
  assignToUser: { name: true, email: true },
  assignToTeam: { name: true },
};

/*
 * Every match is read in the list's own order, with the exception's id
 * after it: offset paging is only steady over an order that never ties, and
 * a hundred exceptions last seen in the same second would otherwise land on
 * two pages while another one was never read at all.
 */
export const getEveryMatchSort: (
  sort: ExceptionListSort,
) => Record<string, SortOrder> = (
  sort: ExceptionListSort,
): Record<string, SortOrder> => {
  return {
    ...getExceptionListSortOrder(sort),
    _id: SortOrder.Ascending,
  };
};

/*
 * Every exception the list's query matches, a page of a thousand at a time,
 * up to the most one selection holds. Null when a newer selection or a
 * changed search superseded it part-way.
 */
export const readEveryMatchingException: (data: {
  query: Query<TelemetryException>;
  sort: ExceptionListSort;
  isSuperseded: () => boolean;
}) => Promise<EveryMatch<TelemetryException> | null> = async (data: {
  query: Query<TelemetryException>;
  sort: ExceptionListSort;
  isSuperseded: () => boolean;
}): Promise<EveryMatch<TelemetryException> | null> => {
  return await readEveryMatch<TelemetryException>({
    readPage: async (page: {
      skip: number;
      limit: number;
    }): Promise<MatchingPage<TelemetryException>> => {
      const result: ModelListResult<TelemetryException> =
        await ModelAPI.getList<TelemetryException>({
          modelType: TelemetryException,
          query: data.query,
          limit: page.limit,
          skip: page.skip,
          select: EXCEPTION_LIST_SELECT,
          sort: getEveryMatchSort(data.sort) as never,
        });

      return { data: result.data || [], count: result.count };
    },
    getItemId: (exception: TelemetryException): string => {
      return getExceptionId(exception) || exception.fingerprint || "";
    },
    isSuperseded: data.isSuperseded,
  });
};
