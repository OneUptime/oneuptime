import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import DashboardNavigation from '../../Utils/Navigation';
import ScheduledMaintenanceNoteTemplate from 'Model/Models/ScheduledMaintenanceNoteTemplate';

const ScheduledMaintenanceNoteTemplates: FunctionComponent<
    PageComponentProps
> = (props: PageComponentProps): ReactElement => {
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
                    title: 'Scheduled Maintenance Note Templates',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap
                                .SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES
                        ] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<ScheduledMaintenanceNoteTemplate>
                modelType={ScheduledMaintenanceNoteTemplate}
                id="incident-templates-table"
                name="Settings > Scheduled Maintenance Templates"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    title: 'Public or Private Note Templates for Scheduled Maintenance Events',
                    description:
                        'Here is a list of all the public and private note templates for scheduled maintenance.',
                }}
                noItemsMessage={'No note templates found.'}
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
                        title: 'Note Details',
                        id: 'note-details',
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
                        fieldType: FormFieldSchemaType.LongText,
                        stepId: 'template-info',
                        required: true,
                        placeholder: 'Template Description',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            note: true,
                        },
                        title: 'Public or Private note template.',
                        fieldType: FormFieldSchemaType.Markdown,
                        stepId: 'note-details',
                        required: true,
                        validation: {
                            minLength: 2,
                        },
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
                    },
                ]}
            />
        </Page>
    );
};

export default ScheduledMaintenanceNoteTemplates;
