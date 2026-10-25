import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import { orderEventOwners } from "../../Utils/EventPeople";

/*
 * The owners of one incident, alert or episode - its owner teams and owner
 * people - for the people row of its overview header. Read with the same two
 * lists the record's Owners page reads, and nothing else on the overview
 * reads them, so this is the only place they come from.
 */

type OwnerRow = BaseModel & {
  user?: User | undefined;
  team?: Team | undefined;
};

export interface UseEventOwnersOptions {
  ownerUserModelType: { new (): BaseModel };
  ownerTeamModelType: { new (): BaseModel };
  // The owner rows' column naming the record: "incidentId", "alertId", ...
  resourceIdField: string;
  resourceId: ObjectID;
}

export interface EventOwnersState {
  /*
   * The record's owners, teams first (orderEventOwners), or undefined until
   * they have been read for the record on screen - and when they could not
   * be read: a reader without access to them sees no Owners in the header,
   * rather than an empty list that says the record has none.
   */
  owners: Array<ResourceOwnerEntry> | undefined;
  error: string;
  /*
   * Whether the reader may add an owner - a person or a team - to the
   * record (PermissionGate on the two owner tables), so the header offers
   * its Add only to someone the Owners page would let add one. False until
   * the permissions are known.
   */
  canAddOwners: boolean;
}

interface LoadedOwners {
  // The record the owners were read for.
  resourceId: string;
  owners: Array<ResourceOwnerEntry> | undefined;
  error: string;
}

export const OWNER_USER_SELECT: Record<string, unknown> = {
  _id: true,
  createdAt: true,
  user: {
    _id: true,
    name: true,
    email: true,
    profilePictureId: true,
  },
};

export const OWNER_TEAM_SELECT: Record<string, unknown> = {
  _id: true,
  createdAt: true,
  team: {
    _id: true,
    name: true,
  },
};

const useEventOwners: (options: UseEventOwnersOptions) => EventOwnersState = (
  options: UseEventOwnersOptions,
): EventOwnersState => {
  const resourceIdString: string = options.resourceId.toString();
  const [loaded, setLoaded] = useState<LoadedOwners | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return undefined;
    }

    const query: Record<string, unknown> = {
      [options.resourceIdField]: new ObjectID(resourceIdString),
      projectId: projectId,
    };

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const [userRows, teamRows]: [
          ListResult<BaseModel>,
          ListResult<BaseModel>,
        ] = await Promise.all([
          ModelAPI.getList<BaseModel>({
            modelType: options.ownerUserModelType,
            query: query,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: OWNER_USER_SELECT,
            sort: { createdAt: SortOrder.Ascending },
          }),
          ModelAPI.getList<BaseModel>({
            modelType: options.ownerTeamModelType,
            query: query,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: OWNER_TEAM_SELECT,
            sort: { createdAt: SortOrder.Ascending },
          }),
        ]);

        const owners: Array<ResourceOwnerEntry> = [];

        for (const row of userRows.data as Array<OwnerRow>) {
          if (row.user) {
            owners.push({ kind: "user", user: row.user });
          }
        }

        for (const row of teamRows.data as Array<OwnerRow>) {
          if (row.team) {
            owners.push({ kind: "team", team: row.team });
          }
        }

        if (isCurrent) {
          setLoaded({
            resourceId: resourceIdString,
            owners: orderEventOwners(owners),
            error: "",
          });
        }
      } catch (err) {
        if (isCurrent) {
          setLoaded({
            resourceId: resourceIdString,
            owners: undefined,
            error: API.getFriendlyMessage(err),
          });
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [
    resourceIdString,
    options.resourceIdField,
    options.ownerUserModelType,
    options.ownerTeamModelType,
  ]);

  /*
   * Read only while it is the record on screen: the page stays mounted when
   * the reader follows a link to another record, and the previous record's
   * owners must never stand in the next one's header.
   */
  const canAddOwners: boolean =
    PermissionGate.check(new options.ownerUserModelType(), ModelAction.Create)
      .isAllowed ||
    PermissionGate.check(new options.ownerTeamModelType(), ModelAction.Create)
      .isAllowed;

  if (!loaded || loaded.resourceId !== resourceIdString) {
    return { owners: undefined, error: "", canAddOwners: canAddOwners };
  }

  return {
    owners: loaded.owners,
    error: loaded.error,
    canAddOwners: canAddOwners,
  };
};

export default useEventOwners;
