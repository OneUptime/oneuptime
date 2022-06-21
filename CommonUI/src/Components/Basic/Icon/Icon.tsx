import React, { FunctionComponent, ReactElement } from 'react';
import {
    FiHome,
    FiGrid,
    FiActivity,
    FiAlertOctagon,
    FiPhoneCall,
    FiSettings,
    FiBell,
    FiCheckCircle,
    FiSearch,
    FiHelpCircle
} from "react-icons/fi";

export enum SizeProp {
    ExtraSmall = '8px',
    Smaller = '10px',
    Small = '12px',
    Regular = '15px',
    Large = '18px',
    Larger = '21px',
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
    Grid = 'Grid',
    More = 'More',
    Activity = 'Activity',
    Alert = 'Alert',
    Call = 'Call',
    CheckCircle = 'CheckCircle',
    Search = 'Search'
}

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
            {icon === IconProp.Home && <FiHome size={size} />} 
            {icon === IconProp.More && <FiGrid size={size} />} 
            {icon === IconProp.Activity && <FiActivity size={size} />} 
            {icon === IconProp.Alert && <FiAlertOctagon size={size} />} 
            {icon === IconProp.Call && <FiPhoneCall size={size} />} 
            {icon === IconProp.Settings && <FiSettings size={size} />} 
            {icon === IconProp.Notification && <FiBell size={size} />} 
            {icon === IconProp.CheckCircle && <FiCheckCircle size={size} />} 
            {icon === IconProp.Search && <FiSearch size={size} />} 
            {icon === IconProp.Help && <FiHelpCircle size={size}/>} 
        </span>
    );
};

export default Icon;
