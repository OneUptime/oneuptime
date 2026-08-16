import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  bulkAddUsersToProject,
  BulkAddUsersToProjectFailure,
  BulkAddUsersToProjectProgress,
} from "../../Components/User/BulkAddUsersToProject";
import BulkAddUsersToProjectModal, {
  BulkAddUsersToProjectSelection,
} from "../../Components/User/BulkAddUsersToProjectModal";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/Models/DatabaseModels/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

const Users: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  /*
   * Adding to a project needs two things the bulk bar cannot ask for on its
   * own - a project and one of its teams - so the action opens this modal
   * instead of running straight away. The click's callbacks are kept alongside
   * the users because the memberships are created after the modal is submitted,
   * and they are what drives the shared bulk progress modal and, on close,
   * clears the selection and refreshes the table.
   */
  const [addToProjectProps, setAddToProjectProps] =
    useState<BulkActionOnClickProps<User> | null>(null);

  const getBulkSetBlockedAction: (
    isBlocked: boolean,
  ) => BulkActionButtonSchema<User> = (
    isBlocked: boolean,
  ): BulkActionButtonSchema<User> => {
    const actionLabel: string = isBlocked ? "Block" : "Unblock";

    return {
      title: actionLabel,
      icon: isBlocked ? IconProp.Lock : IconProp.LockOpen,
      buttonStyleType: ButtonStyleType.NORMAL,
      confirmTitle: (items: Array<User>): string => {
        return `${actionLabel} ${items.length} User(s)`;
      },
      confirmMessage: (items: Array<User>): string => {
        return isBlocked
          ? `Are you sure you want to block ${items.length} user(s)? Blocked users will not be able to sign in or access any project.`
          : `Are you sure you want to unblock ${items.length} user(s)? They will regain access to their account.`;
      },
      onClick: async (
        onClickProps: BulkActionOnClickProps<User>,
      ): Promise<void> => {
        const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
          onClickProps;

        onBulkActionStart();

        const inProgressItems: Array<User> = [...items];
        const totalItems: Array<User> = [...items];
        const successItems: Array<User> = [];
        const failedItems: Array<BulkActionFailed<User>> = [];

        for (const user of totalItems) {
          inProgressItems.splice(inProgressItems.indexOf(user), 1);

          try {
            if (!user.id) {
              throw new BadDataException("User ID not found");
            }

            await AdminModelAPI.updateById<User>({
              id: user.id,
              modelType: User,
              data: {
                isBlocked: isBlocked,
              },
            });

            successItems.push(user);
          } catch (err) {
            failedItems.push({
              item: user,
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

  /*
   * Opens the picker and stops there. Nothing is created until the modal is
   * submitted, so `onBulkActionStart` is deliberately not called here - calling
   * it would put an empty progress modal on screen behind the picker.
   */
  const getBulkAddToProjectAction: () => BulkActionButtonSchema<User> =
    (): BulkActionButtonSchema<User> => {
      return {
        title: t("pages.users.bulkAddToProject"),
        icon: IconProp.FolderPlus,
        buttonStyleType: ButtonStyleType.NORMAL,
        onClick: (
          onClickProps: BulkActionOnClickProps<User>,
        ): Promise<void> => {
          setAddToProjectProps(onClickProps);
          return Promise.resolve();
        },
      };
    };

  type AddSelectedUsersToProjectFunction = (
    onClickProps: BulkActionOnClickProps<User>,
    selection: BulkAddUsersToProjectSelection,
  ) => Promise<void>;

  const addSelectedUsersToProject: AddSelectedUsersToProjectFunction = async (
    onClickProps: BulkActionOnClickProps<User>,
    selection: BulkAddUsersToProjectSelection,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      onClickProps;

    onBulkActionStart();

    /*
     * Kept so the recovery path below knows who had already been dealt with.
     * Without it a late failure would have to report the whole selection as
     * failed, telling the admin nothing was added when some users were.
     */
    let lastProgress: BulkAddUsersToProjectProgress = {
      totalUsers: items,
      inProgressUsers: items,
      succeededUsers: [],
      failedUsers: [],
    };

    type ReportProgressFunction = (
      progress: BulkAddUsersToProjectProgress,
    ) => void;

    const reportProgress: ReportProgressFunction = (
      progress: BulkAddUsersToProjectProgress,
    ): void => {
      lastProgress = progress;

      onProgressInfo({
        totalItems: progress.totalUsers,
        inProgressItems: progress.inProgressUsers,
        successItems: progress.succeededUsers,
        failed: progress.failedUsers.map(
          (failure: BulkAddUsersToProjectFailure): BulkActionFailed<User> => {
            return {
              item: failure.user,
              failedMessage: failure.failedMessage,
            };
          },
        ),
      });
    };

    try {
      await bulkAddUsersToProject({
        users: items,
        projectId: selection.projectId,
        teamId: selection.teamId,
        hasAcceptedInvitation: selection.hasAcceptedInvitation,
        onProgress: reportProgress,
      });
    } catch (err) {
      /*
       * Per-user failures never reach here - bulkAddUsersToProject turns those
       * into rows of the report. Reaching here means the run itself broke, so
       * only the users it had not attempted yet are unaccounted for; the ones
       * already added stay reported as added.
       */
      try {
        reportProgress({
          totalUsers: lastProgress.totalUsers,
          inProgressUsers: [],
          succeededUsers: lastProgress.succeededUsers,
          failedUsers: [
            ...lastProgress.failedUsers,
            ...lastProgress.inProgressUsers.map(
              (user: User): BulkAddUsersToProjectFailure => {
                return {
                  user: user,
                  failedMessage: API.getFriendlyMessage(err),
                };
              },
            ),
          ],
        });
      } catch {
        /*
         * Reporting is the most likely thing to have broken in the first
         * place. Ending the action matters more than the report: until
         * onBulkActionEnd runs, the progress modal's Close button stays
         * disabled and the selection is never cleared.
         */
      }
    } finally {
      onBulkActionEnd();
    }
  };

  const getBulkDeleteAction: () => BulkActionButtonSchema<User> =
    (): BulkActionButtonSchema<User> => {
      return {
        title: "Delete",
        icon: IconProp.Trash,
        buttonStyleType: ButtonStyleType.DANGER,
        confirmButtonStyleType: ButtonStyleType.DANGER,
        confirmTitle: (items: Array<User>): string => {
          return `Delete ${items.length} User(s)`;
        },
        confirmMessage: (items: Array<User>): string => {
          return `Are you sure you want to permanently delete ${items.length} user(s)? This will remove the user(s) from every project and cannot be undone.`;
        },
        onClick: async (
          onClickProps: BulkActionOnClickProps<User>,
        ): Promise<void> => {
          const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
            onClickProps;

          onBulkActionStart();

          const inProgressItems: Array<User> = [...items];
          const totalItems: Array<User> = [...items];
          const successItems: Array<User> = [];
          const failedItems: Array<BulkActionFailed<User>> = [];

          for (const user of totalItems) {
            inProgressItems.splice(inProgressItems.indexOf(user), 1);

            try {
              if (!user.id) {
                throw new BadDataException("User ID not found");
              }

              await AdminModelAPI.deleteItem<User>({
                modelType: User,
                id: user.id,
              });

              successItems.push(user);
            } catch (err) {
              failedItems.push({
                item: user,
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

  return (
    <Page
      title={t("pages.users.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
      ]}
    >
      <Fragment>
        <ModelTable<User>
          modelType={User}
          modelAPI={AdminModelAPI}
          userPreferencesKey="admin-users-table"
          id="users-table"
          isDeleteable={false}
          isEditable={false}
          showViewIdButton={true}
          isCreateable={true}
          name="Users"
          isViewable={true}
          cardProps={{
            title: t("pages.users.cardTitle"),
            description: t("pages.users.cardDescription"),
          }}
          noItemsMessage={t("pages.users.noItems")}
          searchableFields={["name", "email"]}
          bulkActions={{
            buttons: [
              getBulkAddToProjectAction(),
              getBulkSetBlockedAction(true),
              getBulkSetBlockedAction(false),
              getBulkDeleteAction(),
            ],
          }}
          formFields={[
            {
              field: {
                email: true,
              },
              title: "Email",
              fieldType: FormFieldSchemaType.Email,
              required: true,
              placeholder: "email@company.com",
              disableSpellCheck: true,
            },
            {
              field: {
                password: true,
              },
              title: "Password",
              fieldType: FormFieldSchemaType.Password,
              required: true,
              placeholder: "Password",
              disableSpellCheck: true,
            },
            {
              field: {
                name: true,
              },
              title: "Full Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "John Smith",
            },
          ]}
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[
            {
              field: {
                _id: true,
              },
              title: "User ID",
              type: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Full Name",
              type: FieldType.Text,
            },
            {
              field: {
                email: true,
              },
              title: "Email",
              type: FieldType.Email,
            },
            {
              field: {
                isEmailVerified: true,
              },
              title: "Email Verified",
              type: FieldType.Boolean,
            },
            {
              field: {
                lastActive: true,
              },
              title: "Last Active At",
              type: FieldType.DateTime,
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Full Name",
              type: FieldType.Text,
            },
            {
              field: {
                email: true,
              },
              title: "Email",
              type: FieldType.Email,
            },
            {
              field: {
                isEmailVerified: true,
              },
              title: "Email Verified",
              type: FieldType.Boolean,
              hideOnMobile: true,
            },
            {
              field: {
                lastActive: true,
              },
              title: "Last Active At",
              type: FieldType.DateTime,
              hideOnMobile: true,
            },
          ]}
        />

        {addToProjectProps && (
          <BulkAddUsersToProjectModal
            users={addToProjectProps.items}
            onClose={() => {
              setAddToProjectProps(null);
            }}
            onSubmit={(selection: BulkAddUsersToProjectSelection) => {
              /*
               * Close the picker before the memberships are created so the bulk
               * progress modal is not stacked behind it.
               */
              setAddToProjectProps(null);

              /*
               * addSelectedUsersToProject reports its own failures and ends the
               * action in a `finally`, so this only catches a throw from
               * onBulkActionStart / onBulkActionEnd themselves. There is
               * nothing useful left to do with it - calling onBulkActionEnd a
               * second time here would be as likely to throw again - but it
               * must not surface as an unhandled rejection.
               */
              addSelectedUsersToProject(addToProjectProps, selection).catch(
                () => {
                  // Intentionally empty - see above.
                },
              );
            }}
          />
        )}
      </Fragment>
    </Page>
  );
};

export default Users;
