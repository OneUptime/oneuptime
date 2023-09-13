import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Project from 'Model/Models/Project';
import User from 'Model/Models/User';
import { BILLING_ENABLED, getAllEnvVars } from 'CommonUI/src/Config';
import Field from 'CommonUI/src/Components/Forms/Types/Field';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { RadioButton } from 'CommonUI/src/Components/RadioButtons/RadioButtons';
import Toggle from 'CommonUI/src/Components/Toggle/Toggle';
import AdminModelAPI from '../../Utils/ModelAPI';

const Projects: FunctionComponent = (): ReactElement => {
    const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =
        useState<boolean>(true);

    useEffect(() => {
        refreshFields();
    }, [isSubscriptionPlanYearly]);

    const refreshFields: Function = (): void => {
        let formFields: Array<Field<Project>> = [
            {
                field: {
                    name: true,
                },
                validation: {
                    minLength: 4,
                },
                fieldType: FormFieldSchemaType.Text,
                placeholder: 'My Project',
                description: 'Pick a friendly name.',
                title: 'Project Name',
                required: true,
                stepId: BILLING_ENABLED ? 'basic' : undefined,
            },
            {
                field: {
                    createdByUser: true,
                },
                title: 'Owner',
                description:
                    'Who would you like the owner of this project to be? If you leave this blank - you will be the owner of the project',
                fieldType: FormFieldSchemaType.Dropdown,
                stepId: BILLING_ENABLED ? 'basic' : undefined,
                dropdownModal: {
                    type: User,
                    labelField: 'email',
                    valueField: '_id',
                },
            },
        ];

        if (BILLING_ENABLED) {
            formFields = [
                ...formFields,
                {
                    field: {
                        paymentProviderPlanId: true,
                    },
                    stepId: 'plan',
                    validation: {
                        minLength: 6,
                    },
                    footerElement: getFooter(),
                    fieldType: FormFieldSchemaType.RadioButton,
                    radioButtonOptions: SubscriptionPlan.getSubscriptionPlans(
                        getAllEnvVars()
                    ).map((plan: SubscriptionPlan): RadioButton => {
                        let description: string = plan.isCustomPricing()
                            ? `Our sales team will contact you soon.`
                            : `Billed ${
                                  isSubscriptionPlanYearly
                                      ? 'yearly'
                                      : 'monthly'
                              }. ${
                                  plan.getTrialPeriod() > 0
                                      ? `Free ${plan.getTrialPeriod()} days trial.`
                                      : ''
                              }`;

                        if (
                            isSubscriptionPlanYearly &&
                            plan.getYearlySubscriptionAmountInUSD() === 0
                        ) {
                            description = 'This plan is free, forever. ';
                        }

                        if (
                            !isSubscriptionPlanYearly &&
                            plan.getMonthlySubscriptionAmountInUSD() === 0
                        ) {
                            description = 'This plan is free, forever. ';
                        }

                        return {
                            value: isSubscriptionPlanYearly
                                ? plan.getYearlyPlanId()
                                : plan.getMonthlyPlanId(),
                            title: plan.getName(),
                            description: description,
                            sideTitle: plan.isCustomPricing()
                                ? 'Custom Price'
                                : isSubscriptionPlanYearly
                                ? '$' +
                                  plan
                                      .getYearlySubscriptionAmountInUSD()
                                      .toString() +
                                  '/mo billed yearly'
                                : '$' +
                                  plan
                                      .getMonthlySubscriptionAmountInUSD()
                                      .toString(),
                            sideDescription: plan.isCustomPricing()
                                ? ''
                                : isSubscriptionPlanYearly
                                ? `~ $${
                                      plan.getYearlySubscriptionAmountInUSD() *
                                      12
                                  } per user / year`
                                : `/month per user`,
                        };
                    }),
                    title: 'Please select a plan.',
                    required: true,
                },
                {
                    field: {
                        paymentProviderPromoCode: true,
                    },
                    fieldType: FormFieldSchemaType.Text,
                    placeholder: 'Promo Code (Optional)',
                    description: 'If you have a coupon code, enter it here.',
                    title: 'Promo Code',
                    required: false,
                    stepId: 'plan',
                    disabled: false,
                },
            ];
        }

        setFields(formFields);
    };

    const [fields, setFields] = useState<Array<Field<Project>>>([]);

    const getFooter: Function = (): ReactElement => {
        if (!BILLING_ENABLED) {
            return <></>;
        }

        return (
            <Toggle
                title="Yearly Plan"
                initialValue={isSubscriptionPlanYearly}
                description="(Save 20%)"
                onChange={(value: boolean) => {
                    setIsSubscriptionPlanYearly(value);
                }}
            />
        );
    };

    return (
        <Page
            title={'Projects'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Projects',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.PROJECTS] as Route
                    ),
                },
            ]}
        >
            <ModelTable<Project>
                modelType={Project}
                modelAPI={AdminModelAPI}
                id="projects-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                name="Projects"
                isViewable={false}
                cardProps={{
                    title: 'Projects',
                    description: 'Here is a list of proejcts in OneUptime.',
                }}
                showViewIdButton={true}
                formSteps={
                    BILLING_ENABLED
                        ? [
                              {
                                  title: 'Basic',
                                  id: 'basic',
                              },
                              {
                                  title: 'Select Plan',
                                  id: 'plan',
                              },
                          ]
                        : undefined
                }
                noItemsMessage={'No projects found.'}
                formFields={fields}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default Projects;
