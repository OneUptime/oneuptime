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
    FiCircle,
    FiMail,
    FiSlack,
    FiClock,
    FiTerminal,
    FiAlertTriangle,
    FiCode,
    FiPieChart,
    FiUsers,
    FiLock,
    FiKey,
    FiFolder,
    FiShare2,
    FiMessageSquare,
    FiInfo,
    FiCheck,
    FiTrash,
    FiX,
    FiPlus,
    FiTag,
    FiRefreshCcw,
    FiFilter,
    FiEdit2,
    FiEyeOff,
    FiList,
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

export enum ThickProp {
    Normal = '',
    LessThick = '2px',
    Thick = '3px',
    ExtraThick = '5px',
}

export enum IconProp {
    File,
    User,
    Settings,
    Notification,
    Help,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ChevronLeft,
    Public,
    Home,
    Grid,
    More,
    Activity,
    Alert,
    Call,
    List,
    CheckCircle,
    Search,
    Logout,
    Billing,
    Email,
    Slack,
    Time,
    Terminal,
    Error,
    Code,
    Report,
    Team,
    Lock,
    Key,
    Folder,
    Integrations,
    SMS,
    Info,
    Success,
    Trash,
    Close,
    Add,
    Label,
    Refresh,
    Filter,
    Edit,
    Hide,
    Check,
    True,
    False,
    Circle
}

export interface ComponentProps {
    icon: IconProp;
    size?: SizeProp;
    className?: string;
    color?: Color | null;
    thick?: ThickProp;
    onClick?: (() => void) | undefined;
}

const Icon: FunctionComponent<ComponentProps> = ({
    size = SizeProp.Regular,
    icon,
    className,
    color,
    thick = ThickProp.Normal,
    onClick,
}: ComponentProps): ReactElement => {
    return (
        <div
            style={{
                cursor: 'pointer',
            }}
            className={className ? className : ''}
            onClick={() => {
                onClick && onClick();
            }}
        >
            {icon === IconProp.Home && (
                <FiHome
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.More && (
                <FiGrid
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Activity && (
                <FiActivity
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Alert && (
                <FiAlertOctagon
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Call && (
                <FiPhoneCall
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Settings && (
                <FiSettings
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Notification && (
                <FiBell
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.CheckCircle && (
                <FiCheckCircle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Search && (
                <FiSearch
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Help && (
                <FiHelpCircle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Logout && (
                <FiPower
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Billing && (
                <FiCreditCard
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.User && (
                <FiUser
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.ChevronDown && (
                <FiChevronDown
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.ChevronLeft && (
                <FiChevronLeft
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.ChevronRight && (
                <FiChevronRight
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.ChevronUp && (
                <FiChevronUp
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Email && (
                <FiMail
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Slack && (
                <FiSlack
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Time && (
                <FiClock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Terminal && (
                <FiTerminal
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Error && (
                <FiAlertTriangle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Code && (
                <FiCode
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Report && (
                <FiPieChart
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Team && (
                <FiUsers
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}

            {icon === IconProp.Lock && (
                <FiLock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}

            {icon === IconProp.Key && (
                <FiKey
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}

            {icon === IconProp.Folder && (
                <FiFolder
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}

            {icon === IconProp.Integrations && (
                <FiShare2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}

            {icon === IconProp.SMS && (
                <FiMessageSquare
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Info && (
                <FiInfo
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Success && (
                <FiCheck
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Trash && (
                <FiTrash
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Close && (
                <FiX
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Add && (
                <FiPlus
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Label && (
                <FiTag
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Refresh && (
                <FiRefreshCcw
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Filter && (
                <FiFilter
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Edit && (
                <FiEdit2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Hide && (
                <FiEyeOff
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.Check && (
                <FiCheck
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.True && (
                <FiCheck
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.False && (
                <FiX
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
            {icon === IconProp.List && (
                <FiList
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}

            {icon === IconProp.Public && (
                <FiUser
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}

            {icon === IconProp.Circle && (
                <FiCircle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : ''}
                />
            )}
        </div>
    );
};

export default Icon;
