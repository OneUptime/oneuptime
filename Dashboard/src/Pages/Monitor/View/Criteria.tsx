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
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import MonitorStepsViewer from '../../../Components/Monitor/MonitorSteps/MonitorSteps';
import {
    CustomElementProps,
    FormFieldStyleType,
} from 'CommonUI/src/Components/Forms/Types/Field';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import MonitorStepsType from 'Common/Types/Monitor/MonitorSteps';
import MonitorStepsForm from '../../../Components/Form/Monitor/MonitorSteps';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';

const MonitorCriteria: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [error, setError] = useState<string>('');

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
                    icon={IconProp.Criteria}
                    title={'No Criteria for Manual Monitors'}
                    description={
                        <>
                            This is a manual monitor and it cannot have any
                            criteria set. You can have monitoring criteria on
                            other monitor types.{' '}
                        </>
                    }
                />
            );
        }

        return (
            <CardModelDetail
                name="Monitoring Criteria"
                editButtonText="Edit Monitoring Criteria"
                cardProps={{
                    title: 'Monitoring Criteria',
                    description:
                        'Here is the criteria we use to monitor this resource.',
                    icon: IconProp.Criteria,
                }}
                createEditModalWidth={ModalWidth.Large}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            monitorSteps: true,
                        },
                        stepId: 'criteria',
                        styleType: FormFieldStyleType.Heading,
                        title: 'Monitor Details',
                        fieldType: FormFieldSchemaType.CustomComponent,
                        required: true,
                        customValidation: (values: FormValues<Monitor>) => {
                            return MonitorStepsType.getValidationError(
                                values.monitorSteps as MonitorStepsType,
                                values.monitorType as MonitorType
                            );
                        },
                        getCustomElement: (
                            _value: FormValues<Monitor>,
                            props: CustomElementProps
                        ) => {
                            return (
                                <MonitorStepsForm
                                    {...props}
                                    monitorType={
                                        monitorType || MonitorType.Manual
                                    }
                                    error={''}
                                />
                            );
                        },
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: Monitor,
                    id: 'model-detail-monitors',
                    fields: [
                        {
                            field: {
                                monitorSteps: true,
                            },
                            title: '',
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <MonitorStepsViewer
                                        monitorSteps={
                                            item[
                                                'monitorSteps'
                                            ] as MonitorStepsType
                                        }
                                        monitorType={monitorType}
                                    />
                                );
                            },
                        },
                    ],
                    modelId: modelId,
                }}
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
                        {modelId}
                    ),
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW] as Route,
                        {modelId}
                    ),
                },
                {
                    title: 'Criteria',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
                        {modelId}
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {getPageContent()}
        </ModelPage>
    );
};

export default MonitorCriteria;
