import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import {
  OverviewSection,
  failSection,
  forbidSection,
  getLoadingSection,
  getSectionForSubject,
  resolveSection,
  shouldAttemptRead,
} from "../../../Utils/OverviewSection";
import { ResourceOwnerEntry } from "../../ResourceOwners/OwnerEntry";

export const MONITOR_OWNERS_ACCESS_REASON: string =
  "You need permission to read this monitor's owners.";

// Why one half of the owners is missing while the other is shown.
export const MONITOR_OWNERS_PARTIAL_REASONS: {
  users: string;
  teams: string;
} = {
  users: "You need permission to read this monitor's owner users.",
  teams: "You need permission to read this monitor's owner teams.",
};

export interface UseMonitorOwnersResult {
  owners: OverviewSection<Array<ResourceOwnerEntry>>;
}

// What one of the two owner lists came back with.
export type OwnerListOutcome =
  | { kind: "loaded"; entries: Array<ResourceOwnerEntry> }
  | { kind: "failed"; message: string }
  | { kind: "forbidden"; reason: string };

/*
 * One owner list, sent only when the permission snapshot does not
 * definitely refuse it. It never rejects: a failure becomes an outcome, so
 * one list failing cannot take the other down with it.
 */
async function readOwnerList(data: {
  canRead: boolean;
  forbiddenReason: string;
  read: () => Promise<Array<ResourceOwnerEntry>>;
}): Promise<OwnerListOutcome> {
  if (!data.canRead) {
    return { kind: "forbidden", reason: data.forbiddenReason };
  }

  try {
    return { kind: "loaded", entries: await data.read() };
  } catch (err) {
    return { kind: "failed", message: API.getFriendlyMessage(err) };
  }
}

/*
 * The monitor's owners, users first and then teams, for the hero's owners
 * fact.
 *
 * Owners change rarely and are not part of "is this monitor healthy", so
 * they load once per monitor and again only when `refreshToken` changes
 * (the Refresh button), never on the poll. A failed or forbidden read is
 * "unavailable", never "no owners".
 *
 * The two tables have their own read permissions (ReadMonitorOwnerUser and
 * ReadMonitorOwnerTeam), so each list is gated and read on its own. When
 * only one half can be read, the owners it names are shown, with the other
 * half's reason as refreshError. "No owners" is only ever said when both
 * halves were read: an empty half next to an unreadable one is unknown.
 */
export const useMonitorOwners: (options: {
  monitorId: ObjectID;
  refreshToken: number;
}) => UseMonitorOwnersResult = (options: {
  monitorId: ObjectID;
  refreshToken: number;
}): UseMonitorOwnersResult => {
  const monitorIdString: string = options.monitorId.toString();

  const [owners, setOwners] =
    useState<OverviewSection<Array<ResourceOwnerEntry>>>(
      getLoadingSection<Array<ResourceOwnerEntry>>(),
    );

  const ownersRef: MutableRefObject<
    OverviewSection<Array<ResourceOwnerEntry>>
  > = useRef<OverviewSection<Array<ResourceOwnerEntry>>>(owners);

  useEffect(() => {
    let cancelled: boolean = false;
    const subjectId: string = monitorIdString;

    const commitOwners: (
      section: OverviewSection<Array<ResourceOwnerEntry>>,
    ) => void = (section: OverviewSection<Array<ResourceOwnerEntry>>): void => {
      ownersRef.current = section;
      setOwners(section);
    };

    const loadOwners: () => Promise<void> = async (): Promise<void> => {
      const canReadUsers: boolean = shouldAttemptRead(
        PermissionGate.check(new MonitorOwnerUser(), ModelAction.Read),
      );
      const canReadTeams: boolean = shouldAttemptRead(
        PermissionGate.check(new MonitorOwnerTeam(), ModelAction.Read),
      );

      if (!canReadUsers && !canReadTeams) {
        commitOwners(
          forbidSection<Array<ResourceOwnerEntry>>({
            reason: MONITOR_OWNERS_ACCESS_REASON,
            subjectId: subjectId,
          }),
        );
        return;
      }

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      const [users, teams]: [OwnerListOutcome, OwnerListOutcome] =
        await Promise.all([
          readOwnerList({
            canRead: canReadUsers,
            forbiddenReason: MONITOR_OWNERS_PARTIAL_REASONS.users,
            read: async (): Promise<Array<ResourceOwnerEntry>> => {
              const result: ListResult<MonitorOwnerUser> =
                await ModelAPI.getList<MonitorOwnerUser>({
                  modelType: MonitorOwnerUser,
                  query: {
                    monitorId: options.monitorId,
                    projectId: projectId!,
                  },
                  select: {
                    _id: true,
                    createdAt: true,
                    user: {
                      _id: true,
                      name: true,
                      email: true,
                      profilePictureId: true,
                    },
                  },
                  sort: {
                    createdAt: SortOrder.Ascending,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                });

              const entries: Array<ResourceOwnerEntry> = [];

              for (const ownerUser of result.data) {
                if (ownerUser.user) {
                  entries.push({ kind: "user", user: ownerUser.user });
                }
              }

              return entries;
            },
          }),
          readOwnerList({
            canRead: canReadTeams,
            forbiddenReason: MONITOR_OWNERS_PARTIAL_REASONS.teams,
            read: async (): Promise<Array<ResourceOwnerEntry>> => {
              const result: ListResult<MonitorOwnerTeam> =
                await ModelAPI.getList<MonitorOwnerTeam>({
                  modelType: MonitorOwnerTeam,
                  query: {
                    monitorId: options.monitorId,
                    projectId: projectId!,
                  },
                  select: {
                    _id: true,
                    createdAt: true,
                    team: {
                      _id: true,
                      name: true,
                    },
                  },
                  sort: {
                    createdAt: SortOrder.Ascending,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                });

              const entries: Array<ResourceOwnerEntry> = [];

              for (const ownerTeam of result.data) {
                if (ownerTeam.team) {
                  entries.push({ kind: "team", team: ownerTeam.team });
                }
              }

              return entries;
            },
          }),
        ]);

      if (cancelled) {
        return;
      }

      commitOwners(
        combineOwnerLists({
          users: users,
          teams: teams,
          previous: ownersRef.current,
          subjectId: subjectId,
        }),
      );
    };

    loadOwners().catch(() => {
      // loadOwners records its own errors.
    });

    return () => {
      cancelled = true;
    };
  }, [monitorIdString, options.refreshToken]);

  return {
    owners: getSectionForSubject(owners, monitorIdString),
  };
};

/*
 * The owners section from the two lists, users first and then teams.
 * - Both read: the owners, possibly none.
 * - A half that failed: an earlier answer stays on screen with the failure
 *   (failSection), rather than drop the owners that half named.
 * - A half that cannot be read (or failed with no earlier answer): the
 *   other half's owners are shown, with the missing half's reason as
 *   refreshError. If that half named nobody there is nothing to show, and
 *   "No owners" would be a guess, so the section is unavailable instead.
 */
export function combineOwnerLists(data: {
  users: OwnerListOutcome;
  teams: OwnerListOutcome;
  previous: OverviewSection<Array<ResourceOwnerEntry>>;
  subjectId: string;
}): OverviewSection<Array<ResourceOwnerEntry>> {
  const entries: Array<ResourceOwnerEntry> = [];
  let loadedCount: number = 0;
  let failureMessage: string = "";
  let forbiddenReason: string = "";

  for (const outcome of [data.users, data.teams]) {
    if (outcome.kind === "loaded") {
      loadedCount += 1;
      entries.push(...outcome.entries);
    } else if (outcome.kind === "failed") {
      failureMessage = failureMessage || outcome.message;
    } else {
      forbiddenReason = forbiddenReason || outcome.reason;
    }
  }

  if (loadedCount === 2) {
    return resolveSection({ value: entries, subjectId: data.subjectId });
  }

  const hasEarlierAnswer: boolean =
    data.previous.status === "loaded" &&
    data.previous.loadedFor === data.subjectId;

  if (failureMessage && (hasEarlierAnswer || entries.length === 0)) {
    return failSection({
      previous: data.previous,
      message: failureMessage,
      subjectId: data.subjectId,
    });
  }

  if (entries.length === 0) {
    return forbidSection<Array<ResourceOwnerEntry>>({
      reason:
        loadedCount === 0 ? MONITOR_OWNERS_ACCESS_REASON : forbiddenReason,
      subjectId: data.subjectId,
    });
  }

  return {
    ...resolveSection({ value: entries, subjectId: data.subjectId }),
    refreshError: failureMessage || forbiddenReason,
  };
}

export default useMonitorOwners;
