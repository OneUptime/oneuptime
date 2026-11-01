import AppLink from "../AppLink/AppLink";
import DataSecurityApi from "./DataSecurityApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import {
  DataSecurityResponseActionAvailability,
  DataSecurityResponseAvailability,
  DataSecurityResponseResult,
  DataSecurityResponseUnavailableReason,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  DataSecurityResponseAction,
  describeDataSecurityResponseAction,
  getDataSecurityResponseActionForIssue,
} from "Common/Types/DataSecurity/DataSecurityResponseAction";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * FIX IT FROM HERE: an issue fixed in one click, from the issue.
 *
 * An issue whose check one of Data Security's response actions fixes -
 * a public bucket, a snapshot shared outside, a bucket whose deleted files
 * cannot be recovered, a storage account that takes plain HTTP, a table
 * without point-in-time recovery - offers that action above the console
 * steps. It runs through the store's cloud connection, so it is offered
 * only where that connection's "Data security response" setting is on;
 * anywhere else the panel says what it would take, and where to turn it
 * on. A store marked public by design is never blocked.
 *
 * The server says which actions a store can take now
 * (DataSecurityApi.getResponseActions), reading the connection as
 * OneUptime: a person who may work issues need not read connections. A
 * read that fails draws nothing - the console steps below still fix it.
 * Pressing the button asks first, saying exactly what changes and what
 * stops working; the store is checked again right after, and the issue
 * resolves on its own once its check passes.
 */

export const ISSUE_RESPONSE_TEST_ID: string = "data-security-issue-response";

// The button, and the dialog's title and button, of each action.
export const RESPONSE_ACTION_TITLES: Readonly<
  Record<DataSecurityResponseAction, string>
> = {
  [DataSecurityResponseAction.BlockPublicAccess]: translationKey(
    "Block Public Access",
  ),
  [DataSecurityResponseAction.RevokeSharing]: translationKey("Revoke Sharing"),
  [DataSecurityResponseAction.TurnOnVersioning]:
    translationKey("Turn On Versioning"),
  [DataSecurityResponseAction.TurnOnSoftDelete]: translationKey(
    "Turn On Soft Delete",
  ),
  [DataSecurityResponseAction.TurnOffObjectAcls]: translationKey(
    "Turn Off Object ACLs",
  ),
  [DataSecurityResponseAction.TurnOnUniformAccess]: translationKey(
    "Turn On Uniform Access",
  ),
  [DataSecurityResponseAction.RequireSecureTransfer]: translationKey(
    "Require Secure Transfer",
  ),
  [DataSecurityResponseAction.TurnOnPointInTimeRecovery]: translationKey(
    "Turn On Point-in-Time Recovery",
  ),
};

const CONFIRM_TITLES: Readonly<Record<DataSecurityResponseAction, string>> = {
  [DataSecurityResponseAction.BlockPublicAccess]: translationKey(
    "Block public access to {{store}}?",
  ),
  [DataSecurityResponseAction.RevokeSharing]: translationKey(
    "Revoke the sharing of {{store}}?",
  ),
  [DataSecurityResponseAction.TurnOnVersioning]: translationKey(
    "Turn on versioning for {{store}}?",
  ),
  [DataSecurityResponseAction.TurnOnSoftDelete]: translationKey(
    "Turn on soft delete for {{store}}?",
  ),
  [DataSecurityResponseAction.TurnOffObjectAcls]: translationKey(
    "Turn off object ACLs for {{store}}?",
  ),
  [DataSecurityResponseAction.TurnOnUniformAccess]: translationKey(
    "Turn on uniform access for {{store}}?",
  ),
  [DataSecurityResponseAction.RequireSecureTransfer]: translationKey(
    "Require secure transfer for {{store}}?",
  ),
  [DataSecurityResponseAction.TurnOnPointInTimeRecovery]: translationKey(
    "Turn on point-in-time recovery for {{store}}?",
  ),
};

const PANEL_TITLE: string = translationKey("Fix it from here");

const PANEL_DESCRIPTIONS: Readonly<Record<DataSecurityResponseAction, string>> =
  {
    [DataSecurityResponseAction.BlockPublicAccess]: translationKey(
      "OneUptime can block public access to this store through its cloud connection, and check it again right after.",
    ),
    [DataSecurityResponseAction.RevokeSharing]: translationKey(
      "OneUptime can stop sharing this store's snapshots outside your accounts through its cloud connection, and check it again right after.",
    ),
    [DataSecurityResponseAction.TurnOnVersioning]: translationKey(
      "OneUptime can turn on versioning for this bucket through its cloud connection, and check it again right after.",
    ),
    [DataSecurityResponseAction.TurnOnSoftDelete]: translationKey(
      "OneUptime can turn on soft delete for this storage account through its cloud connection, and check it again right after.",
    ),
    [DataSecurityResponseAction.TurnOffObjectAcls]: translationKey(
      "OneUptime can turn off this bucket's object ACLs through its cloud connection, and check it again right after.",
    ),
    [DataSecurityResponseAction.TurnOnUniformAccess]: translationKey(
      "OneUptime can turn on uniform bucket-level access for this bucket through its cloud connection, and check it again right after.",
    ),
    [DataSecurityResponseAction.RequireSecureTransfer]: translationKey(
      "OneUptime can make this storage account take HTTPS only, with TLS 1.2 or later, through its cloud connection, and check it again right after.",
    ),
    [DataSecurityResponseAction.TurnOnPointInTimeRecovery]: translationKey(
      "OneUptime can turn on point-in-time recovery for this table through its cloud connection, and check it again right after.",
    ),
  };

const THROUGH_THE_CONNECTION: string = translationKey(
  "OneUptime does this through the store's cloud connection, and checks the store again right after: the issue resolves on its own once its check passes.",
);

// Why it cannot run from here, in the reader's words.
export const UNAVAILABLE_SENTENCES: Readonly<
  Record<DataSecurityResponseUnavailableReason, string>
> = {
  [DataSecurityResponseUnavailableReason.ResponseOff]: translationKey(
    "To do this from here, turn on Data security response on this store's cloud connection and run its updated setup command. It grants this one narrow write.",
  ),
  [DataSecurityResponseUnavailableReason.ConnectionGone]: translationKey(
    "This store's cloud connection is gone or turned off, so fix it in its cloud with the steps below.",
  ),
  [DataSecurityResponseUnavailableReason.NotThroughACloud]: translationKey(
    "This store was not found through a cloud connection, so fix it in its cloud with the steps below.",
  ),
  [DataSecurityResponseUnavailableReason.PublicByDesign]: translationKey(
    "This store is marked public by design, so its public access is left as it is. Turn that off in the store's Settings first if it should not be public.",
  ),
};

const OPEN_CONNECTIONS: string = translationKey("Open cloud connections");

const DONE_SENTENCES: Readonly<Record<DataSecurityResponseAction, string>> = {
  [DataSecurityResponseAction.BlockPublicAccess]: translationKey(
    "Public access is blocked. The store is being checked again, and the issue resolves once its check passes.",
  ),
  [DataSecurityResponseAction.RevokeSharing]: translationKey(
    "Sharing is revoked. The store is being checked again, and the issue resolves once its check passes.",
  ),
  [DataSecurityResponseAction.TurnOnVersioning]: translationKey(
    "Versioning is on. The store is being checked again, and the issue resolves once its check passes.",
  ),
  [DataSecurityResponseAction.TurnOnSoftDelete]: translationKey(
    "Soft delete is on. The store is being checked again, and the issue resolves once its check passes.",
  ),
  [DataSecurityResponseAction.TurnOffObjectAcls]: translationKey(
    "Object ACLs are off. The store is being checked again, and the issue resolves once its check passes.",
  ),
  [DataSecurityResponseAction.TurnOnUniformAccess]: translationKey(
    "Uniform access is on. The store is being checked again, and the issue resolves once its check passes.",
  ),
  [DataSecurityResponseAction.RequireSecureTransfer]: translationKey(
    "Secure transfer is required. The store is being checked again, and the issue resolves once its check passes.",
  ),
  [DataSecurityResponseAction.TurnOnPointInTimeRecovery]: translationKey(
    "Point-in-time recovery is on. The store is being checked again, and the issue resolves once its check passes.",
  ),
};

const ALREADY_SENTENCES: Readonly<Record<DataSecurityResponseAction, string>> =
  {
    [DataSecurityResponseAction.BlockPublicAccess]: translationKey(
      "Nothing to change: public access was already blocked. The store is checked again at its next read.",
    ),
    [DataSecurityResponseAction.RevokeSharing]: translationKey(
      "Nothing to change: nothing was shared outside your accounts any more. The store is checked again at its next read.",
    ),
    [DataSecurityResponseAction.TurnOnVersioning]: translationKey(
      "Nothing to change: versioning was already on. The store is checked again at its next read.",
    ),
    [DataSecurityResponseAction.TurnOnSoftDelete]: translationKey(
      "Nothing to change: soft delete was already on. The store is checked again at its next read.",
    ),
    [DataSecurityResponseAction.TurnOffObjectAcls]: translationKey(
      "Nothing to change: object ACLs were already off. The store is checked again at its next read.",
    ),
    [DataSecurityResponseAction.TurnOnUniformAccess]: translationKey(
      "Nothing to change: uniform access was already on. The store is checked again at its next read.",
    ),
    [DataSecurityResponseAction.RequireSecureTransfer]: translationKey(
      "Nothing to change: secure transfer was already required. The store is checked again at its next read.",
    ),
    [DataSecurityResponseAction.TurnOnPointInTimeRecovery]: translationKey(
      "Nothing to change: point-in-time recovery was already on. The store is checked again at its next read.",
    ),
  };

export interface ComponentProps {
  issueId: ObjectID;
  checkId: string | undefined;
  dataStoreId: string;
  storeKind: string | undefined;
  storeName: string;
  // Called once an action changed something, so the page reads the issue again.
  onChanged?: (() => void) | undefined;
}

const IssueResponseAction: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const action: DataSecurityResponseAction | undefined =
    getDataSecurityResponseActionForIssue(props.checkId, props.storeKind);
  const [availability, setAvailability] =
    useState<DataSecurityResponseActionAvailability | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<DataSecurityResponseResult | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    if (!action || !props.dataStoreId) {
      return;
    }

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const read: DataSecurityResponseAvailability =
          await DataSecurityApi.getResponseActions(
            new ObjectID(props.dataStoreId),
          );

        if (!isCurrent) {
          return;
        }

        setAvailability(
          (read.actions || []).find(
            (entry: DataSecurityResponseActionAvailability): boolean => {
              return entry.action === action;
            },
          ) || null,
        );
      } catch {
        // Not readable now: the steps below still fix it.
        if (isCurrent) {
          setAvailability(null);
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [action, props.dataStoreId]);

  if (!action || !availability) {
    return <></>;
  }

  const gate: PermissionGateResult = PermissionGate.check(
    new DataStore(),
    ModelAction.Update,
  );

  // Not drawn before the reader's permissions are known.
  if (!gate.isAllowed && !gate.disabledReason) {
    return <></>;
  }

  const title: string = RESPONSE_ACTION_TITLES[action];
  const storeName: string = props.storeName || props.dataStoreId;
  const unavailable: string = availability.unavailableReason
    ? translator.translateText(
        UNAVAILABLE_SENTENCES[availability.unavailableReason],
      ) || ""
    : "";

  const run: () => Promise<void> = async (): Promise<void> => {
    setIsRunning(true);
    setError("");

    try {
      const outcome: DataSecurityResponseResult = await DataSecurityApi.respond(
        {
          dataStoreId: new ObjectID(props.dataStoreId),
          action,
          dataSecurityIssueId: props.issueId,
        },
      );

      setResult(outcome);
      setIsConfirming(false);
      props.onChanged?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsRunning(false);
  };

  return (
    <div
      className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3"
      data-testid={ISSUE_RESPONSE_TEST_ID}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-gray-900">
            {translator.translateText(PANEL_TITLE)}
          </p>
          <p className="text-sm text-gray-700">
            {translator.translateText(PANEL_DESCRIPTIONS[action])}
          </p>
          {unavailable ? (
            <p
              className="text-sm text-gray-600"
              data-testid={`${ISSUE_RESPONSE_TEST_ID}-unavailable`}
            >
              {unavailable}{" "}
              {availability.unavailableReason ===
              DataSecurityResponseUnavailableReason.ResponseOff ? (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.CLOUD_CONNECT] as Route,
                  )}
                  className="font-medium text-indigo-600 hover:underline"
                  dataTestId={`${ISSUE_RESPONSE_TEST_ID}-connections`}
                >
                  <span>{translator.translateText(OPEN_CONNECTIONS)}</span>
                </AppLink>
              ) : (
                <></>
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
        <div className="shrink-0">
          <Button
            title={title}
            icon={IconProp.Lock}
            buttonStyle={ButtonStyleType.PRIMARY}
            disabled={!availability.isAvailable || !gate.isAllowed}
            tooltip={
              gate.isAllowed ? undefined : gate.disabledReason || undefined
            }
            dataTestId={`${ISSUE_RESPONSE_TEST_ID}-button`}
            onClick={() => {
              setError("");
              setIsConfirming(true);
            }}
          />
        </div>
      </div>

      {result ? (
        <div className="mt-3">
          <Alert
            type={result.changed ? AlertType.SUCCESS : AlertType.INFO}
            title={
              translator.translateText(
                result.changed
                  ? DONE_SENTENCES[action]
                  : ALREADY_SENTENCES[action],
              ) || ""
            }
            dataTestId={`${ISSUE_RESPONSE_TEST_ID}-result`}
            onClose={() => {
              setResult(null);
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {isConfirming ? (
        <ConfirmModal
          title={translator.translateTemplate(CONFIRM_TITLES[action], {
            store: storeName,
          })}
          description={
            <div className="space-y-2">
              <p>
                {translator.translateText(
                  describeDataSecurityResponseAction(action, props.storeKind),
                )}
              </p>
              <p>{translator.translateText(THROUGH_THE_CONNECTION)}</p>
            </div>
          }
          submitButtonText={title}
          isLoading={isRunning}
          error={error || undefined}
          onClose={() => {
            setIsConfirming(false);
            setError("");
          }}
          onSubmit={() => {
            void run();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default IssueResponseAction;
