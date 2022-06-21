import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp } from '../Basic/Icon/Icon';
import useComponentOutsideClick from '../../Types/UseComponentOutsideClick';

export interface ComponentProps {
    icon: IconProp;
    badge?: number;
    children?: ReactElement | Array<ReactElement>;
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
                    setIsComponentVisible(!isComponentVisible);
                }}
                aria-expanded="false"
            >
                {props.icon ? (
                    <Icon icon={props.icon} size={SizeProp.Larger} />
                ) : (
                    <></>
                )}
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
