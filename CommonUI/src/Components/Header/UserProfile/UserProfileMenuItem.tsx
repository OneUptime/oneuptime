import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import React, { ReactElement } from "react";
import Icon, { IconProp } from "../../Basic/Icon/Icon";
import Link from "../../Link/Link";

export interface ComponentProps {
    title: string,
    badge?: number,
    route: Route,
    icon: IconProp,
    iconColor?: Color
}

const UserProfile = (props: ComponentProps): ReactElement => {
    return (<Link to={props.route} className="dropdown-item">
        {props.badge ? <span className="badge bg-success float-end">{props.badge}</span> : <></>}
        <Icon icon={props.icon} color={props.iconColor ? props.iconColor : null} />{<span>&nbsp;&nbsp;{props.title}&nbsp;&nbsp;&nbsp;&nbsp;</span>}</Link>)
}

export default UserProfile;