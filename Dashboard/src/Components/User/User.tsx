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
            <div>
                {(props.user.toJSONObject()['name']?.toString() as string) ||
                    ''}
            </div>

            <div>
                {(props.user.toJSONObject()['email']?.toString() as string) ||
                    ''}
            </div>
        </div>
    );
};

export default UserElement;
