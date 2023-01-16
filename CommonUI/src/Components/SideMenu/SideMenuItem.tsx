import Link from 'Common/Types/Link';
import React, { FunctionComponent } from 'react';
import Navigation from '../../Utils/Navigation';
import Icon, { IconProp } from '../Icon/Icon';
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
}

const SideMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {

    let badgeClasName: string = `bg-indigo-${Navigation.isOnThisPage(props.link.to) ? '500' : '400'} p-1 rounded-full pr-3 pl-3 text-white font-bold text-sm`
;

    if (props.showWarning) {
        badgeClasName = "bg-yellow-500 p-1 rounded-full pr-2 pl-3 text-white font-bold text-sm"
    }

    if (props.showAlert) {
        badgeClasName = "bg-red-500 p-1 rounded-full pr-3 pl-3 text-white font-bold text-sm"
    }



    return (
        <UILink
            className={`${props.className ? props.className : ''}  ${
                Navigation.isOnThisPage(props.link.to)
                    ? 'bg-gray-100 text-indigo-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 group rounded-md px-3 py-2 flex items-center text-sm font-medium'
            } flex justify-between`}
            to={props.link.to}
        >
            <div className='flex'>
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

                <span className="truncate mt-1">{props.link.title}</span>
                </div>

            {props.badge || props.showAlert || props.showWarning ? <div className={badgeClasName}>
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
            </div> :<></>}
        </UILink>
    );
};

export default SideMenuItem;
