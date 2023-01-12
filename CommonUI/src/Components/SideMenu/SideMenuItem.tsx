import Link from 'Common/Types/Link';
import React, { FunctionComponent } from 'react';
import Navigation from '../../Utils/Navigation';
import Icon, { IconProp } from '../Icon/Icon';
import UILink from '../Link/Link';
import { BadgeType } from '../Badge/Badge';

export interface ComponentProps {
    link: Link;
    showAlert?: undefined | boolean;
    showWarning?: undefined | boolean;
    badge?: undefined | number;
    badgeType?: BadgeType | undefined;
    icon?: undefined | IconProp;
    className?: undefined | string;
}

const SideMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    return (
        <UILink
            className={`${props.className ? props.className : ''}  ${
                Navigation.isOnThisPage(props.link.to)
                    ? 'bg-gray-100 text-indigo-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 group rounded-md px-3 py-2 flex items-center text-sm font-medium'
            }`}
            to={props.link.to}
        >
            {props.icon ? (
                <>
                    <Icon
                        className={
                            Navigation.isOnThisPage(props.link.to)
                                ? 'text-indigo-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6'
                                : 'text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6'
                        }
                        icon={props.icon}
                    />
                </>
            ) : (
                <></>
            )}

            <span className="truncate">{props.link.title}</span>

            {/* <div>
                {props.badge ? (
                    <Badge
                        badgeCount={props.badge}
                        badgeType={props.badgeType}
                    />
                ) : (
                    <></>
                )}

                {props.showAlert ? (
                    <>
                        <Icon
                            className="float-end"
                            icon={IconProp.Error}
                            color={Red}
                        />
                    </>
                ) : (
                    <></>
                )}
                {props.showWarning ? (
                    <>
                        <Icon
                            className="float-end"
                            icon={IconProp.Alert}
                            color={Yellow}
                        />
                    </>
                ) : (
                    <></>
                )}
            </div> */}
        </UILink>
    );
};

export default SideMenuItem;
