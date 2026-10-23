import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import useCustomFieldFacets from "../../Components/CustomFields/useCustomFieldFacets";
import {
  ROLE_ACCESS_FIELD_KEY,
  RoleAccessHolder,
  getCustomRoleAccessValue,
  getRoleAccessCustomRoleId,
  getRoleAccessOptionsForCurrentUser,
  getRoleAccessRole,
  giveCustomRoleAccess,
  giveRoleAccess,
} from "../../Components/Permission/RoleAccess";
import {
  CustomRoleSummary,
  getCustomRoleCardSelectOption,
  loadCustomRoleGrants,
  loadCustomRoles,
} from "../../Components/CustomRole/CustomRoleOptions";
import GrantablePermission, {
  TeamPermissionGrant,
} from "Common/UI/Utils/GrantablePermission";
import useTranslator from "Common/UI/Utils/UseTranslator";
import RoleAccessNotice from "../../Components/Permission/RoleAccessNotice";
import {
  getNewTeamPage,
  getTeamCreateFormFields,
} from "../../Components/Team/TeamCreateForm";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useResourceOwners, {
  ResourceFacet,
  buildEntityFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import {
  computeTeamIdsForMembers,
  loadProjectUserOptions,
  resolveProjectUserOptions,
} from "../../Components/ResourceOwners/ProjectUserFacetOptions";
import ObjectID from "Common/Types/ObjectID";
import {
  CUSTOM_ROLES_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
} from "../../Enterprise/EnterpriseEligibility";

/*
 * A team whose access could not be added after it was made: what to say,
 * and which team to open.
 */
interface AccessNotice {
  teamId: ObjectID;
  teamName: string;
  error: string;
}

/*
 * Owners and Admin come with every project, and the server refuses to delete
 * them (TeamService, in these words: Common/Types/Team/BuiltInTeam). Their
 * Delete is locked instead, saying why, and a bulk Delete that includes one
 * lists it, with this reason, among the teams it did not delete.
 */
export const BUILT_IN_TEAM_DELETE_REASON: string = translationKey(
  "This team comes with every project and can't be deleted.",
);

export const getTeamDeleteDisabledReason: (team: Team) => string | undefined = (
  team: Team,
): string | undefined => {
  return team.isTeamDeleteable === false
    ? BUILT_IN_TEAM_DELETE_REASON
    : undefined;
};

/*
 * What a new team starts with, picked under Access: a built-in role, one of
 * the project's custom roles, or nothing (Choose permissions later).
 */
interface PendingAccess {
  role: Permission | null;
  customRoleId: string | null;
}

const NO_ACCESS: PendingAccess = { role: null, customRoleId: null };

const Teams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The project's custom roles this user could give a team - every
   * permission in each one being one they may hand on - as Access cards.
   * Read once, after the page opens: null until then, and none for someone
   * who may not read them. Giving a custom role is an Enterprise feature, so
   * none either where the project may not use custom roles (the Community
   * Edition, or OneUptime Cloud below the plan): the server would refuse
   * the team the role.
   */
  const [customRoleOptions, setCustomRoleOptions] =
    useState<Array<CardSelectOption> | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (
      !projectId ||
      !isEnterpriseFeatureEligible(CUSTOM_ROLES_REQUIRED_PLAN)
    ) {
      setCustomRoleOptions([]);
      return;
    }

    Promise.all([
      loadCustomRoles({ projectId: projectId }),
      loadCustomRoleGrants({ projectId: projectId }),
    ])
      .then(
        ([roles, grants]: [
          Array<CustomRoleSummary>,
          Map<string, Array<TeamPermissionGrant>>,
        ]) => {
          setCustomRoleOptions(
            roles
              .filter((role: CustomRoleSummary): boolean => {
                /*
                 * A role that holds nothing yet gives a new team nothing,
                 * as Choose permissions later does: it is given from the
                 * team's page once it holds something.
                 */
                return (
                  role.permissionCount > 0 &&
                  GrantablePermission.canCurrentUserGrantTeam(
                    grants.get(role.id) || [],
                  )
                );
              })
              .map((role: CustomRoleSummary): CardSelectOption => {
                return getCustomRoleCardSelectOption(translator, role, {
                  value: getCustomRoleAccessValue(role.id),
                  saysItIsCustom: true,
                });
              }),
          );
        },
      )
      .catch(() => {
        // Roles the user may not read are roles Create Team can't offer.
        setCustomRoleOptions([]);
      });
  }, []);

  /*
   * The Access cards this user may pick from: the roles they may hand on,
   * the custom roles they could give, then Choose permissions later. Empty
   * for someone who may not add permissions to a team, who is then not
   * asked.
   */
  const accessOptions: Array<CardSelectOption> =
    useMemo((): Array<CardSelectOption> => {
      return getRoleAccessOptionsForCurrentUser(
        RoleAccessHolder.Team,
        customRoleOptions,
      );
    }, [customRoleOptions]);

  /*
   * Name, Access and, folded under Advanced, the description
   * (Components/Team/TeamCreateForm).
   */
  const createFormFields: Array<ModelField<Team>> = useMemo((): Array<
    ModelField<Team>
  > => {
    return getTeamCreateFormFields({
      accessOptions: accessOptions,
    });
  }, [accessOptions]);

  /*
   * The role picked under Access for the team being created. Read when the
   * form is submitted and used once the team exists; cleared as it is used,
   * so a later team never inherits it.
   */
  const pendingAccess: MutableRefObject<PendingAccess> =
    useRef<PendingAccess>(NO_ACCESS);

  const [accessNotice, setAccessNotice] = useState<AccessNotice | null>(null);

  type GetTeamPageRouteFunction = (data: {
    teamId: ObjectID;
    page: PageMap;
  }) => Route;

  const getTeamPageRoute: GetTeamPageRouteFunction = (data: {
    teamId: ObjectID;
    page: PageMap;
  }): Route => {
    return RouteUtil.populateRouteParams(RouteMap[data.page] as Route, {
      modelId: data.teamId,
    });
  };

  const teamExtraFacets: Array<ResourceFacet> = [
    {
      key: "member",
      label: "Member",
      icon: IconProp.User,
      isMultiSelect: true,
      searchPlaceholder: "Search users...",
      supportedOperators: ["is", "is_not"],
      loadOptions: loadProjectUserOptions,
      resolveOptions: resolveProjectUserOptions,
      computeMatchingResourceIds: (
        projectId: ObjectID,
        values: Array<string>,
      ): Promise<Array<string>> => {
        return computeTeamIdsForMembers(projectId, values);
      },
    },
    {
      key: "createdByUser",
      queryField: "createdByUserId",
      label: "Created By",
      icon: IconProp.User,
      isMultiSelect: true,
      searchPlaceholder: "Search users...",
      loadOptions: loadProjectUserOptions,
      resolveOptions: resolveProjectUserOptions,
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEntityFacetQuery(values, operator, true);
      },
    },
  ];

  /*
   * One chip per custom field this project has defined. They arrive a render
   * or two late (the definitions are fetched), which is what
   * `areFacetsLoading` below tells the bar.
   */
  const { facets: customFieldFacets, isLoading: areCustomFieldFacetsLoading } =
    useCustomFieldFacets({ customFieldsModelType: TeamCustomField });

  const {
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Team>({
    persistKey: "settings-teams-table",
    showOwnerFacet: false,
    extraFacets: [...teamExtraFacets, ...customFieldFacets],
    areFacetsLoading: areCustomFieldFacetsLoading,
  });

  return (
    <Fragment>
      {accessNotice && (
        <RoleAccessNotice
          holder={RoleAccessHolder.Team}
          name={accessNotice.teamName}
          error={accessNotice.error}
          onOpen={() => {
            Navigation.navigate(
              getTeamPageRoute({
                teamId: accessNotice.teamId,
                page: PageMap.TEAM_VIEW_PERMISSIONS,
              }),
            );
          }}
          onClose={() => {
            setAccessNotice(null);
          }}
        />
      )}
      <ModelTable<Team>
        modelType={Team}
        id="teams-table"
        name="Settings > Teams"
        saveFilterProps={{
          tableId: "settings-teams-table",
        }}
        isDeleteable={true}
        selectMoreFields={{
          isTeamDeleteable: true,
        }}
        getDeleteDisabledReason={getTeamDeleteDisabledReason}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        userPreferencesKey="teams-table"
        customFieldsModelType={TeamCustomField}
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        cardProps={{
          title: "Teams",
          description:
            "Teams decide what their members can do in this project. Every project starts with Owners, Admin and Members; create your own teams for finer-grained permissions.",
        }}
        query={mergeFiltersIntoQuery({
          projectId: ProjectUtil.getCurrentProjectId()!,
        } as Query<Team>)}
        showViewIdButton={true}
        formFields={createFormFields}
        onBeforeCreate={async (
          item: Team,
          _miscDataProps: JSONObject,
          formValues: JSONObject,
        ): Promise<Team> => {
          pendingAccess.current = {
            role: getRoleAccessRole(formValues[ROLE_ACCESS_FIELD_KEY]),
            customRoleId: getRoleAccessCustomRoleId(
              formValues[ROLE_ACCESS_FIELD_KEY],
            ),
          };

          return item;
        }}
        onCreateSuccess={async (
          createdTeam: Team,
          modalType?: ModalType,
        ): Promise<Team> => {
          const access: PendingAccess = pendingAccess.current;
          pendingAccess.current = NO_ACCESS;
          const role: Permission | null = access.role;

          if (modalType !== ModalType.Create || !createdTeam.id) {
            return createdTeam;
          }

          const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

          if ((role || access.customRoleId) && projectId) {
            try {
              if (access.customRoleId) {
                await giveCustomRoleAccess({
                  teamId: createdTeam.id,
                  projectId: projectId,
                  customRoleId: new ObjectID(access.customRoleId),
                });
              } else if (role) {
                await giveRoleAccess({
                  holder: RoleAccessHolder.Team,
                  holderId: createdTeam.id,
                  projectId: projectId,
                  role: role,
                });
              }
            } catch (err) {
              /*
               * The team exists and stays: say so, say why it has no
               * access, and point at its Permissions page, where a role is
               * one click.
               */
              setAccessNotice({
                teamId: createdTeam.id,
                teamName: createdTeam.name || "",
                error: API.getFriendlyMessage(err),
              });

              return createdTeam;
            }
          }

          setAccessNotice(null);

          /*
           * A new team opens where its next step is: Members, to invite
           * people, once it has a role; Permissions, where Add Role is, when
           * its permissions were left for later (TeamCreateForm).
           */
          Navigation.navigate(
            getTeamPageRoute({
              teamId: createdTeam.id,
              page: getNewTeamPage({
                role: role,
                customRoleId: access.customRoleId,
                wasAccessAsked: accessOptions.length > 0,
              }),
            }),
          );

          return createdTeam;
        }}
        showRefreshButton={true}
        searchableFields={["name"]}
        searchPlaceholder="Search teams by name..."
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
      />
    </Fragment>
  );
};

export default Teams;
