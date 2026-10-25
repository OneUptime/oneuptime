import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { isArchivedValue } from "Common/Utils/ArchivableValues";
import ModelListCache from "Common/UI/Utils/ModelListCache";

/*
 * A project's case priorities and statuses (Security Events > Settings), as
 * every case page reads them: the pills' names and colours, the status
 * steps, the pickers, the filters and which lists a case is open or closed
 * in (Common/Utils/SecurityCase/SecurityCasePriorities and
 * SecurityCaseStatuses answer from these).
 *
 * Archived values are read too: a case at one still shows it, and the
 * rules still read where it sits. Pickers leave them out
 * (withoutArchivedValues), but keep the one a record has already.
 *
 * Served through ModelListCache: the case page, its header, its AI card and
 * the lists all ask on one mount, and these change rarely - one request per
 * project per minute. The settings pages drop the cache whenever they read.
 * React-free, so the lists' rules are tested without a browser.
 */
export interface SecurityCaseValueLists {
  priorities: Array<SecurityCasePriority>;
  statuses: Array<SecurityCaseStatus>;
}

export const SECURITY_CASE_PRIORITY_SELECT: Select<SecurityCasePriority> = {
  _id: true,
  name: true,
  description: true,
  color: true,
  order: true,
  createdAt: true,
  isArchived: true,
  isCriticalPriority: true,
  isHighPriority: true,
  isMediumPriority: true,
  isLowPriority: true,
  isInformationalPriority: true,
};

export const SECURITY_CASE_STATUS_SELECT: Select<SecurityCaseStatus> = {
  _id: true,
  name: true,
  description: true,
  color: true,
  order: true,
  createdAt: true,
  isArchived: true,
  isNewStatus: true,
  isAcknowledgedStatus: true,
  isContainedStatus: true,
  isClosedStatus: true,
};

export async function getSecurityCaseValues(
  projectId: ObjectID,
): Promise<SecurityCaseValueLists> {
  const [priorities, statuses]: [
    ListResult<SecurityCasePriority>,
    ListResult<SecurityCaseStatus>,
  ] = await Promise.all([
    ModelListCache.getList<SecurityCasePriority>({
      modelType: SecurityCasePriority,
      query: { projectId: projectId },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      sort: { order: SortOrder.Ascending },
      select: SECURITY_CASE_PRIORITY_SELECT,
      projectId: projectId,
    }),
    ModelListCache.getList<SecurityCaseStatus>({
      modelType: SecurityCaseStatus,
      query: { projectId: projectId },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      sort: { order: SortOrder.Ascending },
      select: SECURITY_CASE_STATUS_SELECT,
      projectId: projectId,
    }),
  ]);

  return { priorities: priorities.data, statuses: statuses.data };
}

// The settings pages changed a list: every page reads it afresh.
export function invalidateSecurityCaseValues(): void {
  ModelListCache.invalidate(SecurityCasePriority);
  ModelListCache.invalidate(SecurityCaseStatus);
}

/*
 * What a picker offers: the values nobody has archived, in the list's
 * order, and the one a record has already (`keepId`), wherever it is.
 */
export function getPickableSecurityCaseValues<
  T extends SecurityCasePriority | SecurityCaseStatus,
>(values: ReadonlyArray<T>, keepId?: ObjectID | string | null): Array<T> {
  const kept: string = keepId ? keepId.toString() : "";

  return values.filter((value: T): boolean => {
    return !isArchivedValue(value) || value.id?.toString() === kept;
  });
}
