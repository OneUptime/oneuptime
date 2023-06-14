import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import MonitorProbe from 'Model/Models/MonitorProbe';
import DashboardNavigation from '../../../Utils/Navigation';
import Probe from 'Model/Models/Probe';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import ProbeElement from '../../../Components/Probe/Probe';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import URL from 'Common/Types/API/URL';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';

const MonitorProbes: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [error, setError] = useState<string>('');

    const [probes, setProbes] = useState<Array<Probe>>([]);

    const fetchItem: Function = async (): Promise<void> => {
        // get item.
        setIsLoading(true);

        setError('');
        try {
            const item: Monitor | null = await ModelAPI.getItem(
                Monitor,
                modelId,
                {
                    monitorType: true,
                } as any,
                {}
            );

            if (!item) {
                setError(`Monitor not found`);

                return;
            }

            const projectProbeList: ListResult<Probe> = await ModelAPI.getList(
                Probe,
                {
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                },
                LIMIT_PER_PROJECT,
                0,
                {
                    name: true,
                    _id: true,
                },
                {},
                {}
            );

            const globalProbeList: ListResult<Probe> = await ModelAPI.getList(
                Probe,
                {},
                LIMIT_PER_PROJECT,
                0,
                {
                    name: true,
                    _id: true,
                },
                {},
                {
                    overrideRequestUrl: URL.fromString(
                        DASHBOARD_API_URL.toString()
                    ).addRoute('/probe/global-probes'),
                }
            );

            setProbes([...projectProbeList.data, ...globalProbeList.data]);
            setMonitorType(item.monitorType);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }
        setIsLoading(false);
    };

    const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
        undefined
    );

    useEffect(() => {
        // fetch the model
        fetchItem();
    }, []);

    const getPageContent: Function = (): ReactElement => {
        if (!monitorType || isLoading) {
            return <ComponentLoader />;
        }

        if (error) {
            return <ErrorMessage error={error} />;
        }

        if (monitorType === MonitorType.Manual) {
            return (
                <EmptyState
                    icon={IconProp.Signal}
                    title={'No Monitoring Probes for Manual Monitors'}
                    description={
                        <>
                            This is a manual monitor. It does not monitor
                            anything and so, it cannot have monitorting probes
                            set. You can have monitoring probes on other monitor
                            types.{' '}
                        </>
                    }
                />
            );
        }

        return (
            <ModelTable<MonitorProbe>
                modelType={MonitorProbe}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    monitorId: modelId.toString(),
                }}
                onBeforeCreate={(item: MonitorProbe): MonitorProbe => {
                    item.monitorId = modelId;
                    item.projectId = DashboardNavigation.getProjectId()!;

                    return item;
                }}
                id="probes-table"
                name="Monitor > Monitor Probes"
                isDeleteable={false}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Signal,
                    title: 'Probes',
                    description:
                        'List of probes that help you monitor this resource.',
                }}
                noItemsMessage={
                    'No probes found for this resource. However, you can add some probes to monitor this resource.'
                }
                viewPageRoute={Navigation.getCurrentRoute()}
                formFields={[
                    {
                        field: {
                            probe: true,
                        },
                        title: 'Probe',
                        stepId: 'incident-details',
                        description: 'Which probe do you want to use?',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownOptions: probes.map((probe: Probe) => {
                            return {
                                label: probe.name,
                                value: probe._id,
                            };
                        }),
                        required: true,
                        placeholder: 'Probe',
                    },

                    {
                        field: {
                            isEnabled: true,
                        },
                        title: 'Enabled',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={false}
                columns={[
                    {
                        field: {
                            probe: {
                                name: true,
                                iconFileId: true,
                            },
                        },
                        isFilterable: false,
                        title: 'Probe',
                        type: FieldType.Entity,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <ProbeElement
                                    probe={item['probe'] as JSONObject}
                                />
                            );
                        },
                    },
                    {
                        field: {
                            lastPingAt: true,
                        },
                        title: 'Last Monitored At',
                        type: FieldType.DateTime,
                        isFilterable: false,
                        noValueMessage: 'Will be picked up by this probe soon.',
                    },
                    {
                        field: {
                            isEnabled: true,
                        },
                        title: 'Enabled',
                        type: FieldType.Boolean,
                        isFilterable: false,
                    },
                ]}
            />
        );
    };

    return (
        <ModelPage
            title="Monitor"
            modelType={Monitor}
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
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Probes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {getPageContent()}
        </ModelPage>
    );
};

export default MonitorProbes;
