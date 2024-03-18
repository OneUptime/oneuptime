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
            { title: 'Getting Started', url: '/docs/introduction/getting-started' },
        ],
    },
    {
        title: 'Installation',
        links: [
            { title: 'Local Development', url: '/docs/installation/local-development' },
            { title: 'Docker Compose', url: '/docs/installation/docker-comopose' },
            { title: 'Kubernetes and Helm', url: '/docs/installation/kubernetes' },
        ],
    },
    {
        title: 'Monitor',
        links: [
            { title: 'JavaScript Expressions', url: '/docs/monitors/javascript-expressions' },
        ],
    },
    {
        title: 'Probe',
        links: [
            { title: 'Custom Probes', url: '/docs/probes/custom-probes' },
            { title: 'IP Addresses', url: '/docs/probes/ip-addresses' },
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
