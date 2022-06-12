import React, {
    ReactElement,
    MouseEventHandler,
    FunctionComponent,
} from 'react';
import Icon, { IconProp } from '../Icon/Icon';

export interface ComponentProps {
    icon?: IconProp;
    onClick?: MouseEventHandler;
    children: ReactElement | Array<ReactElement>;
}

const IconButton: FunctionComponent<ComponentProps> = ({
    icon,
    onClick,
    children,
}: ComponentProps): ReactElement => {
    return (
        <div className="buttonLayout">
            <div className="iconButton" onClick={onClick}>
                {icon && <Icon icon={icon} />}
            </div>
            <div className="dropdownButtonLists">{children}</div>
        </div>
    );
};

export default IconButton;
