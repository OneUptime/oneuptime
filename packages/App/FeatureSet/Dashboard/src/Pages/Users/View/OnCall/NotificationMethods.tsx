import UserCall from "../../../../Components/NotificationMethods/Call";
import UserEmailMethods from "../../../../Components/NotificationMethods/Email";
import UserPush from "../../../../Components/NotificationMethods/Push";
import UserSMS from "../../../../Components/NotificationMethods/SMS";
import UserTelegram from "../../../../Components/NotificationMethods/Telegram";
import UserSlackMethods from "../../../../Components/NotificationMethods/Slack";
import UserMicrosoftTeamsMethods from "../../../../Components/NotificationMethods/MicrosoftTeams";
import UserWebhook from "../../../../Components/NotificationMethods/Webhook";
import UserWhatsApp from "../../../../Components/NotificationMethods/WhatsApp";
import PageComponentProps from "../../../PageComponentProps";
import { UserOnCallContextValue, useUserOnCallContext } from "./Context";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Users > View > Notification Methods — where a project owner or admin can set
 * up the devices and addresses another member's pages are delivered to.
 *
 * WHAT CHANGED, AND WHY THE OLD ANSWER WAS NOT ENOUGH. The previous version of
 * this section showed an administrator a read-only, masked list and offered
 * them a prefilled "please add one yourself" email. That was the right call for
 * what the server could do at the time: the seven method models are scoped to
 * the person who owns the device, an attempt to widen them leaked every raw
 * column behind them, and the reasoning is preserved in full at the top of
 * UserEmail.ts. But it left the most common broken responder — a new joiner
 * with no method at all — fixable only by that person, and the whole point of
 * an on-call lead being able to see the gap is being able to close it.
 *
 * The models are STILL owner-scoped. Nothing on this page reads or writes one.
 * What it talks to instead is a narrow server-side capability
 * (UserNotificationMethodAdminService, behind
 * /user-notification-method-admin/...) that does the work as root, hands back
 * masked identifiers, and cannot be talked into returning a raw value because
 * there is no raw field on its contract to populate.
 *
 * THE PROPERTY THAT MAKES THIS SAFE TO SHIP, stated where somebody changing
 * this page will read it: AN ADMINISTRATOR CAN ADD A METHOD BUT CANNOT MAKE IT
 * LIVE. The row is written unverified, the verification code goes to the
 * address or device itself, and every verify endpoint compares the row's owner
 * against the SIGNED-IN caller and refuses anybody else. So an admin who types
 * their own number in has created a row that will never verify, will never be
 * selected by the fallback, appears on the owner's own settings page as an
 * unverified method they did not add, and has already caused the owner to be
 * emailed about it. If you are here to add a "verify on the user's behalf"
 * button, that button is the vulnerability this design exists to avoid.
 *
 * WHY FOUR CHANNELS AND NOT NINE. Push is a device token minted by a browser
 * or phone at registration — there is nothing to type. Telegram needs the
 * account holder to message the bot before a chat id exists. Slack and
 * Microsoft Teams are pointers at the owner's own OAuth workspace link, which
 * only the owner can establish. Webhook has no verification concept at all, so
 * an admin-created one would be live immediately, which is exactly the silent
 * redirect the rest of this design rules out. All five are still LISTED and
 * still removable, because a stale device on somebody's leaving-day is a real
 * administrative job.
 *
 * THE SELF CASE IS A DIFFERENT PAGE. A person looking at their own row gets the
 * ordinary self-serve method components — unmasked, with the verification flows
 * — because those are their own rows and the masked admin view would be a
 * strictly worse version of the settings page they already have.
 */

const CHANNEL_ICONS: Dictionary<IconProp> = {
  Email: IconProp.Email,
  SMS: IconProp.SMS,
  Call: IconProp.Call,
  Push: IconProp.Bell,
  WhatsApp: IconProp.WhatsApp,
  Telegram: IconProp.Telegram,
  Webhook: IconProp.Webhook,
};

/*
 * The four channels the Add form offers, mirroring AdminAddableChannel on the
 * server. The server refuses anything else outright, so this list is a
 * convenience — but the two are kept in the same order and with the same names
 * so a channel added there and forgotten here is visible as a missing option
 * rather than as a silently refused submit.
 */
enum AdminAddableChannel {
  Email = "Email",
  SMS = "SMS",
  Call = "Call",
  WhatsApp = "WhatsApp",
}

const ADDABLE_CHANNELS: Array<DropdownOption> = [
  { value: AdminAddableChannel.Email, label: "Email" },
  { value: AdminAddableChannel.SMS, label: "SMS" },
  { value: AdminAddableChannel.Call, label: "Phone call" },
  { value: AdminAddableChannel.WhatsApp, label: "WhatsApp" },
];

interface AdminMethodWire {
  methodId: string;
  methodType: string;
  maskedIdentifier: string;
  isVerified: boolean;
  isAdminAddable: boolean;
}

interface DeletionPreviewWire {
  rulesDeletedCount: number;
  coverageLostCount: number;
  verifiedMethodCountAfterDeletion: number;
  reachability: string;
  isFallbackEnabled: boolean;
  isTruncated: boolean;
}

/*
 * Parsed field by field rather than cast, so a server that grows a field does
 * not start rendering it here by accident. That is not hypothetical caution:
 * the one thing this page must never display is an unmasked identifier, and a
 * blanket cast is how an `email` or `phone` key added upstream would end up in
 * the DOM.
 */
const parseMethod: (value: JSONObject) => AdminMethodWire | null = (
  value: JSONObject,
): AdminMethodWire | null => {
  const methodId: unknown = value["methodId"];
  const methodType: unknown = value["methodType"];

  if (typeof methodId !== "string" || typeof methodType !== "string") {
    return null;
  }

  return {
    methodId: methodId,
    methodType: methodType,
    maskedIdentifier:
      typeof value["maskedIdentifier"] === "string"
        ? (value["maskedIdentifier"] as string)
        : "",
    isVerified: Boolean(value["isVerified"]),
    isAdminAddable: Boolean(value["isAdminAddable"]),
  };
};

/*
 * Parsed rather than cast, for the same reason parseMethod is — and with more
 * riding on it, because this feeds the last thing an administrator reads before
 * a cascade. Cast, a 200 that is not an impact at all renders as "undefined
 * notification rules will be deleted", and, worse, quietly answers the question
 * that matters most: `undefined === 0` is false, so the sentence saying nothing
 * will be able to page this person afterwards simply does not appear.
 *
 * Missing counts therefore mean NO preview rather than an empty one. The
 * confirmation falls back to the general warning underneath, which is true
 * whether or not the numbers arrived.
 */
const parseDeletionPreview: (
  value: JSONObject,
) => DeletionPreviewWire | null = (
  value: JSONObject,
): DeletionPreviewWire | null => {
  const rulesDeletedCount: unknown = value["rulesDeletedCount"];
  const coverageLostCount: unknown = value["coverageLostCount"];
  const verifiedMethodCountAfterDeletion: unknown =
    value["verifiedMethodCountAfterDeletion"];

  if (
    typeof rulesDeletedCount !== "number" ||
    typeof coverageLostCount !== "number" ||
    typeof verifiedMethodCountAfterDeletion !== "number"
  ) {
    return null;
  }

  return {
    rulesDeletedCount: rulesDeletedCount,
    coverageLostCount: coverageLostCount,
    verifiedMethodCountAfterDeletion: verifiedMethodCountAfterDeletion,
    reachability:
      typeof value["reachability"] === "string"
        ? (value["reachability"] as string)
        : "",
    isFallbackEnabled: Boolean(value["isFallbackEnabled"]),
    isTruncated: Boolean(value["isTruncated"]),
  };
};

interface AddMethodFormValues {
  methodType?: string | undefined;
  value?: string | undefined;
}

const UserViewNotificationMethods: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const context: UserOnCallContextValue = useUserOnCallContext();

  const { userId, firstName, displayName, isSelf, canManageMethods } = context;

  const [methods, setMethods] = useState<Array<AdminMethodWire>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [methodToDelete, setMethodToDelete] = useState<AdminMethodWire | null>(
    null,
  );
  const [deletionPreview, setDeletionPreview] =
    useState<DeletionPreviewWire | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  const [resendMethod, setResendMethod] = useState<AdminMethodWire | null>(
    null,
  );
  const [resendError, setResendError] = useState<string>("");
  const [showResentConfirmation, setShowResentConfirmation] =
    useState<boolean>(false);

  const baseRoute: string = `/user-notification-method-admin/user/${userId.toString()}`;

  const loadMethods: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(baseRoute),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const rows: JSONArray = (response.data["methods"] as JSONArray) || [];

      const parsed: Array<AdminMethodWire> = [];

      for (const row of rows) {
        const method: AdminMethodWire | null = parseMethod(row as JSONObject);

        if (method) {
          parsed.push(method);
        }
      }

      setMethods(parsed);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      /*
       * Cleared rather than left standing. A stale list under a fresh error is
       * how somebody removes a method that is no longer there, or concludes a
       * method they just added did not save.
       */
      setMethods([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isSelf) {
      /*
       * The self view renders the ordinary settings components, which do their
       * own reads. Fetching the masked list as well would be a second request
       * for a list this page is not going to draw.
       */
      setIsLoading(false);
      return;
    }

    loadMethods().catch(() => {
      // loadMethods routes every failure into the error state.
    });
  }, []);

  /*
   * A person looking at their OWN row gets the full self-serve surface: their
   * own addresses unmasked, the verification flows, and the delete guard that
   * names the rules a removal would take with it. Handing them the masked admin
   * list instead would be a strictly worse version of a page they already have.
   */
  if (isSelf) {
    return (
      <Fragment>
        <Tabs
          tabs={[
            {
              name: "Direct Contact",
              children: (
                <div className="space-y-4">
                  <UserEmailMethods />
                  <UserSMS />
                  <UserCall />
                  <UserWhatsApp />
                  <UserTelegram />
                </div>
              ),
            },
            {
              name: "Workspace Apps",
              children: (
                <div className="space-y-4">
                  <UserSlackMethods />
                  <UserMicrosoftTeamsMethods />
                </div>
              ),
            },
            {
              name: "Push Notifications",
              children: <UserPush />,
            },
            {
              name: "Webhooks",
              children: <UserWebhook />,
            },
          ]}
          onTabChange={() => {}}
        />
      </Fragment>
    );
  }

  const addMethod: (values: AddMethodFormValues) => Promise<void> = async (
    values: AddMethodFormValues,
  ): Promise<void> => {
    setIsSaving(true);
    setAddError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(baseRoute),
          data: {
            methodType: values.methodType || "",
            value: values.value || "",
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setShowAddModal(false);
      await loadMethods();

      /*
       * The readiness tiles on the section's other page count verified methods,
       * and the one just added is not verified — but "1 unverified" is exactly
       * the state the admin needs to see, and a cached summary would show
       * neither. `refresh` skips the service's 60s cache for the same reason
       * the Recheck button does.
       */
      context.reloadReadiness(true).catch(() => {
        // The readiness surface owns its own error state.
      });
    } catch (err) {
      setAddError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const loadDeletionPreview: (
    method: AdminMethodWire,
  ) => Promise<void> = async (method: AdminMethodWire): Promise<void> => {
    setIsLoadingPreview(true);
    setDeletionPreview(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `${baseRoute}/${method.methodType}/${method.methodId}/deletion-impact`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setDeletionPreview(parseDeletionPreview(response.data));
    } catch {
      /*
       * A preview that cannot be loaded does not block the removal, and it does
       * not raise an error either. The confirmation falls back to the general
       * warning below, which is true whether or not the numbers arrived — and
       * refusing to let an admin remove a dead device because a count failed to
       * load would be the worse failure.
       */
      setDeletionPreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const deleteMethod: () => Promise<void> = async (): Promise<void> => {
    if (!methodToDelete) {
      return;
    }

    setIsSaving(true);
    setDeleteError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.delete<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `${baseRoute}/${methodToDelete.methodType}/${methodToDelete.methodId}`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setMethodToDelete(null);
      setDeletionPreview(null);
      await loadMethods();

      context.reloadReadiness(true).catch(() => {
        // The readiness surface owns its own error state.
      });
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const resendVerificationCode: () => Promise<void> =
    async (): Promise<void> => {
      if (!resendMethod) {
        return;
      }

      setIsSaving(true);
      setResendError("");

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `${baseRoute}/${resendMethod.methodType}/${resendMethod.methodId}/resend-verification-code`,
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setResendMethod(null);
        setShowResentConfirmation(true);
      } catch (err) {
        setResendError(API.getFriendlyMessage(err));
      } finally {
        setIsSaving(false);
      }
    };

  const getMethodsBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="space-y-2" data-testid="methods-loading">
          {[0, 1].map((index: number): ReactElement => {
            return (
              <div
                key={`method-skeleton-${index}`}
                className="h-10 w-full animate-pulse rounded bg-gray-100"
              />
            );
          })}
        </div>
      );
    }

    if (error) {
      /*
       * An error is never rendered as an empty list. "No methods" is the single
       * most alarming thing this page can say about somebody, and saying it
       * because a request failed would send an admin off to configure an
       * account that is perfectly well set up.
       */
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            loadMethods().catch(() => {
              // loadMethods routes every failure into the error state.
            });
          }}
        />
      );
    }

    if (methods.length === 0) {
      return (
        <div
          className="rounded-xl border border-dashed border-red-200 bg-red-50/50 p-5"
          data-testid="no-methods-empty-state"
        >
          <p className="text-sm leading-relaxed text-gray-700">
            <span className="font-semibold text-gray-900">
              {displayName || "This user"}
            </span>{" "}
            has no notification methods at all, so every page routed to them is
            dropped no matter what their notification rules say.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            {canManageMethods
              ? `Add one for ${firstName} and a verification code goes to that address or device. Only ${firstName} can enter it, so the method stays inactive until they do.`
              : `Ask a project owner or admin for the "Manage User Notification Methods" permission, or send ${firstName} the setup link.`}
          </p>
        </div>
      );
    }

    return (
      <ul className="space-y-2" data-testid="admin-notification-method-list">
        {methods.map((method: AdminMethodWire): ReactElement => {
          return (
            <li
              key={method.methodId}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <Icon
                icon={CHANNEL_ICONS[method.methodType] || IconProp.Bell}
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
              />
              <span className="font-medium text-gray-900">
                {method.methodType}
              </span>
              <span className="text-gray-500">{method.maskedIdentifier}</span>

              {method.isVerified ? (
                <span className="ml-auto inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  Verified
                </span>
              ) : (
                <span className="ml-auto inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                  Waiting for {firstName} to verify
                </span>
              )}

              {canManageMethods &&
              !method.isVerified &&
              method.isAdminAddable ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                  onClick={() => {
                    setResendError("");
                    setResendMethod(method);
                  }}
                >
                  <Icon icon={IconProp.Email} className="h-3 w-3" />
                  Resend code
                </button>
              ) : (
                <></>
              )}

              {canManageMethods ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50"
                  onClick={() => {
                    setDeleteError("");
                    setMethodToDelete(method);
                    loadDeletionPreview(method).catch(() => {
                      // The preview is best-effort; see loadDeletionPreview.
                    });
                  }}
                >
                  <Icon icon={IconProp.Trash} className="h-3 w-3" />
                  Remove
                </button>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const getDeletionDescription: () => ReactElement = (): ReactElement => {
    return (
      <div className="space-y-2 text-sm text-gray-600">
        <p>
          This removes the {methodToDelete?.methodType} method{" "}
          <span className="font-medium text-gray-900">
            {methodToDelete?.maskedIdentifier}
          </span>{" "}
          from {displayName || "this user"}&apos;s account, and every
          notification rule that points at it goes with it.
        </p>

        {isLoadingPreview ? (
          <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
        ) : (
          <></>
        )}

        {deletionPreview ? (
          <div data-testid="deletion-preview">
            <p>
              {deletionPreview.rulesDeletedCount === 1
                ? "1 notification rule will be deleted"
                : `${deletionPreview.rulesDeletedCount} notification rules will be deleted`}
              {deletionPreview.coverageLostCount > 0
                ? `, leaving ${
                    deletionPreview.coverageLostCount === 1
                      ? "1 severity"
                      : `${deletionPreview.coverageLostCount} severities`
                  } with no rule at all.`
                : "."}
            </p>

            {/*
             * The one sentence worth interrupting for. Every other number here
             * describes a degradation; this one says the person cannot be
             * reached at all afterwards, which is a different kind of fact.
             */}
            {deletionPreview.verifiedMethodCountAfterDeletion === 0 ? (
              <p className="mt-2 font-medium text-red-700">
                {firstName} will have no verified notification method left, so
                nothing will be able to page them until they add one.
              </p>
            ) : (
              <></>
            )}

            {deletionPreview.isTruncated ? (
              <p className="mt-2 text-xs text-gray-500">
                These numbers are a lower bound — there were more rules than
                could be read in one go.
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        <p>{displayName || "This user"} is emailed about this removal.</p>
      </div>
    );
  };

  return (
    <Fragment>
      <Card
        title="Notification methods"
        description={`The devices and addresses ${firstName}'s on-call notification rules can send to.`}
        buttons={
          canManageMethods
            ? [
                {
                  title: "Add notification method",
                  icon: IconProp.Add,
                  buttonStyle: ButtonStyleType.NORMAL,
                  buttonSize: ButtonSize.Small,
                  onClick: () => {
                    setAddError("");
                    setShowAddModal(true);
                  },
                },
              ]
            : []
        }
      >
        <div className="space-y-4">
          {getMethodsBody()}

          {/*
           * Said once, under the list, and phrased as what the admin CAN do
           * rather than as a restriction. Somebody who has just added a phone
           * number needs to know why it is not working yet, and "waiting for
           * them to verify" on the row above is the answer only if this
           * paragraph has explained that verification is not theirs to do.
           */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm leading-relaxed text-gray-700">
              You can add an email address, phone number or WhatsApp number for{" "}
              {firstName}, and remove any method they no longer use. Identifiers
              are always shown masked.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              A method you add stays inactive until {firstName} verifies it —
              the code goes to the address or device itself and only they can
              enter it. Push devices, Telegram and webhooks have to be set up by{" "}
              {firstName} on their own device.
            </p>
            {context.readiness ? (
              <a
                href={context.getReminderHref(context.readiness)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                <Icon icon={IconProp.Email} className="h-3.5 w-3.5" />
                Email {firstName} the setup link
              </a>
            ) : (
              <></>
            )}
          </div>
        </div>
      </Card>

      {showAddModal ? (
        <BasicFormModal<AddMethodFormValues>
          title={`Add a notification method for ${displayName || "this user"}`}
          description={`A verification code is sent to the address or device you enter. ${firstName} has to enter that code before this method can notify them — you cannot verify it for them.`}
          isLoading={isSaving}
          error={addError}
          submitButtonText="Add"
          onClose={() => {
            setShowAddModal(false);
          }}
          onSubmit={(values: AddMethodFormValues) => {
            addMethod(values).catch(() => {
              // addMethod routes every failure into addError.
            });
          }}
          formProps={{
            name: "Add Notification Method",
            /*
             * Email is preselected rather than leaving the dropdown empty. It
             * is the channel with no per-project switch behind it — SMS, Call
             * and WhatsApp can each be disabled in Project Settings, and a
             * default that lands on a disabled channel turns the commonest
             * action into a refusal — and preselecting it means the ordinary
             * case is one field, typed and submitted.
             */
            initialValues: {
              methodType: AdminAddableChannel.Email,
            },
            fields: [
              {
                field: {
                  methodType: true,
                },
                title: "Method",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: ADDABLE_CHANNELS,
                required: true,
                placeholder: "Email",
              },
              {
                field: {
                  value: true,
                },
                title: "Email address or phone number",
                description:
                  "Phone numbers need the country code, for example +15551234567.",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "you@company.com or +15551234567",
                disableSpellCheck: true,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {methodToDelete ? (
        <ConfirmModal
          title={`Remove this ${methodToDelete.methodType} method?`}
          description={getDeletionDescription()}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={deleteError}
          onClose={() => {
            setMethodToDelete(null);
            setDeletionPreview(null);
            setDeleteError("");
          }}
          onSubmit={() => {
            deleteMethod().catch(() => {
              // deleteMethod routes every failure into deleteError.
            });
          }}
        />
      ) : (
        <></>
      )}

      {resendMethod ? (
        <ConfirmModal
          title="Resend verification code"
          description={`We will send a new verification code to ${resendMethod.maskedIdentifier}. Only ${firstName} can read it and enter it.`}
          submitButtonText="Resend code"
          isLoading={isSaving}
          error={resendError}
          onClose={() => {
            setResendMethod(null);
            setResendError("");
          }}
          onSubmit={() => {
            resendVerificationCode().catch(() => {
              // resendVerificationCode routes every failure into resendError.
            });
          }}
        />
      ) : (
        <></>
      )}

      {showResentConfirmation ? (
        <ConfirmModal
          title="Code sent"
          description={`A new verification code is on its way. ${firstName} needs to enter it in their own user settings before this method can page them.`}
          submitButtonText="Close"
          onSubmit={() => {
            setShowResentConfirmation(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default UserViewNotificationMethods;
