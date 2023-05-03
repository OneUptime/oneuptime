import BadDataException from '../Exception/BadDataException';

enum MonitorType {
    Manual = 'Manual',
    Website = 'Website',
    API = 'API',
    Ping = 'Ping',
    Kubernetes = 'Kubernetes',
    IP = 'IP',
    IncomingRequest = 'IncomingRequest',
}

export default MonitorType;

export interface MonitorTypeProps {
    monitorType: MonitorType;
    description: string;
    title: string;
}

export class MonitorTypeHelper {
    public static getAllMonitorTypeProps(): Array<MonitorTypeProps> {
        const monitorTypeProps: Array<MonitorTypeProps> = [
            {
                monitorType: MonitorType.API,
                title: 'API',
                description:
                    'This monitor type lets you monitor any API - GET, POST, PUT, DELETE or more.',
            },
            {
                monitorType: MonitorType.Manual,
                title: 'Manual',
                description:
                    'This monitor is a static monitor and will not actually monitor anything. It will however help you to integrate OneUptime with external monitoring tools and utilities.',
            },
            {
                monitorType: MonitorType.Website,
                title: 'Website',
                description:
                    'This monitor type lets you monitor landing pages like home page of your company / blog or more.',
            },
            {
                monitorType: MonitorType.Ping,
                title: 'Ping',
                description:
                    'This monitor types does the basic ping test of an endpoint.',
            },
            // {
            //     monitorType: MonitorType.Kubernetes,
            //     title: 'Kubenretes',
            //     description:
            //         'This monitor types lets you monitor kuberetes clusters.',
            // },
            {
                monitorType: MonitorType.IP,
                title: 'IP',
                description:
                    'This monitor types lets you monitor any IPv4 or IPv6 addresses.',
            },
            // {
            //     monitorType: MonitorType.IncomingRequest,
            //     title: 'Incoming Request',
            //     description:
            //         'This monitor types lets you ping OneUptime from any external device or service wuth a custom payload.',
            // },
        ];

        return monitorTypeProps;
    }

    public static getDescription(monitorType: MonitorType): string {
        const monitorTypeProps: Array<MonitorTypeProps> =
            this.getAllMonitorTypeProps().filter((item: MonitorTypeProps) => {
                return item.monitorType === monitorType;
            });

        if (!monitorTypeProps[0]) {
            throw new BadDataException(
                `${monitorType} does not have monitorType props`
            );
        }

        return monitorTypeProps[0].description;
    }

    public static getTitle(monitorType: MonitorType): string {
        const monitorTypeProps: Array<MonitorTypeProps> =
            this.getAllMonitorTypeProps().filter((item: MonitorTypeProps) => {
                return item.monitorType === monitorType;
            });

        if (!monitorTypeProps[0]) {
            throw new BadDataException(
                `${monitorType} does not have monitorType props`
            );
        }

        return monitorTypeProps[0].title;
    }
}
