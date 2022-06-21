import React, { ReactElement } from "react";
import Icon, { IconProp, SizeProp } from "../Basic/Icon/Icon";


export interface ComponentProps {
    icon: IconProp,
    badge?: number
    children?: ReactElement | Array<ReactElement>
}

const HeaderIconDropdownButton = (props: ComponentProps) => {
    return (<li className="dropdown d-inline-block dropdown show">
        <button aria-haspopup="true" className="btn header-item noti-icon position-relative" aria-expanded="false">
            {props.icon ? <Icon icon={props.icon} size={SizeProp.Larger} /> : <></>}
            {props.badge && props.badge > 0 && <span className="badge bg-danger rounded-pill">{props.badge}</span>}
        </button>
        {props.children}
    </li>)
}


export default HeaderIconDropdownButton;