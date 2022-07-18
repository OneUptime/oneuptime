import Link from 'Common/Types/Link';
import React, { FunctionComponent } from 'react';
import Navigation from '../../Utils/Navigation';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import UILink from '../Link/Link';
import { Red, Yellow } from '../../Utils/BrandColors';

export interface ComponentProps {
    link: Link;
    showAlert?: boolean;
    showWarning?: boolean;
    badge?: number;
    icon?: IconProp;
    className?: string;
}

const SideMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    return (
        <UILink
            className={`${
                props.className ? props.className : ''
            } primary-on-hover pointer ${
                Navigation.isOnThisPage(props.link.to) ? 'active' : ''
            }`}
            to={props.link.to}
        >
            {props.icon ? (
                <>
                    <Icon icon={props.icon} thick={ThickProp.LessThick} />
                    &nbsp;
                </>
            ) : (
                <></>
            )}
            <span
            >
                {props.link.title}
            </span>
            {props.badge ? (
                <span className="mt-1 badge bg-success float-end">
                    {props.badge}
                </span>
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
        </UILink>
    );
};

export default SideMenuItem;
