import Route from 'Common/Types/API/Route';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Card from 'CommonUI/src/Components/Card/Card';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import { RadioButton } from 'CommonUI/src/Components/RadioButtons/RadioButtons';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Project from 'Model/Models/Project';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';

export interface ComponentProps extends PageComponentProps { }

const Settings: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [isSubsriptionPlanYearly, setIsSubscriptionPlanYearly] = useState<boolean>(true)


    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Danger Zone',
                    to: RouteMap[PageMap.HOME] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <CardModelDetail
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
                        radioButtonOptions: SubscriptionPlan.getSubscriptionPlans().map((plan: SubscriptionPlan): RadioButton => {

                            let description: string = plan.isCustomPricing() ? `Custom Pricing based on your needs. Our sales team will contact you shortly.` : `$${isSubsriptionPlanYearly ? plan.getYearlySubscriptionAmountInUSD() : plan.getMonthlySubscriptionAmountInUSD()} / month per user. Billed ${isSubsriptionPlanYearly ? "yearly" : "monthly"}. ${plan.getTrialPeriod() > 0 ? `Free ${plan.getTrialPeriod()} days trial.` : ''}`

                            if (isSubsriptionPlanYearly && plan.getYearlySubscriptionAmountInUSD() === 0) {
                                description = 'This plan is free, forever. '
                            }

                            if (!isSubsriptionPlanYearly && plan.getMonthlySubscriptionAmountInUSD() === 0) {
                                description = 'This plan is free, forever. '
                            }


                            return {
                                value: isSubsriptionPlanYearly ? plan.getYearlyPlanId() : plan.getMonthlyPlanId(),
                                title: plan.getName(),
                                description: description
                            }
                        }),
                        title: 'Please select a plan.',
                        required: true,
                        footerElement: (<div className='show-as-link' onClick={() => {
                            setIsSubscriptionPlanYearly(!isSubsriptionPlanYearly);
                        }}>
                            {isSubsriptionPlanYearly ? <span>Switch to monthly pricing?</span> : <span> Switch to yearly pricing?</span>}
                        </div>)
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
                                const plan = SubscriptionPlan.getSubscriptionPlanById(item['paymentProviderPlanId'] as string);

                                if (!plan) {
                                    return <p>No plan selected for this project</p>
                                }

                                let description: string = plan.isCustomPricing() ? `Custom Pricing based on your needs. Our sales team will contact you shortly.` : `$${isSubsriptionPlanYearly ? plan.getYearlySubscriptionAmountInUSD() : plan.getMonthlySubscriptionAmountInUSD()} / month per user. Billed ${isSubsriptionPlanYearly ? "yearly" : "monthly"}.`

                                if (isSubsriptionPlanYearly && plan.getYearlySubscriptionAmountInUSD() === 0) {
                                    description = 'This plan is free, forever. '
                                }

                                if (!isSubsriptionPlanYearly && plan.getMonthlySubscriptionAmountInUSD() === 0) {
                                    description = 'This plan is free, forever. '
                                }

                                return <div>
                                    <div className='bold'>{plan.getName()}</div>
                                    <div>{description}</div>
                                </div>
                            }
                        },
                        {
                            field: {
                                paymentProviderSubscriptionSeats: true,
                            },
                            title: 'Seats',
                            description: 'These are current users in this project. To change this you need to add or remove them.',
                            getElement: (item: JSONObject): ReactElement => {

                                return <div>
                                    <div className='bold'>{item['paymentProviderSubscriptionSeats'] as string} users in this project.</div>
                                </div>
                            }

                        },
                    ],
                    modelId: props.currentProject?._id,
                }}
            />

            <Card
                title={`Cancel Plan`}
                icon={IconProp.Billing}
                description={`If you would like to cancel the plan, you need to delete the project.`}
                buttons={[
                    {
                        title: `Delete Project`,
                        buttonStyle: ButtonStyleType.DANGER,
                        onClick: () => {
                            Navigation.navigate(RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS_DANGERZONE] as Route))
                        },
                        icon: IconProp.Close,
                    },
                ]}
            />
        </Page>
    );
};

export default Settings;
