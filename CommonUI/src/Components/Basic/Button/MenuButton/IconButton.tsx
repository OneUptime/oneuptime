import React, {
    ReactElement,
    FunctionComponent,
} from 'react';
import useComponentOutsideClick from '../../../../Types/UseComponentOutsideClick';
import Icon, { IconProp } from '../../Icon/Icon';

export interface ComponentProps {
    icon?: IconProp;
    onClick?: Function;
    children: ReactElement | Array<ReactElement>;
}

const IconButton: FunctionComponent<ComponentProps> = ({
    icon,
    onClick,
    children,
}: ComponentProps): ReactElement => {

    const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
    return (
        <div className="buttonLayout">
            <div className="iconButton" ref={ref} onClick={() => {
                setIsComponentVisible(!isComponentVisible);
                if (onClick) {
                    onClick();
                }
            }}>
                {icon && <Icon icon={icon} />}
            </div>
            {isComponentVisible && <div className="dropdownButtonLists">{children}</div>}
        </div>
    );
};

export default IconButton;
