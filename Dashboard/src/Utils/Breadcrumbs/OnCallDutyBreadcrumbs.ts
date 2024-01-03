import Dictionary from 'Common/Types/Dictionary';
import PageMap from '../PageMap';
import Link from 'Common/Types/Link';
import { BuildBreadcrumbLinksByTitles } from './Helper';

export function getOnCallDutyBreadcrumbs(
    path: string
): Array<Link> | undefined {
    const breadcrumpLinksMap: Dictionary<Link[]> = {
        ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY, [
            'Project',
            'On-Call Duty',
            'Policies',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICIES, [
            'Project',
            'On-Call Duty',
            'Policies',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULES, [
            'Project',
            'On-Call Duty',
            'Schedules',
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_EXECUTION_LOGS, [
            'Project',
            'On-Call Duty',
            'Execution Logs',
        ]),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE,
            ['Project', 'On-Call Duty', 'Execution Logs', 'Timeline']
        ),
        ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW, [
            'Project',
            'On-Call Duty',
            'View On-Call Policy',
        ]),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
            [
                'Project',
                'On-Call Duty',
                'View On-Call Policy',
                'Escalation Rules',
            ]
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS,
            ['Project', 'On-Call Duty', 'View On-Call Policy', 'Logs']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW,
            ['Project', 'On-Call Duty', 'View On-Call Policy', 'Timeline']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS,
            ['Project', 'On-Call Duty', 'View On-Call Policy', 'Custom Fields']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE,
            [
                'Project',
                'On-Call Duty',
                'View On-Call Policy',
                'Delete On-Call Policy',
            ]
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE,
            [
                'Project',
                'On-Call Duty',
                'View On-Call Policy',
                'Delete On-Call Policy',
            ]
        ),
        ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW, [
            'Project',
            'On-Call Duty',
            'View On-Call Schedule',
        ]),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS,
            ['Project', 'On-Call Duty', 'View On-Call Schedule', 'Layers']
        ),
        ...BuildBreadcrumbLinksByTitles(
            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE,
            [
                'Project',
                'On-Call Duty',
                'View On-Call Schedule',
                'Delete On-Call Schedule',
            ]
        ),
    };
    return breadcrumpLinksMap[path];
}
