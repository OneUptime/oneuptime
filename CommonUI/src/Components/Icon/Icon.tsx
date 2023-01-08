import Color from 'Common/Types/Color';
import React, { CSSProperties, FunctionComponent, ReactElement } from 'react';
import {
    Home,
    Grid,
    Activity,
    AlertOctagon,
    PhoneCall,
    Settings,
    Bell,
    CheckCircle,
    Search,
    HelpCircle,
    Disc,
    Power,
    Image,
    Globe,
    Layout,
    MoreVertical,
    CreditCard,
    File,
    User,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    ChevronUp,
    Circle,
    Send,
    Mail,
    BarChart2,
    Slack,
    Clock,
    Terminal,
    AlertTriangle,
    Code,
    PieChart,
    Users,
    Rss,
    Lock,
    Key,
    Type,
    Folder,
    Share2,
    MessageSquare,
    ShoppingBag,
    Info,
    Check,
    Trash,
    X,
    Plus,
    Tag,
    RefreshCcw,
    Filter,
    Edit2,
    EyeOff,
    FileText,
    List,
    Link2,
    ExternalLink,
    Layers,
    Codesandbox,
    Star,
    ArrowDown,
    Compass,
} from 'react-feather';

export enum SizeProp {
    ExtraSmall = '8px',
    Smaller = '10px',
    Small = '12px',
    Regular = '15px',
    Large = '18px',
    Larger = '21px',
    ExtraLarge = '25px',
    Five = 'Five'
}

export enum ThickProp {
    Normal = '0.5px',
    LessThick = '1px',
    Thick = '2px',
}

export enum IconProp {
    File,
    Automation,
    Layout,
    Compass,
    User,
    Disc,
    Settings,
    Notification,
    Help,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ChevronLeft,
    UpDownArrow,
    Public,
    Home,
    Graph,
    Image,
    Grid,
    More,
    Activity,
    Alert,
    Call,
    List,
    CheckCircle,
    Search,
    TextFile,
    Globe,
    Logout,
    Billing,
    Email,
    Slack,
    Time,
    Terminal,
    Drag,
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
    RSS,
    Add,
    Label,
    Refresh,
    Filter,
    Edit,
    Hide,
    Check,
    True,
    False,
    Text,
    Circle,
    Webhook,
    SendMessage,
    ExternalLink,
    Link,
    Layers,
    Clock,
    Invoice,
    Upgrade,
    Star,
    Download,
    ErrorSolid
}

export enum IconType {
    Danger = "Danger",
    Success = "Success",
    Info = "Info",
    Warning = "Warning"
}

export interface ComponentProps {
    icon: IconProp;
    size?: SizeProp;
    className?: string;
    color?: Color | null;
    thick?: ThickProp;
    onClick?: (() => void) | undefined;
    style?: CSSProperties | undefined;
    type?: IconType | undefined;
}
const Icon: FunctionComponent<ComponentProps> = ({
    size = SizeProp.Regular,
    icon,
    className,
    color,
    thick = ThickProp.Normal,
    onClick,
    style,
    type
}: ComponentProps): ReactElement => {




    let sizeClassName: string = "h-4 w-4";

    if (size === SizeProp.Large) {
        sizeClassName = "h-6 w-6"
    } else if (size === SizeProp.Larger) {
        sizeClassName = "h-8 w-8"
    } else if (size === SizeProp.ExtraLarge) {
        sizeClassName = "h-10 w-10"
    } else if (size === SizeProp.ExtraSmall) {
        sizeClassName = "h-1 w-1"
    } else if (size === SizeProp.Small) {
        sizeClassName = "h-3 w-3"
    } else if (size === SizeProp.Smaller) {
        sizeClassName = "h-2 w-2"
    } else if (size === SizeProp.Five) {
        sizeClassName = "h-5 w-5"
    }

    let strokeWidth: string = "stroke-1";

    if (thick == ThickProp.LessThick) {
        strokeWidth = "stroke-0";
    } else if (thick === ThickProp.Thick) {
        strokeWidth = "stroke-2";
    }

    let textColor: string = "";

    if (type === IconType.Info) {
        textColor = "text-slate-600"
    } else if (type === IconType.Warning) {
        textColor = "text-yellow-600"
    } else if (type === IconType.Success) {
        textColor = "text-green-600"
    } else if (type === IconType.Danger) {
        textColor = "text-red-600"
    }


    const getSvgWrapper = (children: ReactElement): ReactElement => {
        return (<svg onClick={() => {
            onClick && onClick();
        }} className={`${textColor} ${sizeClassName} ${strokeWidth} ${className}`} style={color ? { color: color.toString() } : {}} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
            {children}
        </svg>)
    }


    if (icon === IconProp.Close) {
        return getSvgWrapper(
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        )
    } else if (icon === IconProp.Alert) {
        return getSvgWrapper(<path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v3.75m-9.303 3.376C1.83 19.126 2.914 21 4.645 21h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 4.88c-.866-1.501-3.032-1.501-3.898 0L2.697 17.626zM12 17.25h.007v.008H12v-.008z" />);
    } else if (icon == IconProp.Search) {
        return getSvgWrapper(<path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />);
    } else if (icon === IconProp.Notification) {
        return getSvgWrapper(<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />);
    } else if (icon === IconProp.Help) {
        return getSvgWrapper(
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        )
    } else if (icon === IconProp.Email) {
        return getSvgWrapper(
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        )
    } else if (icon === IconProp.User) {
        return getSvgWrapper(

            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />


        )
    } else if (icon === IconProp.UpDownArrow) {
        return getSvgWrapper(<path fill-rule="evenodd" d="M10 3a.75.75 0 01.55.24l3.25 3.5a.75.75 0 11-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 01-1.1-1.02l3.25-3.5A.75.75 0 0110 3zm-3.76 9.2a.75.75 0 011.06.04l2.7 2.908 2.7-2.908a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0l-3.25-3.5a.75.75 0 01.04-1.06z" clip-rule="evenodd" />)
    } else if (icon === IconProp.ErrorSolid) {
        return getSvgWrapper(<path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />)
    }

    return (
        <div
            style={{
                ...style,
            }}
            className={className ? className : 'pointer'}
            onClick={() => {
                onClick && onClick();
            }}
            role="icon"
        >
            {icon === IconProp.Home && (
                <Home
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.More && (
                <Grid
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Activity && (
                <Activity
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Call && (
                <PhoneCall
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Settings && (
                <Settings
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.CheckCircle && (
                <CheckCircle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Logout && (
                <Power
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Billing && (
                <CreditCard
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            
            {icon === IconProp.ChevronDown && (
                <ChevronDown
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.ChevronLeft && (
                <ChevronLeft
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.ChevronRight && (
                <ChevronRight
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.ChevronUp && (
                <ChevronUp
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            
            {icon === IconProp.Slack && (
                <Slack
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Time && (
                <Clock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Terminal && (
                <Terminal
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Error && (
                <AlertTriangle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Code && (
                <Code
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Report && (
                <PieChart
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Team && (
                <Users
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Lock && (
                <Lock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Key && (
                <Key
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Folder && (
                <Folder
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Integrations && (
                <Share2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.SMS && (
                <MessageSquare
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Info && (
                <Info
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Success && (
                <Check
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Trash && (
                <Trash
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Add && (
                <Plus
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Label && (
                <Tag
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Refresh && (
                <RefreshCcw
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Filter && (
                <Filter
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Edit && (
                <Edit2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Hide && (
                <EyeOff
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Check && (
                <Check
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.True && (
                <Check
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.False && (
                <X
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Automation && (
                <Codesandbox
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.List && (
                <List
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Public && (
                <User
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Circle && (
                <Circle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Graph && (
                <BarChart2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Globe && (
                <Globe
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Image && (
                <Image
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Text && (
                <Type
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Drag && (
                <MoreVertical
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Webhook && (
                <Link2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Link && (
                <Link2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.SendMessage && (
                <Send
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Disc && (
                <Disc
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.TextFile && (
                <FileText
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.ExternalLink && (
                <ExternalLink
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.RSS && (
                <Rss
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Layers && (
                <Layers
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
            {icon === IconProp.Clock && (
                <Clock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Invoice && (
                <File
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Upgrade && (
                <ShoppingBag
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Star && (
                <Star
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Download && (
                <ArrowDown
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Layout && (
                <Layout
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}

            {icon === IconProp.Compass && (
                <Compass
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString() : (undefined as any)}
                />
            )}
        </div>
    );
};

export default Icon;
