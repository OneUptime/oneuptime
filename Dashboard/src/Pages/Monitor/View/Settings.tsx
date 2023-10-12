import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import useAsyncEffect from 'use-async-effect';
import DuplicateModel from 'CommonUI/src/Components/DuplicateModel/DuplicateModel';

const MonitorCriteria: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [alertRefreshToggle, setAlertRefreshToggle] =
        useState<boolean>(false);

    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [error, setError] = useState<string>('');

    const fetchItem: () => Promise<void> = async (): Promise<void> => {
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

            setMonitorType(item.monitorType);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }
        setIsLoading(false);
    };

    const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
        undefined
    );

    useAsyncEffect(async () => {
        // fetch the model
        await fetchItem();
    }, []);

    const getPageContent: Function = (): ReactElement => {
        if (!monitorType || isLoading) {
            return <ComponentLoader />;
        }

        if (error) {
            return <ErrorMessage error={error} />;
        }

        return (
            <div>
                {monitorType !== MonitorType.Manual && (
                    <CardModelDetail
                        name="Monitor Settings"
                        editButtonText="Edit Settings"
                        cardProps={{
                            title: 'Monitor Settings',
                            description:
                                'Here are some advanced settings for this monitor.',
                        }}
                        onSaveSuccess={() => {
                            setAlertRefreshToggle(!alertRefreshToggle);
                        }}
                        isEditable={true}
                        formFields={[
                            {
                                field: {
                                    disableActiveMonitoring: true,
                                },

                                title: 'Disable Active Monitoring',
                                fieldType: FormFieldSchemaType.Toggle,
                                required: false,
                            },
                        ]}
                        modelDetailProps={{
                            showDetailsInNumberOfColumns: 1,
                            modelType: Monitor,
                            id: 'model-detail-monitors',
                            fields: [
                                {
                                    field: {
                                        disableActiveMonitoring: true,
                                    },
                                    title: 'Disable Active Monitoring',
                                    fieldType: FieldType.Boolean,
                                },
                            ],
                            modelId: modelId,
                        }}
                    />
                )}
                <div className="mt-5">
                    <DuplicateModel
                        modelId={modelId}
                        modelType={Monitor}
                        fieldsToDuplicate={{
                            description: true,
                            monitorType: true,
                            monitorSteps: true,
                            monitoringInterval: true,
                            labels: true,
                            customFields: true,
                        }}
                        navigateToOnSuccess={RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITORS] as Route
                        )}
                        fieldsToChange={[
                            {
                                field: {
                                    name: true,
                                },
                                title: 'New Monitor Name',
                                fieldType: FormFieldSchemaType.Text,
                                required: true,
                                placeholder: 'New Monitor Name',
                                validation: {
                                    minLength: 2,
                                },
                            },
                        ]}
                    />
                </div>
            </div>
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
                    title: 'Criteria',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <DisabledWarning
                monitorId={modelId}
                refreshToggle={alertRefreshToggle}
            />
            {getPageContent()}
        </ModelPage>
    );
};

export default MonitorCriteria;
