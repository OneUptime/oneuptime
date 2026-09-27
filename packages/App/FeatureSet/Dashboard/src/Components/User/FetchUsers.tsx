import User from "Common/Models/DatabaseModels/User";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import UsersElement from "./Users";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  userIds: Array<ObjectID>;
}

const getUserSortName: (user: User) => string = (user: User): string => {
  return user.name?.toString() || user.email?.toString() || "";
};

const FetchUsers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");
  const [users, setUsers] = React.useState<Array<User>>([]);

  const fetchUsers: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      /*
       * The User model is readable only by that user: listing other users by
       * id is refused for anyone but a master admin ("You do not have
       * permission to access another user's User"). TeamMember is the
       * project-scoped link to User the dashboard can list (see ProjectUser),
       * so the users are looked up through it. A user in several teams comes
       * back once per team, and is listed once.
       */
      const query: Query<TeamMember> = {
        userId: new Includes(props.userIds),
      };

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        query.projectId = projectId;
      }

      const teamMembers: ListResult<TeamMember> =
        await ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: query,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          select: {
            _id: true,
            user: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {},
        });

      const usersById: Map<string, User> = new Map();

      for (const teamMember of teamMembers.data) {
        const userId: string | undefined = teamMember.user?._id?.toString();

        if (teamMember.user && userId && !usersById.has(userId)) {
          usersById.set(userId, teamMember.user);
        }
      }

      setUsers(
        Array.from(usersById.values()).sort((a: User, b: User): number => {
          return getUserSortName(a).localeCompare(getUserSortName(b));
        }),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchUsers().catch((err: Exception) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  return <UsersElement users={users} />;
};

export default FetchUsers;
