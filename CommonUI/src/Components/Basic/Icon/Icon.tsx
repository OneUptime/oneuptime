import React, { FunctionComponent, ReactElement } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faCircleQuestion,
    faUser,
    faCog,
    faBell,
    faFile,
    IconDefinition
} from '@fortawesome/free-solid-svg-icons';
import Dictionary from 'Common/Types/Dictionary';

export enum SizeProp {
    ExtraSmall = '8px',
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
}

const IconDictionary: Dictionary<IconDefinition> = {
    [IconProp.Help]: faCircleQuestion,
    [IconProp.User]: faUser,
    [IconProp.Notification]: faBell,
    [IconProp.Settings]: faCog,
    [IconProp.File]: faFile
}

export interface ComponentProps {
    icon: IconProp;
    size?: SizeProp;
}

const Icon: FunctionComponent<ComponentProps> = ({
    size = SizeProp.Regular,
    icon
}: ComponentProps): ReactElement => {
    return (
        <span style={ 
            {
                cursor: "pointer"
            }
        }>
            <FontAwesomeIcon icon={IconDictionary[icon] as IconDefinition} style={ 
                {
                    fontSize: size
                }
            } />
        </span>
    );
};

export default Icon;
