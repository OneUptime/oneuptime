import PageMap from '../PageMap';
import { BuildBreadcrumbLinksByTitles } from './Helper';
import Dictionary from 'Common/Types/Dictionary';
import Link from 'Common/Types/Link';

export function getMonitorGroupBreadcrumbs(
    path: string
): Array<Link> | undefined {
    const breadcrumpLinksMap: Dictionary<Link[]> = {
        ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW, [
            'Project',
            'Monitor Groups',
            'View Monitor Group',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_OWNERS, [
            'Project',
            'Monitor Groups',
            'View Monitor Group',
            'Owners',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_MONITORS, [
            'Project',
            'Monitor Groups',
            'View Monitor Group',
            'Monitors',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_INCIDENTS, [
            'Project',
            'Monitor Groups',
            'View Monitor Group',
            'Incidents',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_GROUP_VIEW_DELETE, [
            'Project',
            'Monitor Groups',
            'View Monitor Group',
            'Delete Monitor Group',
        ]),
    };
    return breadcrumpLinksMap[path];
}
