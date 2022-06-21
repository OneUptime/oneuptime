import React, { ReactElement } from "react";

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>
}

const IconDropdown = (props: ComponentProps) => {
    return (
        <div tabIndex={-1} role="menu" aria-hidden="false" className="dropdown-menu-lg dropdown-menu-end dropdown-menu show" style={{ position: 'absolute', willChange: 'transform', top: '0px', left: '0px', transform: 'translate3d(0px, 70px, 0px)' }} x-placement="bottom-start">
            <div className="px-lg-2">
                {props.children}
            </div>
        </div>
    )
}

export default IconDropdown;