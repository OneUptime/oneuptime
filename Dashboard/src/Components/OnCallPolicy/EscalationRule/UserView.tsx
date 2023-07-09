import React, { FunctionComponent, ReactElement, useState } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import User from 'Model/Models/User';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import OnCallDutyPolicyEscalationRuleUser from 'Model/Models/OnCallDutyPolicyEscalationRuleUser';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import useAsyncEffect from 'use-async-effect';
import API from 'CommonUI/src/Utils/API/API';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import UsersElement from '../../User/Users';

export interface ComponentProps {
    escalationRuleId: ObjectID;
}

const UserView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [users, setUsers] = useState<Array<User>>([]);

    const [isLoading, setIsLoading] = useState<boolean>(false);

    const [error, setError] = useState<string>('');

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const onCallUsers: ListResult<OnCallDutyPolicyEscalationRuleUser> =
                await ModelAPI.getList(
                    OnCallDutyPolicyEscalationRuleUser,
                    {
                        onCallDutyPolicyEscalationRuleId:
                            props.escalationRuleId,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        user: {
                            name: true,
                            email: true,
                            profilePictureId: true,
                        },
                    },
                    {}
                );

            const users: Array<User> = onCallUsers.data.map(
                (onCallUser: OnCallDutyPolicyEscalationRuleUser) => {
                    return onCallUser.user!;
                }
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
