import React, { ReactElement } from "react";

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>,
}

const UserProfile = (props: ComponentProps): ReactElement => {
    
    return (
        <div tabIndex={-1} role="menu" aria-hidden="true" className="dropdown-menu-end dropdown-menu show" style={{"position":"absolute","willChange":"transform","top":"0px","left":"0px","transform":"translate3d(0px, 70px, 0px)"}}>
            {props.children}
        </div>
    )
}


export default UserProfile;