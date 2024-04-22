import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import TelemetryService from 'Model/Models/TelemetryService';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../Components/Label/Labels';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import SideMenu from './SideMenu';
import BaseModel from 'Common/Models/BaseModel';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import TelemetryServiceElement from '../../Components/TelemetryService/TelemetryServiceElement';

const Services: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const disableTelemetryForThisProject: boolean =
        props.currentProject?.reseller?.enableTelemetryFeatures === false;

    if (disableTelemetryForThisProject) {
        return (
            <ErrorMessage error="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
        );
    }

    return (
        <Page
            title={'Telemetry'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Telemetry',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TELEMETRY] as Route
                    ),
                },
                {
                    title: 'Services',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TELEMETRY_SERVICES] as Route
                    ),
                },
            ]}
            sideMenu={<SideMenu />}
        >
            <ModelTable<TelemetryService>
                modelType={TelemetryService}
                id="services-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                name="Services"
                isViewable={true}
                cardProps={{
                    title: 'Services',
                    description: 'Here is a list of services for this project.',
                }}
                showViewIdButton={true}
                noItemsMessage={'No services found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Service  Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Service Description',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            labels: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Labels',
                        type: FieldType.EntityArray,

                        filterEntityType: Label,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                    },
                ]}
                selectMoreFields={{
                    serviceColor: true,
                }}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Element,
                        getElement: (service: TelemetryService): ReactElement => {
                           

                            return (
                                <Fragment>
                                    <TelemetryServiceElement
                                        telemetryService={service}
                                    />
                                </Fragment>
                            );
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            labels: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Labels',
                        type: FieldType.EntityArray,

                        getElement: (item: TelemetryService): ReactElement => {
                            return (
                                <LabelsElement
                                    labels={
                                        item['labels'] || []
                                    }
                                />
                            );
                        },
                    },
                ]}
            />
        </Page>
    );
};

export default Services;
