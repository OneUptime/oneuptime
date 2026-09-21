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

export interface UseMonitorOwnersResult {
  owners: OverviewSection<Array<ResourceOwnerEntry>>;
}

/*
 * The monitor's owners, users first and then teams, for the hero's owners
 * fact.
 *
 * Owners change rarely and are not part of "is this monitor healthy", so
 * they load once per monitor and again only when `refreshToken` changes
 * (the Refresh button), never on the poll. A failed or forbidden read is
 * "unavailable", never "no owners".
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
      /*
       * One gate for both lists: the owner-user and owner-team tables share
       * their read permissions, and the fact needs both to be complete.
       */
      if (
        !shouldAttemptRead(
          PermissionGate.check(new MonitorOwnerUser(), ModelAction.Read),
        )
      ) {
        commitOwners(
          forbidSection<Array<ResourceOwnerEntry>>({
            reason: MONITOR_OWNERS_ACCESS_REASON,
            subjectId: subjectId,
          }),
        );
        return;
      }

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      try {
        const [ownerUsers, ownerTeams]: [
          ListResult<MonitorOwnerUser>,
          ListResult<MonitorOwnerTeam>,
        ] = await Promise.all([
          ModelAPI.getList<MonitorOwnerUser>({
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
          }),
          ModelAPI.getList<MonitorOwnerTeam>({
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
          }),
        ]);

        if (cancelled) {
          return;
        }

        const entries: Array<ResourceOwnerEntry> = [];

        for (const ownerUser of ownerUsers.data) {
          if (ownerUser.user) {
            entries.push({ kind: "user", user: ownerUser.user });
          }
        }

        for (const ownerTeam of ownerTeams.data) {
          if (ownerTeam.team) {
            entries.push({ kind: "team", team: ownerTeam.team });
          }
        }

        commitOwners(resolveSection({ value: entries, subjectId: subjectId }));
      } catch (err) {
        if (cancelled) {
          return;
        }

        commitOwners(
          failSection({
            previous: ownersRef.current,
            message: API.getFriendlyMessage(err),
            subjectId: subjectId,
          }),
        );
      }
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

export default useMonitorOwners;
