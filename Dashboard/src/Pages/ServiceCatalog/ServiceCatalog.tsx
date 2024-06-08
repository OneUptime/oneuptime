import LabelsElement from '../../Components/Label/Labels';
import DashboardNavigation from '../../Utils/Navigation';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Page from 'CommonUI/src/Components/Page/Page';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Label from 'Model/Models/Label';
import ServiceCatalog from 'Model/Models/ServiceCatalog';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import ServiceCatalogElement from '../../Components/ServiceCatalog/ServiceElement';

const ServiceCatalogPage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Service Catalog'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Service Catalog',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route
                    ),
                },
            ]}
        >
            <ModelTable<ServiceCatalog>
                modelType={ServiceCatalog}
                id="service-catalog-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                name="Service Catalog"
                isViewable={true}
                cardProps={{
                    title: 'Service Catalog',
                    description:
                        'List and manage services for this project here.',
                }}
                showViewIdButton={true}
                noItemsMessage={'No services found.'}
                selectMoreFields={{
                    serviceColor: true,
                }}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Service Name',
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
                        placeholder: 'Description',
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
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Element,
                        getElement: (
                            service: ServiceCatalog
                        ): ReactElement => {
                            return (
                                <Fragment>
                                    <ServiceCatalogElement
                                        serviceCatalog={service}
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

                        getElement: (item: ServiceCatalog): ReactElement => {
                            return (
                                <LabelsElement labels={item['labels'] || []} />
                            );
                        },
                    },
                ]}
            />
        </Page>
    );
};

export default ServiceCatalogPage;
