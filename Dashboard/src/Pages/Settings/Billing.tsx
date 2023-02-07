import Route from 'Common/Types/API/Route';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Card from 'CommonUI/src/Components/Card/Card';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Page from 'CommonUI/src/Components/Page/Page';
import { RadioButton } from 'CommonUI/src/Components/RadioButtons/RadioButtons';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Project from 'Model/Models/Project';
import React, {
    FunctionComponent,
    ReactElement,
    useRef,
    useState,
} from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import BillingPaymentMethod from 'Model/Models/BillingPaymentMethod';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Modal from 'CommonUI/src/Components/Modal/Modal';
import ButtonType from 'CommonUI/src/Components/Button/ButtonTypes';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import BaseAPI from 'CommonUI/src/Utils/API/API';
import URL from 'Common/Types/API/URL';
import {
    BILLING_ENABLED,
    BILLING_PUBLIC_KEY,
    DASHBOARD_API_URL,
    getAllEnvVars,
} from 'CommonUI/src/Config';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import useAsyncEffect from 'use-async-effect';
import CheckoutForm from './BillingPaymentMethodForm';
import Text from 'Common/Types/Text';
import DashboardNavigation from '../../Utils/Navigation';
import Toggle from 'CommonUI/src/Components/Toggle/Toggle';

export interface ComponentProps extends PageComponentProps { }

const Settings: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    const [isSubsriptionPlanYearly, setIsSubscriptionPlanYearly] =
        useState<boolean>(true);
    const [showPaymentMethodModal, setShowPaymentMethodModal] =
        useState<boolean>(false);
    const [isModalLoading, setIsModalLoading] = useState<boolean>(false);
    const [isModalSubmitButtonLoading, setIsModalSubmitButtonLoading] =
        useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [setupIntent, setSetupIntent] = useState<string>('');
    const [stripe, setStripe] = useState<Stripe | null>(null);
    const formRef: any = useRef<any>(null);

    useAsyncEffect(async () => {
        setIsModalLoading(true);
        setStripe(await loadStripe(BILLING_PUBLIC_KEY));
        setIsModalLoading(false);
    }, []);

    const fetchSetupIntent: Function = async (): Promise<void> => {
        try {
            setIsModalLoading(true);

            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/billing-payment-methods/setup`
                    ),
                    {},
                    ModelAPI.getCommonHeaders()
                );
            const data: JSONObject = response.data;

            setSetupIntent(data['setupIntent'] as string);
            setIsModalLoading(false);
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                    'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
            setIsModalLoading(false);
        }
    };

    const getFooter: Function = (): ReactElement => {
        if (!BILLING_ENABLED) {
            return <></>;
        }

        return (
            <Toggle
                title="Yearly Plan"
                initialValue={isSubsriptionPlanYearly}
                description="(Save 20%)"
                onChange={(value: boolean) => {
                    setIsSubscriptionPlanYearly(value);
                }}
            />
        );
    };

    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: 'Billing',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_BILLING] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <CardModelDetail
                name="Plan Details"
                cardProps={{
                    title: 'Current Plan',
                    description: "Here's more details on this Project.",
                    icon: IconProp.Billing,
                }}
                isEditable={true}
                editButtonText={'Change Plan'}
                formFields={[
                    {
                        field: {
                            paymentProviderPlanId: true,
                        },
                        validation: {
                            minLength: 6,
                        },
                        fieldType: FormFieldSchemaType.RadioButton,
                        radioButtonOptions:
                            SubscriptionPlan.getSubscriptionPlans(
                                getAllEnvVars()
                            ).map((plan: SubscriptionPlan): RadioButton => {
                                let description: string = plan.isCustomPricing()
                                    ? `Our sales team will contact you soon.`
                                    : `Billed ${isSubsriptionPlanYearly
                                        ? 'yearly'
                                        : 'monthly'
                                    }. ${plan.getTrialPeriod() > 0
                                        ? `Free ${plan.getTrialPeriod()} days trial.`
                                        : ''
                                    }`;

                                if (
                                    isSubsriptionPlanYearly &&
                                    plan.getYearlySubscriptionAmountInUSD() ===
                                    0
                                ) {
                                    description =
                                        'This plan is free, forever. ';
                                }

                                if (
                                    !isSubsriptionPlanYearly &&
                                    plan.getMonthlySubscriptionAmountInUSD() ===
                                    0
                                ) {
                                    description =
                                        'This plan is free, forever. ';
                                }

                                return {
                                    value: isSubsriptionPlanYearly
                                        ? plan.getYearlyPlanId()
                                        : plan.getMonthlyPlanId(),
                                    title: plan.getName(),
                                    description: description,
                                    sideTitle: plan.isCustomPricing()
                                        ? 'Custom Price'
                                        : isSubsriptionPlanYearly
                                            ? '$' +
                                            (
                                                plan.getYearlySubscriptionAmountInUSD() *
                                                12
                                            ).toString()
                                            : '$' +
                                            plan
                                                .getMonthlySubscriptionAmountInUSD()
                                                .toString(),
                                    sideDescription: plan.isCustomPricing()
                                        ? ''
                                        : isSubsriptionPlanYearly
                                            ? `/year per user`
                                            : `/month per user`,
                                };
                            }),
                        title: 'Please select a plan.',
                        required: true,
                        footerElement: getFooter(),
                    },
                ]}
                modelDetailProps={{
                    modelType: Project,
                    id: 'model-detail-project',
                    fields: [
                        {
                            field: {
                                paymentProviderPlanId: true,
                            },
                            title: 'Current Plan',
                            getElement: (item: JSONObject): ReactElement => {
                                const plan: SubscriptionPlan | undefined =
                                    SubscriptionPlan.getSubscriptionPlanById(
                                        item['paymentProviderPlanId'] as string,
                                        getAllEnvVars()
                                    );

                                if (!plan) {
                                    return (
                                        <p>No plan selected for this project</p>
                                    );
                                }

                                const isYearlyPlan: boolean =
                                    SubscriptionPlan.isYearlyPlan(
                                        item['paymentProviderPlanId'] as string,
                                        getAllEnvVars()
                                    );

                                let description: string = plan.isCustomPricing()
                                    ? `Custom Pricing based on your needs. Our sales team will contact you shortly.`
                                    : `$${isYearlyPlan
                                        ? plan.getYearlySubscriptionAmountInUSD()
                                        : plan.getMonthlySubscriptionAmountInUSD()
                                    } / month per user. Billed ${isYearlyPlan ? 'yearly' : 'monthly'
                                    }.`;

                                if (
                                    isYearlyPlan &&
                                    plan.getYearlySubscriptionAmountInUSD() ===
                                    0
                                ) {
                                    description =
                                        'This plan is free, forever. ';
                                }

                                if (
                                    !isYearlyPlan &&
                                    plan.getMonthlySubscriptionAmountInUSD() ===
                                    0
                                ) {
                                    description =
                                        'This plan is free, forever. ';
                                }

                                return (
                                    <div>
                                        <div className="bold">
                                            {plan.getName()}
                                        </div>
                                        <div>{description}</div>
                                    </div>
                                );
                            },
                        },
                        {
                            field: {
                                paymentProviderSubscriptionSeats: true,
                            },
                            title: 'Seats',
                            description:
                                'These are current users in this project. To change this you need to add or remove them.',
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <div>
                                        <div className="bold">
                                            {
                                                item[
                                                'paymentProviderSubscriptionSeats'
                                                ] as string
                                            }{' '}
                                            users in this project.
                                        </div>
                                    </div>
                                );
                            },
                        },
                    ],
                    modelId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />

            <ModelTable<BillingPaymentMethod>
                modelType={BillingPaymentMethod}
                id="payment-methods-table"
                isDeleteable={true}
                isEditable={false}
                isCreateable={false}
                isViewable={false}
                name="Settings > Billing > Add Payment Method"
                cardProps={{
                    buttons: [
                        {
                            title: 'Add Payment Method',
                            icon: IconProp.Add,
                            onClick: () => {
                                fetchSetupIntent();
                                setShowPaymentMethodModal(true);
                            },
                            buttonStyle: ButtonStyleType.NORMAL,
                        },
                    ],
                    icon: IconProp.Billing,
                    title: 'Payment Methods',
                    description:
                        'Here is a list of payment methods attached to this project.',
                }}
                noItemsMessage={'No payment methods found.'}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                showRefreshButton={true}
                showFilterButton={true}
                columns={[
                    {
                        field: {
                            type: true,
                        },
                        title: 'Payment Method Type',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject) => {
                            return (
                                <span>{`${Text.uppercaseFirstLetter(
                                    item['type'] as string
                                )}`}</span>
                            );
                        },
                    },
                    {
                        field: {
                            last4Digits: true,
                        },
                        title: 'Number',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject) => {
                            return <span>{`*****${item['last4Digits']}`}</span>;
                        },
                    },
                ]}
            />

            {showPaymentMethodModal ? (
                <Modal
                    title={`Add Payment Method`}
                    onSubmit={async () => {
                        setIsModalSubmitButtonLoading(true);
                        formRef.current.click();
                    }}
                    isLoading={isModalSubmitButtonLoading}
                    onClose={() => {
                        setShowPaymentMethodModal(false);
                    }}
                    submitButtonText={`Save`}
                    error={error || ''}
                    isBodyLoading={isModalLoading}
                    submitButtonType={ButtonType.Submit}
                >
                    {setupIntent && !error && stripe ? (
                        <Elements
                            stripe={stripe}
                            options={{
                                // passing the client secret obtained in step 3
                                clientSecret: setupIntent,
                            }}
                        >
                            <CheckoutForm
                                onSuccess={() => {
                                    setIsModalSubmitButtonLoading(false);
                                }}
                                onError={(errorMessage: string) => {
                                    setError(errorMessage);
                                    setIsModalSubmitButtonLoading(false);
                                }}
                                formRef={formRef}
                            />
                        </Elements>
                    ) : (
                        <></>
                    )}
                    {!error && !setupIntent && !stripe ? (
                        <p>Loading...</p>
                    ) : (
                        <></>
                    )}
                </Modal>
            ) : (
                <></>
            )}

            <Card
                title={`Cancel Plan`}
                description={`If you would like to cancel the plan, you need to delete the project.`}
                buttons={[
                    {
                        title: `Delete Project`,
                        buttonStyle: ButtonStyleType.DANGER,
                        onClick: () => {
                            Navigation.navigate(
                                RouteUtil.populateRouteParams(
                                    RouteMap[
                                    PageMap.SETTINGS_DANGERZONE
                                    ] as Route
                                )
                            );
                        },
                        icon: IconProp.Close,
                    },
                ]}
            />
        </Page>
    );
};

export default Settings;
