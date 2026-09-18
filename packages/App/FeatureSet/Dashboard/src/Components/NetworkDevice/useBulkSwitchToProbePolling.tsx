import React, { ReactElement, useRef, useState } from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import PageMap from "../../Utils/PageMap";
import ProbeUtil from "../../Utils/Probe";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * The fleet-wide way out of "monitor-backed with nothing bound".
 *
 * Before ping-first polling, a device a probe could not walk over SNMP had
 * to be monitor-backed — a Ping monitor per phone, per camera, per PDU — and
 * discovery import created those by the dozen with nothing bound, because
 * monitors are billable and the opt-in is off by default. Every one of them
 * reads Pending / "No monitor" and is never polled. Now that a probe pings
 * every device it is assigned, the honest fix is to switch them back: give
 * each one a probe, and the probe pings it on its schedule (and walks it the
 * moment it has credentials). No monitor, nothing billable, a status from
 * the first poll.
 *
 * There is deliberately NO data migration doing this — a Monitor device's
 * probeId was never set, and only an operator knows which probe can reach
 * it. This action asks, once, for the selection. Modelled on
 * useBulkCreatePingMonitors: same { bulkActions, modals } return, same
 * BasicFormModal, same per-item progress loop, same lazy probe fetch.
 */

export interface BulkSwitchToProbePollingResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

export const SWITCH_TO_PROBE_POLLING_ACTION_TITLE: string =
  "Switch to Probe Polling";

/*
 * The one no-op outcome, worded once so the tests and the page can pin it.
 * Reported through the FAILED list with the "Skipped:" prefix, for the same
 * reason useBulkCreatePingMonitors does: the progress modal has exactly two
 * lists, and a device this action did nothing to belongs in neither
 * honestly — "succeeded" claims it was switched, dropping it makes the
 * totals stop adding up.
 */
export const SKIPPED_ALREADY_PROBE_POLLED_MESSAGE: string =
  "Skipped: already probe-polled.";

/*
 * The one field the modal writes. A type alias rather than an interface so
 * it satisfies BasicFormModal's GenericObject constraint.
 */
type SwitchToProbePollingFormData = {
  probeId: string;
};

function useBulkSwitchToProbePolling(): BulkSwitchToProbePollingResult {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<NetworkDevice> | null>(null);

  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoadingProbes, setIsLoadingProbes] = useState<boolean>(false);
  const [didProbeLoadFail, setDidProbeLoadFail] = useState<boolean>(false);

  /*
   * Which open of the modal a probe response belongs to, so a slow response
   * from an earlier open cannot overwrite the list a later one fetched.
   */
  const probeLoadSequence: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * Probes are fetched when the modal OPENS, never on mount: this hook is
   * called by the Devices list page, which other tests mount with no probe
   * mock in place, and a list page that fires a request for a menu item most
   * visits never open would be wrong anyway.
   *
   * Unlike the Ping-monitors action, a probe is REQUIRED here — a probe-
   * polled device with none is exactly the "No probe" Pending this action
   * exists to avoid creating — so a failed fetch is a reason to refuse the
   * action rather than to proceed without options.
   */
  const loadProbes: () => Promise<void> = async (): Promise<void> => {
    probeLoadSequence.current += 1;
    const sequence: number = probeLoadSequence.current;

    setIsLoadingProbes(true);
    setDidProbeLoadFail(false);

    let loadedProbes: Array<Probe> = [];
    let didFail: boolean = false;

    try {
      loadedProbes = await ProbeUtil.getAllProbes();
    } catch {
      didFail = true;
    }

    if (sequence !== probeLoadSequence.current) {
      return;
    }

    setProbes(loadedProbes);
    setDidProbeLoadFail(didFail);
    setIsLoadingProbes(false);
  };

  /*
   * One device. Returns the "Skipped:" message when there was nothing to do,
   * null when the device was switched; anything that goes wrong is thrown to
   * the loop, which reports it against the device.
   */
  type SwitchOneFunction = (
    item: NetworkDevice,
    probeId: ObjectID,
  ) => Promise<string | null>;

  const switchOne: SwitchOneFunction = async (
    item: NetworkDevice,
    probeId: ObjectID,
  ): Promise<string | null> => {
    if (!item.id) {
      throw new BadDataException("Item ID not found");
    }

    /*
     * Re-read the device rather than trusting the row. The list's rows were
     * fetched when the page loaded; a device switched in another tab since
     * then would otherwise have its probe overwritten by the one picked
     * here — and it may have been given that probe on purpose.
     */
    const device: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>({
      modelType: NetworkDevice,
      id: item.id,
      select: {
        _id: true,
        monitoringMethod: true,
      },
    });

    if (!device) {
      throw new BadDataException(
        "This device could not be read. It may have been deleted since the list was loaded.",
      );
    }

    if (
      !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        device.monitoringMethod,
      )
    ) {
      return SKIPPED_ALREADY_PROBE_POLLED_MESSAGE;
    }

    /*
     * The method and the probe, and nothing else. The server owns the rest
     * of the switch-over (clearing the old monitor stamp's residue, turning
     * polling back on and scheduling the first poll), the same way it owns
     * it when the method is changed on the Settings page — writing those
     * columns from here would be a second copy of that rule.
     */
    const updateData: JSONObject = {
      monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
      probeId: probeId,
    };

    await ModelAPI.updateById<NetworkDevice>({
      id: item.id,
      modelType: NetworkDevice,
      data: updateData,
    });

    return null;
  };

  /*
   * The per-item loop. Takes the action props explicitly rather than reading
   * them off state, for the same reason the other bulk hooks do: the submit
   * handler runs in the tick that closes the modal, before any state write
   * made there is visible.
   */
  type SwitchDevicesFunction = (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    probeId: ObjectID,
  ) => Promise<void>;

  const switchDevices: SwitchDevicesFunction = async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    probeId: ObjectID,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      actionProps;

    // Close the form modal first so the progress modal is visible.
    setShowModal(false);

    onBulkActionStart();

    const totalItems: Array<NetworkDevice> = [...items];
    const inProgressItems: Array<NetworkDevice> = [...items];
    const successItems: Array<NetworkDevice> = [];
    const failedItems: Array<BulkActionFailed<NetworkDevice>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        const skippedMessage: string | null = await switchOne(item, probeId);

        if (skippedMessage) {
          failedItems.push({
            item: item,
            failedMessage: skippedMessage,
          });
        } else {
          successItems.push(item);
        }
      } catch (err) {
        failedItems.push({
          item: item,
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
    setBulkActionProps(null);
  };

  /*
   * Every probe the project can use, global ones labelled as such: a global
   * probe sits on the public internet and cannot ping a private address,
   * which is where most of this fleet lives, so the label is the one hint
   * the picker can give. None is excluded — a device on a public address is
   * a real case.
   */
  const probeDropdownOptions: Array<DropdownOption> = probes
    .filter((probe: Probe): boolean => {
      return Boolean(probe._id);
    })
    .map((probe: Probe): DropdownOption => {
      const name: string = probe.name || probe._id?.toString() || "";

      return {
        label: probe.isGlobalProbe ? `${name} (global)` : name,
        value: probe._id?.toString() || "",
      };
    });

  /*
   * Bulk actions are handed straight to the table's action bar, which never
   * checks permissions — so a viewer on an otherwise gated table could
   * otherwise re-point every device they had selected. This is an update of
   * the records it touches, and nothing else.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ) => BulkActionButtonSchema<NetworkDevice>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ): BulkActionButtonSchema<NetworkDevice> => {
    /*
     * Same rule as the other bulk hooks: "not allowed, and nothing honest
     * to say" (the permission snapshot is still loading) leaves the action
     * alone rather than accusing the user of a permission they may hold.
     */
    if (updateGate.isAllowed || !updateGate.disabledReason) {
      return action;
    }

    return {
      ...action,
      disabled: true,
      tooltip: updateGate.disabledReason,
    };
  };

  /*
   * Offered whenever the selection holds at least one monitor-backed device.
   * An all-probe-polled selection would only ever produce a list of
   * "Skipped" rows, so the action is withheld from it; a mixed selection
   * keeps it, because the monitor-backed devices in it are the point and the
   * rest are reported as skipped rather than touched. An empty selection
   * reads as visible, the convention every bulk-action hook here follows —
   * the action bar is not rendered for one anyway.
   */
  type HasMonitorBackedDeviceFunction = (
    items: Array<NetworkDevice>,
  ) => boolean;

  const hasMonitorBackedDevice: HasMonitorBackedDeviceFunction = (
    items: Array<NetworkDevice>,
  ): boolean => {
    if (items.length === 0) {
      return true;
    }

    return items.some((item: NetworkDevice): boolean => {
      return NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        item.monitoringMethod,
      );
    });
  };

  const switchToProbePollingAction: BulkActionButtonSchema<NetworkDevice> = {
    title: SWITCH_TO_PROBE_POLLING_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Signal,
    isVisible: hasMonitorBackedDevice,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowModal(true);
      await loadProbes();
    },
  };

  const closeModal: () => void = (): void => {
    /*
     * Invalidate any probe fetch still in flight for this open, so it does
     * not write state into a modal that is no longer there.
     */
    probeLoadSequence.current += 1;
    setIsLoadingProbes(false);
    setShowModal(false);
    setBulkActionProps(null);
  };

  const probesSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
  );

  const hasNoProbes: boolean =
    !isLoadingProbes && !didProbeLoadFail && probeDropdownOptions.length === 0;

  const modals: ReactElement = (
    <>
      {showModal && didProbeLoadFail && (
        <Modal
          title="Probes Could Not Be Loaded"
          description="Nothing was changed. A probe is required — it is what will ping these devices — and the project's probes could not be loaded just now. Try again in a moment."
          onClose={closeModal}
          closeButtonText="Close"
        >
          <ErrorMessage message="The project's probes could not be loaded." />
        </Modal>
      )}
      {showModal && hasNoProbes && (
        <Modal
          title="No Probes Yet"
          description="A probe-polled device is pinged by the probe assigned to it, so there has to be one that can reach these devices. Create a custom probe on their network first, then come back and switch them."
          onClose={closeModal}
          closeButtonText="Close"
        >
          <AppLink
            to={probesSettingsRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            Create a custom probe
          </AppLink>
        </Modal>
      )}
      {showModal && !didProbeLoadFail && !hasNoProbes && (
        <BasicFormModal<SwitchToProbePollingFormData>
          title={SWITCH_TO_PROBE_POLLING_ACTION_TITLE}
          /*
           * Says what changes and what does not. The bound monitor is left
           * in place — it may be paging somebody — but it stops being the
           * device's status; the probe's poll is.
           */
          description="Switches each selected monitor-backed device to probe polling: the probe you pick pings it on its schedule, and walks it over SNMP as well once it has credentials, so the device has a status from its first poll — with no monitor needed. A monitor already bound to a device stays bound, but the device's status comes from the probe from now on. Devices that are already probe-polled are skipped."
          isLoading={isLoadingProbes}
          onClose={closeModal}
          submitButtonText={SWITCH_TO_PROBE_POLLING_ACTION_TITLE}
          onSubmit={async (formData: SwitchToProbePollingFormData) => {
            const actionProps: BulkActionOnClickProps<NetworkDevice> | null =
              bulkActionProps;

            setShowModal(false);

            if (!actionProps) {
              return;
            }

            /*
             * The field is required, so an empty id means the option itself
             * came back without one. Writing "" would fail every device over
             * one unusable option, so stop before starting.
             */
            const probeId: string = String(formData.probeId || "").trim();

            if (!probeId) {
              setBulkActionProps(null);
              return;
            }

            await switchDevices(actionProps, new ObjectID(probeId));
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeId: true,
                },
                title: "Probe",
                description:
                  "The probe that will ping these devices on their schedule, and walk them over SNMP when they have credentials. It has to be able to reach them directly: a global probe on the public internet cannot ping a private (RFC 1918) address, so for devices on an internal network pick a custom probe deployed on that network.",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: probeDropdownOptions,
                placeholder: "Select a probe",
              },
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [gateAction(switchToProbePollingAction)],
    modals: modals,
  };
}

export default useBulkSwitchToProbePolling;
