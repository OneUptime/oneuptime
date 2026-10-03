import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import URL from "Common/Types/API/URL";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  DASHBOARD_ACCESS_CHOICES,
  DASHBOARD_MASTER_PASSWORD_COLUMN,
  DashboardAccess,
  DashboardAccessState,
  getDashboardAccess,
  getDashboardAccessChanges,
  getDashboardAccessStateAfter,
  isDashboardLockedWithoutPassword,
} from "Common/Types/Dashboard/DashboardAccess";
import HashedString from "Common/Types/HashedString";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ChoiceRows, {
  ChoiceRowOption,
} from "Common/UI/Components/ChoiceRows/ChoiceRows";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardSharingCopy, {
  DASHBOARD_ACCESS_CHOICE_COPY,
  DASHBOARD_ACCESS_GATED_COLUMNS,
  DASHBOARD_PUBLIC_LINK_TEST_ID,
  DASHBOARD_SHARING_CARD_TEST_ID,
  DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID,
  DASHBOARD_SHARING_LOCKED_TEST_ID,
  DASHBOARD_SHARING_SET_PASSWORD_TEST_ID,
  DashboardAccessConfirmationCopy,
  getDashboardAccessChoiceTestId,
  getDashboardAccessConfirmationCopy,
  getDashboardAccessSelect,
  getDashboardAccessState,
  getPlanNeededForDashboardAccess,
  getPublicDashboardUrl,
  isDashboardPasswordRequiredInDialog,
} from "./DashboardSharingCopy";

/*
 * "Who can view this dashboard", on a dashboard's Sharing page: only people
 * in this project, anyone with the link, or anyone with the link and a
 * password - one choice (see DashboardSharingCopy for why, and
 * Common/Types/Dashboard/DashboardAccess for the rule the server enforces).
 *
 * - The checked choice is what the server enforces now, read from the
 *   dashboard.
 * - Picking another asks first, in a dialog that says what changes for
 *   visitors. A move to the password asks for the password in the same
 *   dialog when the dashboard has none, and offers to replace it when it
 *   has one. Confirming writes only the columns that change, then the
 *   choice says "Saved"; a refusal keeps the dialog open with the server's
 *   reason.
 * - Under the public choice in force: the public link, which opens in a new
 *   tab, and a button that copies it.
 * - Under "Anyone with the link and a password", while it is the choice:
 *   Change Password - or, on a dashboard that asks for a password it does
 *   not have (the server lets nobody in then), why nobody can open it and
 *   Set Password.
 * - A choice the plan does not include shows the plan and cannot be picked
 *   (sharing a dashboard, or stopping, needs Growth on OneUptime Cloud;
 *   moving between the two public choices does not). Someone who may not
 *   edit the dashboard sees the choices locked, with why - and can still
 *   copy the link.
 */

export interface ComponentProps {
  dashboardId: ObjectID;
}

/*
 * Whether the signed-in person may change who can view the dashboard: every
 * column a choice can write must allow it. The first one that does not
 * answers, with why.
 */
export const getDashboardSharingGate: (
  model: Dashboard,
) => PermissionGateResult = (model: Dashboard): PermissionGateResult => {
  let gate: PermissionGateResult = { isAllowed: true };

  for (const column of DASHBOARD_ACCESS_GATED_COLUMNS) {
    gate = PermissionGate.checkColumnUpdate(model, column);

    if (!gate.isAllowed) {
      return gate;
    }
  }

  return gate;
};

// The password a form handed back: BasicForm wraps a password in a HashedString.
const getEnteredPassword: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value instanceof HashedString) {
    return value.toString();
  }

  return typeof value === "string" ? value : "";
};

interface PasswordFormData {
  password: string | HashedString;
}

// The password dialog opened from under the password choice.
enum PasswordDialog {
  // The dashboard asks for a password it does not have.
  Set = "Set",
  // It has one.
  Change = "Change",
}

const DashboardSharingCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A fixed English sentence in the reader's language.
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const [state, setState] = useState<DashboardAccessState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // The choice its dialog is asking about.
  const [pending, setPending] = useState<DashboardAccess | null>(null);
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialog | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  // The choice saved last, which says "Saved".
  const [saved, setSaved] = useState<DashboardAccess | null>(null);

  // Set at once: a second press before the dialog locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  // Bumped by every read: an answer for an older one is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const dashboardIdString: string = props.dashboardId.toString();
  const model: Dashboard = new Dashboard();

  const fetchDashboard: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setIsLoading(true);
    setError("");

    try {
      const item: Dashboard | null = await ModelAPI.getItem<Dashboard>({
        modelType: Dashboard,
        id: props.dashboardId,
        select: getDashboardAccessSelect(),
      });

      if (read !== readRef.current) {
        return;
      }

      if (!item) {
        setState(null);
        setError(translate(DashboardSharingCopy.notFound));
      } else {
        setState(getDashboardAccessState(item));
      }
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setState(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    setPending(null);
    setPasswordDialog(null);
    setSaved(null);
    void fetchDashboard();
  }, [dashboardIdString]);

  /*
   * Writes a choice: only the columns that change, and the password when one
   * was entered. The dialog stays open, with why, when the server refuses.
   */
  const save: (data: {
    to: DashboardAccess;
    password: string;
  }) => Promise<void> = async (data: {
    to: DashboardAccess;
    password: string;
  }): Promise<void> => {
    if (!state || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError("");

    const changes: JSONObject = {
      ...getDashboardAccessChanges({ from: state, to: data.to }),
    };

    if (data.password) {
      changes[DASHBOARD_MASTER_PASSWORD_COLUMN] = new HashedString(
        data.password,
        false,
      ).toJSON();
    }

    try {
      if (Object.keys(changes).length > 0) {
        await ModelAPI.updateById<Dashboard>({
          modelType: Dashboard,
          id: props.dashboardId,
          data: JSONFunctions.serialize(changes),
        });
      }

      setState(
        getDashboardAccessStateAfter({
          from: state,
          to: data.to,
          isPasswordEntered: Boolean(data.password),
        }),
      );
      setPending(null);
      setPasswordDialog(null);
      setSaved(data.to);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    isSavingRef.current = false;
    setIsSaving(false);
  };

  const closeDialog: () => void = (): void => {
    if (isSavingRef.current) {
      return;
    }

    setPending(null);
    setPasswordDialog(null);
    setSaveError("");
  };

  // The public link, which opens in a new tab, and a button that copies it.
  const getPublicLink: () => ReactElement = (): ReactElement => {
    const url: URL = getPublicDashboardUrl(props.dashboardId);

    return (
      <div className="space-y-1" data-testid={DASHBOARD_PUBLIC_LINK_TEST_ID}>
        <div className="text-xs font-medium text-gray-700">
          {translate(DashboardSharingCopy.publicLinkTitle)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={url}
            openInNewTab={true}
            className="min-w-0 break-all font-mono text-sm text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-800"
          >
            {url.toString()}
          </Link>
          <CopyTextButton
            textToBeCopied={url.toString()}
            label={DashboardSharingCopy.copyLink}
            copiedLabel={translate(DashboardSharingCopy.copied)}
            title={DashboardSharingCopy.copyLinkTitle}
            size="sm"
            variant="soft"
          />
        </div>
      </div>
    );
  };

  // Under the password choice, while it is the choice.
  const getPasswordDetails: (data: {
    gate: PermissionGateResult;
    isLocked: boolean;
  }) => ReactElement = (data: {
    gate: PermissionGateResult;
    isLocked: boolean;
  }): ReactElement => {
    const isDisabled: boolean = !data.gate.isAllowed || isSaving;

    if (data.isLocked) {
      return (
        <div className="space-y-2">
          <div
            className="flex items-start gap-2 text-amber-700"
            data-testid={DASHBOARD_SHARING_LOCKED_TEST_ID}
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0"
            />
            <p>{translate(DashboardSharingCopy.lockedWithoutPassword)}</p>
          </div>
          <div className="[&_button]:ml-0 [&_button]:md:ml-0">
            <Button
              title={DashboardSharingCopy.setPassword}
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              icon={IconProp.Lock}
              disabled={isDisabled}
              tooltip={data.gate.disabledReason}
              dataTestId={DASHBOARD_SHARING_SET_PASSWORD_TEST_ID}
              onClick={() => {
                setSaveError("");
                setSaved(null);
                setPasswordDialog(PasswordDialog.Set);
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="[&_button]:ml-0 [&_button]:md:ml-0">
        <Button
          title={DashboardSharingCopy.changePassword}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Lock}
          disabled={isDisabled}
          tooltip={data.gate.disabledReason}
          dataTestId={DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID}
          onClick={() => {
            setSaveError("");
            setSaved(null);
            setPasswordDialog(PasswordDialog.Change);
          }}
        />
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !state) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchDashboard();
          }}
        />
      );
    }

    const current: DashboardAccess = getDashboardAccess(state);

    /*
     * Locked for someone who may not change every column a choice can
     * write (the record's update permission, then each column's own, as the
     * server checks them).
     */
    const gate: PermissionGateResult = getDashboardSharingGate(model);

    const options: Array<ChoiceRowOption<DashboardAccess>> =
      DASHBOARD_ACCESS_CHOICES.map(
        (access: DashboardAccess): ChoiceRowOption<DashboardAccess> => {
          const isCurrent: boolean = access === current;

          const planNeeded: PlanType | null = isCurrent
            ? null
            : getPlanNeededForDashboardAccess({
                from: state,
                to: access,
                getPlanNeeded: (column: string): PlanType | null => {
                  return getPlanNeededToChangeColumn(model, column);
                },
              });

          let details: ReactNode = undefined;

          if (isCurrent && access !== DashboardAccess.ProjectOnly) {
            details = (
              <div className="space-y-3">
                {getPublicLink()}
                {access === DashboardAccess.AnyoneWithPassword ? (
                  getPasswordDetails({
                    gate,
                    isLocked: isDashboardLockedWithoutPassword(state),
                  })
                ) : (
                  <></>
                )}
              </div>
            );
          }

          return {
            value: access,
            title: DASHBOARD_ACCESS_CHOICE_COPY[access].title,
            description: DASHBOARD_ACCESS_CHOICE_COPY[access].description,
            planNeeded,
            details,
            dataTestId: getDashboardAccessChoiceTestId(access),
          };
        },
      );

    return (
      /*
       * Full-bleed rows, ruled like the card's own header rule, as on a
       * status page's "Who can see this status page" card.
       */
      <div className="-mx-5 -mb-6 border-t border-gray-200 md:-mx-6">
        <ChoiceRows<DashboardAccess>
          value={pending || current}
          options={options}
          onPick={(access: DashboardAccess) => {
            setSaveError("");
            setSaved(null);
            setPending(access);
          }}
          isLocked={Boolean(pending) || Boolean(passwordDialog) || isSaving}
          lockedReason={gate.isAllowed ? undefined : gate.disabledReason}
          status={
            saved === current && !pending && !passwordDialog ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Icon icon={IconProp.Check} className="h-4 w-4" />
                {translate("Saved")}
              </span>
            ) : undefined
          }
          ariaLabel={DashboardSharingCopy.cardTitle}
          dataTestId={`${DASHBOARD_SHARING_CARD_TEST_ID}-choices`}
        />
      </div>
    );
  };

  const getDialog: () => ReactElement | null = (): ReactElement | null => {
    if (!state) {
      return null;
    }

    if (passwordDialog) {
      const isSetting: boolean = passwordDialog === PasswordDialog.Set;

      return (
        <BasicFormModal<PasswordFormData>
          title={
            isSetting
              ? DashboardSharingCopy.setPassword
              : DashboardSharingCopy.changePassword
          }
          description={
            isSetting
              ? DashboardSharingCopy.setPasswordDescription
              : DashboardSharingCopy.changePasswordDescription
          }
          submitButtonText={
            isSetting
              ? DashboardSharingCopy.setPassword
              : DashboardSharingCopy.changePassword
          }
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={closeDialog}
          onSubmit={(values: PasswordFormData) => {
            void save({
              to: DashboardAccess.AnyoneWithPassword,
              password: getEnteredPassword(values.password),
            });
          }}
          formProps={{
            name: isSetting
              ? "Dashboard > Sharing > Set Password"
              : "Dashboard > Sharing > Change Password",
            fields: [
              {
                field: { password: true },
                title: isSetting
                  ? DashboardSharingCopy.passwordFieldTitle
                  : DashboardSharingCopy.newPasswordFieldTitle,
                fieldType: FormFieldSchemaType.Password,
                required: true,
                placeholder: DashboardSharingCopy.passwordPlaceholder,
                disableSpellCheck: true,
              },
            ],
          }}
        />
      );
    }

    if (!pending) {
      return null;
    }

    const copy: DashboardAccessConfirmationCopy =
      getDashboardAccessConfirmationCopy({
        from: getDashboardAccess(state),
        to: pending,
      });

    if (pending === DashboardAccess.AnyoneWithPassword) {
      const isPasswordRequired: boolean = isDashboardPasswordRequiredInDialog({
        from: state,
        to: pending,
      });

      return (
        <BasicFormModal<PasswordFormData>
          title={copy.title}
          description={copy.description}
          submitButtonText={copy.submitButtonText}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={closeDialog}
          onSubmit={(values: PasswordFormData) => {
            void save({
              to: DashboardAccess.AnyoneWithPassword,
              password: getEnteredPassword(values.password),
            });
          }}
          formProps={{
            name: "Dashboard > Sharing > Require Password",
            fields: [
              {
                field: { password: true },
                title: isPasswordRequired
                  ? DashboardSharingCopy.passwordFieldTitle
                  : DashboardSharingCopy.newPasswordFieldTitle,
                ...(isPasswordRequired
                  ? {}
                  : {
                      description: DashboardSharingCopy.keepPasswordDescription,
                    }),
                fieldType: FormFieldSchemaType.Password,
                required: isPasswordRequired,
                placeholder: DashboardSharingCopy.passwordPlaceholder,
                disableSpellCheck: true,
              },
            ],
          }}
        />
      );
    }

    return (
      <ConfirmModal
        title={copy.title}
        description={copy.description}
        submitButtonText={copy.submitButtonText}
        submitButtonType={ButtonStyleType.PRIMARY}
        isLoading={isSaving}
        error={saveError || undefined}
        onClose={closeDialog}
        onSubmit={() => {
          void save({ to: pending, password: "" });
        }}
      />
    );
  };

  return (
    <>
      <Card
        title={DashboardSharingCopy.cardTitle}
        description={DashboardSharingCopy.cardDescription}
      >
        <div data-testid={DASHBOARD_SHARING_CARD_TEST_ID}>{getBody()}</div>
      </Card>
      {getDialog()}
    </>
  );
};

export default DashboardSharingCard;
