import Route from 'Common/Types/API/Route';
import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../../Icon/Icon';
import Link from '../../Link/Link';

export interface ComponentProps {
    title: string;
    badge?: undefined | number;
    route: Route;
    icon: IconProp;
    iconColor?: undefined | Color;
}

const UserProfile: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Link
            to={props.route}
            onClick={undefined}
            className="dropdown-item flex"
        >
            {props.badge ? (
                <span className="badge bg-success float-end">
                    {props.badge}
                </span>
            ) : (
                <></>
            )}
            <Icon
                icon={props.icon}
                color={props.iconColor ? props.iconColor : null}
            />
            {
                <div
                    style={{
                        marginTop: '1px',
                    }}
                >
                    &nbsp;&nbsp;{props.title}&nbsp;&nbsp;&nbsp;&nbsp;
                </div>
            }
        </Link>
    );
};

export default UserProfile;
