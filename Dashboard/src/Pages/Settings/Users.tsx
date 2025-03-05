import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUser from "Common/Models/DatabaseModels/ProjectUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
} from "react";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Team from "Common/Models/DatabaseModels/Team";
import TeamsElement from "../../Components/Team/TeamsElement";
import Route from "Common/Types/API/Route";

const Teams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {

  return (
    <Fragment>
      <ModelTable<ProjectUser>
        modelType={ProjectUser}
        id="teams-table"
        name="Settings > Users"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Users",
          description: "Here is a list of all the users in this project.",
        }}
        noItemsMessage={"No users found."}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
        }}
        showRefreshButton={true}
        onViewPage={(item: ProjectUser) => {
          const viewPageRoute: string = props.pageRoute.toString() + "/" + item.user?.id?.toString(); 
          // add user id to the route
          return Promise.resolve(new Route(viewPageRoute)); 
        }}
        filters={[
          {
            field: {
              user: {
                name: true,
              },
            },
            title: "User",
            type: FieldType.Entity,

            filterEntityType: User,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              acceptedTeams: {
                name: true,
              },
            },
            title: "Teams",
            type: FieldType.EntityArray,
            filterEntityType: Team,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              invitedTeams: {
                name: true,
              },
            },
            title: "Invited to Teams",
            type: FieldType.EntityArray,
            filterEntityType: Team,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
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
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Element,
            getElement: (item: ProjectUser) => {
              if (!item.user) {
                return <p>User not found</p>;
              }
              return <UserElement user={item.user!} />;
            },
          },
          {
            field: {
              acceptedTeams: {
                name: true,
              }
            },
            title: "Teams",
            type: FieldType.Element,
            getElement: (item: ProjectUser) => {
              return <TeamsElement teams={item.acceptedTeams || []} />;
            },
          },
          {
            field: {
              invitedTeams: {
                name: true,
              }
            },
            title: "Invited to Teams",
            type: FieldType.Element,
            getElement: (item: ProjectUser) => {
              return <TeamsElement teams={item.invitedTeams || []} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default Teams;
