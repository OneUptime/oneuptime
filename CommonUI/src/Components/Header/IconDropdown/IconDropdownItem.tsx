import URL from 'Common/Types/API/URL';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp } from '../../Icon/Icon';
import Link from '../../Link/Link';

export interface ComponentProps {
    url: URL;
    icon: IconProp;
    title: string;
}

const IconDropdown: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="col">
            <Link className="dropdown-icon-item" to={props.url}>
                <Icon icon={props.icon} size={SizeProp.ExtraLarge} />
                <span>{props.title}</span>
            </Link>
        </div>
    );
};

export default IconDropdown;
