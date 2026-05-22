import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
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
  /**
   * Show a Labels facet in the sidebar. When enabled, the merged query
   * includes `labels: Includes([...])` for the selected labels.
   */
  showLabelsFacet?: boolean | undefined;
}

export interface UseResourceOwnersResult<TResource extends BaseModel> {
  ownersByResourceId: { [resourceId: string]: Array<ResourceOwnerEntry> };
  isLoadingOwners: boolean;
  onResourcesFetched: (resources: Array<TResource>) => void;
  /**
   * Vertical facet sidebar element. Render it to the left of the table.
   */
  facetPanel: ReactElement;
  /**
   * Merge owner + label filters into the base query. Pass the result to
   * the ModelTable's `query` prop.
   */
  mergeFiltersIntoQuery: (
    base: Query<TResource> | undefined,
  ) => Query<TResource>;
  hasActiveFilters: boolean;
}

const useResourceOwners: <TResource extends BaseModel>(
  options: UseResourceOwnersOptions,
) => UseResourceOwnersResult<TResource> = <TResource extends BaseModel>(
  options: UseResourceOwnersOptions,
): UseResourceOwnersResult<TResource> => {
  const { ownerUserModelType, ownerTeamModelType, resourceIdField } = options;
  const showLabelsFacet: boolean = Boolean(options.showLabelsFacet);

  const [ownersByResourceId, setOwnersByResourceId] = useState<{
    [resourceId: string]: Array<ResourceOwnerEntry>;
  }>({});
  const [isLoadingOwners, setIsLoadingOwners] = useState<boolean>(false);

  const [userOptions, setUserOptions] = useState<Array<DropdownOption>>([]);
  const [teamOptions, setTeamOptions] = useState<Array<DropdownOption>>([]);
  const [labelOptions, setLabelOptions] = useState<Array<DropdownOption>>([]);

  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<string | null>(
    null,
  );
  const [selectedOwnerTeamId, setSelectedOwnerTeamId] = useState<string | null>(
    null,
  );
  const [selectedLabelIds, setSelectedLabelIds] = useState<Array<string>>([]);

  const [matchingResourceIds, setMatchingResourceIds] =
    useState<Array<string> | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const fetchOptions: () => Promise<void> = async (): Promise<void> => {
      try {
        const [users, teamsResult, labelsResult]: [
          Array<DropdownOption>,
          ListResult<Team>,
          ListResult<Label> | null,
        ] = await Promise.all([
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
          showLabelsFacet
            ? ModelAPI.getList<Label>({
                modelType: Label,
                query: { projectId: projectId },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: {
                  _id: true,
                  name: true,
                },
                sort: { name: 1 },
              })
            : Promise.resolve(null),
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

        if (labelsResult) {
          setLabelOptions(
            labelsResult.data.map((label: Label) => {
              return {
                value: label._id as string,
                label: label.name?.toString() || "",
              };
            }),
          );
        }
      } catch {
        // dropdowns will stay empty; filter still degrades gracefully
      }
    };

    fetchOptions();
  }, [showLabelsFacet]);

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

  const mergeFiltersIntoQuery: (
    base: Query<TResource> | undefined,
  ) => Query<TResource> = (
    base: Query<TResource> | undefined,
  ): Query<TResource> => {
    const merged: Query<TResource> = {
      ...((base || {}) as Query<TResource>),
    } as Query<TResource>;

    if (matchingResourceIds !== null) {
      if (matchingResourceIds.length === 0) {
        (merged as unknown as Record<string, unknown>)["_id"] = new Includes([
          new ObjectID("00000000-0000-0000-0000-000000000000"),
        ]);
      } else {
        (merged as unknown as Record<string, unknown>)["_id"] = new Includes(
          matchingResourceIds.map((id: string) => {
            return new ObjectID(id);
          }),
        );
      }
    }

    if (selectedLabelIds.length > 0) {
      (merged as unknown as Record<string, unknown>)["labels"] = new Includes(
        selectedLabelIds.map((id: string) => {
          return new ObjectID(id);
        }),
      );
    }

    return merged;
  };

  const clearAllFilters: () => void = (): void => {
    setSelectedOwnerUserId(null);
    setSelectedOwnerTeamId(null);
    setSelectedLabelIds([]);
  };

  const hasActiveFilters: boolean = Boolean(
    selectedOwnerUserId || selectedOwnerTeamId || selectedLabelIds.length > 0,
  );

  const facetPanel: ReactElement = useMemo((): ReactElement => {
    const selectedLabelOptions: Array<DropdownOption> = labelOptions.filter(
      (o: DropdownOption) => {
        return selectedLabelIds.includes(o.value.toString());
      },
    );

    return (
      <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
          {hasActiveFilters && (
            <Button
              title="Clear"
              buttonStyle={ButtonStyleType.SECONDARY_LINK}
              onClick={clearAllFilters}
            />
          )}
        </div>
        <div className="space-y-4">
          <div>
            <label
              className="mb-1 block text-xs font-medium text-gray-700"
              htmlFor="resource-owner-user-filter"
            >
              Owner (User)
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
          <div>
            <label
              className="mb-1 block text-xs font-medium text-gray-700"
              htmlFor="resource-owner-team-filter"
            >
              Owner (Team)
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
          {showLabelsFacet && (
            <div>
              <label
                className="mb-1 block text-xs font-medium text-gray-700"
                htmlFor="resource-labels-filter"
              >
                Labels
              </label>
              <Dropdown
                id="resource-labels-filter"
                placeholder="Any labels"
                options={labelOptions}
                isMultiSelect={true}
                value={selectedLabelOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (value === null) {
                    setSelectedLabelIds([]);
                    return;
                  }
                  if (Array.isArray(value)) {
                    setSelectedLabelIds(
                      value.map((v: DropdownValue) => {
                        return v.toString();
                      }),
                    );
                    return;
                  }
                  setSelectedLabelIds([value.toString()]);
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }, [
    userOptions,
    teamOptions,
    labelOptions,
    selectedOwnerUserId,
    selectedOwnerTeamId,
    selectedLabelIds,
    hasActiveFilters,
    showLabelsFacet,
  ]);

  return {
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    facetPanel,
    mergeFiltersIntoQuery,
    hasActiveFilters,
  };
};

export default useResourceOwners;
