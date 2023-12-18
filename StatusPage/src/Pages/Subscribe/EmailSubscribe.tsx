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

    const fetchCheckboxOptionsAndCategories: Function =
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
                subscriberEmail: true,
            },
            title: 'Your Email',
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: 'subscriber@company.com',
        },
    ];

    if (props.allowSubscribersToChooseResources) {
        fields.push({
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
                            ? (RouteMap[
                                  PageMap.PREVIEW_SUBSCRIBE_EMAIL
                              ] as Route)
                            : (RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route)
                    ),
                },
            ]}
            sideMenu={
                <SubscribeSideMenu
                    isPreviewStatusPage={Boolean(
                        StatusPageUtil.isPreviewPage()
                    )}
                    enableEmailSubscribers={props.enableEmailSubscribers}
                    enableSMSSubscribers={props.enableSMSSubscribers}
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
                            <div className="-mr-4">
                                <Card
                                    title="Subscribe by Email"
                                    description={
                                        'All of our updates will be sent to this email address.'
                                    }
                                >
                                    <ModelForm<StatusPageSubscriber>
                                        modelType={StatusPageSubscriber}
                                        id="email-form"
                                        name="Status Page > Email Subscribe"
                                        fields={fields}
                                        apiUrl={URL.fromString(
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
