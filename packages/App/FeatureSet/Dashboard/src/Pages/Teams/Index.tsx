import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import useCustomFieldFacets from "../../Components/CustomFields/useCustomFieldFacets";
import {
  ROLE_ACCESS_FIELD_KEY,
  RoleAccessHolder,
  getRoleAccessOptionsForCurrentUser,
  getRoleAccessRole,
  giveRoleAccess,
} from "../../Components/Permission/RoleAccess";
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

/*
 * A team whose access could not be added after it was made: what to say,
 * and which team to open.
 */
interface AccessNotice {
  teamId: ObjectID;
  teamName: string;
  error: string;
}

const Teams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * The Access cards this user may pick from: the roles they may hand on,
   * then Choose permissions later. Empty for someone who may not add
   * permissions to a team, who is then not asked. Read once.
   */
  const accessOptions: Array<CardSelectOption> =
    useMemo((): Array<CardSelectOption> => {
      return getRoleAccessOptionsForCurrentUser(RoleAccessHolder.Team);
    }, []);

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
  const pendingAccessRole: MutableRefObject<Permission | null> =
    useRef<Permission | null>(null);

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
        isDeleteable={false}
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
          pendingAccessRole.current = getRoleAccessRole(
            formValues[ROLE_ACCESS_FIELD_KEY],
          );

          return item;
        }}
        onCreateSuccess={async (
          createdTeam: Team,
          modalType?: ModalType,
        ): Promise<Team> => {
          const role: Permission | null = pendingAccessRole.current;
          pendingAccessRole.current = null;

          if (modalType !== ModalType.Create || !createdTeam.id) {
            return createdTeam;
          }

          const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

          if (role && projectId) {
            try {
              await giveRoleAccess({
                holder: RoleAccessHolder.Team,
                holderId: createdTeam.id,
                projectId: projectId,
                role: role,
              });
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
