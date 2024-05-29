import PageMap from '../PageMap';
import { BuildBreadcrumbLinksByTitles } from './Helper';
import Dictionary from 'Common/Types/Dictionary';
import Link from 'Common/Types/Link';

export function getIncidentsBreadcrumbs(path: string): Array<Link> | undefined {
    const breadcrumpLinksMap: Dictionary<Link[]> = {
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS, [
            'Project',
            'Incidents',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.UNRESOLVED_INCIDENTS, [
            'Project',
            'Incidents',
            'Active Incidents',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW, [
            'Project',
            'Incidents',
            'View Incident',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_STATE_TIMELINE, [
            'Project',
            'Incidents',
            'View Incident',
            'State Timeline',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_OWNERS, [
            'Project',
            'Incidents',
            'View Incident',
            'Owners',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_INTERNAL_NOTE, [
            'Project',
            'Incidents',
            'View Incident',
            'Private Notes',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_PUBLIC_NOTE, [
            'Project',
            'Incidents',
            'View Incident',
            'Public Notes',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_CUSTOM_FIELDS, [
            'Project',
            'Incidents',
            'View Incident',
            'Custom Fields',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_DELETE, [
            'Project',
            'Incidents',
            'View Incident',
            'Delete Incident',
        ]),
    };
    return breadcrumpLinksMap[path];
}
