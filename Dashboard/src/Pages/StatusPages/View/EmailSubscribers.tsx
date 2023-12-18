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
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import NotNull from 'Common/Types/Database/NotNull';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Red } from 'Common/Types/BrandColors';
import Navigation from 'CommonUI/src/Utils/Navigation';
import StatusPage from 'Model/Models/StatusPage';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import { ModelField } from 'CommonUI/src/Components/Forms/ModelForm';
import { CategoryCheckboxOptionsAndCategories } from 'CommonUI/src/Components/CategoryCheckbox/Index';
import SubscriberUtil from 'CommonUI/src/Utils/StatusPage';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
    const [
        allowSubscribersToChooseResources,
        setAllowSubscribersToChooseResources,
    ] = React.useState<boolean>(false);
    const [isEmailSubscribersEnabled, setIsEmailSubscribersEnabled] =
        React.useState<boolean>(false);
    const [isLoading, setIsLoading] = React.useState<boolean>(false);
    const [error, setError] = React.useState<string>('');
    const [
        categoryCheckboxOptionsAndCategories,
        setCategoryCheckboxOptionsAndCategories,
    ] = useState<CategoryCheckboxOptionsAndCategories>({
        categories: [],
        options: [],
    });

    const fetchCheckboxOptionsAndCategories: Function =
        async (): Promise<void> => {
            const result: CategoryCheckboxOptionsAndCategories =
                await SubscriberUtil.getCategoryCheckboxPropsBasedOnResources(
                    modelId
                );

            setCategoryCheckboxOptionsAndCategories(result);
        };

    const fetchStatusPage: Function = async (): Promise<void> => {
        try {
            setIsLoading(true);

            const statusPage: StatusPage | null = await ModelAPI.getItem(
                StatusPage,
                modelId,
                {
                    allowSubscribersToChooseResources: true,
                    enableEmailSubscribers: true,
                }
            );

            if (statusPage && statusPage.allowSubscribersToChooseResources) {
                setAllowSubscribersToChooseResources(
                    statusPage.allowSubscribersToChooseResources
                );
                await fetchCheckboxOptionsAndCategories();
            }

            if (statusPage && statusPage.enableEmailSubscribers) {
                setIsEmailSubscribersEnabled(statusPage.enableEmailSubscribers);
            }

            setIsLoading(false);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    useEffect(() => {
        fetchStatusPage().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
        });
    }, []);

    const [formFields, setFormFields] = React.useState<
        Array<ModelField<StatusPageSubscriber>>
    >([]);

    useEffect(() => {
        const formFields: Array<ModelField<StatusPageSubscriber>> = [
            {
                field: {
                    subscriberEmail: true,
                },
                title: 'Email',
                description: 'Status page updates will be sent to this email.',
                fieldType: FormFieldSchemaType.Email,
                required: true,
                placeholder: 'subscriber@company.com',
            },
        ];

        if (allowSubscribersToChooseResources) {
            formFields.push({
                field: {
                    statusPageResources: true,
                },
                title: 'Select Resources to Subscribe',
                description:
                    'Please select the resources you want to subscribe to.',
                fieldType: FormFieldSchemaType.CategoryCheckbox,
                required: true,
                categoryCheckboxProps: categoryCheckboxOptionsAndCategories,
            });
        }

        setFormFields(formFields);
    }, [isLoading, categoryCheckboxOptionsAndCategories]);

    return (
        <ModelPage
            title="Status Page"
            modelType={StatusPage}
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
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Email Subscribers',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {isLoading ? <PageLoader isVisible={true} /> : <></>}

            {error ? <ErrorMessage error={error} /> : <></>}

            {!error && !isLoading ? (
                <>
                    {!isEmailSubscribersEnabled && (
                        <Alert
                            type={AlertType.DANGER}
                            title="Email subscribers are not enabled for this status page. Please enable it in Subscriber Settings"
                        />
                    )}
                    <ModelTable<StatusPageSubscriber>
                        modelType={StatusPageSubscriber}
                        id="table-subscriber"
                        name="Status Page > Email Subscribers"
                        isDeleteable={true}
                        showViewIdButton={true}
                        isCreateable={true}
                        isEditable={false}
                        isViewable={false}
                        selectMoreFields={{
                            subscriberPhone: true,
                        }}
                        query={{
                            statusPageId: modelId,
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                            subscriberEmail: new NotNull(),
                        }}
                        onBeforeCreate={(
                            item: StatusPageSubscriber
                        ): Promise<StatusPageSubscriber> => {
                            if (
                                !props.currentProject ||
                                !props.currentProject._id
                            ) {
                                throw new BadDataException(
                                    'Project ID cannot be null'
                                );
                            }

                            item.statusPageId = modelId;
                            item.projectId = new ObjectID(
                                props.currentProject._id
                            );
                            return Promise.resolve(item);
                        }}
                        cardProps={{
                            title: 'Email Subscribers',
                            description:
                                'Here are the list of subscribers who have subscribed to the status page.',
                        }}
                        noItemsMessage={'No subscribers found.'}
                        formFields={formFields}
                        showRefreshButton={true}
                        viewPageRoute={Navigation.getCurrentRoute()}
                        columns={[
                            {
                                field: {
                                    subscriberEmail: true,
                                },
                                title: 'Email',
                                type: FieldType.Email,
                            },
                            {
                                field: {
                                    isUnsubscribed: true,
                                },
                                title: 'Status',
                                type: FieldType.Text,
                                getElement: (
                                    item: JSONObject
                                ): ReactElement => {
                                    if (item['isUnsubscribed']) {
                                        return (
                                            <Pill
                                                color={Red}
                                                text={'Unsubscribed'}
                                            />
                                        );
                                    }
                                    return (
                                        <Pill
                                            color={Green}
                                            text={'Subscribed'}
                                        />
                                    );
                                },
                            },
                            {
                                field: {
                                    createdAt: true,
                                },
                                title: 'Subscribed At',
                                type: FieldType.DateTime,
                            },
                        ]}
                    />
                </>
            ) : (
                <></>
            )}
        </ModelPage>
    );
};

export default StatusPageDelete;
