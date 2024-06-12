import DashboardNavigation from '../../Utils/Navigation';
import MetricViewDetail from './MetricVIewDetail';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Card from 'CommonUI/src/Components/Card/Card';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import API from 'CommonUI/src/Utils/API/API';
import ModelAPI from 'CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import ListResult from 'CommonUI/src/Utils/BaseDatabase/ListResult';
import Metric from 'Model/AnalyticsModels/Metric';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';

export interface ComponentProps {
    metricName: string;
    serviceId: ObjectID;
}

const MetricView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showFilterModal, setShowFilterModal] =
        React.useState<boolean>(false);
    const [metricName, setMetricName] = React.useState<string>('');
    const [metricDescription, setMetricDescription] =
        React.useState<string>('');
    const [isLoading, setIsLoading] = React.useState<boolean>(true);
    const [error, setError] = React.useState<string>('');

    const fetchFirstMetric: PromiseVoidFunction = async (): Promise<void> => {
        try {
            setIsLoading(true);

            const metrics: ListResult<Metric> = await ModelAPI.getList<Metric>({
                modelType: Metric,
                query: {
                    name: props.metricName,
                    projectId: DashboardNavigation.getProjectId(),
                },
                skip: 0,
                limit: 1,
                sort: {
                    createdAt: SortOrder.Descending,
                },
                select: {
                    description: true,
                    name: true,
                },
            });

            if (metrics.data.length === 0) {
                setError(`Metric ${props.metricName} not found`);
                setIsLoading(false);
                return;
            }

            setMetricName(metrics.data[0]?.name || '');
            setMetricDescription(metrics.data[0]?.description || '');
            setIsLoading(false);
            setError('');
        } catch (error) {
            setError(API.getFriendlyMessage(error));
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchFirstMetric().catch((error: Error) => {
            setError(API.getFriendlyMessage(error));
            setIsLoading(false);
        });
    }, []);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <Card
            buttons={[
                {
                    title: 'Filter',
                    onClick: () => {
                        return setShowFilterModal(true);
                    },
                    icon: IconProp.Filter,
                    buttonStyle: ButtonStyleType.ICON,
                },
            ]}
            title={metricName}
            description={metricDescription}
        >
            <MetricViewDetail
                metricName={props.metricName}
                serviceId={props.serviceId}
                showFilterModal={showFilterModal}
                onFilterModalClose={() => {
                    setShowFilterModal(false);
                }}
                onFilterModalOpen={() => {
                    setShowFilterModal(true);
                }}
            />
        </Card>
    );
};

export default MetricView;
