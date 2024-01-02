import Dictionary from 'Common/Types/Dictionary';
import PageMap from '../PageMap';
import Link from 'Common/Types/Link';
import { BuildBreadcrumbLinksByTitles } from './Helper';

export function getUserSettingsBreadcrumbs(
    path: string
): Array<Link> | undefined {
    const breadcrumpLinksMap: Dictionary<Link[]> = {
        ...BuildBreadcrumbLinksByTitles(
            PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
            ['Project', 'User Settings', 'Notification Methods']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS,
            ['Project', 'User Settings', 'Notification Settings']
        ),
        ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_ON_CALL_RULES, [
            'Project',
            'User Settings',
            'Notification Rules',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_ON_CALL_LOGS, [
            'Project',
            'User Settings',
            'Notification Logs',
        ]),
    };
    return breadcrumpLinksMap[path];
}
