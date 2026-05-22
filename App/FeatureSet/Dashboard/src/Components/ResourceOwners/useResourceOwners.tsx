import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { ReactElement, useEffect, useMemo, useState } from "react";
import ProjectUser from "../../Utils/ProjectUser";
import { ResourceOwnerEntry } from "./OwnerEntry";

type OwnerJunctionModel = BaseModel & {
  user?: User;
  team?: Team;
};

export interface UseResourceOwnersOptions {
  ownerUserModelType: { new (): OwnerJunctionModel };
  ownerTeamModelType: { new (): OwnerJunctionModel };
  resourceIdField: string;
}

export interface UseResourceOwnersResult<TResource extends BaseModel> {
  ownersByResourceId: { [resourceId: string]: Array<ResourceOwnerEntry> };
  isLoadingOwners: boolean;
  onResourcesFetched: (resources: Array<TResource>) => void;
  ownerFilterUI: ReactElement;
  mergeOwnerFilterIntoQuery: (
    base: Query<TResource> | undefined,
  ) => Query<TResource>;
  isOwnerFilterActive: boolean;
}

const useResourceOwners: <TResource extends BaseModel>(
  options: UseResourceOwnersOptions,
) => UseResourceOwnersResult<TResource> = <TResource extends BaseModel>(
  options: UseResourceOwnersOptions,
): UseResourceOwnersResult<TResource> => {
  const { ownerUserModelType, ownerTeamModelType, resourceIdField } = options;

  const [ownersByResourceId, setOwnersByResourceId] = useState<{
    [resourceId: string]: Array<ResourceOwnerEntry>;
  }>({});
  const [isLoadingOwners, setIsLoadingOwners] = useState<boolean>(false);

  const [userOptions, setUserOptions] = useState<Array<DropdownOption>>([]);
  const [teamOptions, setTeamOptions] = useState<Array<DropdownOption>>([]);
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<string | null>(
    null,
  );
  const [selectedOwnerTeamId, setSelectedOwnerTeamId] = useState<string | null>(
    null,
  );
  const [matchingResourceIds, setMatchingResourceIds] =
    useState<Array<string> | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const fetchOptions: () => Promise<void> = async (): Promise<void> => {
      try {
        const [users, teamsResult]: [Array<DropdownOption>, ListResult<Team>] =
          await Promise.all([
            ProjectUser.fetchProjectUsersAsDropdownOptions(projectId),
            ModelAPI.getList<Team>({
              modelType: Team,
              query: { projectId: projectId },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                name: true,
              },
              sort: { name: 1 },
            }),
          ]);

        setUserOptions(users);
        setTeamOptions(
          teamsResult.data.map((team: Team) => {
            return {
              value: team._id as string,
              label: team.name?.toString() || "",
            };
          }),
        );
      } catch {
        // dropdowns will stay empty; filter still degrades gracefully
      }
    };

    fetchOptions();
  }, []);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    if (!selectedOwnerUserId && !selectedOwnerTeamId) {
      setMatchingResourceIds(null);
      return;
    }

    let cancelled: boolean = false;

    const computeMatching: () => Promise<void> = async (): Promise<void> => {
      try {
        let userResourceIds: Set<string> | null = null;
        let teamResourceIds: Set<string> | null = null;

        if (selectedOwnerUserId) {
          const result: ListResult<OwnerJunctionModel> =
            await ModelAPI.getList<OwnerJunctionModel>({
              modelType: ownerUserModelType,
              query: {
                userId: new ObjectID(selectedOwnerUserId),
                projectId: projectId,
              } as Query<OwnerJunctionModel>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: { [resourceIdField]: true } as Record<string, true>,
              sort: {},
            });

          userResourceIds = new Set(
            result.data
              .map((item: OwnerJunctionModel) => {
                const value: unknown = (
                  item as unknown as Record<string, unknown>
                )[resourceIdField];
                return value !== undefined && value !== null
                  ? (value as { toString: () => string }).toString()
                  : undefined;
              })
              .filter((id: string | undefined): id is string => {
                return Boolean(id);
              }),
          );
        }

        if (selectedOwnerTeamId) {
          const result: ListResult<OwnerJunctionModel> =
            await ModelAPI.getList<OwnerJunctionModel>({
              modelType: ownerTeamModelType,
              query: {
                teamId: new ObjectID(selectedOwnerTeamId),
                projectId: projectId,
              } as Query<OwnerJunctionModel>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: { [resourceIdField]: true } as Record<string, true>,
              sort: {},
            });

          teamResourceIds = new Set(
            result.data
              .map((item: OwnerJunctionModel) => {
                const value: unknown = (
                  item as unknown as Record<string, unknown>
                )[resourceIdField];
                return value !== undefined && value !== null
                  ? (value as { toString: () => string }).toString()
                  : undefined;
              })
              .filter((id: string | undefined): id is string => {
                return Boolean(id);
              }),
          );
        }

        let finalIds: Array<string>;
        if (userResourceIds && teamResourceIds) {
          finalIds = [...userResourceIds].filter((id: string) => {
            return teamResourceIds!.has(id);
          });
        } else {
          finalIds = Array.from(
            userResourceIds || teamResourceIds || new Set<string>(),
          );
        }

        if (!cancelled) {
          setMatchingResourceIds(finalIds);
        }
      } catch {
        if (!cancelled) {
          setMatchingResourceIds([]);
        }
      }
    };

    computeMatching();

    return () => {
      cancelled = true;
    };
  }, [selectedOwnerUserId, selectedOwnerTeamId]);

  const onResourcesFetched: (resources: Array<TResource>) => void = (
    resources: Array<TResource>,
  ): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const ids: Array<string> = resources
      .map((r: TResource) => {
        return r.id?.toString();
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    if (ids.length === 0) {
      setOwnersByResourceId({});
      return;
    }

    setIsLoadingOwners(true);

    const fetchOwners: () => Promise<void> = async (): Promise<void> => {
      try {
        const idQuery: Includes = new Includes(
          ids.map((id: string) => {
            return new ObjectID(id);
          }),
        );

        const [userResult, teamResult]: [
          ListResult<OwnerJunctionModel>,
          ListResult<OwnerJunctionModel>,
        ] = await Promise.all([
          ModelAPI.getList<OwnerJunctionModel>({
            modelType: ownerUserModelType,
            query: {
              [resourceIdField]: idQuery,
              projectId: projectId,
            } as Query<OwnerJunctionModel>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              [resourceIdField]: true,
              user: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            } as Record<string, unknown>,
            sort: {},
          }),
          ModelAPI.getList<OwnerJunctionModel>({
            modelType: ownerTeamModelType,
            query: {
              [resourceIdField]: idQuery,
              projectId: projectId,
            } as Query<OwnerJunctionModel>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              [resourceIdField]: true,
              team: {
                _id: true,
                name: true,
              },
            } as Record<string, unknown>,
            sort: {},
          }),
        ]);

        const map: { [k: string]: Array<ResourceOwnerEntry> } = {};

        for (const id of ids) {
          map[id] = [];
        }

        for (const item of userResult.data) {
          const key: string | undefined = (
            item as unknown as Record<
              string,
              { toString: () => string } | undefined
            >
          )[resourceIdField]?.toString();
          if (key && item.user) {
            map[key]?.push({ kind: "user", user: item.user });
          }
        }

        for (const item of teamResult.data) {
          const key: string | undefined = (
            item as unknown as Record<
              string,
              { toString: () => string } | undefined
            >
          )[resourceIdField]?.toString();
          if (key && item.team) {
            map[key]?.push({ kind: "team", team: item.team });
          }
        }

        setOwnersByResourceId(map);
      } catch {
        // leave owners empty on failure
      } finally {
        setIsLoadingOwners(false);
      }
    };

    fetchOwners();
  };

  const mergeOwnerFilterIntoQuery: (
    base: Query<TResource> | undefined,
  ) => Query<TResource> = (
    base: Query<TResource> | undefined,
  ): Query<TResource> => {
    const baseQuery: Query<TResource> = (base || {}) as Query<TResource>;

    if (matchingResourceIds === null) {
      return baseQuery;
    }

    if (matchingResourceIds.length === 0) {
      return {
        ...baseQuery,
        _id: new Includes([
          new ObjectID("00000000-0000-0000-0000-000000000000"),
        ]),
      } as Query<TResource>;
    }

    return {
      ...baseQuery,
      _id: new Includes(
        matchingResourceIds.map((id: string) => {
          return new ObjectID(id);
        }),
      ),
    } as Query<TResource>;
  };

  const clearOwnerFilter: () => void = (): void => {
    setSelectedOwnerUserId(null);
    setSelectedOwnerTeamId(null);
  };

  const isOwnerFilterActive: boolean = Boolean(
    selectedOwnerUserId || selectedOwnerTeamId,
  );

  const ownerFilterUI: ReactElement = useMemo((): ReactElement => {
    return (
      <div className="mb-3 rounded-md border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              className="mb-1 block text-xs font-medium text-gray-700"
              htmlFor="resource-owner-user-filter"
            >
              Filter by owner (User)
            </label>
            <Dropdown
              id="resource-owner-user-filter"
              placeholder="Any user"
              options={userOptions}
              value={
                selectedOwnerUserId
                  ? userOptions.find((o: DropdownOption) => {
                      return o.value === selectedOwnerUserId;
                    })
                  : undefined
              }
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value === null || Array.isArray(value)) {
                  setSelectedOwnerUserId(null);
                  return;
                }
                setSelectedOwnerUserId(value.toString());
              }}
            />
          </div>
          <div className="flex-1">
            <label
              className="mb-1 block text-xs font-medium text-gray-700"
              htmlFor="resource-owner-team-filter"
            >
              Filter by owner (Team)
            </label>
            <Dropdown
              id="resource-owner-team-filter"
              placeholder="Any team"
              options={teamOptions}
              value={
                selectedOwnerTeamId
                  ? teamOptions.find((o: DropdownOption) => {
                      return o.value === selectedOwnerTeamId;
                    })
                  : undefined
              }
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value === null || Array.isArray(value)) {
                  setSelectedOwnerTeamId(null);
                  return;
                }
                setSelectedOwnerTeamId(value.toString());
              }}
            />
          </div>
          {isOwnerFilterActive && (
            <div>
              <Button
                title="Clear owners"
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={clearOwnerFilter}
              />
            </div>
          )}
        </div>
      </div>
    );
  }, [
    userOptions,
    teamOptions,
    selectedOwnerUserId,
    selectedOwnerTeamId,
    isOwnerFilterActive,
  ]);

  return {
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    ownerFilterUI,
    mergeOwnerFilterIntoQuery,
    isOwnerFilterActive,
  };
};

export default useResourceOwners;
