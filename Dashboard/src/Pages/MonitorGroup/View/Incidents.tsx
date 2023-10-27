import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import IncidentsTable from '../../../Components/Incident/IncidentsTable';
import DashboardNavigation from '../../../Utils/Navigation';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import MonitorGroupResource from 'Model/Models/MonitorGroupResource';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import API from 'CommonUI/src/Utils/API/API';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import MonitorGroup from 'Model/Models/MonitorGroup';

const MonitorIncidents: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    const [monitorIds, setMonitorIds] = React.useState<ObjectID[]>([]);

    const [error, setError] = React.useState<string | undefined>(undefined);

    const loadMonitorsIds: Function = async (): Promise<void> => {
        setIsLoading(true);

        try {
            const monitorGroupResources: ListResult<MonitorGroupResource> =
                await ModelAPI.getList(
                    MonitorGroupResource,
                    {
                        monitorGroupId: modelId.toString(),
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        monitorId: true,
                    },
                    {}
                );

            const monitorIds: Array<ObjectID> = monitorGroupResources.data.map(
                (monitorGroupResource: MonitorGroupResource): ObjectID => {
                    return monitorGroupResource.monitorId!;
                }
            );

            setMonitorIds(monitorIds);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    useEffect(() => {
        loadMonitorsIds().catch(() => {});
    }, []);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <ModelPage
            title="Monitor Group"
            modelType={MonitorGroup}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Monitor Groups',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUPS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Monitor Group',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUP_VIEW_INCIDENTS] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <IncidentsTable
                viewPageRoute={Navigation.getCurrentRoute()}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    monitors: monitorIds,
                }}
            />
        </ModelPage>
    );
};

export default MonitorIncidents;
