import React, { ReactElement } from "react";

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    title?: string
}

const NavBarMenuColumn = (props: ComponentProps) => {
    return (
        <div>
            {props.title && <div className="menu-title">{props.title}</div>}
            <div className="row">
                <div className="col-lg-12">
                    <div>
                        {props.children}
                    </div>
                </div>
            </div>
        </div>
    )
}


export default NavBarMenuColumn;