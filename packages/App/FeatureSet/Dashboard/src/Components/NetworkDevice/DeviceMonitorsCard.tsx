import MonitorElement from "../Monitor/Monitor";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { Gray500 } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
 * monitors, the Ping, IP, Port and NTP monitors a discovery import made for
 * it, and its web UI monitor) and passed in by the page so the Health charts
 * can share the same fetch.
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
              className="flex items-center justify-between py-3"
            >
              <div className="text-sm font-medium text-gray-900">
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
            </div>
          );
        })}
      </div>
    );
  };

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
        onClose={() => {
          setIsAddingMonitor(false);
        }}
        onSubmit={async (formData: AddExistingMonitorFormData) => {
          const monitorId: string = String(formData.monitorId || "").trim();

          if (!monitorId) {
            setIsAddingMonitor(false);
            return;
          }

          await ModelAPI.updateById<Monitor>({
            modelType: Monitor,
            id: new ObjectID(monitorId),
            data: {
              networkDeviceId: new ObjectID(props.networkDeviceId as string),
            },
          });

          setIsAddingMonitor(false);
          Toast.success(
            translator.translateText("Monitor added to this device.") ||
              "Monitor added to this device.",
          );
          props.onMonitorAdded?.();
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
         * can give each device one from a template (OneUptime issue #5145) -
         * Ping, IP, Port and NTP monitors that check its address.
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
    </Fragment>
  );
};

export default DeviceMonitorsCard;
