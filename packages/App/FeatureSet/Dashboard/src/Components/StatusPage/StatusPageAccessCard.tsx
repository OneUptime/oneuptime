import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import Route from "Common/Types/API/Route";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import Query from "Common/Types/BaseDatabase/Query";
import HashedString from "Common/Types/HashedString";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import {
  getStatusPageAccess,
  getStatusPageAccessChanges,
  getStatusPageAccessStateAfter,
  StatusPageAccess,
  StatusPageAccessState,
  STATUS_PAGE_ACCESS_CHOICES,
  STATUS_PAGE_MASTER_PASSWORD_COLUMN,
} from "Common/Types/StatusPage/StatusPageAccess";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ChoiceRows, {
  ChoiceRowOption,
} from "Common/UI/Components/ChoiceRows/ChoiceRows";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { getAllEnvVars } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import StatusPageAccessCopy, {
  ACCESS_CHOICE_COPY,
  ACCESS_CONFIRMATION_COPY,
  AccessConfirmationCopy,
  getAccessChoiceTestId,
  getNobodyCanSignInReason,
  getPlanNeededForAccess,
  getStatusPageAccessSelect,
  getStatusPageAccessState,
  isPasswordRequiredInDialog,
  NobodyCanSignInReason,
  SignInMethods,
  STATUS_PAGE_ACCESS_CARD_TEST_ID,
  STATUS_PAGE_ACCESS_GATED_COLUMNS,
  STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID,
  STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID,
  STATUS_PAGE_ACCESS_SIGN_IN_METHODS_TEST_ID,
} from "./StatusPageAccessCopy";

/*
 * "Who can see this status page", on Security -> Access: anyone with the
 * link, only people who sign in, or anyone with the password - one choice
 * (see StatusPageAccessCopy for why, and Common/Types/StatusPage/
 * StatusPageAccess for the rule the server enforces).
 *
 * - The checked choice is what the server enforces now, read from the page.
 * - Picking another asks first, in a dialog that says what changes for
 *   visitors. A move to the password asks for the password in the same
 *   dialog when the page has none, and offers to replace it when it has
 *   one. Confirming writes only the columns that change, then the choice
 *   says "Saved"; a refusal keeps the dialog open with the server's reason.
 * - Under "Only people who sign in": the sign-in methods set up for the
 *   page (private users, SSO, OIDC, whether SSO is required), each a link to
 *   its page, and, while it is the choice, a warning when nobody can sign
 *   in yet.
 * - Under "Anyone with the password", while it is the choice: Change
 *   Password.
 * - A choice the plan does not include shows the plan and cannot be picked
 *   (making a page private or public again needs Growth on OneUptime
 *   Cloud; moving between the two private choices does not). Someone who
 *   may not edit the status page sees the choices locked, with why.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

/*
 * The plan this project would need to read a model's records, or null when
 * it can (or billing is off): a sign-in method the plan does not include is
 * left out of the line, not counted as none.
 */
export const getPlanNeededToRead: (model: BaseModel) => PlanType | null = (
  model: BaseModel,
): PlanType | null => {
  const currentPlan: PlanType | null = ProjectUtil.getCurrentPlan();
  const readPlan: PlanType | null = model.getReadBillingPlan();

  if (!currentPlan || !readPlan) {
    return null;
  }

  try {
    return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
      readPlan,
      currentPlan,
      getAllEnvVars(),
    )
      ? null
      : readPlan;
  } catch {
    return null;
  }
};

/*
 * Whether the signed-in person may change who can see the page: every
 * column a choice can write must allow it. The first one that does not
 * answers, with why.
 */
export const getAccessGate: (model: StatusPage) => PermissionGateResult = (
  model: StatusPage,
): PermissionGateResult => {
  let gate: PermissionGateResult = { isAllowed: true };

  for (const column of STATUS_PAGE_ACCESS_GATED_COLUMNS) {
    gate = PermissionGate.checkColumnUpdate(model, column);

    if (!gate.isAllowed) {
      return gate;
    }
  }

  return gate;
};

// How many records match, or null when the plan or the read says no.
const countIfReadable: <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  query: Query<TBaseModel>;
}) => Promise<number | null> = async <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  query: Query<TBaseModel>;
}): Promise<number | null> => {
  if (getPlanNeededToRead(new data.modelType())) {
    return null;
  }

  try {
    return await ModelAPI.count<TBaseModel>({
      modelType: data.modelType,
      query: data.query,
    });
  } catch {
    return null;
  }
};

// What the card read.
interface LoadedPage {
  state: StatusPageAccessState;
  isSsoRequired: boolean;
}

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

const StatusPageAccessCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A fixed English sentence in the reader's language.
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const [page, setPage] = useState<LoadedPage | null>(null);
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // The choice its dialog is asking about.
  const [pending, setPending] = useState<StatusPageAccess | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  // The choice saved last, which says "Saved".
  const [saved, setSaved] = useState<StatusPageAccess | null>(null);

  // Set at once: a second press before the dialog locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  // Bumped by every read: an answer for an older one is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const statusPageIdString: string = props.statusPageId.toString();
  const model: StatusPage = new StatusPage();

  const routeTo: (pageKey: PageMap) => Route = (pageKey: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[pageKey] as Route, {
      modelId: props.statusPageId,
    });
  };

  const fetchMethods: (
    read: number,
    isSsoRequired: boolean,
  ) => Promise<void> = async (
    read: number,
    isSsoRequired: boolean,
  ): Promise<void> => {
    /*
     * SSO and OIDC are sold together (Scale on OneUptime Cloud). A plan
     * without them offers neither, so neither is asked for: none is on.
     */
    const isSsoOnPlan: boolean =
      !getPlanNeededToRead(new StatusPageSSO()) &&
      !getPlanNeededToRead(new StatusPageOIDC());

    const [privateUsers, enabledSsoProviders, enabledOidcProviders] =
      await Promise.all([
        countIfReadable<StatusPagePrivateUser>({
          modelType: StatusPagePrivateUser,
          query: { statusPageId: props.statusPageId },
        }),
        isSsoOnPlan
          ? countIfReadable<StatusPageSSO>({
              modelType: StatusPageSSO,
              query: { statusPageId: props.statusPageId, isEnabled: true },
            })
          : Promise.resolve(0),
        isSsoOnPlan
          ? countIfReadable<StatusPageOIDC>({
              modelType: StatusPageOIDC,
              query: { statusPageId: props.statusPageId, isEnabled: true },
            })
          : Promise.resolve(0),
      ]);

    if (read !== readRef.current) {
      return;
    }

    setMethods({
      privateUsers,
      enabledSsoProviders,
      enabledOidcProviders,
      isSsoRequired,
      isSsoOnPlan,
    });
  };

  const fetchPage: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setIsLoading(true);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: getStatusPageAccessSelect(),
      });

      if (read !== readRef.current) {
        return;
      }

      if (!item) {
        setPage(null);
        setError(translate(StatusPageAccessCopy.notFound));
      } else {
        const isSsoRequired: boolean = Boolean(item.requireSsoForLogin);

        setPage({
          state: getStatusPageAccessState(item),
          isSsoRequired,
        });

        void fetchMethods(read, isSsoRequired);
      }
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setPage(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    setPending(null);
    setIsChangingPassword(false);
    setSaved(null);
    setMethods(null);
    void fetchPage();
  }, [statusPageIdString]);

  /*
   * Writes a choice: only the columns that change, and the password when one
   * was entered. The dialog stays open, with why, when the server refuses.
   */
  const save: (data: {
    to: StatusPageAccess;
    password: string;
  }) => Promise<void> = async (data: {
    to: StatusPageAccess;
    password: string;
  }): Promise<void> => {
    if (!page || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError("");

    const changes: JSONObject = {
      ...getStatusPageAccessChanges({ from: page.state, to: data.to }),
    };

    if (data.password) {
      changes[STATUS_PAGE_MASTER_PASSWORD_COLUMN] = new HashedString(
        data.password,
        false,
      ).toJSON();
    }

    try {
      if (Object.keys(changes).length > 0) {
        await ModelAPI.updateById<StatusPage>({
          modelType: StatusPage,
          id: props.statusPageId,
          data: JSONFunctions.serialize(changes),
        });
      }

      setPage({
        ...page,
        state: getStatusPageAccessStateAfter({
          from: page.state,
          to: data.to,
          isPasswordEntered: Boolean(data.password),
        }),
      });
      setPending(null);
      setIsChangingPassword(false);
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
    setIsChangingPassword(false);
    setSaveError("");
  };

  const getSignInMethodsLine: (
    signInMethods: SignInMethods,
  ) => ReactElement | null = (
    signInMethods: SignInMethods,
  ): ReactElement | null => {
    const items: Array<{ key: string; text: string; to: Route }> = [];

    if (signInMethods.privateUsers !== null) {
      items.push({
        key: "private-users",
        text: translator.translatePlural(
          StatusPageAccessCopy.privateUsers,
          signInMethods.privateUsers,
        ),
        to: routeTo(PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS),
      });
    }

    if (
      signInMethods.isSsoOnPlan &&
      signInMethods.enabledSsoProviders !== null
    ) {
      items.push({
        key: "sso",
        text: translate(
          signInMethods.enabledSsoProviders > 0
            ? StatusPageAccessCopy.ssoOn
            : StatusPageAccessCopy.ssoOff,
        ),
        to: routeTo(PageMap.STATUS_PAGE_VIEW_SSO),
      });
    }

    if (
      signInMethods.isSsoOnPlan &&
      signInMethods.enabledOidcProviders !== null
    ) {
      items.push({
        key: "oidc",
        text: translate(
          signInMethods.enabledOidcProviders > 0
            ? StatusPageAccessCopy.oidcOn
            : StatusPageAccessCopy.oidcOff,
        ),
        to: routeTo(PageMap.STATUS_PAGE_VIEW_OIDC),
      });
    }

    if (signInMethods.isSsoRequired) {
      items.push({
        key: "sso-required",
        text: translate(StatusPageAccessCopy.ssoRequired),
        to: routeTo(PageMap.STATUS_PAGE_VIEW_SSO),
      });
    }

    if (items.length === 0) {
      return null;
    }

    return (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1"
        data-testid={STATUS_PAGE_ACCESS_SIGN_IN_METHODS_TEST_ID}
      >
        {items.map(
          (
            item: { key: string; text: string; to: Route },
            index: number,
          ): ReactElement => {
            return (
              <Fragment key={item.key}>
                {index > 0 ? <span aria-hidden="true">·</span> : <></>}
                <Link
                  to={item.to}
                  className="text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-gray-900"
                >
                  {item.text}
                </Link>
              </Fragment>
            );
          },
        )}
      </div>
    );
  };

  const getNobodyCanSignInWarning: (
    signInMethods: SignInMethods,
  ) => ReactElement | null = (
    signInMethods: SignInMethods,
  ): ReactElement | null => {
    const reason: NobodyCanSignInReason | null =
      getNobodyCanSignInReason(signInMethods);

    if (!reason) {
      return null;
    }

    const isSsoRequired: boolean =
      reason === NobodyCanSignInReason.SsoRequiredWithoutProvider;

    return (
      <div
        className="mt-2 flex items-start gap-2 text-amber-700"
        data-testid={STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID}
      >
        <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <TranslatedSentence
            template={
              isSsoRequired
                ? StatusPageAccessCopy.nobodyCanSignInSsoRequired
                : StatusPageAccessCopy.nobodyCanSignIn
            }
            slots={{
              link: (
                <Link
                  to={routeTo(
                    isSsoRequired
                      ? PageMap.STATUS_PAGE_VIEW_SSO
                      : PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS,
                  )}
                  className="font-medium underline underline-offset-2"
                >
                  {translate(
                    isSsoRequired
                      ? StatusPageAccessCopy.setUpSso
                      : StatusPageAccessCopy.addPrivateUsers,
                  )}
                </Link>
              ),
            }}
          />
        </div>
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !page) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchPage();
          }}
        />
      );
    }

    const current: StatusPageAccess = getStatusPageAccess(page.state);

    /*
     * Locked for someone who may not change every column a choice can
     * write (the record's update permission, then each column's own, as the
     * server checks them).
     */
    const gate: PermissionGateResult = getAccessGate(model);

    const options: Array<ChoiceRowOption<StatusPageAccess>> =
      STATUS_PAGE_ACCESS_CHOICES.map(
        (access: StatusPageAccess): ChoiceRowOption<StatusPageAccess> => {
          const isCurrent: boolean = access === current;

          const planNeeded: PlanType | null = isCurrent
            ? null
            : getPlanNeededForAccess({
                from: page.state,
                to: access,
                getPlanNeeded: (column: string): PlanType | null => {
                  return getPlanNeededToChangeColumn(model, column);
                },
              });

          let details: ReactNode = undefined;

          if (access === StatusPageAccess.SignIn && methods) {
            const line: ReactElement | null = getSignInMethodsLine(methods);
            const warning: ReactElement | null = isCurrent
              ? getNobodyCanSignInWarning(methods)
              : null;

            details =
              line || warning ? (
                <>
                  {line}
                  {warning}
                </>
              ) : undefined;
          }

          if (access === StatusPageAccess.Password && isCurrent) {
            details = (
              <div className="[&_button]:ml-0 [&_button]:md:ml-0">
                <Button
                  title={StatusPageAccessCopy.changePassword}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  icon={IconProp.Lock}
                  disabled={!gate.isAllowed || isSaving}
                  tooltip={gate.disabledReason}
                  dataTestId={STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID}
                  onClick={() => {
                    setSaveError("");
                    setIsChangingPassword(true);
                  }}
                />
              </div>
            );
          }

          return {
            value: access,
            title: ACCESS_CHOICE_COPY[access].title,
            description: ACCESS_CHOICE_COPY[access].description,
            planNeeded,
            details,
            dataTestId: getAccessChoiceTestId(access),
          };
        },
      );

    return (
      /*
       * Full-bleed rows, ruled like the card's own header rule, as on the
       * "What your status page shows" card.
       */
      <div className="-mx-5 -mb-6 border-t border-gray-200 md:-mx-6">
        <ChoiceRows<StatusPageAccess>
          value={pending || current}
          options={options}
          onPick={(access: StatusPageAccess) => {
            setSaveError("");
            setSaved(null);
            setPending(access);
          }}
          isLocked={Boolean(pending) || isChangingPassword || isSaving}
          lockedReason={gate.isAllowed ? undefined : gate.disabledReason}
          status={
            saved === current && !pending ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Icon icon={IconProp.Check} className="h-4 w-4" />
                {translate("Saved")}
              </span>
            ) : undefined
          }
          ariaLabel={StatusPageAccessCopy.cardTitle}
          dataTestId={`${STATUS_PAGE_ACCESS_CARD_TEST_ID}-choices`}
        />
      </div>
    );
  };

  const getDialog: () => ReactElement | null = (): ReactElement | null => {
    if (!page) {
      return null;
    }

    if (isChangingPassword) {
      return (
        <BasicFormModal<PasswordFormData>
          title={StatusPageAccessCopy.changePassword}
          description={StatusPageAccessCopy.changePasswordDescription}
          submitButtonText={StatusPageAccessCopy.changePassword}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={closeDialog}
          onSubmit={(values: PasswordFormData) => {
            void save({
              to: StatusPageAccess.Password,
              password: getEnteredPassword(values.password),
            });
          }}
          formProps={{
            name: "Status Page > Access > Change Password",
            fields: [
              {
                field: { password: true },
                title: StatusPageAccessCopy.newPasswordFieldTitle,
                fieldType: FormFieldSchemaType.Password,
                required: true,
                placeholder: StatusPageAccessCopy.passwordPlaceholder,
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

    const copy: AccessConfirmationCopy = ACCESS_CONFIRMATION_COPY[pending];
    const from: StatusPageAccess = getStatusPageAccess(page.state);

    if (pending === StatusPageAccess.Password) {
      const isPasswordRequired: boolean = isPasswordRequiredInDialog({
        from: page.state,
        to: pending,
      });

      const sentences: Array<string> = [copy.description];

      if (from === StatusPageAccess.SignIn) {
        sentences.push(StatusPageAccessCopy.confirmPrivateUsersUsePassword);
      }

      return (
        <BasicFormModal<PasswordFormData>
          title={copy.title}
          description={sentences
            .map((sentence: string): string => {
              return translate(sentence);
            })
            .join(" ")}
          submitButtonText={copy.submitButtonText}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={closeDialog}
          onSubmit={(values: PasswordFormData) => {
            void save({
              to: StatusPageAccess.Password,
              password: getEnteredPassword(values.password),
            });
          }}
          formProps={{
            name: "Status Page > Access > Require Password",
            fields: [
              {
                field: { password: true },
                title: isPasswordRequired
                  ? StatusPageAccessCopy.passwordFieldTitle
                  : StatusPageAccessCopy.newPasswordFieldTitle,
                ...(isPasswordRequired
                  ? {}
                  : {
                      description: StatusPageAccessCopy.keepPasswordDescription,
                    }),
                fieldType: FormFieldSchemaType.Password,
                required: isPasswordRequired,
                placeholder: StatusPageAccessCopy.passwordPlaceholder,
                disableSpellCheck: true,
              },
            ],
          }}
        />
      );
    }

    const isNobodyLetIn: boolean = Boolean(
      pending === StatusPageAccess.SignIn &&
        methods &&
        getNobodyCanSignInReason(methods),
    );

    return (
      <ConfirmModal
        title={copy.title}
        description={
          <div className="space-y-2">
            <p>{translate(copy.description)}</p>
            {isNobodyLetIn ? (
              <p
                className="text-amber-700"
                data-testid={`${STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID}-confirm`}
              >
                {translate(StatusPageAccessCopy.confirmNobodyCanSignIn)}
              </p>
            ) : (
              <></>
            )}
          </div>
        }
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
        title={StatusPageAccessCopy.cardTitle}
        description={StatusPageAccessCopy.cardDescription}
      >
        <div data-testid={STATUS_PAGE_ACCESS_CARD_TEST_ID}>{getBody()}</div>
      </Card>
      {getDialog()}
    </>
  );
};

export default StatusPageAccessCard;
