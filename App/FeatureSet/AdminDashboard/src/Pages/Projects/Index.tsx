import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import Navigation from "Common/UI/Utils/Navigation";

const Projects: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =
    useState<boolean>(true);

  useEffect(() => {
    refreshFields();
  }, [isSubscriptionPlanYearly]);

  const refreshFields: VoidFunction = (): void => {
    let formFields: Array<Field<Project>> = [
      {
        field: {
          name: true,
        },
        validation: {
          minLength: 4,
        },
        fieldType: FormFieldSchemaType.Text,
        placeholder: "My Project",
        description: "Pick a friendly name.",
        title: "Project Name",
        required: true,
        stepId: BILLING_ENABLED ? "basic" : undefined,
      },
      {
        field: {
          createdByUser: true,
        },
        title: "Owner",
        description:
          "Who would you like the owner of this project to be? If you leave this blank - you will be the owner of the project",
        fieldType: FormFieldSchemaType.Dropdown,
        stepId: BILLING_ENABLED ? "basic" : undefined,
        dropdownModal: {
          type: User,
          labelField: "email",
          valueField: "_id",
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
          stepId: "plan",
          validation: {
            minLength: 6,
          },
          footerElement: getFooter(),
          fieldType: FormFieldSchemaType.OptionChooserButton,
          radioButtonOptions: SubscriptionPlan.getSubscriptionPlans(
            getAllEnvVars(),
          ).map((plan: SubscriptionPlan): RadioButton => {
            let description: string = plan.isCustomPricing()
              ? `Our sales team will contact you soon.`
              : `Billed ${isSubscriptionPlanYearly ? "yearly" : "monthly"}. ${
                  plan.getTrialPeriod() > 0
                    ? `Free ${plan.getTrialPeriod()} days trial.`
                    : ""
                }`;

            if (
              isSubscriptionPlanYearly &&
              plan.getYearlySubscriptionAmountInUSD() === 0
            ) {
              description = t("pages.projects.freeForeverDescription");
            }

            if (
              !isSubscriptionPlanYearly &&
              plan.getMonthlySubscriptionAmountInUSD() === 0
            ) {
              description = t("pages.projects.freeForeverDescription");
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
                  : "$" + plan.getMonthlySubscriptionAmountInUSD().toString(),
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
        },
        {
          field: {
            paymentProviderPromoCode: true,
          },
          fieldType: FormFieldSchemaType.Text,
          placeholder: "Promo Code (Optional)",
          description: "If you have a coupon code, enter it here.",
          title: "Promo Code",
          required: false,
          stepId: "plan",
          disabled: false,
        },
      ];
    }

    setFields(formFields);
  };

  const [fields, setFields] = useState<Array<Field<Project>>>([]);

  const getBulkSetBlockedAction: (
    isBlocked: boolean,
  ) => BulkActionButtonSchema<Project> = (
    isBlocked: boolean,
  ): BulkActionButtonSchema<Project> => {
    const actionLabel: string = isBlocked ? "Block" : "Unblock";

    return {
      title: actionLabel,
      icon: isBlocked ? IconProp.Lock : IconProp.LockOpen,
      buttonStyleType: ButtonStyleType.NORMAL,
      confirmTitle: (items: Array<Project>): string => {
        return `${actionLabel} ${items.length} Project(s)`;
      },
      confirmMessage: (items: Array<Project>): string => {
        return isBlocked
          ? `Are you sure you want to block ${items.length} project(s)? Blocked projects and their members will lose access until unblocked.`
          : `Are you sure you want to unblock ${items.length} project(s)? They will regain access.`;
      },
      onClick: async (
        onClickProps: BulkActionOnClickProps<Project>,
      ): Promise<void> => {
        const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
          onClickProps;

        onBulkActionStart();

        const inProgressItems: Array<Project> = [...items];
        const totalItems: Array<Project> = [...items];
        const successItems: Array<Project> = [];
        const failedItems: Array<BulkActionFailed<Project>> = [];

        for (const project of totalItems) {
          inProgressItems.splice(inProgressItems.indexOf(project), 1);

          try {
            if (!project.id) {
              throw new BadDataException("Project ID not found");
            }

            await AdminModelAPI.updateById<Project>({
              id: project.id,
              modelType: Project,
              data: {
                isBlocked: isBlocked,
              },
            });

            successItems.push(project);
          } catch (err) {
            failedItems.push({
              item: project,
              failedMessage: API.getFriendlyMessage(err),
            });
          }

          onProgressInfo({
            totalItems: totalItems,
            failed: failedItems,
            successItems: successItems,
            inProgressItems: inProgressItems,
          });
        }

        onBulkActionEnd();
      },
    };
  };

  const getBulkDeleteAction: () => BulkActionButtonSchema<Project> =
    (): BulkActionButtonSchema<Project> => {
      return {
        title: "Delete",
        icon: IconProp.Trash,
        buttonStyleType: ButtonStyleType.DANGER,
        confirmButtonStyleType: ButtonStyleType.DANGER,
        confirmTitle: (items: Array<Project>): string => {
          return `Delete ${items.length} Project(s)`;
        },
        confirmMessage: (items: Array<Project>): string => {
          return `Are you sure you want to permanently delete ${items.length} project(s)? This will remove all of their data (monitors, incidents, telemetry, and more) and cannot be undone.`;
        },
        onClick: async (
          onClickProps: BulkActionOnClickProps<Project>,
        ): Promise<void> => {
          const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
            onClickProps;

          onBulkActionStart();

          const inProgressItems: Array<Project> = [...items];
          const totalItems: Array<Project> = [...items];
          const successItems: Array<Project> = [];
          const failedItems: Array<BulkActionFailed<Project>> = [];

          for (const project of totalItems) {
            inProgressItems.splice(inProgressItems.indexOf(project), 1);

            try {
              if (!project.id) {
                throw new BadDataException("Project ID not found");
              }

              await AdminModelAPI.deleteItem<Project>({
                modelType: Project,
                id: project.id,
              });

              successItems.push(project);
            } catch (err) {
              failedItems.push({
                item: project,
                failedMessage: API.getFriendlyMessage(err),
              });
            }

            onProgressInfo({
              totalItems: totalItems,
              failed: failedItems,
              successItems: successItems,
              inProgressItems: inProgressItems,
            });
          }

          onBulkActionEnd();
        },
      };
    };

  const getFooter: GetReactElementFunction = (): ReactElement => {
    if (!BILLING_ENABLED) {
      return <></>;
    }

    return (
      <Toggle
        title={t("pages.projects.yearlyPlanTitle")}
        value={isSubscriptionPlanYearly}
        description={t("pages.projects.yearlyPlanDescription")}
        onChange={(value: boolean) => {
          setIsSubscriptionPlanYearly(value);
        }}
      />
    );
  };

  return (
    <Page
      title={t("pages.projects.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.projects"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECTS] as Route,
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
        isViewable={true}
        cardProps={{
          title: t("pages.projects.cardTitle"),
          description: t("pages.projects.cardDescription"),
        }}
        showViewIdButton={true}
        formSteps={
          BILLING_ENABLED
            ? [
                {
                  title: t("pages.projects.stepBasic"),
                  id: "basic",
                },
                {
                  title: t("pages.projects.stepSelectPlan"),
                  id: "plan",
                },
              ]
            : undefined
        }
        noItemsMessage={t("pages.projects.noItems")}
        searchableFields={["name"]}
        bulkActions={{
          buttons: [
            getBulkSetBlockedAction(true),
            getBulkSetBlockedAction(false),
            getBulkDeleteAction(),
          ],
        }}
        formFields={fields}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
        userPreferencesKey="admin-projects-table"
      />
    </Page>
  );
};

export default Projects;
