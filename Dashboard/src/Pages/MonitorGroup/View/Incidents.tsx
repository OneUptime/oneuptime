import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useEffect,
} from 'react';
import PageComponentProps from '../../PageComponentProps';
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

const MonitorIncidents: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    const [monitorIds, setMonitorIds] = React.useState<ObjectID[]>([]);

    const [error, setError] = React.useState<string | undefined>(undefined);

    const loadMonitorsIds: PromiseVoidFunctionType =
        async (): Promise<void> => {
            setIsLoading(true);

            try {
                const monitorGroupResources: ListResult<MonitorGroupResource> =
                    await ModelAPI.getList({
                        modelType: MonitorGroupResource,
                        query: {
                            monitorGroupId: modelId.toString(),
                        },
                        limit: LIMIT_PER_PROJECT,
                        skip: 0,
                        select: {
                            monitorId: true,
                        },
                        sort: {},
                    });

                const monitorIds: Array<ObjectID> =
                    monitorGroupResources.data.map(
                        (
                            monitorGroupResource: MonitorGroupResource
                        ): ObjectID => {
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
        <Fragment>
            <IncidentsTable
                viewPageRoute={Navigation.getCurrentRoute()}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    monitors: monitorIds,
                }}
            />
        </Fragment>
    );
};

export default MonitorIncidents;
