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
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { runBulkAction } from "Common/UI/Components/BulkUpdate/BulkActionRunner";
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
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

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

export const SWITCH_TO_PROBE_POLLING_ACTION_TITLE: string = translationKey(
  "Switch to Probe Polling",
);

/*
 * The one no-op outcome, worded once so the tests and the page can pin it.
 * Reported through the FAILED list with the "Skipped:" prefix, for the same
 * reason useBulkCreatePingMonitors does: the progress modal has exactly two
 * lists, and a device this action did nothing to belongs in neither
 * honestly — "succeeded" claims it was switched, dropping it makes the
 * totals stop adding up.
 */
export const SKIPPED_ALREADY_PROBE_POLLED_MESSAGE: string = translationKey(
  "Skipped: already probe-polled.",
);

/*
 * The one field the modal writes. A type alias rather than an interface so
 * it satisfies BasicFormModal's GenericObject constraint.
 */
type SwitchToProbePollingFormData = {
  probeId: string;
};

function useBulkSwitchToProbePolling(): BulkSwitchToProbePollingResult {
  const translator: Translator = useTranslator();
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
        translationKey(
          "This device could not be read. It may have been deleted since the list was loaded.",
        ),
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
    // Close the form modal first so the progress modal is visible.
    setShowModal(false);

    /*
     * Through the shared runner (progress, Stop, failures by device), one
     * device at a time: how a device is monitored decides which of its
     * site's alert policies watch it, and each switch matches them again.
     */
    await runBulkAction<NetworkDevice>({
      actionProps: actionProps,
      concurrency: 1,
      step: async (item: NetworkDevice): Promise<void> => {
        let skippedMessage: string | null = null;

        try {
          skippedMessage = await switchOne(item, probeId);
        } catch (err) {
          const message: string = API.getFriendlyMessage(err);

          // The progress list shows it as given: a fixed sentence is looked up.
          throw new Error(translator.translateText(message) || message);
        }

        // Skipped, and listed with why among the devices not switched.
        if (skippedMessage) {
          throw new Error(
            translator.translateText(skippedMessage) || skippedMessage,
          );
        }
      },
    });

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
        label: probe.isGlobalProbe
          ? translator.translateTemplate("{{name}} (global)", { name: name })
          : name,
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
          description="Nothing was changed: your probes could not be loaded. Try again in a moment."
          onClose={closeModal}
          closeButtonText="Close"
        >
          <ErrorMessage message="The project's probes could not be loaded." />
        </Modal>
      )}
      {showModal && hasNoProbes && (
        <Modal
          title="No Probes Yet"
          description="No probe can reach these devices yet. Add a probe on their network first, then try again."
          onClose={closeModal}
          closeButtonText="Close"
        >
          <AppLink
            to={probesSettingsRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText("Create a custom probe") || ""}
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
          description="The probe you pick pings each device, and walks it when it has credentials. Bound monitors stay, but the probe sets the status."
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
                  "It must reach these devices directly: pick a probe on their network.",
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
