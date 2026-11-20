import AdminModelAPI from "../../Utils/ModelAPI";
import SecurityAdvisoryNotice from "../../Components/SecurityAdvisories/SecurityAdvisoryNotice";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { bulkAddUsersToProject } from "../../Components/User/BulkAddUsersToProject";
import {
  ADD_TO_PROJECT_RESULT_LABELS,
  TWO_FACTOR_AUTH_RESULT_LABELS,
} from "../../Components/User/BulkUserResultLabels";
import BulkAddUsersToProjectModal, {
  BulkAddUsersToProjectSelection,
} from "../../Components/User/BulkAddUsersToProjectModal";
import SetPasswordLinkModal, {
  PASSWORD_FOLD_SUMMARY_EMAIL,
  PASSWORD_FOLD_SUMMARY_PASSWORD,
  PASSWORD_HELP_NO_EMAIL,
  SetPasswordEmailResult,
  sendSetPasswordEmail,
} from "../../Components/User/SetPasswordLink";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
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
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import HashedString from "Common/Types/HashedString";
import Toast from "Common/UI/Utils/Toast";
import { useServerCanSendEmail } from "Common/UI/Utils/ServerSending";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { APP_API_URL } from "Common/UI/Config";
import User from "Common/Models/DatabaseModels/User";
import { Translator, translationKey } from "Common/Types/Translator";
import { getNewPasswordField } from "Common/UI/Components/PasswordRequirements/NewPasswordFields";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * The master-admin endpoint behind the bulk two-factor actions.
 *
 * Spelled out here rather than shared with Pages/Users/View/Authentication.tsx
 * on purpose: that page's wiring test scrapes its own source for the literal
 * `userAuthenticationRoute(modelId, "...")` call shape, and a shared helper
 * imported from elsewhere would make both files' contracts invisible to it.
 * Two short builders that each name their own endpoint are cheaper than one
 * abstraction neither test can see through.
 */
const setTwoFactorAuthRequiredRoute: (userId: ObjectID) => URL = (
  userId: ObjectID,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `/user/${userId.toString()}/set-two-factor-auth-required`,
  );
};

/*
 * Whether the Create User form holds a password: BasicForm hands it on as a
 * HashedString, and an empty field as nothing or "".
 */
const hasPassword: (value: unknown) => boolean = (value: unknown): boolean => {
  const password: unknown =
    value instanceof HashedString ? value.toString() : value;

  return typeof password === "string" && password.length > 0;
};

// A user just created whose email with a link to set a password was not sent.
interface UnsentSetPasswordEmail {
  userId: ObjectID;
  name: string;
  email: string;
  error: string;
}

const Users: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();
  const passwordRequirementsId: string = useId();

  /*
   * Create User asks for a name and an email (#9139). Unless the master
   * admin sets a password under More fields, the new user is emailed a link
   * to set their own, and the page says so. On a server known not to send
   * email the password is in view with help that says why, and leaving it
   * empty ends in a link to send them by hand (SetPasswordLinkModal).
   */
  const canSendEmail: boolean | null = useServerCanSendEmail();
  const passwordSection: FormFieldCollapsibleSection<User> =
    getAdvancedFormSection<User>({
      getSummary: (values: FormValues<User>): Array<string> => {
        return [
          hasPassword((values as JSONObject)["password"])
            ? PASSWORD_FOLD_SUMMARY_PASSWORD
            : PASSWORD_FOLD_SUMMARY_EMAIL,
        ];
      },
    });
  // Whether the form just submitted held a password: read before it is sent.
  const createdWithPassword: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const [unsentSetPasswordEmail, setUnsentSetPasswordEmail] =
    useState<UnsentSetPasswordEmail | null>(null);

  type OnUserCreatedFunction = (user: User) => Promise<void>;

  const onUserCreated: OnUserCreatedFunction = async (
    user: User,
  ): Promise<void> => {
    const name: string = user.name?.toString() || "";
    const email: string = user.email?.toString() || "";

    if (createdWithPassword.current) {
      Toast.success(
        t("pages.users.createdWithPassword", { name: name || email }),
      );
      return;
    }

    if (!user.id) {
      return;
    }

    const result: SetPasswordEmailResult = await sendSetPasswordEmail(user.id);

    if (result.isSent) {
      Toast.success(
        t("pages.users.createdAndEmailed", {
          name: name || email,
          email: result.email || email,
        }),
      );
      return;
    }

    setUnsentSetPasswordEmail({
      userId: user.id,
      name: name,
      email: email,
      error: result.error,
    });
  };

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
    const actionLabel: string = isBlocked
      ? translationKey("Block")
      : translationKey("Unblock");

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
        // Each user their own update, several at once (runBulkAction).
        await runBulkAction<User>({
          actionProps: onClickProps,
          concurrency: BULK_ACTION_CONCURRENCY,
          step: async (user: User): Promise<void> => {
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
          },
        });
      },
    };
  };

  /*
   * Org-wide two factor auth enforcement, one selection at a time.
   *
   * Deliberately POSTs to the master-admin endpoint rather than writing
   * `enableTwoFactorAuth` through AdminModelAPI.updateById, even though the
   * CRUD write would succeed. The endpoint also revokes each user's sessions,
   * and a bulk "require two factor auth" that left everybody's current session
   * running would be the version of this feature that quietly does nothing for
   * the people already signed in.
   *
   * There is no bulk RESET. Clearing every selected user's authenticator in
   * one click has no undo and no partial recovery - the reset is per-user, on
   * the Authentication page, where the operator is looking at the one person
   * who lost their phone.
   */
  const getBulkSetTwoFactorAuthRequiredAction: (
    isRequired: boolean,
  ) => BulkActionButtonSchema<User> = (
    isRequired: boolean,
  ): BulkActionButtonSchema<User> => {
    return {
      title: isRequired
        ? t("pages.users.bulkRequireTwoFactorAuth")
        : t("pages.users.bulkDoNotRequireTwoFactorAuth"),
      icon: isRequired ? IconProp.ShieldCheck : IconProp.LockOpen,
      /*
       * NORMAL rather than DANGER: a DANGER style relocates the item below the
       * divider at the bottom of the bulk menu, where Delete lives.
       */
      buttonStyleType: ButtonStyleType.NORMAL,
      // "6 Users updated", not "6 Users succeeded" (BulkUserResultLabels).
      resultLabels: TWO_FACTOR_AUTH_RESULT_LABELS,
      confirmTitle: (items: Array<User>): string => {
        return isRequired
          ? t("pages.users.bulkRequireTwoFactorAuthTitle", {
              userCount: items.length,
            })
          : t("pages.users.bulkDoNotRequireTwoFactorAuthTitle", {
              userCount: items.length,
            });
      },
      confirmMessage: (items: Array<User>): string => {
        return isRequired
          ? t("pages.users.bulkRequireTwoFactorAuthDescription", {
              userCount: items.length,
            })
          : t("pages.users.bulkDoNotRequireTwoFactorAuthDescription", {
              userCount: items.length,
            });
      },
      onClick: async (
        onClickProps: BulkActionOnClickProps<User>,
      ): Promise<void> => {
        /*
         * Several users at once (runBulkAction), as Block and Unblock: each
         * request writes one user's requirement and signs that user out,
         * nothing another user's request reads. A user that fails is named
         * with why in the progress dialog, and the rest go on; Stop starts
         * no more of them.
         */
        await runBulkAction<User>({
          actionProps: onClickProps,
          concurrency: BULK_ACTION_CONCURRENCY,
          step: async (user: User): Promise<void> => {
            if (!user.id) {
              throw new BadDataException("User ID not found");
            }

            const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
              await API.post<JSONObject>({
                url: setTwoFactorAuthRequiredRoute(user.id),
                data: {
                  isRequired: isRequired,
                },
              });

            /*
             * API.post resolves an error response rather than rejecting: a
             * user the server refused is a failure, never a change.
             */
            if (response instanceof HTTPErrorResponse) {
              throw response;
            }
          },
        });
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
        // "2 Users added", not "2 Users succeeded" (BulkUserResultLabels).
        resultLabels: ADD_TO_PROJECT_RESULT_LABELS,
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
    /*
     * The shared runner opens the progress dialog, counts the users down
     * one at a time (bulkAddUsersToProject says why), names each failure
     * and ends the action whatever happens - its Close and the selection's
     * clearing wait on that.
     */
    await bulkAddUsersToProject({
      actionProps: onClickProps,
      projectId: selection.projectId,
      teamId: selection.teamId,
      hasAcceptedInvitation: selection.hasAcceptedInvitation,
    });
  };

  const getBulkDeleteAction: () => BulkActionButtonSchema<User> =
    (): BulkActionButtonSchema<User> => {
      return {
        title: "Delete",
        icon: IconProp.Trash,
        buttonStyleType: ButtonStyleType.DANGER,
        confirmButtonStyleType: ButtonStyleType.DANGER,
        confirmTitle: (items: Array<User>): string => {
          return t("pages.users.bulkDeleteTitle", {
            userCount: items.length,
          });
        },
        /*
         * What a delete does, as the server does it: a user still in a
         * project is not deleted (UserService.onBeforeDelete) - it said the
         * users would be removed from every project - and the master admin
         * confirms it's them first (#10330).
         */
        confirmMessage: (items: Array<User>): string => {
          return t("pages.users.bulkDeleteDescription", {
            userCount: items.length,
          });
        },
        /*
         * Which users, by email - what this dashboard knows a user by, and
         * unlike a name, never shared by two of them.
         */
        confirmDetails: (items: Array<User>): ReactElement => {
          return (
            <DeleteItemNames
              names={items.map((user: User) => {
                return getRecordDisplayName(user, { column: "email" });
              })}
              totalCount={items.length}
            />
          );
        },
        onClick: async (
          onClickProps: BulkActionOnClickProps<User>,
        ): Promise<void> => {
          /*
           * One user at a time (runBulkAction): deleting a user takes them out
           * of every project, and a project keeps at least one owner - a rule
           * two deletes at once would each check against the other's user.
           */
          await runBulkAction<User>({
            actionProps: onClickProps,
            concurrency: 1,
            step: async (user: User): Promise<void> => {
              if (!user.id) {
                throw new BadDataException("User ID not found");
              }

              await AdminModelAPI.deleteItem<User>({
                modelType: User,
                id: user.id,
              });
            },
          });
        },
      };
    };

  return (
    <Page
      title={t("pages.users.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
      ]}
    >
      <Fragment>
        {/*
         * A self-hosted server whose version a published security advisory
         * affects says so here before anything else. What a new server
         * still needs has a page of its own (Server setup), where /admin
         * lands while a required check is open.
         */}
        <SecurityAdvisoryNotice />
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
            description: t("pages.users.listDescription"),
          }}
          noItemsMessage={t("pages.users.emptyMessage")}
          searchableFields={["name", "email"]}
          bulkActions={{
            buttons: [
              getBulkAddToProjectAction(),
              getBulkSetTwoFactorAuthRequiredAction(true),
              getBulkSetTwoFactorAuthRequiredAction(false),
              getBulkSetBlockedAction(true),
              getBulkSetBlockedAction(false),
              getBulkDeleteAction(),
            ],
          }}
          /*
           * The create says what it did itself: who was emailed a link, or
           * that the password set is theirs to pass on (onUserCreated).
           */
          hideChangeToasts={true}
          onBeforeCreate={(
            item: User,
            _miscDataProps: JSONObject,
            formValues: JSONObject,
          ): Promise<User> => {
            createdWithPassword.current = hasPassword(
              formValues["password"] ?? item.password,
            );

            return Promise.resolve(item);
          }}
          onCreateSuccess={async (
            item: User,
            modalType?: ModalType,
          ): Promise<User> => {
            if (modalType !== ModalType.Edit) {
              await onUserCreated(item);
            }

            return item;
          }}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Full Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "John Smith",
            },
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
            /*
             * The one password rule, with its checklist, as every form that
             * sets a password asks it (#9123) - but no longer asked: the new
             * user is emailed a link to set their own (#9139). A master
             * admin who wants to set one opens More fields. No
             * confirmation: Set Password can change a mistyped one.
             */
            getNewPasswordField<User>({
              translator: translator,
              requirementsId: passwordRequirementsId,
              passwordTitle: translator.translateText("Password")!,
              // Somebody else's password: no password manager saves it as the admin's.
              isOwnPassword: false,
              isOptional: true,
              passwordField:
                canSendEmail === false
                  ? { description: PASSWORD_HELP_NO_EMAIL }
                  : { collapsibleSection: passwordSection },
            }),
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

        {unsentSetPasswordEmail && (
          <SetPasswordLinkModal
            userId={unsentSetPasswordEmail.userId}
            name={unsentSetPasswordEmail.name}
            email={unsentSetPasswordEmail.email}
            error={unsentSetPasswordEmail.error}
            onClose={() => {
              setUnsentSetPasswordEmail(null);
            }}
          />
        )}

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
               * The runner reports each user's failure and ends the action in
               * a `finally` (runBulkAction), so this only catches a throw from
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
