import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Team from 'Model/Models/Team';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import DashboardNavigation from '../../Utils/Navigation';
import IncidentTemplate from 'Model/Models/IncidentTemplate';
import ProjectUser from '../../Utils/ProjectUser';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import MonitorStatus from 'Model/Models/MonitorStatus';
import Label from '../../Components/Label/Label';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import Monitor from 'Model/Models/Monitor';


const IncidentTemplates: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: 'Incident Templates',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_INCIDENT_TEMPLATES] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<IncidentTemplate>
                modelType={IncidentTemplate}
                id="incident-templates-table"
                name="Settings > Incident Templates"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    icon: IconProp.Alert,
                    title: 'Incident Templates',
                    description:
                        'Here is a list of all the incident templates in this project.',
                }}
                noItemsMessage={'No incident templates found.'}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                showViewIdButton={true}
                formSteps={[
                    {
                        title: 'Template Info',
                        id: 'template-info',
                    },
                    {
                        title: 'Incident Details',
                        id: 'incident-details',
                    },
                    {
                        title: 'Resources Affected',
                        id: 'resources-affected',
                    },
                    {
                        title: 'On-Call',
                        id: 'on-call',
                    },
                    {
                        title: 'Owners',
                        id: 'owners',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                formFields={[
                    {
                        field: {
                            templateName: true,
                        },
                        title: 'Template Name',
                        fieldType: FormFieldSchemaType.Text,
                        stepId: 'template-info',
                        required: true,
                        placeholder: 'Template Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            templateDescription: true,
                        },
                        title: 'Template Description',
                        fieldType: FormFieldSchemaType.Text,
                        stepId: 'template-info',
                        required: true,
                        placeholder: 'Template Description',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        fieldType: FormFieldSchemaType.Text,
                        stepId: 'incident-details',
                        required: true,
                        placeholder: 'Incident Title',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        stepId: 'incident-details',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                    },
                    {
                        field: {
                            incidentSeverity: true,
                        },
                        title: 'Incident Severity',
                        stepId: 'incident-details',
                        description: 'What type of incident is this?',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: IncidentSeverity,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Incident Severity',
                    },
                    {
                        field: {
                            monitors: true,
                        },
                        title: 'Monitors affected',
                        stepId: 'resources-affected',
                        description: 'Select monitors affected by this incident.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Monitor,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Monitors affected',
                    },
                    {
                        field: {
                            onCallDutyPolicies: true,
                        },
                        title: 'On-Call Policy',
                        stepId: 'on-call',
                        description:
                            'Select on-call duty policy to execute when this incident is created.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: OnCallDutyPolicy,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Select on-call policies',
                    },
                    {
                        field: {
                            changeMonitorStatusTo: true,
                        },
                        title: 'Change Monitor Status to ',
                        stepId: 'resources-affected',
                        description:
                            'This will change the status of all the monitors attached to this incident.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: MonitorStatus,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Monitor Status',
                    },
                    {
                        field: {
                            ownerTeams: true,
                        },
                        forceShow: true,
                        title: 'Owner - Teams',
                        stepId: 'owners',
                        description:
                            'Select which teams own this incident. They will be notified when the incident is created or updated.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Team,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Select Teams',
                        overrideFieldKey: 'ownerTeams',
                    },
                    {
                        field: {
                            ownerUsers: true,
                        },
                        forceShow: true,
                        title: 'Owner - Users',
                        stepId: 'owners',
                        description:
                            'Select which users own this incident. They will be notified when the incident is created or updated.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        fetchDropdownOptions: async () => {
                            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                                DashboardNavigation.getProjectId()!
                            );
                        },
                        required: false,
                        placeholder: 'Select Users',
                        overrideFieldKey: 'ownerUsers',
                    },
                    {
                        field: {
                            labels: true,
                        },
    
                        title: 'Labels ',
                        stepId: 'labels',
                        description:
                            'Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
                columns={[
                    {
                        field: {
                            templateName: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            templateDescription: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    }
                ]}
            />
        </Page>
    );
};

export default IncidentTemplates;
