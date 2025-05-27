import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import UsersElement from "./Users";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  userIds: Array<ObjectID>;
}

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
      const users: ListResult<User> = await ModelAPI.getList({
        modelType: User,
        query: {
          _id: new Includes(props.userIds),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          name: true,
          profilePictureId: true,
          email: true,
          _id: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setUsers(users.data);
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
