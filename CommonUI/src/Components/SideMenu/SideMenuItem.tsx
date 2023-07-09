import Link from 'Common/Types/Link';
import React, { FunctionComponent } from 'react';
import Navigation from '../../Utils/Navigation';
import Icon from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import UILink from '../Link/Link';
import Badge, { BadgeType } from '../Badge/Badge';

export interface ComponentProps {
    link: Link;
    showAlert?: undefined | boolean;
    showWarning?: undefined | boolean;
    badge?: undefined | number;
    badgeType?: BadgeType | undefined;
    icon?: undefined | IconProp;
    className?: undefined | string;
    subItemLink?: undefined | Link;
    subItemIcon?: undefined | IconProp;
}

const SideMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    const badgeClasName: string = `p-1 rounded-full pr-3 pl-3 text-white  text-sm`;

    let linkClassName: string = `text-gray-500 hover:text-gray-900 hover:bg-gray-100 group rounded-md px-3 py-2 flex items-center text-sm font-medium`;

    if (Navigation.isOnThisPage(props.link.to)) {
        linkClassName = `bg-gray-100 text-indigo-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium`;
    }

    let subItemLinkClassName: string = `text-gray-500 hover:text-gray-900 hover:bg-gray-100 group rounded-md px-3 py-2 flex items-center text-sm font-medium`;

    if (props.subItemLink && Navigation.isOnThisPage(props.subItemLink.to)) {
        subItemLinkClassName = `bg-gray-100 text-indigo-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium`;
    }

    // if(props.badge && props.badge > 0){
    //     if(props.badgeType === BadgeType.DANGER){
    //         linkClassName = `text-red-400 hover:text-red-600 hover:bg-gray-100 group rounded-md px-3 py-2 flex items-center text-sm font-medium`;

    //         if(Navigation.isOnThisPage(props.link.to)){
    //             linkClassName = `bg-gray-100 text-red-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium`;
    //         }

    //     }

    //     if(props.badgeType === BadgeType.WARNING){
    //         linkClassName = `text-yellow-400 hover:text-yellow-600 hover:bg-gray-100 group rounded-md px-3 py-2 flex items-center text-sm font-medium`;

    //         if(Navigation.isOnThisPage(props.link.to)){
    //             linkClassName = `bg-gray-100 text-yellow-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium`;
    //         }
    //     }

    //     if(props.badgeType === BadgeType.SUCCESS){
    //         linkClassName = `text-emerald-400 hover:text-emerald-600 hover:bg-gray-100 group rounded-md px-3 py-2 flex items-center text-sm font-medium`;

    //         if(Navigation.isOnThisPage(props.link.to)){
    //             linkClassName = `bg-gray-100 text-emerald-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium`;
    //         }
    //     }
    // }

    let iconClassName: string =
        'text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6';

    if (Navigation.isOnThisPage(props.link.to)) {
        iconClassName = 'text-indigo-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6';
    }

    let subItemIconClassName: string =
        'text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6';

    if (props.subItemLink && Navigation.isOnThisPage(props.subItemLink.to)) {
        subItemIconClassName =
            'text-indigo-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6';
    }

    // if(props.badge && props.badge > 0){
    //     if(props.badgeType === BadgeType.DANGER){
    //         iconClassName = `text-red-400 group-hover:text-red-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6`;

    //         if(Navigation.isOnThisPage(props.link.to)){
    //             iconClassName = `text-red-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6`;
    //         }

    //     }

    //     if(props.badgeType === BadgeType.WARNING){
    //         iconClassName = `text-yellow-400 group-hover:text-yellow-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6`;

    //         if(Navigation.isOnThisPage(props.link.to)){
    //             iconClassName = `text-yellow-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6`;
    //         }
    //     }

    //     if(props.badgeType === BadgeType.SUCCESS){
    //         iconClassName = `text-emerald-400 group-hover:text-emerald-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6`;

    //         if(Navigation.isOnThisPage(props.link.to)){
    //             iconClassName = `text-emerald-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6`;
    //         }
    //     }
    // }

    return (
        <>
            <UILink
                className={`${
                    props.className ? props.className : ''
                }  ${linkClassName} flex justify-between`}
                to={props.link.to}
            >
                <div className="flex">
                    {props.icon ? (
                        <>
                            <Icon className={iconClassName} icon={props.icon} />
                        </>
                    ) : (
                        <></>
                    )}

                    <span className="truncate mt-1">{props.link.title}</span>
                </div>

                {props.badge || props.showAlert || props.showWarning ? (
                    <div className={badgeClasName}>
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
                                    className="float-end text-red-900"
                                    icon={IconProp.Error}
                                />
                            </>
                        ) : (
                            <></>
                        )}
                        {props.showWarning ? (
                            <>
                                <Icon
                                    className="float-end text-yellow-900"
                                    icon={IconProp.Alert}
                                />
                            </>
                        ) : (
                            <></>
                        )}
                    </div>
                ) : (
                    <></>
                )}
            </UILink>
            {props.subItemLink ? (
                <UILink
                    className={`${
                        props.className ? props.className : ''
                    }  ${subItemLinkClassName} flex justify-between`}
                    to={props.subItemLink.to}
                >
                    <div className="ml-8 flex">
                        {props.icon ? (
                            <>
                                <Icon
                                    className={subItemIconClassName}
                                    icon={
                                        props.subItemIcon || IconProp.MinusSmall
                                    }
                                />
                            </>
                        ) : (
                            <></>
                        )}

                        <span className="truncate mt-1">
                            {props.subItemLink.title}
                        </span>
                    </div>
                </UILink>
            ) : (
                <> </>
            )}
        </>
    );
};

export default SideMenuItem;
