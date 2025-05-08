import ProjectUtil from "Common/UI/Utils/Project";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/Models/DatabaseModels/User";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Team from "Common/Models/DatabaseModels/Team";
import TeamElement from "../../Components/Team/Team";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Image from "Common/UI/Components/Image/Image";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Detail from "Common/UI/Components/Detail/Detail";
import Card from "Common/UI/Components/Card/Card";
import FileUtil from "Common/UI/Utils/File";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";
import RemoveUserFromProject from "../../Components/User/RemoveUserFromProject";
import PageMap from "../../Utils/PageMap";

const UserView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const userId: ObjectID = Navigation.getLastParamAsObjectID();

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const teamMembers: ListResult<TeamMember> =
        await ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: userId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            user: {
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {},
          skip: 0,
          limit: 1,
        });

      if (teamMembers.data.length === 0) {
        setError("User not found.");
        return;
      }

      const user: User = teamMembers!.data[0]!.user!;

      setUser(user);
    } catch (error) {
      setError(API.getFriendlyErrorMessage(error as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // get team member with user.
    loadPage().catch((error: Error) => {
      setError(API.getFriendlyErrorMessage(error as Exception));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <Card
        title={
          user?.name?.toString() || user?.email?.toString() || "User Details"
        }
        description="View details about this user."
      >
        <Detail
          item={user!}
          fields={[
            {
              key: "profilePictureId",
              fieldType: FieldType.Element,
              title: "Profile Picture",
              placeholder: "No profile picture uploaded.",
              getElement: (item: User): ReactElement => {
                if (!item.profilePictureId) {
                  return (
                    <Image
                      className="h-12 w-12 rounded-full"
                      imageUrl={BlankProfilePic}
                      alt={
                        item.name?.toString() ||
                        item.email?.toString() ||
                        "User Profile Picture"
                      }
                    />
                  );
                }

                return (
                  <Image
                    className="h-12 w-12 rounded-full"
                    imageUrl={FileUtil.getFileRoute(item.profilePictureId!)}
                    alt={
                      item.name?.toString() ||
                      item.email?.toString() ||
                      "User Profile Picture"
                    }
                  />
                );
              },
            },
            {
              key: "name",
              title: "Name",
              fieldType: FieldType.Name,
              placeholder: "No name provided.",
            },
            {
              key: "email",
              title: "Email",
              fieldType: FieldType.Email,
            },
            {
              key: "_id",
              title: "User ID",
              fieldType: FieldType.ObjectID,
            },
          ]}
        />
      </Card>

      {/* User Members Table */}

      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="table-User-member"
        userPreferencesKey="user-member-table"
        isDeleteable={true}
        name="Settings > User > Member"
        createVerb={"Invite"}
        isCreateable={true}
        isViewable={false}
        query={{
          userId: userId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.userId = userId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        singularName=" "
        pluralName=" "
        cardProps={{
          title: "Teams",
          description: "See a list of teams this user is a members of.",
        }}
        noItemsMessage={"This user is not a member of any team."}
        formFields={[
          {
            field: {
              team: true,
            },
            title: "Team",
            description: "Select the team you would like to add this user to.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Team",
          },
        ]}
        showRefreshButton={true}
        deleteButtonText="Remove"
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              team: true,
            },
            type: FieldType.Entity,
            title: "Team",
            filterEntityType: Team,
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
        ]}
        columns={[
          {
            field: {
              team: {
                name: true,
                _id: true,
              },
            },
            title: "Team",
            type: FieldType.Element,
            getElement: (item: TeamMember): ReactElement => {
              if (item["team"]) {
                return <TeamElement team={item["team"]!} />;
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

      <RemoveUserFromProject
        userId={userId}
        projectId={ProjectUtil.getCurrentProjectId()!}
        onError={async () => {
          // do nothing.
        }}
        onActionComplete={() => {
          // navigate to users list.
          Navigation.navigate(
            RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS_USERS]!),
          );
        }}
      />
    </Fragment>
  );
};

export default UserView;
