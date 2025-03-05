import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FieldType from "Common/UI/Components/Types/FieldType";
import Team from "Common/Models/DatabaseModels/Team";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import TableCard from "Common/UI/Components/Table/TableCard";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import TeamsElement from "../../Components/Team/TeamsElement";

const Teams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  interface TeamMemberItem {
    user: User | undefined;
    teams: Array<Team> | undefined;
  }

  const [teamMembers, setTeamMembers] = useState<TeamMemberItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);

      const teamMembers: ListResult<TeamMember> = await ModelAPI.getList({
        modelType: TeamMember,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {
          createdAt: SortOrder.Descending,
        },
        select: {
          user: {
            name: true,
            email: true,
            _id: true,
            profilePictureId: true,
          },
          team: {
            name: true,
            _id: true,
          },
        },
      });

      const teamMemberItems: TeamMemberItem[] = [];

      for (const teamMember of teamMembers.data) {
        // check if team member already exists in teamMemberItems. If it does, add the team to the existing team member. If it does not then, create a new team member and add the team to it.
        const teamMemberItemIndex = teamMemberItems.findIndex((item) => {
          return item.user?.id?.toString() === teamMember.user?._id?.toString();
        });
        if (teamMemberItemIndex !== -1) {
          teamMemberItems[teamMemberItemIndex]!.teams?.push(teamMember.team!);
        } else {
          teamMemberItems.push({
            user: teamMember.user!,
            teams: [teamMember.team!],
          });
        }
      }

      setTeamMembers(teamMemberItems);
      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
      setError(API.getFriendlyErrorMessage(error as Exception));
    }
  };

  React.useEffect(() => {
    loadItems().catch(() => {
      // Do nothing
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
      <TableCard<TeamMemberItem>
        title="Users"
        description="Here is a list of all the users in this project."
        headerButtons={[
          {
            // add user button
            icon: IconProp.Add,
            title: "Add User",
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setShowAddUserModal(true);
            },
          },
          {
            icon: IconProp.Refresh,
            title: "Refresh",
            buttonStyle: ButtonStyleType.ICON,
            onClick: loadItems,
          },
        ]}
        tableProps={{
          id: "users-table",
          data: teamMembers,
          itemsOnPage: 10,
          totalItemsCount: teamMembers.length,
          singularLabel: "User",
          pluralLabel: "Users",
          error: error || "",
          isLoading: isLoading,
          currentPageNumber: 1,
          onNavigateToPage: () => {},

          sortOrder: SortOrder.Descending,
          sortBy: "user",
          onSortChanged: () => {},
          onFilterModalClose: () => {},
          onFilterModalOpen: () => {},
          onFilterChanged: () => {},
          bulkActions: {
            buttons: [],
          },
          bulkSelectedItems: [],
          onBulkActionEnd: () => {},
          onBulkActionStart: () => {},
          onBulkClearAllItems: () => {},
          onBulkSelectedItemAdded: () => {},
          onBulkSelectedItemRemoved: () => {},
          onBulkSelectAllItems: () => {},
          bulkItemToString: () => "",
          onBulkSelectItemsOnCurrentPage: () => {},
          matchBulkSelectedItemByField: "user", 
          columns: [
            {
              key: "user",
              title: "User",
              type: FieldType.Element,
              getElement: (item: TeamMemberItem) => {
                if (!item.user) {
                  return <p>User not found</p>;
                }
                return <UserElement user={item.user!} />;
              },
            },
            {
              key: "teams",
              title: "Teams",
              type: FieldType.Element,
              getElement: (item: TeamMemberItem) => {
                if (!item.teams) {
                  return <p>Not added to any team.</p>;
                }
                return <TeamsElement teams={item.teams!} />;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default Teams;
