import BaseModel from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';
import Icon, { IconProp, ThickProp } from 'CommonUI/src/Components/Icon/Icon';
import User from 'Model/Models/User';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    user?: User | JSONObject | undefined | null;
    prefix?: string | undefined;
}

const UserElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let user: JSONObject | null | undefined = null;

    if (props.user instanceof User) {
        user = BaseModel.toJSONObject(props.user, User);
    } else {
        user = props.user;
    }

    if (!user) {
        return (
            <div className="flex">
                <div>
                    <Icon icon={IconProp.Automation} thick={ThickProp.Thick} />
                </div>
                <div
                    style={{
                        marginLeft: '5px',
                        marginBottom: '5px',
                        marginTop: '1px',
                    }}
                >
                    <div className="bold">
                        {props.prefix} OneUptime Automation
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex">
            <div>
                <Icon icon={IconProp.User} thick={ThickProp.Thick} />
            </div>
            <div
                style={{
                    marginLeft: '5px',
                    marginBottom: '5px',
                    marginTop: '1px',
                }}
            >
                <div>
                    <span className="bold">{props.prefix}</span>{' '}
                    <span className="bold">{`${
                        (user['name']?.toString() as string) ||
                        (user['email']?.toString() as string) ||
                        ''
                    }`}</span>{' '}
                    {user['name'] ? (
                        <span>
                            ({(user['email']?.toString() as string) || ''})
                        </span>
                    ) : (
                        <></>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UserElement;
