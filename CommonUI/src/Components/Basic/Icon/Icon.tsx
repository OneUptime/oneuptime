import React, { FunctionComponent, ReactElement } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faCircleQuestion,
    faUser,
    faCog,
    faBell,
    faFile,
    faChevronDown,
    faChevronRight,
    IconDefinition,
    faHome,
    faCheck,
    faExclamation,
    faTriangleExclamation,
    faInfo,
} from '@fortawesome/free-solid-svg-icons';
import Dictionary from 'Common/Types/Dictionary';

export enum SizeProp {
    ExtraSmall = '8px',
    Smaller = '10px',
    Small = '12px',
    Regular = '15px',
    Large = '18px',
    ExtraLarge = '25px',
}
export enum IconProp {
    File = 'File',
    User = 'User',
    Settings = 'Settings',
    Notification = 'Notifications',
    Help = 'Help',
    ChevronDown = 'ChevronDown',
    ChevronRight = 'ChevronRight',
    Home = 'Home',
    CheckMark = 'CherkMark',
    Exclamation = 'Exclamation',
    TriangleExclamation = 'TriangleExclamation',
    Info = 'Info',
}

const IconDictionary: Dictionary<IconDefinition> = {
    [IconProp.Help]: faCircleQuestion,
    [IconProp.User]: faUser,
    [IconProp.Notification]: faBell,
    [IconProp.Settings]: faCog,
    [IconProp.File]: faFile,
    [IconProp.ChevronDown]: faChevronDown,
    [IconProp.ChevronRight]: faChevronRight,
    [IconProp.Home]: faHome,
    [IconProp.CheckMark]: faCheck,
    [IconProp.Exclamation]: faExclamation,
    [IconProp.TriangleExclamation]: faTriangleExclamation,
    [IconProp.Info]: faInfo,
};

export interface ComponentProps {
    icon: IconProp;
    size?: SizeProp;
    className?: string;
}

const Icon: FunctionComponent<ComponentProps> = ({
    size = SizeProp.Regular,
    icon,
    className,
}: ComponentProps): ReactElement => {
    return (
        <span
            style={{
                cursor: 'pointer',
            }}
            className={className ? className : ''}
        >
            <FontAwesomeIcon
                icon={IconDictionary[icon] as IconDefinition}
                style={{
                    fontSize: size,
                }}
            />
        </span>
    );
};

export default Icon;
