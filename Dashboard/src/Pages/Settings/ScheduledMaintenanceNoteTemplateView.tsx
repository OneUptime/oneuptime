import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import ScheduledMaintenanceNoteTemplate from 'Model/Models/ScheduledMaintenanceNoteTemplate';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

const TeamView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

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
                {
                    title: 'View Template',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap
                                .SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES_VIEW
                        ] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* ScheduledMaintenance View  */}
            <CardModelDetail
                name="Basic Details"
                cardProps={{
                    title: 'Basic Details',
                    description:
                        'Here are more details for this scheduled maintenance template.',
                }}
                isEditable={true}
                editButtonText="Edit Details"
                formFields={[
                    {
                        field: {
                            templateName: true,
                        },
                        title: 'Template Name',
                        fieldType: FormFieldSchemaType.Text,
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
                        required: true,
                        placeholder: 'Template Description',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 2,
                    modelType: ScheduledMaintenanceNoteTemplate,
                    id: 'model-detail-scheduled-maintenances',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Scheduled Maintenance Note Template ID',
                            fieldType: FieldType.ObjectID,
                        },
                        {
                            field: {
                                templateName: true,
                            },
                            title: 'Template Name',
                            fieldType: FieldType.Text,
                        },
                        {
                            field: {
                                templateDescription: true,
                            },
                            title: 'Template Description',
                            fieldType: FieldType.Text,
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail
                name="Note Template"
                editButtonText="Edit Note Template"
                cardProps={{
                    title: 'Note Template',
                    description: 'Here is the note template.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Note',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 2,
                    modelType: ScheduledMaintenanceNoteTemplate,
                    id: 'model-detail-scheduled-maintenances',
                    fields: [
                        {
                            field: {
                                note: true,
                            },
                            title: 'Note Template',
                            fieldType: FieldType.Markdown,
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <ModelDelete
                modelType={ScheduledMaintenanceNoteTemplate}
                modelId={Navigation.getLastParamAsObjectID()}
                onDeleteSuccess={() => {
                    Navigation.navigate(
                        RouteMap[
                            PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES
                        ] as Route
                    );
                }}
            />
        </Page>
    );
};

export default TeamView;
