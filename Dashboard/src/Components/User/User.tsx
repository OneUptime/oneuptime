import { JSONObject } from 'Common/Types/JSON';
import Icon, { IconProp, ThickProp } from 'CommonUI/src/Components/Icon/Icon';
import User from 'Model/Models/User';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    user: User | JSONObject;
}

const UserElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    let user: JSONObject | null = null; 

    if (props.user instanceof User) {
        user = props.user.toJSONObject();
    } else {
        user = props.user; 
    }

    return (
        <div className="flex">
            <div className='user-circle'>
                <Icon icon={IconProp.User} thick={ThickProp.Thick} />
            </div>
            <div>
                <div className="bold">
                    {(user['name']?.toString() as string) ||
                        'User not signed up so far'}
                </div>

                <div className="color-light-grey">
                    {(user['email']?.toString() as string) ||
                        ''}
                </div>
            </div>
        </div>
    );
};

export default UserElement;
