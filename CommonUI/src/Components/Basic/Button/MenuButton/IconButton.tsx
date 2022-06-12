import React, { ReactElement, FunctionComponent } from 'react';
import useComponentOutsideClick from '../../../../Types/UseComponentOutsideClick';
import Icon, { IconProp, SizeProp } from '../../Icon/Icon';
import './IconButton.scss'

export interface ComponentProps {
    icon?: IconProp;
    onClick?: Function;
    children: ReactElement | Array<ReactElement>;
    size?: SizeProp;
}

const IconButton: FunctionComponent<ComponentProps> = ({
    icon,
    onClick,
    children,
    size,
}: ComponentProps): ReactElement => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);
    return (
        <div className="buttonLayout">
            <div
                className="iconButton"
                ref={ref}
                onClick={() => {
                    setIsComponentVisible(!isComponentVisible);
                    if (onClick) {
                        onClick();
                    }
                }}
            >
                {icon && (
                    <Icon className="icon" icon={icon} size={size ? size : SizeProp.Regular} />
                )}
            </div>
            {isComponentVisible && (
                <div className="dropdownButtonLists">{children}</div>
            )}
        </div>
    );
};

export default IconButton;
