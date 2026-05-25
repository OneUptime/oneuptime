import UserElement from "../../../Components/User/User";
import ProjectUtil from "Common/UI/Utils/Project";
import ProjectUser from "../../../Utils/ProjectUser";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import UserUtil from "Common/UI/Utils/User";
import Banner from "Common/UI/Components/Banner/Banner";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";

const TeamViewMembers: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const currentUserId: ObjectID | null = (() => {
    const id: ObjectID = UserUtil.getUserId();
    return id && id.toString() ? id : null;
  })();

  const [isPushGroupsManaged, setIsPushGroupsManaged] =
    React.useState<boolean>(false);

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
          title="Team membership is managed by SCIM Push Groups"
          description="Manage team members from your identity provider or disable Push Groups in Settings > SCIM to make changes here."
        />
      )}

      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="table-team-member"
        userPreferencesKey="team-member-table"
        saveFilterProps={{
          tableId: "settings-team-view-members-table",
        }}
        isDeleteable={!isPushGroupsManaged}
        bulkActions={
          !isPushGroupsManaged
            ? {
                buttons: [ModalTableBulkDefaultActions.Delete],
              }
            : undefined
        }
        name="Settings > Team > Member"
        createVerb={"Invite"}
        isCreateable={!isPushGroupsManaged}
        isViewable={false}
        query={{
          teamId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot invite users while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.teamId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        onBeforeDelete={async (item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot remove team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          return item;
        }}
        cardProps={{
          title: "Team Members",
          description: "See a list of members or invite them to this team. ",
        }}
        noItemsMessage={"No members found for this team."}
        formFields={[
          {
            field: {
              user: true,
            },
            title: "User Email",
            description:
              "Please enter the email of the user you would like to invite. We will send them an email to let them know they have been invited to this team.",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "member@company.com",
            overrideFieldKey: "email",
          },
        ]}
        showRefreshButton={true}
        deleteButtonText="Remove Member"
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        actionButtons={[
          {
            title: "Leave Team",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Logout,
            isVisible: (item: TeamMember): boolean => {
              if (isPushGroupsManaged) {
                return false;
              }
              if (!currentUserId) {
                return false;
              }
              return item.userId?.toString() === currentUserId.toString();
            },
            onClick: async (
              item: TeamMember,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                if (!item._id) {
                  throw new BadDataException("Team member id is missing");
                }
                const url: URL = URL.fromString(APP_API_URL.toString())
                  .addRoute("/team-member")
                  .addRoute(`/${item._id.toString()}/leave`);

                const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                  await API.post({
                    url,
                    data: {},
                    headers: { ...ModelAPI.getCommonHeaders() },
                  });

                if (response instanceof HTTPErrorResponse) {
                  throw response;
                }

                onCompleteAction();
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.HOME] as Route,
                  ),
                  { forceNavigate: true },
                );
              } catch (err) {
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: {
              user: true,
            },
            type: FieldType.Entity,
            title: "User",
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            type: FieldType.Boolean,
            title: "Accepted Invite",
          },
        ]}
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
            type: FieldType.Text,
            getElement: (item: TeamMember): ReactElement => {
              if (item["user"]) {
                return <UserElement user={item["user"]} />;
              }

              return <></>;
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: TeamMember): ReactElement => {
              if (item["hasAcceptedInvitation"]) {
                return <Pill text="Member" color={Green} />;
              }
              return <Pill text="Invitation Sent" color={Yellow} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default TeamViewMembers;
