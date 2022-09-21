import React, { FunctionComponent, ReactElement } from 'react';

export enum BadgeType {
    DANGER,
    SUCCESS,
    WARNING,
}


export interface ComponentProps {
    badgeCount: number
    badgeType?: undefined | BadgeType;
}

const Badge: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {

    let className = 'bg-success';

    if (props.badgeType === BadgeType.DANGER) {
        className = 'bg-danger';
    }

    if (props.badgeType === BadgeType.WARNING) {
        className = 'bg-warning';
    }

    if (props.badgeCount) {
        return (<span className={`mt-1 badge ${className} float-end`}>
            {props.badgeCount}
        </span>)
    }
    return <></>
};

export default Badge;
