import ProjectUtil from "Common/UI/Utils/Project";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { ReactElement, useState } from "react";

const Upgrade: () => JSX.Element = (): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =
    useState<boolean>(true);

  const getFooter: GetReactElementFunction = (): ReactElement => {
    if (!BILLING_ENABLED) {
      return <></>;
    }

    return (
      <Toggle
        title="Yearly Plan"
        value={isSubscriptionPlanYearly}
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
          modelIdToEdit={ProjectUtil.getCurrentProjectId()!}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText="Change Plan"
          onSuccess={() => {
            Navigation.reload();
          }}
          formProps={{
            name: "Change Plan",
            modelType: Project,
            id: "create-project-from",
            fields: [
              {
                field: {
                  paymentProviderPlanId: true,
                },
                validation: {
                  minLength: 6,
                },
                fieldType: FormFieldSchemaType.OptionChooserButton,
                radioButtonOptions: SubscriptionPlan.getSubscriptionPlans(
                  getAllEnvVars(),
                ).map((plan: SubscriptionPlan): RadioButton => {
                  let description: string = plan.isCustomPricing()
                    ? `Our sales team will contact you soon.`
                    : `Billed ${
                        isSubscriptionPlanYearly ? "yearly" : "monthly"
                      }. ${
                        plan.getTrialPeriod() > 0
                          ? `Free ${plan.getTrialPeriod()} days trial.`
                          : ""
                      }`;

                  if (
                    isSubscriptionPlanYearly &&
                    plan.getYearlySubscriptionAmountInUSD() === 0
                  ) {
                    description = "This plan is free, forever. ";
                  }

                  if (
                    !isSubscriptionPlanYearly &&
                    plan.getMonthlySubscriptionAmountInUSD() === 0
                  ) {
                    description = "This plan is free, forever. ";
                  }

                  return {
                    value: isSubscriptionPlanYearly
                      ? plan.getYearlyPlanId()
                      : plan.getMonthlyPlanId(),
                    title: plan.getName(),
                    description: description,
                    sideTitle: plan.isCustomPricing()
                      ? "Custom Price"
                      : isSubscriptionPlanYearly
                        ? "$" +
                          plan.getYearlySubscriptionAmountInUSD().toString() +
                          "/mo billed yearly"
                        : "$" +
                          plan.getMonthlySubscriptionAmountInUSD().toString(),
                    sideDescription: plan.isCustomPricing()
                      ? ""
                      : isSubscriptionPlanYearly
                        ? `~ $${
                            plan.getYearlySubscriptionAmountInUSD() * 12
                          } per user / year`
                        : `/month per user`,
                  };
                }),
                title: "Please select a plan.",
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
