import React, { FunctionComponent, ReactElement, useState } from 'react';
import IconProp from 'Common/Types/Icon/IconProp';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';
import Project from 'Model/Models/Project';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { RadioButton } from 'CommonUI/src/Components/RadioButtons/RadioButtons';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { BILLING_ENABLED, getAllEnvVars } from 'CommonUI/src/Config';
import DashboardNavigation from '../../Utils/Navigation';
import Toggle from 'CommonUI/src/Components/Toggle/Toggle';

const Upgrade: FunctionComponent = (): ReactElement => {
    const [showModal, setShowModal] = useState<boolean>(false);
    const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =
        useState<boolean>(true);

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
        <>
            <Button
                title="Upgrade Plan"
                onClick={() => {
                    setShowModal(true);
                }}
                buttonStyle={ButtonStyleType.LINK}
                icon={IconProp.Star}
            ></Button>
            {showModal ? (
                <ModelFormModal<Project>
                    modelType={Project}
                    title="Change Plan"
                    name="Change Plan"
                    modelIdToEdit={DashboardNavigation.getProjectId()!}
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText="Change Plan"
                    onSuccess={() => {
                        Navigation.reload();
                    }}
                    formProps={{
                        saveRequestOptions: {
                            isMultiTenantRequest: true, // because this is a tenant request, we do not have to include the header in the request
                        },
                        model: new Project(),
                        id: 'create-project-from',
                        fields: [
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
                                    ).map(
                                        (
                                            plan: SubscriptionPlan
                                        ): RadioButton => {
                                            let description: string =
                                                plan.isCustomPricing()
                                                    ? `Our sales team will contact you soon.`
                                                    : `Billed ${
                                                          isSubscriptionPlanYearly
                                                              ? 'yearly'
                                                              : 'monthly'
                                                      }. ${
                                                          plan.getTrialPeriod() >
                                                          0
                                                              ? `Free ${plan.getTrialPeriod()} days trial.`
                                                              : ''
                                                      }`;

                                            if (
                                                isSubscriptionPlanYearly &&
                                                plan.getYearlySubscriptionAmountInUSD() ===
                                                    0
                                            ) {
                                                description =
                                                    'This plan is free, forever. ';
                                            }

                                            if (
                                                !isSubscriptionPlanYearly &&
                                                plan.getMonthlySubscriptionAmountInUSD() ===
                                                    0
                                            ) {
                                                description =
                                                    'This plan is free, forever. ';
                                            }

                                            return {
                                                value: isSubscriptionPlanYearly
                                                    ? plan.getYearlyPlanId()
                                                    : plan.getMonthlyPlanId(),
                                                title: plan.getName(),
                                                description: description,
                                                sideTitle:
                                                    plan.isCustomPricing()
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
                                                sideDescription:
                                                    plan.isCustomPricing()
                                                        ? ''
                                                        : isSubscriptionPlanYearly
                                                        ? `~ $${
                                                              plan.getYearlySubscriptionAmountInUSD() *
                                                              12
                                                          } per user / year`
                                                        : `/month per user`,
                                            };
                                        }
                                    ),
                                title: 'Please select a plan.',
                                required: true,
                                footerElement: getFooter(),
                            },
                        ],
                        formType: FormType.Update,
                    }}
                />
            ) : (
                <></>
            )}
        </>
    );
};

export default Upgrade;
