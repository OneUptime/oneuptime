import React, { FunctionComponent, ReactElement, useState } from 'react';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';
import Project from 'Model/Models/Project';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { RadioButton } from 'CommonUI/src/Components/RadioButtons/RadioButtons';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';

export interface ComponentProps {
    projectId: ObjectID;
}
const Upgrade: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showModal, setShowModal] = useState<boolean>(false);
    const [isSubsriptionPlanYearly, setIsSubscriptionPlanYearly] =
        useState<boolean>(true);

    return (
        <>
            <Button
                title="Upgrade Plan"
                onClick={() => {
                    setShowModal(true);
                }}
                buttonStyle={ButtonStyleType.LINK}
                icon={IconProp.Star}
                textStyle={
                    {
                        fontWeight: 500
                    }
                }
            ></Button>
            {showModal ? (
                <ModelFormModal<Project>
                    modelType={Project}
                    title="Change Plan"
                    modelIdToEdit={props.projectId}
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText="Change Plan"
                    onSuccess={() => {
                        Navigation.reload();
                    }}
                    formProps={{
                        saveRequestOptions: {
                            isMultiTenantRequest: true, // because this is a tenant request, we do not have to incclude the header in the reqeuest
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
                                    SubscriptionPlan.getSubscriptionPlans().map(
                                        (
                                            plan: SubscriptionPlan
                                        ): RadioButton => {
                                            let description: string =
                                                plan.isCustomPricing()
                                                    ? `Custom Pricing based on your needs. Our sales team will contact you shortly.`
                                                    : `$${
                                                          isSubsriptionPlanYearly
                                                              ? plan.getYearlySubscriptionAmountInUSD()
                                                              : plan.getMonthlySubscriptionAmountInUSD()
                                                      } / month per user. Billed ${
                                                          isSubsriptionPlanYearly
                                                              ? 'yearly'
                                                              : 'monthly'
                                                      }. ${
                                                          plan.getTrialPeriod() >
                                                          0
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
                                            };
                                        }
                                    ),
                                title: 'Please select a plan.',
                                required: true,
                                footerElement: (
                                    <div
                                        className="show-as-link"
                                        onClick={() => {
                                            setIsSubscriptionPlanYearly(false);
                                        }}
                                    >
                                        {isSubsriptionPlanYearly ? (
                                            <span>
                                                Switch to monthly pricing?
                                            </span>
                                        ) : (
                                            <span>
                                                {' '}
                                                Switch to yearly pricing?
                                            </span>
                                        )}
                                    </div>
                                ),
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
