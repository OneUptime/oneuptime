import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import UserElement from "../../Components/User/User";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import Team from "Common/Models/DatabaseModels/Team";
import TeamElement from "../../Components/Team/Team";
import Route from "Common/Types/API/Route";
import { RouteUtil } from "../../Utils/RouteMap";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Banner from "Common/UI/Components/Banner/Banner";
import useResourceOwners, {
  ResourceFacet,
  buildBooleanFacetQuery,
  buildEntityFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../Components/ResourceOwners/FilterChipDropdown";
import {
  loadProjectUserOptions,
  resolveProjectUserOptions,
} from "../../Components/ResourceOwners/ProjectUserFacetOptions";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";

const Users: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [showInviteUserModal, setShowInviteUserModal] =
    React.useState<boolean>(false);
  const [showScimErrorModal, setShowScimErrorModal] =
    React.useState<boolean>(false);
  const [isPushGroupsManaged, setIsPushGroupsManaged] =
    React.useState<boolean>(false);

  const userExtraFacets: Array<ResourceFacet> = [
    {
      key: "user",
      queryField: "userId",
      label: "User",
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
    {
      key: "hasAcceptedInvitation",
      label: "Status",
      icon: IconProp.CheckCircle,
      isMultiSelect: false,
      options: [
        { value: "true", label: "Member" },
        { value: "false", label: "Invitation Sent" },
      ],
      supportedOperators: ["is", "is_not"],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildBooleanFacetQuery(values, operator);
      },
    },
    {
      key: "team",
      queryField: "teamId",
      label: "Team",
      icon: IconProp.Team,
      isMultiSelect: true,
      searchPlaceholder: "Search teams...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<Team> = {
          projectId: projectId,
        } as Query<Team>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<Team> = await ModelAPI.getList<Team>({
          modelType: Team,
          query: query,
          limit: 50,
          skip: 0,
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
        });
        return result.data.map((t: Team) => {
          return {
            value: t.id?.toString() || "",
            label: t.name?.toString() || "",
          };
        });
      },
      resolveOptions: async (
        projectId: ObjectID,
        values: Array<string>,
      ): Promise<Array<FilterChipDropdownOption>> => {
        if (values.length === 0) {
          return [];
        }
        const result: ListResult<Team> = await ModelAPI.getList<Team>({
          modelType: Team,
          query: {
            projectId: projectId,
            _id: new Includes(values),
          } as Query<Team>,
          limit: values.length,
          skip: 0,
          select: { _id: true, name: true },
          sort: {},
        });
        return result.data.map((t: Team) => {
          return {
            value: t.id?.toString() || "",
            label: t.name?.toString() || "",
          };
        });
      },
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEntityFacetQuery(values, operator, true);
      },
    },
  ];

  const {
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
    hasActiveFilters,
  } = useResourceOwners<TeamMember>({
    persistKey: "settings-users-table",
    showOwnerFacet: false,
    extraFacets: userExtraFacets,
  });

  React.useEffect(() => {
    const checkScim: () => Promise<void> = async () => {
      if (!props.currentProject || !props.currentProject._id) {
        return;
      }
      try {
        const scimCount: number = await ModelAPI.count<ProjectSCIM>({
          modelType: ProjectSCIM,
          query: {
            projectId: props.currentProject._id,
            enablePushGroups: true,
          },
        });
        setIsPushGroupsManaged(scimCount > 0);
      } catch {
        // ignore
      }
    };
    checkScim();
  }, [props.currentProject]);

  return (
    <Fragment>
      {isPushGroupsManaged && (
        <Banner
          title="Users are managed by SCIM Push Groups"
          description="Invite or remove users from your identity provider or disable Push Groups in Settings > SCIM to manage them here."
        />
      )}

      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="teams-table"
        name="Settings > Users"
        userPreferencesKey="users-table"
        saveFilterProps={{
          tableId: "settings-users-table",
        }}
        isDeleteable={!isPushGroupsManaged}
        bulkActions={
          !isPushGroupsManaged
            ? {
                buttons: [ModalTableBulkDefaultActions.Delete],
              }
            : undefined
        }
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        onBeforeDelete={async (item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot remove team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          return item;
        }}
        cardProps={{
          title: "Users",
          description:
            "Here is a list of all the team members in this project.",
          buttons: [
            {
              title: "Invite User",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Add,
              onClick: () => {
                if (isPushGroupsManaged) {
                  setShowScimErrorModal(true);
                } else {
                  setShowInviteUserModal(true);
                }
              },
            },
          ],
        }}
        noItemsMessage={
          hasActiveFilters
            ? "No users found"
            : "Please wait, we are refreshing the list of users for this project. Please try again in sometime."
        }
        query={mergeFiltersIntoQuery({
          projectId: ProjectUtil.getCurrentProjectId()!,
        } as Query<TeamMember>)}
        showRefreshButton={true}
        onViewPage={(item: TeamMember) => {
          const viewPageRoute: string =
            RouteUtil.populateRouteParams(props.pageRoute).toString() +
            "/" +
            item.user?.id?.toString();
          return Promise.resolve(new Route(viewPageRoute));
        }}
        filters={[]}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Element,
            getElement: (item: TeamMember) => {
              if (!item.user) {
                return <p>User not found</p>;
              }
              return <UserElement user={item.user!} />;
            },
          },
          {
            field: {
              team: {
                name: true,
                _id: true,
              },
            },
            title: "Team",
            type: FieldType.Element,
            getElement: (item: TeamMember) => {
              if (!item.team) {
                return <p>No team assigned</p>;
              }
              return <TeamElement team={item.team!} />;
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: TeamMember) => {
              if (item.hasAcceptedInvitation) {
                return <Pill text="Member" color={Green} />;
              }
              return <Pill text="Invitation Sent" color={Yellow} />;
            },
          },
        ]}
      />
      {showInviteUserModal && !isPushGroupsManaged && (
        <ModelFormModal<TeamMember>
          modelType={TeamMember}
          name="Invite New User"
          title="Invite New User"
          description="Invite new user to this project."
          onClose={() => {
            setShowInviteUserModal(false);
          }}
          submitButtonText="Invite"
          onSuccess={(teamMember: TeamMember | null) => {
            if (teamMember) {
              const userId: string =
                teamMember.user?.id?.toString() ||
                teamMember.userId?.toString() ||
                "";
              const viewPageRoute: string =
                RouteUtil.populateRouteParams(props.pageRoute).toString() +
                "/" +
                userId;
              Navigation.navigate(new Route(viewPageRoute));
            }
            setShowInviteUserModal(false);
          }}
          formProps={{
            name: "Create New Project",
            modelType: TeamMember,
            id: "create-project-from",
            fields: [
              {
                field: {
                  user: true,
                },
                title: "User Email",
                description:
                  "Please enter the email of the user you would like to invite. We will send them an email to let them know they have been invited to team you have selected.",
                fieldType: FormFieldSchemaType.Email,
                required: true,
                placeholder: "member@company.com",
                overrideFieldKey: "email",
              },
              {
                field: {
                  team: true,
                },
                title: "Team",
                description:
                  "Select the team you would like to add this user to.",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownModal: {
                  type: Team,
                  labelField: "name",
                  valueField: "_id",
                },
                placeholder: "Select a team",
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}
      {showScimErrorModal && (
        <ConfirmModal
          title="Users are managed by SCIM Push Groups"
          description="Team membership is being managed by your identity provider. Disable Push Groups in Settings > SCIM if you need to invite or promote users from OneUptime."
          onSubmit={() => {
            setShowScimErrorModal(false);
          }}
          submitButtonText="Close"
        />
      )}
    </Fragment>
  );
};

export default Users;
