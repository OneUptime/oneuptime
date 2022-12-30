import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp } from '../Icon/Icon';
import useComponentOutsideClick from '../../Types/UseComponentOutsideClick';

export interface ComponentProps {
    icon: IconProp;
    badge?: undefined | number;
    children?: undefined | ReactElement | Array<ReactElement>;
    title?: string | undefined;
    onClick?: (() => void) | undefined;
}

const HeaderIconDropdownButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);

    return (
        <li className="dropdown d-inline-block dropdown show">
            <button
                aria-haspopup="true"
                className="btn header-item noti-icon position-relative"
                onClick={() => {
                    props.onClick && props.onClick();
                    setIsComponentVisible(!isComponentVisible);
                }}
                aria-expanded="false"
            >
                {props.icon ? (
                    <Icon icon={props.icon} size={SizeProp.Larger} />
                ) : (
                    <></>
                )}
                {props.title}
                {props.badge && props.badge > 0 && (
                    <span className="badge bg-danger rounded-pill">
                        {props.badge}
                    </span>
                )}
            </button>
            <div ref={ref}>{isComponentVisible && props.children}</div>
        </li>
    );
};

export default HeaderIconDropdownButton;
