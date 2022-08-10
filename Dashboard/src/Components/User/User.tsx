import User from 'Model/Models/User';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    user: User;
}

const UserElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <div className="bold">
                {(props.user.toJSONObject()['name']?.toString() as string) ||
                    'User not signed up so far'}
            </div>

            <div className="color-light-grey">
                {(props.user.toJSONObject()['email']?.toString() as string) ||
                    ''}
            </div>
        </div>
    );
};

export default UserElement;
