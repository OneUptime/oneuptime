import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
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
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const Users: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

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
    </Page>
  );
};

export default Users;
