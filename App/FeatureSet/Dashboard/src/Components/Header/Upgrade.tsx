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
import { useTranslation } from "react-i18next";

const Upgrade: () => JSX.Element = (): ReactElement => {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =
    useState<boolean>(true);

  const getFooter: GetReactElementFunction = (): ReactElement => {
    if (!BILLING_ENABLED) {
      return <></>;
    }

    return (
      <Toggle
        title={t("upgrade.yearlyPlan")}
        value={isSubscriptionPlanYearly}
        description={t("upgrade.yearlyPlanSave")}
        onChange={(value: boolean) => {
          setIsSubscriptionPlanYearly(value);
        }}
      />
    );
  };

  return (
    <>
      <Button
        title={t("upgrade.upgradePlan")}
        onClick={() => {
          setShowModal(true);
        }}
        buttonStyle={ButtonStyleType.LINK}
        icon={IconProp.Star}
      ></Button>
      {showModal ? (
        <ModelFormModal<Project>
          modelType={Project}
          title={t("upgrade.changePlan")}
          name={t("upgrade.changePlan")}
          modelIdToEdit={ProjectUtil.getCurrentProjectId()!}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={t("upgrade.changePlan")}
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
                    ? t("upgrade.salesContact")
                    : `${
                        isSubscriptionPlanYearly
                          ? t("upgrade.billedYearly")
                          : t("upgrade.billedMonthly")
                      }${
                        plan.getTrialPeriod() > 0
                          ? ` ${t("upgrade.freeTrialDays", { days: plan.getTrialPeriod() })}`
                          : ""
                      }`;

                  if (
                    isSubscriptionPlanYearly &&
                    plan.getYearlySubscriptionAmountInUSD() === 0
                  ) {
                    description = t("upgrade.freeForever");
                  }

                  if (
                    !isSubscriptionPlanYearly &&
                    plan.getMonthlySubscriptionAmountInUSD() === 0
                  ) {
                    description = t("upgrade.freeForever");
                  }

                  return {
                    value: isSubscriptionPlanYearly
                      ? plan.getYearlyPlanId()
                      : plan.getMonthlyPlanId(),
                    title: plan.getName(),
                    description: description,
                    sideTitle: plan.isCustomPricing()
                      ? t("upgrade.customPrice")
                      : isSubscriptionPlanYearly
                        ? "$" +
                          plan.getYearlySubscriptionAmountInUSD().toString() +
                          t("upgrade.billedYearlySuffix")
                        : "$" +
                          plan.getMonthlySubscriptionAmountInUSD().toString(),
                    sideDescription: plan.isCustomPricing()
                      ? ""
                      : isSubscriptionPlanYearly
                        ? t("upgrade.perUserPerYear", {
                            amount:
                              plan.getYearlySubscriptionAmountInUSD() * 12,
                          })
                        : t("upgrade.perUserPerMonth"),
                  };
                }),
                title: t("upgrade.selectPlan"),
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
