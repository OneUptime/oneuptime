import React, { ReactElement } from "react";

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>
}

const NavBarItem = (props: ComponentProps) => {
    let children: Array<ReactElement>;
    if (!Array.isArray(props.children) && props.children) {
        children = [props.children];
    } else {
        children = props.children
    }
    return (<div className={`dropdown-menu ${children.length > 1 ? 'mega-dropdown-menu dropdown-menu-left dropdown-mega-menu-xl': ''}`}>
        <div className="ps-2 p-lg-0">
            <div className="row">
                {children && children.length > 0 && children.map((child, i) => {
                    return (<div key={i} className={`col-lg-${Math.floor(12 / (children as Array<ReactElement>).length)}`}>
                        {child}
                    </div>)
                })}
            </div>
        </div>
    </div>)
}


export default NavBarItem;