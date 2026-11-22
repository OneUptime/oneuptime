import { CheckRow } from "../ConnectorTestReportView";
import {
  BlockingCheckAnswer,
  checkBlocking,
  getBlockingBody,
  putBlockingBack,
  readBlockingConnection,
  readBlockingZoneChoices,
  turnBlockingOff,
  turnBlockingOn,
} from "./CloudflareBlockingApi";
import {
  ACCESS_RULES_PERMISSION_USE,
  BLOCKING_DIALOG_DESCRIPTION,
  BLOCKING_DIALOG_TITLE,
  CHECKING_PERMISSIONS,
  CHECK_PERMISSIONS_BUTTON,
  CLOUDFLARE_BLOCKING_TEST_IDS,
  LIST_PERMISSION_USE,
  NEW_TOKEN_FIELD_DESCRIPTION,
  NEW_TOKEN_FIELD_TITLE,
  NOT_TURNED_ON,
  PERMISSIONS_HEADING,
  REMOVE_FROM_CLOUDFLARE_DESCRIPTION,
  REMOVE_FROM_CLOUDFLARE_TITLE,
  REMOVING_NOTICE,
  SAVE_ZONES_BUTTON,
  TURNED_OFF_REMOVING_TOAST,
  TURNED_OFF_TOAST,
  TURNED_ON_TOAST,
  TURN_OFF_BUTTON,
  TURN_OFF_DESCRIPTION,
  TURN_OFF_TITLE,
  TURN_ON_BUTTON,
  WAF_PERMISSION_USE,
  ZONES_FIELD_DESCRIPTION,
  ZONES_FIELD_PLACEHOLDER,
  ZONES_FIELD_TITLE,
  ZONES_NOT_READ,
  ZONES_SAVED_TOAST,
} from "./CloudflareBlockingCopy";
import CloudflareBlockingStatusView from "./CloudflareBlockingStatusView";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectorCheck } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { ConnectorFieldChoice } from "Common/Types/SecurityEvent/Connectors/ConnectorFieldChoices";
import {
  CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION,
  CLOUDFLARE_LIST_EDIT_PERMISSION,
  CLOUDFLARE_WAF_EDIT_PERMISSION,
  CloudflareBlockingSettings,
  CloudflareBlockingStatus,
  isCloudflareBlockingRemovalPending,
  isCloudflareBlockingSetupPending,
  readCloudflareBlockingFailure,
  readCloudflareBlockingSettings,
  readCloudflareBlockingStatus,
} from "Common/Types/SecurityBlocklist/CloudflareBlocking";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * BLOCK ADDRESSES AT CLOUDFLARE (#10343): a Cloudflare connection's
 * blocking, opened from its row. Off by default, a clear opt-in:
 *
 *   - off, it says what OneUptime sets up in Cloudflare, lists the write
 *     permissions that takes, lets the person choose the zones (none: every
 *     zone the connection reads) and paste a new token or keep the current
 *     one once they have added the permissions to it; Check Permissions asks
 *     without writing, and Turn On Blocking turns it on only when every
 *     check passes, showing what failed otherwise;
 *   - on, it says how blocking stands (CloudflareBlockingStatusView): each
 *     action's mechanism and why, how many addresses Cloudflare holds of how
 *     many, a zone whose rule was turned off, deleted or changed at
 *     Cloudflare with Put It Back, and the addresses its skip rules let
 *     through to protect. Turn Off Blocking asks whether to remove
 *     OneUptime's lists and rules from Cloudflare, removing them unless told
 *     to keep them.
 *
 * While Cloudflare is being set up or its lists and rules taken away, the
 * dialog reads the connection again every few seconds.
 */

// The connection was deleted since its row was drawn.
const MISSING_CONNECTION: string = translationKey(
  "This connection no longer exists.",
);

// How often the dialog reads the connection again while OneUptime works on Cloudflare.
export const BLOCKING_POLL_INTERVAL_IN_MS: number = 5000;

export interface ComponentProps {
  connectionId: ObjectID;
  onClose: () => void;
  // Blocking was turned on or off, or its zones changed: the list reads its rows again.
  onChanged: () => void;
  // Opens on the question of turning blocking off: from a delete refused while it blocks.
  isTurningOff?: boolean | undefined;
}

function sameZones(left: Array<string>, right: Array<string>): boolean {
  return (
    left.length === right.length &&
    left.every((zoneId: string): boolean => {
      return right.includes(zoneId);
    })
  );
}

const CloudflareBlockingModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connection, setConnection] = useState<SecurityEventConnection | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string>("");
  const [isMissing, setIsMissing] = useState<boolean>(false);
  const [zoneChoices, setZoneChoices] =
    useState<Array<ConnectorFieldChoice> | null>(null);
  const [zonesUnread, setZonesUnread] = useState<boolean>(false);
  const [zoneIds, setZoneIds] = useState<Array<string> | null>(null);
  const [apiToken, setApiToken] = useState<string>("");
  const [checks, setChecks] = useState<Array<SecurityConnectorCheck> | null>(
    null,
  );
  const [isNotTurnedOn, setIsNotTurnedOn] = useState<boolean>(false);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [isAskingToTurnOff, setIsAskingToTurnOff] = useState<boolean>(
    Boolean(props.isTurningOff),
  );
  const [removeFromCloudflare, setRemoveFromCloudflare] =
    useState<boolean>(true);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const read: SecurityEventConnection | null = await readBlockingConnection(
        props.connectionId,
      );

      if (!read) {
        setIsMissing(true);
        return;
      }

      setConnection(read);
      setZoneIds((current: Array<string> | null): Array<string> => {
        // The zones as saved, the first time; what the person picks after.
        return (
          current ||
          readCloudflareBlockingSettings(read.blockingSettings).zoneIds
        );
      });
    } catch (error) {
      setLoadError(API.getFriendlyMessage(error));
    }
    /*
     * Read again only for another connection: the translator is a new
     * object on every render, and reading again on each would read for ever.
     */
  }, [props.connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The zones to choose from, once the connection is read.
  useEffect(() => {
    if (!connection || zoneChoices || zonesUnread) {
      return;
    }

    readBlockingZoneChoices(connection)
      .then((choices: Array<ConnectorFieldChoice>): void => {
        setZoneChoices(choices);
      })
      .catch((): void => {
        setZonesUnread(true);
      });
  }, [connection, zoneChoices, zonesUnread]);

  const settings: CloudflareBlockingSettings = readCloudflareBlockingSettings(
    connection?.blockingSettings,
  );
  const status: CloudflareBlockingStatus | null = readCloudflareBlockingStatus(
    connection?.blockingStatus,
  );
  const failure: { error: string; errorAt: string } | null =
    readCloudflareBlockingFailure(connection?.blockingStatus);
  const isSettingUp: boolean = isCloudflareBlockingSetupPending(
    settings,
    status,
  );
  const isRemoving: boolean = isCloudflareBlockingRemovalPending(
    settings,
    status,
  );

  // While OneUptime works on Cloudflare, read the connection again until it is done.
  useEffect(() => {
    if (!isSettingUp && !isRemoving) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      void load();
    }, BLOCKING_POLL_INTERVAL_IN_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, [isSettingUp, isRemoving, load]);

  const chosenZones: Array<string> = zoneIds || [];
  const zonesChanged: boolean = !sameZones(chosenZones, settings.zoneIds);

  const run: (work: () => Promise<void>) => Promise<void> = async (
    work: () => Promise<void>,
  ): Promise<void> => {
    setIsWorking(true);
    setActionError("");

    try {
      await work();
    } catch (error) {
      setActionError(API.getFriendlyMessage(error));
    } finally {
      setIsWorking(false);
    }
  };

  const check: () => Promise<void> = async (): Promise<void> => {
    await run(async (): Promise<void> => {
      setIsNotTurnedOn(false);
      setChecks(null);
      const answer: BlockingCheckAnswer = await checkBlocking(
        props.connectionId,
        getBlockingBody({ zoneIds: chosenZones, apiToken }),
      );
      setChecks(answer.checks);
    });
  };

  const turnOn: () => Promise<void> = async (): Promise<void> => {
    const wasOn: boolean = settings.isEnabled;

    await run(async (): Promise<void> => {
      setIsNotTurnedOn(false);
      setChecks(null);
      const answer: BlockingCheckAnswer = await turnBlockingOn(
        props.connectionId,
        getBlockingBody({ zoneIds: chosenZones, apiToken }),
      );

      if (!answer.isReady) {
        setIsNotTurnedOn(true);
        setChecks(answer.checks);
        return;
      }

      setApiToken("");
      const said: string = wasOn ? ZONES_SAVED_TOAST : TURNED_ON_TOAST;
      Toast.success(translator.translateText(said) || said);
      props.onChanged();
      await load();
    });
  };

  const turnOff: () => Promise<void> = async (): Promise<void> => {
    await run(async (): Promise<void> => {
      await turnBlockingOff(props.connectionId, removeFromCloudflare);
      const said: string = removeFromCloudflare
        ? TURNED_OFF_REMOVING_TOAST
        : TURNED_OFF_TOAST;
      Toast.success(translator.translateText(said) || said);
      setIsAskingToTurnOff(false);
      props.onChanged();
      await load();
    });
  };

  const putBack: (zoneId: string) => Promise<void> = async (
    zoneId: string,
  ): Promise<void> => {
    await run(async (): Promise<void> => {
      await putBlockingBack(props.connectionId, [zoneId]);
      await load();
    });
  };

  if (isAskingToTurnOff) {
    return (
      <Modal
        title={TURN_OFF_TITLE}
        description={TURN_OFF_DESCRIPTION}
        submitButtonText={TURN_OFF_BUTTON}
        submitButtonStyleType={ButtonStyleType.DANGER}
        onSubmit={(): void => {
          void turnOff();
        }}
        onClose={(): void => {
          if (props.isTurningOff) {
            props.onClose();
            return;
          }

          setIsAskingToTurnOff(false);
        }}
        isLoading={isWorking}
        error={actionError || undefined}
      >
        <Checkbox
          title={REMOVE_FROM_CLOUDFLARE_TITLE}
          description={REMOVE_FROM_CLOUDFLARE_DESCRIPTION}
          value={removeFromCloudflare}
          onChange={(value: boolean): void => {
            setRemoveFromCloudflare(value);
          }}
          dataTestId={CLOUDFLARE_BLOCKING_TEST_IDS.removeCheckbox}
        />
      </Modal>
    );
  }

  const zoneOptions: Array<DropdownOption> = (zoneChoices || []).map(
    (choice: ConnectorFieldChoice): DropdownOption => {
      return {
        value: choice.value,
        label: choice.description
          ? `${choice.label} · ${choice.description}`
          : choice.label,
      };
    },
  );
  const chosenOptions: Array<DropdownOption> = chosenZones.map(
    (zoneId: string): DropdownOption => {
      return (
        zoneOptions.find((option: DropdownOption): boolean => {
          return option.value === zoneId;
        }) || { value: zoneId, label: zoneId }
      );
    },
  );

  return (
    <Modal
      title={BLOCKING_DIALOG_TITLE}
      description={BLOCKING_DIALOG_DESCRIPTION}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
      submitButtonText={settings.isEnabled ? SAVE_ZONES_BUTTON : TURN_ON_BUTTON}
      onSubmit={(): void => {
        void turnOn();
      }}
      disableSubmitButton={
        !connection || (settings.isEnabled && !zonesChanged && !apiToken)
      }
      secondaryButton={
        settings.isEnabled
          ? {
              title: TURN_OFF_BUTTON,
              onClick: (): void => {
                setRemoveFromCloudflare(true);
                setIsAskingToTurnOff(true);
              },
            }
          : {
              title: CHECK_PERMISSIONS_BUTTON,
              onClick: (): void => {
                void check();
              },
              disabled: !connection || isWorking,
            }
      }
      isLoading={isWorking}
      isBodyLoading={!connection && !loadError && !isMissing}
      error={
        loadError ||
        (isMissing
          ? translator.translateText(MISSING_CONNECTION) || MISSING_CONNECTION
          : "") ||
        actionError ||
        undefined
      }
    >
      <div
        className="space-y-5"
        data-testid={CLOUDFLARE_BLOCKING_TEST_IDS.dialog}
      >
        {settings.isEnabled ? (
          <CloudflareBlockingStatusView
            projectId={connection?.projectId || null}
            status={status}
            failure={failure}
            isSettingUp={isSettingUp}
            isWorking={isWorking}
            onPutBack={(zoneId: string): void => {
              void putBack(zoneId);
            }}
          />
        ) : (
          <>
            {isRemoving ? (
              <Alert type={AlertType.INFO} title={REMOVING_NOTICE} />
            ) : (
              <></>
            )}
            <div data-testid={CLOUDFLARE_BLOCKING_TEST_IDS.permissions}>
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(PERMISSIONS_HEADING)}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-gray-700">
                {[
                  [CLOUDFLARE_LIST_EDIT_PERMISSION, LIST_PERMISSION_USE],
                  [CLOUDFLARE_WAF_EDIT_PERMISSION, WAF_PERMISSION_USE],
                  [
                    CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION,
                    ACCESS_RULES_PERMISSION_USE,
                  ],
                ].map(([permission, use]: Array<string>): ReactElement => {
                  return (
                    <li key={permission} className="flex flex-wrap gap-x-2">
                      <code dir="ltr" className="font-mono text-gray-900">
                        {permission}
                      </code>
                      <span>{translator.translateText(use || "")}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        <div>
          <FieldLabelElement
            title={ZONES_FIELD_TITLE}
            description={ZONES_FIELD_DESCRIPTION}
            htmlFor="cloudflare-blocking-zones"
          />
          <Dropdown
            inputId="cloudflare-blocking-zones"
            isMultiSelect={true}
            options={zoneOptions}
            value={chosenOptions}
            placeholder={ZONES_FIELD_PLACEHOLDER}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              setZoneIds(
                (Array.isArray(value) ? value : value ? [value] : []).map(
                  (zoneId: DropdownValue): string => {
                    return String(zoneId);
                  },
                ),
              );
            }}
          />
          {zonesUnread ? (
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(ZONES_NOT_READ)}
            </p>
          ) : (
            <></>
          )}
        </div>

        {settings.isEnabled ? (
          <></>
        ) : (
          <div>
            <FieldLabelElement
              title={NEW_TOKEN_FIELD_TITLE}
              description={NEW_TOKEN_FIELD_DESCRIPTION}
              htmlFor="cloudflare-blocking-token"
              required={false}
            />
            <Input
              id="cloudflare-blocking-token"
              type={InputType.PASSWORD}
              value={apiToken}
              onChange={(value: string): void => {
                setApiToken(value);
              }}
            />
          </div>
        )}

        {isWorking && !checks ? (
          <p className="text-sm text-gray-600">
            {translator.translateText(CHECKING_PERMISSIONS)}
          </p>
        ) : (
          <></>
        )}

        {isNotTurnedOn ? (
          <Alert type={AlertType.DANGER} title={NOT_TURNED_ON} />
        ) : (
          <></>
        )}

        {checks ? (
          <ul
            className="divide-y divide-gray-100"
            data-testid={CLOUDFLARE_BLOCKING_TEST_IDS.checks}
          >
            {checks.map((one: SecurityConnectorCheck): ReactElement => {
              return <CheckRow key={one.key} check={one} />;
            })}
          </ul>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudflareBlockingModal;
