import React, { ReactElement, useRef, useState } from "react";

import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  MonitorCriteriaSeedIds,
  PingMonitorOrigin,
} from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
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
import ProbeUtil from "../../Utils/Probe";
import { provisionPingMonitorForDevice } from "./PingMonitorProvisioning";
import PingMonitorSeedIds from "./PingMonitorSeedIds";

/*
 * The fleet-wide half of "a monitor-backed device with nothing bound reads
 * Pending / No monitor forever".
 *
 * A NetworkDevice whose monitoring method is Monitor is never polled: nothing
 * walks it, and the only thing that can say whether it is up is the Ping or
 * IP monitor bound through `NetworkDevice.monitorId`. Discovery import can
 * create dozens of these in one go with nothing bound - the "create Ping
 * monitors" opt-in is off by default, because monitors are billable - and
 * the device page's "Create Ping Monitor" button fixes them one at a time.
 * This action is how an operator fixes a selection at once.
 *
 * Modelled on useBulkOidTemplateActions: same { bulkActions, modals } return,
 * same BasicFormModal, same per-item progress loop. The provisioning itself
 * is PingMonitorProvisioning's, shared with the create form and the device
 * page, so every surface creates the same monitor and says the same thing
 * about it.
 */

export interface BulkCreatePingMonitorsResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

/*
 * The one field the modal writes. A type alias rather than an interface so it
 * satisfies BasicFormModal's GenericObject constraint.
 */
type CreatePingMonitorsFormData = {
  probeIds: Array<string>;
};

/*
 * The two no-op outcomes, worded once so the tests and the orchestrating
 * page can pin them.
 *
 * They are reported through the FAILED list, prefixed "Skipped:". The bulk
 * progress modal has exactly two lists - succeeded and failed - and a device
 * this action did nothing to belongs in neither honestly: putting it under
 * "succeeded" claims a monitor was created, and dropping it from both makes
 * the totals stop adding up. "Skipped" in the failed list is the one report
 * that names the device, says nothing happened, and says why.
 */
export const SKIPPED_SNMP_DEVICE_MESSAGE: string =
  "Skipped: this device is polled over SNMP, so it does not use a bound monitor.";

export const SKIPPED_ALREADY_BOUND_MESSAGE: string =
  "Skipped: a monitor is already bound to this device.";

function useBulkCreatePingMonitors(): BulkCreatePingMonitorsResult {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<NetworkDevice> | null>(null);

  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoadingProbes, setIsLoadingProbes] = useState<boolean>(false);
  const [didProbeLoadFail, setDidProbeLoadFail] = useState<boolean>(false);

  /*
   * A project-level reason the action could not start at all, shown in its
   * own modal rather than N times over in the progress list - see the seed
   * id comment in createPingMonitors.
   */
  const [startupError, setStartupError] = useState<string | null>(null);

  /*
   * Which open of the modal a probe response belongs to. The modal is
   * closed and reopened freely, and a slow response from an earlier open
   * must not overwrite the list a later one fetched - the same "newest
   * selection wins" rule BulkLabelActions applies to its remove options.
   */
  const probeLoadSequence: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * Probes are fetched when the modal OPENS, never on mount. This hook is
   * called by the Devices list page, which two existing tests mount with
   * ModelTable mocked and no ModelAPI or Probe mocks in place for it - a
   * mount-time fetch would throw there, and a list page that fires a probe
   * request for a menu item most visits never open would be wrong anyway.
   *
   * On failure the modal still opens, with no probe options: the selection
   * is optional, the server picks the project's defaults when it is left
   * empty, and a fetch error is not a reason to refuse the action.
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
   * null when a monitor was created and bound; anything that goes wrong is
   * thrown to the loop, which reports it against the device.
   */
  type ProvisionOneFunction = (
    item: NetworkDevice,
    probeIds: Array<string>,
    seedIds: MonitorCriteriaSeedIds,
  ) => Promise<string | null>;

  const provisionOne: ProvisionOneFunction = async (
    item: NetworkDevice,
    probeIds: Array<string>,
    seedIds: MonitorCriteriaSeedIds,
  ): Promise<string | null> => {
    if (!item.id) {
      throw new BadDataException("Item ID not found");
    }

    /*
     * Re-read the device rather than trusting the row. The list's rows were
     * fetched when the page loaded; a device bound in another tab since
     * then, or one whose method was edited, would otherwise get a second
     * monitor it can never use - and a monitor is billable.
     */
    const device: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>({
      modelType: NetworkDevice,
      id: item.id,
      select: {
        _id: true,
        name: true,
        hostname: true,
        monitoringMethod: true,
        monitorId: true,
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
      return SKIPPED_SNMP_DEVICE_MESSAGE;
    }

    if (device.monitorId) {
      return SKIPPED_ALREADY_BOUND_MESSAGE;
    }

    await provisionPingMonitorForDevice({
      deviceId: item.id,
      deviceName: device.name || item.name || "",
      address: device.hostname || "",
      probeIds: probeIds,
      origin: PingMonitorOrigin.BulkAction,
      seedIds: seedIds,
    });

    return null;
  };

  /*
   * The per-item loop. Takes the action props explicitly rather than reading
   * them off state, for the same reason useBulkOidTemplateActions does: the
   * submit handler runs in the tick that closes the modal, before any state
   * write made there is visible.
   */
  type CreatePingMonitorsFunction = (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    probeIds: Array<string>,
  ) => Promise<void>;

  const createPingMonitors: CreatePingMonitorsFunction = async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    probeIds: Array<string>,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      actionProps;

    // Close the form modal first so the progress modal is visible.
    setShowModal(false);

    /*
     * The four ids a monitor's criteria are seeded with describe the
     * PROJECT, not any one device, so they are resolved once here and handed
     * to every provision call - a 200-device selection must not make 200
     * copies of the same three list requests.
     *
     * When they cannot be resolved (the project has no offline status, or no
     * incident severity) NO device can get a monitor, and the reason is not
     * about any device. That is surfaced ONCE, in its own modal, and the
     * action never starts: the alternative - starting the action and filing
     * every device under "failed" with the same project-level sentence - is
     * a report about 200 devices for a problem with one settings page, and
     * at that length the sentence naming the fix is the thing that gets
     * scrolled past. onBulkActionStart is deliberately not called before
     * this resolves, so the table's progress modal never opens on nothing.
     */
    let seedIds: MonitorCriteriaSeedIds;

    try {
      seedIds = await PingMonitorSeedIds.resolve();
    } catch (err) {
      setStartupError(API.getFriendlyMessage(err));
      setBulkActionProps(null);
      return;
    }

    onBulkActionStart();

    const totalItems: Array<NetworkDevice> = [...items];
    const inProgressItems: Array<NetworkDevice> = [...items];
    const successItems: Array<NetworkDevice> = [];
    const failedItems: Array<BulkActionFailed<NetworkDevice>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        const skippedMessage: string | null = await provisionOne(
          item,
          probeIds,
          seedIds,
        );

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

  const probeDropdownOptions: Array<DropdownOption> = probes
    .filter((probe: Probe): boolean => {
      return Boolean(probe._id);
    })
    .map((probe: Probe): DropdownOption => {
      return {
        label: probe.name || probe._id?.toString() || "",
        value: probe._id?.toString() || "",
      };
    });

  /*
   * Two permissions, because the action writes two models: it creates a
   * Monitor and then updates the NetworkDevice to point at it. Bulk actions
   * are handed straight to the table's action bar, which never checks
   * either, so a viewer on an otherwise gated table could otherwise create
   * a plan-counted monitor per selected row. The device gate is checked
   * first so its reason wins when both are missing - the action lives on
   * the device list, and that is the permission an operator on it expects
   * to be asked about.
   */
  const deviceUpdateGate: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  );

  const monitorCreateGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ) => BulkActionButtonSchema<NetworkDevice>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ): BulkActionButtonSchema<NetworkDevice> => {
    for (const gate of [deviceUpdateGate, monitorCreateGate]) {
      /*
       * Same rule as useBulkOidTemplateActions: "not allowed, and nothing
       * honest to say" (the permission snapshot is still loading) leaves
       * the action alone rather than accusing the user of a permission
       * they may well hold.
       */
      if (!gate.isAllowed && gate.disabledReason) {
        return {
          ...action,
          disabled: true,
          tooltip: gate.disabledReason,
        };
      }
    }

    return action;
  };

  /*
   * Offered whenever the selection holds at least one monitor-backed device.
   * An all-SNMP selection would only ever produce a list of "Skipped" rows,
   * so the action is withheld from it; a mixed selection keeps it, because
   * the monitor-backed devices in it are the point and the SNMP ones are
   * reported as skipped rather than touched. An empty selection reads as
   * visible, the convention every bulk-action hook here follows - the
   * action bar is not rendered for one anyway.
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

  const createPingMonitorsAction: BulkActionButtonSchema<NetworkDevice> = {
    title: "Create Ping Monitors",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Add,
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

  const probeFieldDescription: string = didProbeLoadFail
    ? "Optional. The project's probes could not be loaded just now, so the monitors will use the project's default probes. A probe has to be able to reach the device's network — a global probe on the public internet cannot ping a private address — so if these devices are on an internal network, create the monitors from a device's page once a probe deployed there can be picked, or change the probes on each monitor afterwards."
    : "Optional. Leave it empty to use the project's default probes. A probe has to be able to reach the device's network: a global probe on the public internet cannot ping a private (RFC 1918) address, so for devices on an internal network pick a custom probe deployed on that network.";

  const modals: ReactElement = (
    <>
      {showModal && (
        <BasicFormModal<CreatePingMonitorsFormData>
          title="Create Ping Monitors"
          /*
           * Says what will be created and what will be skipped, and nothing
           * about reachability: a fresh monitor is stamped with the project's
           * operational status before any probe has checked the address, so
           * the device reading Up straight after this is the monitor's
           * starting status, not a verdict.
           */
          description="Creates a Ping monitor on each selected monitor-backed device's hostname and binds it to the device, so the monitor's status becomes the device's status. Devices that already have a monitor bound are skipped, and so are SNMP devices — a probe polls those. Each monitor counts towards the plan's monitor limit. Incidents are off on these monitors by default, so they move the device's status without paging anyone; turn them on per monitor if you want that."
          isLoading={isLoadingProbes}
          onClose={closeModal}
          submitButtonText="Create Ping Monitors"
          onSubmit={async (formData: CreatePingMonitorsFormData) => {
            const actionProps: BulkActionOnClickProps<NetworkDevice> | null =
              bulkActionProps;

            setShowModal(false);

            if (!actionProps) {
              return;
            }

            /*
             * BasicForm hands a multi-select over as the picked values, or
             * as nothing at all when nothing was picked; either way what
             * reaches the provision call is a clean list of ids, and an
             * empty one means "the project's default probes"
             * (probeMiscDataProps translates it into no `probes` key).
             */
            const probeIds: Array<string> = Array.isArray(formData.probeIds)
              ? formData.probeIds.map((probeId: unknown): string => {
                  return String(probeId || "").trim();
                })
              : [];

            await createPingMonitors(actionProps, probeIds);
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeIds: true,
                },
                title: "Ping from probes",
                description: probeFieldDescription,
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: false,
                dropdownOptions: probeDropdownOptions,
                placeholder: "Project default probes",
              },
            ],
          }}
        />
      )}
      {startupError && (
        <Modal
          title="Ping Monitors Could Not Be Created"
          description="Nothing was created or changed. This is a project setting rather than a problem with any of the selected devices, so it is reported once instead of against every device."
          onClose={(): void => {
            setStartupError(null);
          }}
          closeButtonText="Close"
        >
          <ErrorMessage message={startupError} />
        </Modal>
      )}
    </>
  );

  return {
    bulkActions: [gateAction(createPingMonitorsAction)],
    modals: modals,
  };
}

export default useBulkCreatePingMonitors;
