export interface NavLink {
    title: string;
    url: string;
}

export interface NavGroup {
    title: string;
    links: NavLink[];
}

const DocsNav: NavGroup[] = [
    {
        title: 'Introduction',
        links: [
            {
                title: 'Getting Started',
                url: '/docs/introduction/getting-started',
            },
        ],
    },
    {
        title: 'Installation',
        links: [
            {
                title: 'Local Development',
                url: '/docs/installation/local-development',
            },
            {
                title: 'Docker Compose',
                url: '/docs/installation/docker-compose',
            },
            {
                title: 'Kubernetes and Helm',
                url: 'https://artifacthub.io/packages/helm/oneuptime/oneuptime',
            },
        ],
    },
    {
        title: 'Monitor',
        links: [
            {
                title: 'Custom Code Monitor',
                url: '/docs/monitor/custom-code-monitor',
            },
            {
                title: 'Synthetic Monitor',
                url: '/docs/monitor/synthetic-monitor',
            },
            {
                title: 'JavaScript Expressions',
                url: '/docs/monitor/javascript-expression',
            },
        ],
    },
    {
        title: 'Probe',
        links: [
            { title: 'Custom Probes', url: '/docs/probe/custom-probe' },
            { title: 'IP Addresses', url: '/docs/probe/ip-address' },
        ],
    },
    {
        title: 'Telemetry',
        links: [
            { title: 'OpenTelemetry', url: '/docs/telemetry/open-telemetry' },
            { title: 'Fluentd', url: '/docs/telemetry/fluentd' },
        ],
    },
];

export default DocsNav;
