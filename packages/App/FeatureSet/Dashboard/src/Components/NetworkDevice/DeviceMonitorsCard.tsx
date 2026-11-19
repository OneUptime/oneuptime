import MonitorElement from "../Monitor/Monitor";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { Gray500 } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  DEVICE_MONITOR_CHECK_QUERY_PARAM,
  DeviceMonitorCheck,
} from "Common/Utils/NetworkDevice/DeviceWebUiUtil";
import { DEVICE_TARGET_MONITOR_TYPES } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import API from "Common/UI/Utils/API/API";
import { translationKey } from "Common/Types/Translator";

export interface ComponentProps {
  monitors: Array<Monitor>;
  isLoading: boolean;
  error: string;
  /*
   * When provided, the empty-state "Create Monitor" button deep-links the
   * monitor create page with the type and device pre-selected.
   */
  networkDeviceId?: string | undefined;
  /*
   * Whether this device's health comes from a bound Monitor rather than from
   * its probe's own poll. It changes what an empty list MEANS, so the copy
   * has to branch on it — see the note below.
   */
  isMonitorBacked?: boolean | undefined;
  /*
   * Whether the reader may create monitors. "Monitor web UI" is offered
   * only then - hidden, not locked, as the device's other on-demand actions
   * are (its SNMP Walk page's "Alert on it"): it opens a form that only
   * saves for someone who may create monitors.
   */
  canCreateMonitor: boolean;
  /*
   * Read the device's monitors again: a monitor someone made by hand was
   * just added to the device ("Add Existing Monitor", issue #9545). Left
   * out, the card offers no way to add one.
   */
  onMonitorAdded?: (() => void) | undefined;
  /*
   * The monitors a person's tie alone lists here, by id (lower case): the
   * ones Remove takes off the device (issue #9676). One made for the
   * device, bound to it or watching it is the device's for that reason,
   * and is never offered.
   */
  removableMonitorIds?: ReadonlySet<string> | undefined;
  /*
   * Read the device's monitors again: one was just taken off the device.
   * Left out, the card offers no way to remove one.
   */
  onMonitorRemoved?: (() => void) | undefined;
}

/*
 * The monitors "Add Existing Monitor" offers (issue #9545): the ones a
 * person made, of a kind that checks a host, tied to no device yet. A
 * monitor an import made for a device is that device's already.
 */
export const ADDABLE_MONITOR_QUERY: Record<string, unknown> = {
  monitorType: new Includes([...DEVICE_TARGET_MONITOR_TYPES]),
  networkDeviceId: new IsNull(),
  autoProvisionedNetworkDeviceId: new IsNull(),
};

interface AddExistingMonitorFormData {
  monitorId?: string | undefined;
}

// Whether the reader may tie a monitor to a device: write its column.
export function canAddExistingMonitor(): boolean {
  return PermissionGate.checkColumnUpdate(new Monitor(), "networkDeviceId")
    .isAllowed;
}

/*
 * Whether the reader may take a monitor off a device (issue #9676): write
 * the same column, as the monitor's Details card does to clear it.
 */
export function canRemoveTiedMonitor(): boolean {
  return canAddExistingMonitor();
}

// The words of taking a monitor someone tied off the device (issue #9676).
export const REMOVE_TIED_MONITOR_COPY: {
  button: string;
  buttonAriaLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  removed: string;
} = {
  // Written as the literal "Remove" where it is drawn, as other lists do.
  button: translationKey("Remove"),
  buttonAriaLabel: translationKey("Remove {{monitorName}} from this device"),
  dialogTitle: translationKey("Remove from Device"),
  dialogDescription: translationKey(
    "{{monitorName}} stops being listed on this device, and what it raises from now on is not linked to the device. Imports and auto import rules stop counting it, so they can give the device a monitor like it. The monitor itself keeps checking, unchanged.",
  ),
  removed: translationKey("Monitor removed from this device."),
};

/*
 * Create Monitor on a Website monitor of a device's web UI: the device link
 * Create Monitor reads, asking for that check (DeviceWebUiUtil).
 */
export const getDeviceWebUiMonitorRoute: (networkDeviceId: string) => Route = (
  networkDeviceId: string,
): Route => {
  const createRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );

  return Route.fromString(
    `${createRoute.toString()}?networkDeviceId=${encodeURIComponent(
      networkDeviceId,
    )}&${DEVICE_MONITOR_CHECK_QUERY_PARAM}=${DeviceMonitorCheck.WebUi}`,
  );
};

/*
 * "Monitors alerting on this device" card for the device Overview. The
 * monitor list is resolved by DeviceMonitorLookupUtil (the monitor bound to
 * the device, a client-side filter over the project's Network Device
 * monitors, the Ping, IP, Port, NTP, Website, API and SSL Certificate
 * monitors a discovery import made for it, the monitors a person tied to it,
 * and its web UI monitor) and passed in by the page so the Health charts can
 * share the same fetch.
 *
 * An empty list means two opposite things depending on the device:
 *
 *   Probe-polled dev   - the probe pings it on its schedule (and walks it
 *                        over SNMP once it has credentials) regardless;
 *                        monitors only decide what to ALERT on. Nothing is
 *                        wrong, and the copy says so.
 *   Monitor-backed dev - nothing polls it at all. Without a bound monitor it
 *                        has no health source whatsoever and sits on
 *                        "Pending" forever, which is OneUptime/oneuptime#3447.
 *                        Telling that operator the device "is still polled by
 *                        its assigned probe" is false and sends them looking
 *                        for a probe it is designed never to have.
 */
const DeviceMonitorsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isAddingMonitor, setIsAddingMonitor] = useState<boolean>(false);
  const [isSavingAddExisting, setIsSavingAddExisting] =
    useState<boolean>(false);
  const [addExistingError, setAddExistingError] = useState<string>("");
  // The monitor being taken off the device, while Remove asks (issue #9676).
  const [monitorToRemove, setMonitorToRemove] = useState<Monitor | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>("");

  /*
   * Remove is for a reader who may tie monitors, on a page that reads the
   * monitors again after: hidden otherwise, as Add Existing Monitor is.
   */
  const mayRemove: boolean =
    Boolean(props.networkDeviceId && props.onMonitorRemoved) &&
    canRemoveTiedMonitor();

  const isRemovable: (monitor: Monitor) => boolean = (
    monitor: Monitor,
  ): boolean => {
    const monitorId: string = (
      monitor._id?.toString() ||
      monitor.id?.toString() ||
      ""
    ).toLowerCase();

    return (
      mayRemove &&
      Boolean(monitorId) &&
      Boolean(props.removableMonitorIds?.has(monitorId))
    );
  };

  const closeRemove: () => void = (): void => {
    setMonitorToRemove(null);
    setRemoveError("");
  };

  /*
   * Unties the monitor from the device (Monitor.networkDeviceId), and
   * nothing else about it: it keeps checking. The duplicate check reads the
   * tie each time it runs, so imports stop counting the monitor at once,
   * and the page reads its monitors again. The dialog stays open while it
   * saves, and says why when the server refuses.
   */
  const removeTiedMonitor: () => Promise<void> = async (): Promise<void> => {
    const monitorId: string =
      monitorToRemove?._id?.toString() || monitorToRemove?.id?.toString() || "";

    if (!monitorId) {
      closeRemove();
      return;
    }

    setIsRemoving(true);
    setRemoveError("");

    try {
      await ModelAPI.updateById<Monitor>({
        modelType: Monitor,
        id: new ObjectID(monitorId),
        data: {
          networkDeviceId: null,
        },
      });
    } catch (err) {
      setRemoveError(API.getFriendlyMessage(err));
      setIsRemoving(false);
      return;
    }

    setIsRemoving(false);
    closeRemove();
    Toast.success(
      translator.translateText(REMOVE_TIED_MONITOR_COPY.removed) ||
        REMOVE_TIED_MONITOR_COPY.removed,
    );
    props.onMonitorRemoved?.();
  };

  type GetCardContentFunction = () => ReactElement;

  const getCardContent: GetCardContentFunction = (): ReactElement => {
    if (props.isLoading) {
      return <TableSkeleton rows={3} />;
    }

    if (props.error) {
      return <ErrorMessage message={props.error} />;
    }

    if (props.monitors.length === 0) {
      return (
        <div className="text-center py-10">
          <p className="text-sm text-gray-500">
            {translator.translateText(
              props.isMonitorBacked
                ? `This device has no monitor bound to it, so nothing is reporting its health — it is not polled by a probe at all, and its status stays "Pending" until a monitor is bound. The button below creates a Ping monitor on this device's address and binds it to the device for you. To use a monitor that already exists instead, bind it under Settings → Monitor. To have a probe ping it directly instead, switch it to probe polling under Settings.`
                : `Nothing alerts on this device yet. Its probe already pings it on schedule, so it has a status; an alert policy is what turns a failure into an incident - for this device and every one like it. Or create a monitor for this device alone.`,
            )}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {/*
             * The policy first: one covers the whole fleet, the devices added
             * later too. "Under Network settings" used to be a sentence to
             * go looking for; it is a button now.
             */}
            {!props.isMonitorBacked && (
              <Button
                title="Set up alerts"
                icon={IconProp.Alert}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="device-monitors-set-up-alerts"
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[
                        PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES
                      ] as Route,
                    ),
                  );
                }}
              />
            )}
            <Button
              title={
                props.isMonitorBacked ? "Create Ping Monitor" : "Create Monitor"
              }
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                const createRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_CREATE] as Route,
                );

                Navigation.navigate(
                  props.networkDeviceId
                    ? Route.fromString(
                        `${createRoute.toString()}?networkDeviceId=${props.networkDeviceId}`,
                      )
                    : createRoute,
                );
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="divide-y divide-gray-100">
        {props.monitors.map((monitor: Monitor): ReactElement => {
          return (
            <div
              key={monitor._id?.toString()}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0 text-sm font-medium text-gray-900">
                <MonitorElement monitor={monitor} />
                {/*
                 * A policy-owned monitor is created and removed by the alert
                 * policy engine. Saying so here is what stops an operator
                 * editing its criteria, or deleting it, and being quietly
                 * overruled on the next reconcile — the one thing about this
                 * monitor they cannot discover from the monitor page itself.
                 */}
                {monitor.networkAlertPolicyId && (
                  <div className="mt-0.5 text-xs font-normal text-gray-500">
                    {translator.translateText(
                      "Managed by an alert policy. Edit the policy rather than this monitor.",
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {monitor.currentMonitorStatus?.name && (
                  <Pill
                    text={monitor.currentMonitorStatus.name}
                    isUserContent={isRecordNameAsWritten(
                      StateListType.MonitorStatus,
                      monitor.currentMonitorStatus.name,
                    )}
                    color={monitor.currentMonitorStatus.color || Gray500}
                    isMinimal={true}
                  />
                )}
                {/*
                 * A monitor a person tied to the device, and nothing else
                 * puts here (issue #9676): taken off the device, it keeps
                 * checking.
                 */}
                {isRemovable(monitor) && (
                  <Button
                    title={REMOVE_TIED_MONITOR_COPY.button}
                    buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                    buttonSize={ButtonSize.Small}
                    ariaLabel={translator.translateTemplate(
                      REMOVE_TIED_MONITOR_COPY.buttonAriaLabel,
                      { monitorName: monitor.name || "" },
                    )}
                    isAriaLabelTranslated={true}
                    dataTestId={`device-monitors-remove-${monitor._id?.toString()}`}
                    onClick={() => {
                      setRemoveError("");
                      setMonitorToRemove(monitor);
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Asks before a monitor is taken off the device, saying what that changes.
  const removeModal: ReactElement | null =
    monitorToRemove && props.networkDeviceId ? (
      <ConfirmModal
        title={REMOVE_TIED_MONITOR_COPY.dialogTitle}
        description={translator.translateTemplate(
          REMOVE_TIED_MONITOR_COPY.dialogDescription,
          { monitorName: monitorToRemove.name || "" },
        )}
        error={removeError || undefined}
        isLoading={isRemoving}
        submitButtonType={ButtonStyleType.DANGER}
        submitButtonText={REMOVE_TIED_MONITOR_COPY.button}
        onClose={closeRemove}
        onSubmit={() => {
          void removeTiedMonitor();
        }}
      />
    ) : null;

  /*
   * "Monitor web UI": Create Monitor on a Website monitor of the device's
   * management page (DeviceWebUiUtil), whatever else watches the device -
   * in the header, so it is there with or without monitors listed. For a
   * reader who may create monitors.
   */
  const webUiButton: ReactElement | null =
    props.networkDeviceId && props.canCreateMonitor ? (
      <Button
        key="monitor-web-ui"
        title="Monitor web UI"
        icon={IconProp.Globe}
        buttonStyle={ButtonStyleType.NORMAL}
        dataTestId="device-monitors-web-ui"
        onClick={() => {
          Navigation.navigate(
            getDeviceWebUiMonitorRoute(props.networkDeviceId as string),
          );
        }}
      />
    ) : null;

  /*
   * "Add Existing Monitor" (issue #9545): a Ping, Port or Website monitor
   * someone made by hand from Monitors > Create, before the device was
   * added or on another of its names, tied to this device - listed here
   * from then on, and counted by the duplicate check imports run. For a
   * reader who may tie monitors to devices; hidden otherwise, as Monitor
   * web UI is.
   */
  const addExistingButton: ReactElement | null =
    props.networkDeviceId && props.onMonitorAdded && canAddExistingMonitor() ? (
      <Button
        key="add-existing-monitor"
        title="Add Existing Monitor"
        icon={IconProp.Link}
        buttonStyle={ButtonStyleType.NORMAL}
        dataTestId="device-monitors-add-existing"
        onClick={() => {
          setIsAddingMonitor(true);
        }}
      />
    ) : null;

  const buttons: Array<ReactElement> = [webUiButton, addExistingButton].filter(
    (button: ReactElement | null): button is ReactElement => {
      return Boolean(button);
    },
  );

  const closeAddExisting: () => void = (): void => {
    setIsAddingMonitor(false);
    setAddExistingError("");
  };

  /*
   * Ties the picked monitor to the device, and nothing else about it. The
   * dialog stays open while it saves, and says why when the server refuses -
   * a monitor an import made for another device, a device the reader may
   * not read - rather than close as if it had worked.
   */
  const addExistingMonitor: (
    formData: AddExistingMonitorFormData,
  ) => Promise<void> = async (
    formData: AddExistingMonitorFormData,
  ): Promise<void> => {
    const monitorId: string = String(formData.monitorId || "").trim();

    if (!monitorId || !props.networkDeviceId) {
      closeAddExisting();
      return;
    }

    setIsSavingAddExisting(true);
    setAddExistingError("");

    try {
      await ModelAPI.updateById<Monitor>({
        modelType: Monitor,
        id: new ObjectID(monitorId),
        data: {
          networkDeviceId: new ObjectID(props.networkDeviceId),
        },
      });
    } catch (err) {
      setAddExistingError(API.getFriendlyMessage(err));
      setIsSavingAddExisting(false);
      return;
    }

    setIsSavingAddExisting(false);
    closeAddExisting();
    Toast.success(
      translator.translateText("Monitor added to this device.") ||
        "Monitor added to this device.",
    );
    props.onMonitorAdded?.();
  };

  /*
   * The monitor to add, from the ones a person made that check a host and
   * are no device's yet. The server checks the reader may read the device
   * and refuses a monitor an import made for another one.
   */
  const addExistingModal: ReactElement | null =
    isAddingMonitor && props.networkDeviceId ? (
      <BasicFormModal<AddExistingMonitorFormData>
        title="Add Existing Monitor"
        description="A monitor someone made that checks this device. It is listed here, and an import never gives the device a second one like it."
        submitButtonText="Add Monitor"
        isSubmitting={isSavingAddExisting}
        error={addExistingError || undefined}
        onClose={closeAddExisting}
        onSubmit={(formData: AddExistingMonitorFormData) => {
          void addExistingMonitor(formData);
        }}
        formProps={{
          fields: [
            {
              field: {
                monitorId: true,
              },
              title: "Monitor",
              description:
                "Ping, IP, Port, NTP, Website, API and SSL Certificate monitors tied to no device are listed.",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownModal: {
                type: Monitor,
                labelField: "name",
                valueField: "_id",
                sort: { name: SortOrder.Ascending },
                query: ADDABLE_MONITOR_QUERY,
                emptyListText: translationKey("No monitors to add yet."),
              },
              required: true,
              placeholder: "Select a monitor",
            },
          ],
        }}
      />
    ) : null;

  return (
    <Fragment>
      <Card
        title={
          props.isMonitorBacked
            ? "Monitors reporting on this device"
            : "Monitors alerting on this device"
        }
        buttons={buttons.length > 0 ? buttons : undefined}
        /*
         * Every kind of monitor the card lists: Network Device monitors that
         * read the device's polls and traps, and - since a discovery import
         * can give each device one from a template (OneUptime issues #5145,
         * #9546), and a person can tie one they made (#9545) - Ping, IP,
         * Port, NTP, Website, API and SSL Certificate monitors that check its
         * address or a URL on it.
         */
        description={
          props.isMonitorBacked
            ? "The monitor bound to this device decides its status; any other monitors here check it too."
            : "Monitors that check this device and open incidents or alerts."
        }
      >
        {getCardContent()}
      </Card>
      {addExistingModal}
      {removeModal}
    </Fragment>
  );
};

export default DeviceMonitorsCard;
