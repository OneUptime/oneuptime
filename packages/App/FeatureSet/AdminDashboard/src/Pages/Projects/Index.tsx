import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BULK_ACTION_CONCURRENCY,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import DeleteItemNames from "Common/UI/Components/DeleteConfirmation/DeleteItemNames";
import { getRecordDisplayName } from "Common/UI/Utils/ModelDisplayName";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Field from "Common/UI/Components/Forms/Types/Field";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { getCreateProjectFormFields } from "Common/UI/Components/Project/CreateProjectFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Navigation from "Common/UI/Utils/Navigation";

const Projects: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  /*
   * The same one-page form the Dashboard's Create New Project dialog shows
   * (CreateProjectFormFields): the name and, with billing on, the plan and a
   * promo code folded under More fields.
   *
   * No Owner field: a project is created by the admin who makes it, as
   * OneUptime decides every record's creator, and the creator is its first
   * owner. Add the customer to the project's Owners team from the project's
   * Users page afterwards.
   */
  const fields: Array<Field<Project>> = useMemo(() => {
    return getCreateProjectFormFields({
      isBillingEnabled: BILLING_ENABLED,
      plans: BILLING_ENABLED
        ? SubscriptionPlan.getSubscriptionPlans(getAllEnvVars())
        : [],
    });
  }, []);

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
          ? `Are you sure you want to block ${items.length} project(s)? Until they are unblocked, their members, API keys and MCP clients lose access; their monitors, workflows, telemetry ingest and notifications stop; and their status pages and public dashboards go offline. Master admins keep access.`
          : `Are you sure you want to unblock ${items.length} project(s)? Their members, API keys and MCP clients regain access, and their monitors, workflows, telemetry ingest, notifications, status pages and public dashboards start again.`;
      },
      onClick: async (
        onClickProps: BulkActionOnClickProps<Project>,
      ): Promise<void> => {
        // Each project its own update, several at once (runBulkAction).
        await runBulkAction<Project>({
          actionProps: onClickProps,
          concurrency: BULK_ACTION_CONCURRENCY,
          step: async (project: Project): Promise<void> => {
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
          },
        });
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
        // Which projects: a count alone cannot show the one picked by mistake.
        confirmDetails: (items: Array<Project>): ReactElement => {
          return (
            <DeleteItemNames
              names={items.map((project: Project) => {
                return getRecordDisplayName(project, { column: "name" });
              })}
              totalCount={items.length}
            />
          );
        },
        onClick: async (
          onClickProps: BulkActionOnClickProps<Project>,
        ): Promise<void> => {
          /*
           * One project at a time (runBulkAction): a project's delete removes
           * everything it holds, a long write of its own.
           */
          await runBulkAction<Project>({
            actionProps: onClickProps,
            concurrency: 1,
            step: async (project: Project): Promise<void> => {
              if (!project.id) {
                throw new BadDataException("Project ID not found");
              }

              await AdminModelAPI.deleteItem<Project>({
                modelType: Project,
                id: project.id,
              });
            },
          });
        },
      };
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
        // Room for each plan's price beside it, as in the Dashboard's dialog.
        createEditModalWidth={
          BILLING_ENABLED ? ModalWidth.Medium : ModalWidth.Normal
        }
        name="Projects"
        isViewable={true}
        cardProps={{
          title: t("pages.projects.cardTitle"),
          description: t("pages.projects.cardDescription"),
        }}
        showViewIdButton={true}
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
              _id: true,
            },
            title: "Project ID",
            type: FieldType.ObjectID,
          },
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
