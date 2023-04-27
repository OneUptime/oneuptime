import React, { FunctionComponent, ReactElement } from 'react';

export enum BadgeType {
    DANGER,
    SUCCESS,
    WARNING,
}

export interface ComponentProps {
    badgeCount: number;
    badgeType?: undefined | BadgeType;
}

const Badge: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let className: string =
        'bg-white text-gray-600 ring-1 ring-inset ring-gray-300';

    if (props.badgeType === BadgeType.DANGER) {
        className = 'bg-white text-red-600 ring-1 ring-inset ring-red-300';
    }

    if (props.badgeType === BadgeType.WARNING) {
        className =
            'bg-white text-yellow-600 ring-1 ring-inset ring-yellow-300';
    }

    if (props.badgeType === BadgeType.SUCCESS) {
        className =
            'bg-white text-emerald-600 ring-1 ring-inset ring-emerald-300';
    }

    if (props.badgeCount) {
        return (
            <span
                className={`${className} ml-auto w-11 min-w-max whitespace-nowrap rounded-full  px-2.5 py-0.5 text-center text-sm font-medium leading-5 `}
                aria-hidden="true"
            >
                {props.badgeCount}
            </span>
        );
    }
    return <></>;
};

export default Badge;
