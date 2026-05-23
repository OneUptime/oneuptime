import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { ReactElement, useEffect, useMemo, useState } from "react";
import ProjectUser from "../../Utils/ProjectUser";
import FilterChipDropdown, {
  FilterChipDropdownOption,
} from "./FilterChipDropdown";
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
   * Show a Labels chip in the filter bar. When enabled, the merged query
   * includes `labels: Includes([...])` for the selected labels.
   */
  showLabelsFacet?: boolean | undefined;
}

export interface UseResourceOwnersResult<TResource extends BaseModel> {
  ownersByResourceId: { [resourceId: string]: Array<ResourceOwnerEntry> };
  isLoadingOwners: boolean;
  onResourcesFetched: (resources: Array<TResource>) => void;
  /**
   * Compact row of chip-dropdowns (one per filter type). Render it via the
   * `topContent` prop of ModelTable so it sits inside the table card.
   */
  filterBar: ReactElement;
  /**
   * Merge owner + label filters into the base query. Pass the result to
   * the ModelTable's `query` prop.
   */
  mergeFiltersIntoQuery: (
    base: Query<TResource> | undefined,
  ) => Query<TResource>;
  hasActiveFilters: boolean;
}

type OwnerSelectionKind = "user" | "team";

const OWNER_KEY_PREFIX: { user: "user:"; team: "team:" } = {
  user: "user:",
  team: "team:",
};

const parseOwnerKey: (key: string) => {
  kind: OwnerSelectionKind;
  id: string;
} | null = (key: string): { kind: OwnerSelectionKind; id: string } | null => {
  if (key.startsWith(OWNER_KEY_PREFIX.user)) {
    return { kind: "user", id: key.slice(OWNER_KEY_PREFIX.user.length) };
  }
  if (key.startsWith(OWNER_KEY_PREFIX.team)) {
    return { kind: "team", id: key.slice(OWNER_KEY_PREFIX.team.length) };
  }
  return null;
};

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

  const [selectedOwnerKeys, setSelectedOwnerKeys] = useState<Array<string>>([]);
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

    if (selectedOwnerKeys.length === 0) {
      setMatchingResourceIds(null);
      return;
    }

    const userIds: Array<string> = [];
    const teamIds: Array<string> = [];
    for (const key of selectedOwnerKeys) {
      const parsed: { kind: OwnerSelectionKind; id: string } | null =
        parseOwnerKey(key);
      if (parsed?.kind === "user") {
        userIds.push(parsed.id);
      } else if (parsed?.kind === "team") {
        teamIds.push(parsed.id);
      }
    }

    let cancelled: boolean = false;

    const computeMatching: () => Promise<void> = async (): Promise<void> => {
      try {
        const fetches: Array<Promise<Array<string>>> = [];

        if (userIds.length > 0) {
          fetches.push(
            ModelAPI.getList<OwnerJunctionModel>({
              modelType: ownerUserModelType,
              query: {
                userId: new Includes(
                  userIds.map((id: string) => {
                    return new ObjectID(id);
                  }),
                ),
                projectId: projectId,
              } as Query<OwnerJunctionModel>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: { [resourceIdField]: true } as Record<string, true>,
              sort: {},
            }).then((result: ListResult<OwnerJunctionModel>) => {
              return result.data
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
                });
            }),
          );
        }

        if (teamIds.length > 0) {
          fetches.push(
            ModelAPI.getList<OwnerJunctionModel>({
              modelType: ownerTeamModelType,
              query: {
                teamId: new Includes(
                  teamIds.map((id: string) => {
                    return new ObjectID(id);
                  }),
                ),
                projectId: projectId,
              } as Query<OwnerJunctionModel>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: { [resourceIdField]: true } as Record<string, true>,
              sort: {},
            }).then((result: ListResult<OwnerJunctionModel>) => {
              return result.data
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
                });
            }),
          );
        }

        const results: Array<Array<string>> = await Promise.all(fetches);
        const union: Set<string> = new Set();
        for (const list of results) {
          for (const id of list) {
            union.add(id);
          }
        }

        if (!cancelled) {
          setMatchingResourceIds(Array.from(union));
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
  }, [selectedOwnerKeys]);

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

  const hasActiveFilters: boolean = Boolean(
    selectedOwnerKeys.length > 0 || selectedLabelIds.length > 0,
  );

  const getInitials: (name: string) => string = (name: string): string => {
    const parts: Array<string> = name
      .trim()
      .split(/\s+/)
      .filter((p: string) => {
        return p.length > 0;
      });
    if (parts.length === 0) {
      return "?";
    }
    if (parts.length === 1) {
      return parts[0]!.charAt(0).toUpperCase();
    }
    return (
      parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
    ).toUpperCase();
  };

  const ownerChipOptions: Array<FilterChipDropdownOption> =
    useMemo((): Array<FilterChipDropdownOption> => {
      const users: Array<FilterChipDropdownOption> = userOptions.map(
        (o: DropdownOption) => {
          return {
            value: `${OWNER_KEY_PREFIX.user}${o.value.toString()}`,
            label: o.label,
            initials: getInitials(o.label),
            icon: IconProp.User,
            group: "People",
          };
        },
      );
      const teams: Array<FilterChipDropdownOption> = teamOptions.map(
        (o: DropdownOption) => {
          return {
            value: `${OWNER_KEY_PREFIX.team}${o.value.toString()}`,
            label: o.label,
            initials: getInitials(o.label),
            icon: IconProp.Team,
            group: "Teams",
          };
        },
      );
      return [...users, ...teams];
    }, [userOptions, teamOptions]);

  const labelChipOptions: Array<FilterChipDropdownOption> =
    useMemo((): Array<FilterChipDropdownOption> => {
      return labelOptions.map((o: DropdownOption) => {
        return {
          value: o.value.toString(),
          label: o.label,
          initials: getInitials(o.label),
        };
      });
    }, [labelOptions]);

  const filterBar: ReactElement = useMemo((): ReactElement => {
    return (
      <div className="-mt-1 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
          Filter by
        </span>
        <FilterChipDropdown
          label="Owner"
          emptyIcon={IconProp.User}
          options={ownerChipOptions}
          isMultiSelect={true}
          value={selectedOwnerKeys}
          searchPlaceholder="Search people and teams..."
          popoverWidthClassName="w-72"
          onChange={(value: string | Array<string> | null) => {
            if (value === null) {
              setSelectedOwnerKeys([]);
              return;
            }
            if (Array.isArray(value)) {
              setSelectedOwnerKeys(value);
              return;
            }
            setSelectedOwnerKeys([value]);
          }}
        />
        {showLabelsFacet && (
          <FilterChipDropdown
            label="Labels"
            emptyIcon={IconProp.Tag}
            options={labelChipOptions}
            isMultiSelect={true}
            value={selectedLabelIds}
            searchPlaceholder="Search labels..."
            onChange={(value: string | Array<string> | null) => {
              if (value === null) {
                setSelectedLabelIds([]);
                return;
              }
              if (Array.isArray(value)) {
                setSelectedLabelIds(value);
                return;
              }
              setSelectedLabelIds([value]);
            }}
          />
        )}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSelectedOwnerKeys([]);
              setSelectedLabelIds([]);
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800 focus:outline-none"
          >
            <Icon icon={IconProp.Close} className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>
    );
  }, [
    ownerChipOptions,
    labelChipOptions,
    selectedOwnerKeys,
    selectedLabelIds,
    showLabelsFacet,
    hasActiveFilters,
  ]);

  return {
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    hasActiveFilters,
  };
};

export default useResourceOwners;
