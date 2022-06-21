import Color from 'Common/Types/Color';
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
    FiHelpCircle,
    FiPower,
    FiCreditCard,
    FiUser,
    FiChevronDown,
    FiChevronRight,
    FiChevronLeft,
    FiChevronUp,
    FiMail,
    FiSlack,
    FiClock,
} from 'react-icons/fi';

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
    ChevronUp = 'ChevronUp',
    ChevronLeft = 'ChevronLeft',
    Home = 'Home',
    Grid = 'Grid',
    More = 'More',
    Activity = 'Activity',
    Alert = 'Alert',
    Call = 'Call',
    CheckCircle = 'CheckCircle',
    Search = 'Search',
    Logout = 'Logout',
    Billing = 'Billing',
    Email = 'Email',
    Slack = 'Slack',
    Time = 'Time',
}

export interface ComponentProps {
    icon: IconProp;
    size?: SizeProp;
    className?: string;
    color?: Color | null;
}

const Icon: FunctionComponent<ComponentProps> = ({
    size = SizeProp.Regular,
    icon,
    className,
    color,
}: ComponentProps): ReactElement => {
    return (
        <span
            style={{
                cursor: 'pointer',
            }}
            className={className ? className : ''}
        >
            {icon === IconProp.Home && (
                <FiHome size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.More && (
                <FiGrid size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.Activity && (
                <FiActivity size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.Alert && (
                <FiAlertOctagon
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Call && (
                <FiPhoneCall
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Settings && (
                <FiSettings size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.Notification && (
                <FiBell size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.CheckCircle && (
                <FiCheckCircle
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Search && (
                <FiSearch size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.Help && (
                <FiHelpCircle
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Logout && (
                <FiPower size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.Billing && (
                <FiCreditCard
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.User && (
                <FiUser size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.ChevronDown && (
                <FiChevronDown
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.ChevronLeft && (
                <FiChevronLeft
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.ChevronRight && (
                <FiChevronRight
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.ChevronUp && (
                <FiChevronUp
                    size={size}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Email && (
                <FiMail size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.Slack && (
                <FiSlack size={size} color={color ? color.toString() : ''} />
            )}
            {icon === IconProp.Time && (
                <FiClock size={size} color={color ? color.toString() : ''} />
            )}
        </span>
    );
};

export default Icon;
