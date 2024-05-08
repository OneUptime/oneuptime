import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import AnalyticsModelTable from 'CommonUI/src/Components/ModelTable/AnalyticsModelTable';
import Metric from 'Model/AnalyticsModels/Metric';
import DashboardNavigation from '../../../../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Route from 'Common/Types/API/Route';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';

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
                onViewPage={async (_item: Metric) => {
                    return Promise.resolve(new Route(''));
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
