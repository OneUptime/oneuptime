import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PermissionGateOptions } from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "Common/UI/Utils/PrivateRecordScope";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { canAddOwners, OwnersTarget } from "../Owners/AddOwners";
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
  // The record's owner tables: where the header's Add owners list adds.
  target: OwnersTarget;
  /*
   * Reads the owners again - after one was added from the header - and
   * settles once the header shows the answer. A read that fails keeps the
   * owners that are on screen: the new one was added all the same.
   */
  refresh: () => Promise<void>;
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

  /*
   * Which read is the latest: an answer to an earlier one - for the record
   * the reader left, or overtaken by a newer read - is dropped.
   */
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const read: (isRefresh: boolean) => Promise<void> = useCallback(
    async (isRefresh: boolean): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      latestReadRef.current += 1;
      const readNumber: number = latestReadRef.current;

      const query: Record<string, unknown> = {
        [options.resourceIdField]: new ObjectID(resourceIdString),
        projectId: projectId,
      };

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

        if (readNumber === latestReadRef.current) {
          setLoaded({
            resourceId: resourceIdString,
            owners: orderEventOwners(owners),
            error: "",
          });
        }
      } catch (err) {
        // A read again after an add keeps what the header shows.
        if (readNumber === latestReadRef.current && !isRefresh) {
          setLoaded({
            resourceId: resourceIdString,
            owners: undefined,
            error: API.getFriendlyMessage(err),
          });
        }
      }
    },
    [
      resourceIdString,
      options.resourceIdField,
      options.ownerUserModelType,
      options.ownerTeamModelType,
    ],
  );

  useEffect(() => {
    void read(false);

    return () => {
      // Whatever is still on its way was read for the record being left.
      latestReadRef.current += 1;
    };
  }, [read]);

  const refresh: () => Promise<void> = useCallback((): Promise<void> => {
    return read(true);
  }, [read]);

  const target: OwnersTarget = useMemo((): OwnersTarget => {
    return {
      ownerUserModelType: options.ownerUserModelType,
      ownerTeamModelType: options.ownerTeamModelType,
      resourceIdField: options.resourceIdField,
      resourceId: new ObjectID(resourceIdString),
    };
  }, [
    resourceIdString,
    options.resourceIdField,
    options.ownerUserModelType,
    options.ownerTeamModelType,
  ]);

  /*
   * On a private record's page, adding owners takes the permission of a
   * team of the reader's that owns it (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(new options.ownerUserModelType());

  const mayAddOwners: boolean = canAddOwners(target, privateRecordOptions);

  /*
   * Read only while it is the record on screen: the page stays mounted when
   * the reader follows a link to another record, and the previous record's
   * owners must never stand in the next one's header.
   */
  if (!loaded || loaded.resourceId !== resourceIdString) {
    return {
      owners: undefined,
      error: "",
      canAddOwners: mayAddOwners,
      target: target,
      refresh: refresh,
    };
  }

  return {
    owners: loaded.owners,
    error: loaded.error,
    canAddOwners: mayAddOwners,
    target: target,
    refresh: refresh,
  };
};

export default useEventOwners;
