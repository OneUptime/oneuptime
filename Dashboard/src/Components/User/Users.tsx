import User from 'Model/Models/User';
import UserElement from './User';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    users?: Array<User>;
    prefix?: string | undefined;
    suffix?: string | undefined;
    suffixClassName?: string | undefined;
    usernameClassName?: string | undefined;
    prefixClassName?: string | undefined;
}

const UsersElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.users || props.users.length === 0) {
        return <p>No users.</p>;
    }

    return (
        <div className="space-y-2 mt-2 mb-2">
            {props.users?.map((user: User) => {
                return (
                    <UserElement
                        key={user.id?.toString()}
                        user={user}
                        prefix={props.prefix}
                        suffix={props.suffix}
                        suffixClassName={props.suffixClassName}
                        usernameClassName={props.usernameClassName}
                        prefixClassName={props.prefixClassName}
                    />
                );
            })}
        </div>
    );
};

export default UsersElement;
