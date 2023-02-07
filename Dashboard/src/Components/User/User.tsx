import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Icon, { ThickProp } from 'CommonUI/src/Components/Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import User from 'Model/Models/User';
import React, { FunctionComponent, ReactElement } from 'react';
import Image from 'CommonUI/src/Components/Image/Image';
import URL from 'Common/Types/API/URL';
import { FILE_URL } from 'CommonUI/src/Config';
import BlankProfilePic from 'CommonUI/src/Images/users/blank-profile.svg';
import Route from 'Common/Types/API/Route';

export interface ComponentProps {
    user?: User | JSONObject | undefined | null;
    prefix?: string | undefined;
    suffix?: string | undefined;
    suffixClassName?: string | undefined;
    usernameClassName?: string | undefined;
    prefixClassName?: string | undefined;
}

const UserElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let user: JSONObject | null | undefined = null;

    if (props.user instanceof User) {
        user = JSONFunctions.toJSONObject(props.user, User);
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
                {props.user?.profilePictureId && (
                    <Image
                        className="h-8 w-8 rounded-full"
                        imageUrl={URL.fromString(FILE_URL.toString()).addRoute(
                            '/image/' + props.user?.profilePictureId.toString()
                        )}
                        alt={user['name']?.toString() || 'User'}
                    />
                )}
                {!props.user?.profilePictureId && (
                    <Image
                        className="h-8 w-8 rounded-full"
                        imageUrl={Route.fromString(`${BlankProfilePic}`)}
                        alt={user['name']?.toString() || 'User'}
                    />
                )}
            </div>
            <div className="mt-1 mr-1 ml-3">
                <div>
                    <span
                        className={
                            props.prefixClassName ? props.prefixClassName : ''
                        }
                    >
                        {props.prefix}
                    </span>{' '}
                    <span
                        className={
                            props.usernameClassName
                                ? props.usernameClassName
                                : ''
                        }
                    >{`${(user['name']?.toString() as string) ||
                        (user['email']?.toString() as string) ||
                        ''
                        }`}</span>{' '}
                </div>
            </div>
            {props.suffix && (
                <div>
                    <p className={props.suffixClassName}>{props.suffix}</p>
                </div>
            )}
        </div>
    );
};

export default UserElement;
