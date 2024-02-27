import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Page from '../../Components/Page/Page';
import ModelForm, {
    FormType,
    ModelField,
} from 'CommonUI/src/Components/Forms/ModelForm';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Route from 'Common/Types/API/Route';
import SubscribeSideMenu from './SideMenu';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Card from 'CommonUI/src/Components/Card/Card';
import URL from 'Common/Types/API/URL';
import API from '../../Utils/API';
import StatusPageUtil from '../../Utils/StatusPage';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import { SubscribePageProps } from './SubscribePageUtils';
import { CategoryCheckboxOptionsAndCategories } from 'CommonUI/src/Components/CategoryCheckbox/Index';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import SubscriberUtil from 'CommonUI/src/Utils/StatusPage';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

const SubscribePage: FunctionComponent<SubscribePageProps> = (
    props: SubscribePageProps
): ReactElement => {
    const [isSuccess, setIsSuccess] = useState<boolean>(false);

    const id: ObjectID = LocalStorage.getItem('statusPageId') as ObjectID;

    const [
        categoryCheckboxOptionsAndCategories,
        setCategoryCheckboxOptionsAndCategories,
    ] = useState<CategoryCheckboxOptionsAndCategories>({
        categories: [],
        options: [],
    });
    const [isLaoding, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | undefined>(undefined);

    const fetchCheckboxOptionsAndCategories: PromiseVoidFunction =
        async (): Promise<void> => {
            try {
                setIsLoading(true);

                const result: CategoryCheckboxOptionsAndCategories =
                    await SubscriberUtil.getCategoryCheckboxPropsBasedOnResources(
                        id,
                        URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
                            `/resources/${id.toString()}`
                        )
                    );

                setCategoryCheckboxOptionsAndCategories(result);
            } catch (err) {
                setError(API.getFriendlyMessage(err));
            }

            setIsLoading(false);
        };

    useEffect(() => {
        fetchCheckboxOptionsAndCategories().catch((error: Error) => {
            setError(error.message);
        });
    }, []);

    if (!id) {
        throw new BadDataException('Status Page ID is required');
    }

    StatusPageUtil.checkIfUserHasLoggedIn();

    const fields: Array<ModelField<StatusPageSubscriber>> = [
        {
            field: {
                subscriberPhone: true,
            },
            title: 'Your Phone Number',
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            placeholder: '+11234567890',
        },
    ];

    if (props.allowSubscribersToChooseResources) {
        fields.push({
            field: {
                isSubscribedToAllResources: true,
            },
            title: 'Subscribe to All Resources',
            description:
                'Select this option if you want to subscribe to all resources.',
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            defaultValue: true,
        });

        fields.push({
            field: {
                statusPageResources: true,
            },
            title: 'Select Resources to Subscribe',
            description:
                'Please select the resources you want to subscribe to.',
            fieldType: FormFieldSchemaType.CategoryCheckbox,
            required: false,
            categoryCheckboxProps: categoryCheckboxOptionsAndCategories,
            showIf: (model: FormValues<StatusPageSubscriber>) => {
                return !model || !model.isSubscribedToAllResources;
            },
        });
    }

    return (
        <Page
            title={'Subscribe'}
            breadcrumbLinks={[
                {
                    title: 'Overview',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                            : (RouteMap[PageMap.OVERVIEW] as Route)
                    ),
                },
                {
                    title: 'Subscribe',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_SMS] as Route)
                            : (RouteMap[PageMap.SUBSCRIBE_SMS] as Route)
                    ),
                },
            ]}
            sideMenu={
                <SubscribeSideMenu
                    isPreviewStatusPage={Boolean(
                        StatusPageUtil.isPreviewPage()
                    )}
                    enableSMSSubscribers={props.enableSMSSubscribers}
                    enableEmailSubscribers={props.enableEmailSubscribers}
                />
            }
        >
            {isLaoding ? <PageLoader isVisible={isLaoding} /> : <></>}

            {error ? <ErrorMessage error={error} /> : <></>}

            {!isLaoding && !error ? (
                <div className="justify-center">
                    <div>
                        {isSuccess && (
                            <p className="text-center text-gray-400 mb-20 mt-20">
                                {' '}
                                You have been subscribed successfully.
                            </p>
                        )}

                        {!isSuccess ? (
                            <div className="">
                                <Card
                                    title="Subscribe by SMS"
                                    description={
                                        'All of our updates will be sent to this phone number.'
                                    }
                                >
                                    <ModelForm<StatusPageSubscriber>
                                        modelType={StatusPageSubscriber}
                                        id="SMS-form"
                                        name="Status Page > SMS Subscribe"
                                        fields={fields}
                                        createOrUpdateApiUrl={URL.fromString(
                                            STATUS_PAGE_API_URL.toString()
                                        ).addRoute(
                                            `/subscribe/${id.toString()}`
                                        )}
                                        requestHeaders={API.getDefaultHeaders(
                                            StatusPageUtil.getStatusPageId()!
                                        )}
                                        formType={FormType.Create}
                                        submitButtonText={'Subscribe'}
                                        onBeforeCreate={async (
                                            item: StatusPageSubscriber
                                        ) => {
                                            const id: ObjectID =
                                                LocalStorage.getItem(
                                                    'statusPageId'
                                                ) as ObjectID;
                                            if (!id) {
                                                throw new BadDataException(
                                                    'Status Page ID is required'
                                                );
                                            }

                                            item.statusPageId = id;
                                            return item;
                                        }}
                                        onSuccess={(
                                            _value: StatusPagePrivateUser
                                        ) => {
                                            setIsSuccess(true);
                                        }}
                                        maxPrimaryButtonWidth={true}
                                    />
                                </Card>
                            </div>
                        ) : (
                            <></>
                        )}
                    </div>
                </div>
            ) : (
                <></>
            )}
        </Page>
    );
};

export default SubscribePage;
