import Dictionary from 'Common/Types/Dictionary';
import PageMap from '../PageMap';
import Link from 'Common/Types/Link';
import { BuildBreadcrumbLinksByTitles } from './Helper';

export function getTelemetryBreadcrumbs(path: string): Array<Link> | undefined {
    const breadcrumpLinksMap: Dictionary<Link[]> = {
        ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW, [
            'Project',
            'Telemetry',
            'Services',
            'View Service',
            'Overview',
        ]),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.TELEMETRY_SERVICES_VIEW_DOCUMENTATION,
            [
                'Project',
                'Telemetry',
                'Services',
                'View Service',
                'Documentation',
            ]
        ),
        ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_LOGS, [
            'Project',
            'Telemetry',
            'Services',
            'View Service',
            'Logs',
        ]),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.TELEMETRY_SERVICES_VIEW_METRICS,
            ['Project', 'Telemetry', 'Services', 'View Service', 'Metrics']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.TELEMETRY_SERVICES_VIEW_TRACES,
            ['Project', 'Telemetry', 'Services', 'View Service', 'Traces']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.TELEMETRY_SERVICES_VIEW_DASHBOARDS,
            ['Project', 'Telemetry', 'Services', 'View Service', 'Dashboards']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.TELEMETRY_SERVICES_VIEW_SETTINGS,
            ['Project', 'Telemetry', 'Services', 'View Service', 'Settings']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.TELEMETRY_SERVICES_VIEW_DELETE,
            [
                'Project',
                'Telemetry',
                'Services',
                'View Service',
                'Delete Service',
            ]
        ),
    };
    return breadcrumpLinksMap[path];
}
