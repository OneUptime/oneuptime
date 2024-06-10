import DashboardNavigation from '../../../../../Utils/Navigation';
import PageComponentProps from '../../../../PageComponentProps';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import ObjectID from 'Common/Types/ObjectID';
import AnalyticsModelTable from 'CommonUI/src/Components/ModelTable/AnalyticsModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Metric from 'Model/AnalyticsModels/Metric';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <AnalyticsModelTable<Metric>
                modelType={Metric}
                id="metrics-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                singularName="Metric"
                pluralName="Metrics"
                name="Metrics"
                isViewable={true}
                sortBy="name"
                sortOrder={SortOrder.Ascending}
                cardProps={{
                    title: 'Metrics',
                    description:
                        'Metrics are the individual data points that make up a service. They are the building blocks of a service and represent the work done by a single service.',
                }}
                groupBy={{
                    name: true,
                }}
                onViewPage={async (item: Metric) => {
                    let metricName: string = item.name?.toString() || '';
                    metricName = URL.encode(metricName);
                    return Promise.resolve(
                        new Route(
                            Navigation.getCurrentPath().toString() +
                                '/' +
                                metricName
                        )
                    );
                }}
                query={{
                    projectId: DashboardNavigation.getProjectId(),
                    serviceId: modelId,
                }}
                showViewIdButton={false}
                noItemsMessage={'No metrics found for this service.'}
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
                            attributes: true,
                        },
                        type: FieldType.JSON,
                        title: 'Attributes',
                    },
                ]}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                    },
                ]}
            />
        </Fragment>
    );
};

export default ServiceDelete;
