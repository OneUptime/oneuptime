import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp, ThickProp } from '../../Icon/Icon';
import Link from '../../Link/Link';

export interface ComponentProps {
    url?: URL | Route;
    icon?: IconProp;
    title: string;
    onClick?: (() => void) | undefined;
}

const IconDropdown: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Link
            className="block py-2 px-4 text-sm text-gray-700 flex hover:bg-gray-100"
            to={props.url}
            onClick={props.onClick}
        >
            <div className="mr-1 h-4 w-4">
                {props.icon ? (
                    <Icon
                        icon={props.icon}
                    />
                ) : (
                    <></>
                )}
            </div>
            <span className="-mt-1">{props.title}</span>
        </Link>
    );
};

export default IconDropdown;
