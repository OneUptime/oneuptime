import type Route from 'Common/Types/API/Route';
import type Color from 'Common/Types/Color';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type { IconProp } from '../../Icon/Icon';
import Icon from '../../Icon/Icon';
import Link from '../../Link/Link';

export interface ComponentProps {
    title: string;
    badge?: undefined | number;
    route?: Route | undefined;
    onClick?: (() => void) | undefined;
    icon: IconProp;
    iconColor?: undefined | Color;
}

const UserProfile: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Link
            to={props.route}
            onClick={props.onClick}
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
