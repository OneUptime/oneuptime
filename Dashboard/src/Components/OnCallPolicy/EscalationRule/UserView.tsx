import UsersElement from "../../User/Users";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "CommonUI/src/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import API from "CommonUI/src/Utils/API/API";
import ModelAPI, { ListResult } from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  escalationRuleId: ObjectID;
}

const UserView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [users, setUsers] = useState<Array<User>>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    try {
      setIsLoading(true);

      const onCallUsers: ListResult<OnCallDutyPolicyEscalationRuleUser> =
        await ModelAPI.getList({
          modelType: OnCallDutyPolicyEscalationRuleUser,
          query: {
            onCallDutyPolicyEscalationRuleId: props.escalationRuleId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            user: {
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {},
        });

      const users: Array<User> = onCallUsers.data.map(
        (onCallUser: OnCallDutyPolicyEscalationRuleUser) => {
          return onCallUser.user!;
        },
      );

      setUsers(users);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center w-full">
        <ComponentLoader />
      </div>
    );
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  return <UsersElement users={users} />;
};

export default UserView;
