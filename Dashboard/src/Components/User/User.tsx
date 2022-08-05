import User from 'Model/Models/User';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    user: User;
}

const UserElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <p>
            {((props.user.toJSONObject())[
                'name'
            ]?.toString() as string) || ''}
        </p>
    );
};

export default UserElement;
