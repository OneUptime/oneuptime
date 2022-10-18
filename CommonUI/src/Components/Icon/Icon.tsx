import { LightGrey } from 'Common/Types/BrandColors';
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
    MoreVertical,
    CreditCard,
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
} from 'react-feather';

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
    Disc,
    Settings,
    Notification,
    Help,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ChevronLeft,
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
    Clock
}

export interface ComponentProps {
    icon: IconProp;
    size?: SizeProp;
    className?: string;
    color?: Color | null;
    thick?: ThickProp;
    onClick?: (() => void) | undefined;
    style?: CSSProperties | undefined;
}

const Icon: FunctionComponent<ComponentProps> = ({
    size = SizeProp.Regular,
    icon,
    className,
    color,
    thick = ThickProp.Normal,
    onClick,
    style,
}: ComponentProps): ReactElement => {
    return (
        <div
            style={{
                ...style,
            }}
            className={className ? className : 'pointer'}
            onClick={() => {
                onClick && onClick();
            }}
        >
            {icon === IconProp.Home && (
                <Home
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.More && (
                <Grid
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Activity && (
                <Activity
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Alert && (
                <AlertOctagon
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Call && (
                <PhoneCall
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Settings && (
                <Settings
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Notification && (
                <Bell
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.CheckCircle && (
                <CheckCircle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Search && (
                <Search
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Help && (
                <HelpCircle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Logout && (
                <Power
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Billing && (
                <CreditCard
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.User && (
                <User
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.ChevronDown && (
                <ChevronDown
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.ChevronLeft && (
                <ChevronLeft
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.ChevronRight && (
                <ChevronRight
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.ChevronUp && (
                <ChevronUp
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Email && (
                <Mail
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Slack && (
                <Slack
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Time && (
                <Clock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Terminal && (
                <Terminal
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Error && (
                <AlertTriangle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Code && (
                <Code
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Report && (
                <PieChart
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Team && (
                <Users
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Lock && (
                <Lock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Key && (
                <Key
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Folder && (
                <Folder
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Integrations && (
                <Share2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.SMS && (
                <MessageSquare
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Info && (
                <Info
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Success && (
                <Check
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Trash && (
                <Trash
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Close && (
                <X
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Add && (
                <Plus
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Label && (
                <Tag
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Refresh && (
                <RefreshCcw
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Filter && (
                <Filter
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Edit && (
                <Edit2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Hide && (
                <EyeOff
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Check && (
                <Check
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.True && (
                <Check
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.False && (
                <X
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.List && (
                <List
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Public && (
                <User
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Circle && (
                <Circle
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Graph && (
                <BarChart2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Globe && (
                <Globe
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Image && (
                <Image
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Text && (
                <Type
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Drag && (
                <MoreVertical
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Webhook && (
                <Link2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Link && (
                <Link2
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.SendMessage && (
                <Send
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.Disc && (
                <Disc
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.TextFile && (
                <FileText
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.ExternalLink && (
                <ExternalLink
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

            {icon === IconProp.RSS && (
                <Rss
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Layers && (
                <Layers
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}
            {icon === IconProp.Clock && (
                <Clock
                    size={size}
                    strokeWidth={thick ? thick : ''}
                    color={color ? color.toString(): LightGrey.toString()}
                />
            )}

        </div>
    );
};

export default Icon;
