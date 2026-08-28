import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Probe from "Common/Models/DatabaseModels/Probe";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import Includes from "Common/Types/BaseDatabase/Includes";
import Route from "Common/Types/API/Route";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ProbeUtil from "../../Utils/Probe";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  MONITORING_METHOD_OPTIONS,
  isMonitorBackedDevice,
  isSnmpDevice,
} from "../NetworkDevice/MonitoringMethodFormFields";
import {
  DEVICE_ROLE_FIELD_DESCRIPTION,
  DEVICE_ROLE_FIELD_TITLE,
  DEVICE_ROLE_OPTIONS,
} from "../NetworkDevice/DeviceRoleFormFields";
import { getSnmpConfigFormFields } from "../../Pages/NetworkDevice/SnmpConfigFormFields";
import {
  NeighborAdoptionDraft,
  buildNeighborAdoptionDraft,
  unanimousId,
} from "./AdoptNeighborUtil";

/*
 * "Add to Monitoring" for an unmanaged neighbour on the topology map —
 * issue #3435.
 *
 * The map has always known these devices: a CDP or LLDP neighbour with a
 * name, a platform string and the switch port it hangs off. What it could
 * not do was act on any of it, so an operator who spotted an unmonitored IP
 * phone in their topology had to leave the map, open Network > Devices >
 * Create, and retype what OneUptime had already discovered. This dialog is
 * that trip, pre-filled.
 *
 * It deliberately reuses the SAME field helpers as the create form on the
 * Devices list rather than declaring its own: two ways of creating one kind
 * of device would drift, and the second one would be the one nobody
 * remembers to update.
 */

export interface ComponentProps {
  node: NetworkTopologyNode;
  edges: Array<NetworkTopologyEdge>;
  nodeById: Map<string, NetworkTopologyNode>;
  onClose: () => void;
  // Called after the device exists; the caller refetches the graph.
  onSuccess: (device: NetworkDevice) => void;
}

/*
 * What the adjacent managed devices agree on, and are therefore worth
 * inheriting. Both are ids in string form because that is what a form
 * dropdown option holds — an ObjectID instance would never compare equal.
 */
interface InheritedPlacement {
  probeId?: string | undefined;
  siteId?: string | undefined;
}

const AddNeighborToMonitoringModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [inherited, setInherited] = useState<InheritedPlacement>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Worked out ONCE, when the dialog opens, and deliberately not kept in
   * step with the map afterwards.
   *
   * The map behind this dialog refreshes every sixty seconds, and a
   * refreshed graph is a new edge array and a new node map. Recomputing
   * from those would mean a second switch starting to report this peer —
   * or the peer moving ports — re-running the inheritance fetch, swapping
   * the form for the loader, and discarding whatever the operator had
   * typed, mid-wizard and with no explanation. The dialog is a form: it
   * should be a snapshot of the moment it was opened. Its caller keys it on
   * the node id, so a DIFFERENT node still gets a fresh one.
   */
  const [draft] = useState<NeighborAdoptionDraft>(() => {
    return buildNeighborAdoptionDraft({
      node: props.node,
      edges: props.edges,
      nodeById: props.nodeById,
    });
  });

  /*
   * The ids of the managed devices this peer hangs off, as a stable string
   * so the effect below does not refire on every render of an array that
   * happens to be rebuilt each time.
   */
  const neighborDeviceIdKey: string = draft.links
    .map((link: { deviceId: string }) => {
      return link.deviceId;
    })
    .join(",");

  useEffect(() => {
    let isMounted: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const allProbes: Array<Probe> = await ProbeUtil.getAllProbes();

        /*
         * The switches this peer is cabled to. A device on a switch port is
         * on that switch's network, so the probe that reaches the switch
         * reaches it and the site that contains the switch contains it —
         * which is the difference between a form with two more fields to
         * fill in and one the operator can submit as it stands.
         */
        const neighborIds: Array<string> = neighborDeviceIdKey
          .split(",")
          .filter((id: string) => {
            return id.length > 0;
          });

        let placement: InheritedPlacement = {};

        if (neighborIds.length > 0) {
          const neighbors: ListResult<NetworkDevice> =
            await ModelAPI.getList<NetworkDevice>({
              modelType: NetworkDevice,
              query: {
                _id: new Includes(neighborIds),
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                probeId: true,
                siteId: true,
              },
              sort: {},
            });

          placement = {
            probeId: unanimousId(
              neighbors.data.map((device: NetworkDevice) => {
                return device.probeId?.toString();
              }),
            ),
            siteId: unanimousId(
              neighbors.data.map((device: NetworkDevice) => {
                return device.siteId?.toString();
              }),
            ),
          };
        }

        if (!isMounted) {
          return;
        }

        setProbes(allProbes);
        setInherited(placement);
      } catch (err) {
        if (isMounted) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (isMounted) {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [neighborDeviceIdKey]);

  /*
   * Built only once the probe list has landed, because BasicForm reads
   * initialValues ONCE — on the first render in which the fields exist —
   * and a probe id seeded before its dropdown had options would be seeded
   * into a form that then never re-reads it.
   */
  const initialValues: FormValues<NetworkDevice> = useMemo(() => {
    const values: Record<string, unknown> = {
      name: draft.name,
      hostname: draft.hostname,
      description: draft.description,
      monitoringMethod: draft.monitoringMethod,
    };

    if (draft.deviceRole) {
      values["deviceRole"] = draft.deviceRole;
    }

    /*
     * Only for a device that will actually be polled. Handing a probe to a
     * monitor-backed device would be handing it a poller it never uses, and
     * the field is hidden on that branch anyway.
     */
    if (
      inherited.probeId &&
      draft.monitoringMethod === NetworkDeviceMonitoringMethod.Snmp
    ) {
      values["probe"] = inherited.probeId;
    }

    if (inherited.siteId) {
      values["site"] = inherited.siteId;
    }

    return values as FormValues<NetworkDevice>;
  }, [draft, inherited.probeId, inherited.siteId]);

  const formFields: Fields<NetworkDevice> = useMemo(() => {
    return [
      {
        field: {
          monitoringMethod: true,
        },
        title: "How is this device monitored?",
        stepId: "monitoring-method",
        description:
          "SNMP devices are polled by a probe you assign. Pick Monitor for gear that cannot be walked — an IP phone, a camera, a PDU — and bind it to a Ping or IP monitor instead. Either way the device keeps its place on the topology map.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: MONITORING_METHOD_OPTIONS,
        required: true,
        placeholder: "Monitoring method",
      },
      {
        field: {
          name: true,
        },
        title: "Name",
        stepId: "device-details",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        /*
         * The one field on this form with a wrong answer that is not
         * obviously wrong. The map re-attaches this device to the cable it
         * was discovered on by comparing what its neighbours advertise
         * against this name and the hostname below — so a friendlier name
         * typed here, with no hostname the neighbours would recognise,
         * leaves the peer on the map as a separate unmanaged node.
         */
        description:
          "The name this device advertises to its neighbours. Keep it, or set the hostname below to an address they report, so the map recognises this device as the one it already draws.",
        placeholder: "core-switch-01",
      },
      {
        field: {
          hostname: true,
        },
        title: "Hostname",
        stepId: "device-details",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "10.0.0.1 or switch-01.example.com",
        description:
          "The device's address. SNMP devices are polled here; for monitor-backed devices it is how the device is identified and matched to SNMP traps.",
      },
      {
        field: {
          deviceRole: true,
        },
        title: DEVICE_ROLE_FIELD_TITLE,
        stepId: "device-details",
        description: DEVICE_ROLE_FIELD_DESCRIPTION,
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: DEVICE_ROLE_OPTIONS,
        required: false,
        placeholder: "Worked out from the device (SNMP only)",
      },
      {
        field: {
          description: true,
        },
        title: "Description",
        stepId: "device-details",
        fieldType: FormFieldSchemaType.LongText,
        required: false,
        placeholder: "Where this device was discovered",
      },
      {
        field: {
          monitor: true,
        },
        title: "Monitor",
        stepId: "probe-and-site",
        showIf: isMonitorBackedDevice,
        description:
          "The monitor whose status IS this device's status. A Ping or IP monitor on the device's address is the usual choice. Leave it empty to record the device now and bind a monitor later — it still belongs to a site and still appears on the map.",
        sideLink: {
          text: "Create a monitor",
          url: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MONITORS] as Route,
          ),
          openLinkInNewTab: true,
        },
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownModal: {
          type: Monitor,
          labelField: "name",
          valueField: "_id",
        },
        required: false,
        placeholder: "Select Monitor (optional)",
      },
      {
        field: {
          probe: true,
        },
        title: "Probe",
        stepId: "probe-and-site",
        showIf: isSnmpDevice,
        description:
          "The probe that polls this device. It has to reach the device directly, so the probe already polling the switch this device hangs off is pre-selected when every neighbouring device agrees on one.",
        sideLink: {
          text: "Create a custom probe",
          url: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
          ),
          openLinkInNewTab: true,
        },
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: probes
          .filter((probe: Probe) => {
            return Boolean(probe.name && probe._id);
          })
          .map((probe: Probe) => {
            return {
              label: probe.name!,
              value: probe._id!,
            };
          }),
        required: true,
        placeholder: "Probe",
      },
      {
        field: {
          site: true,
        },
        title: "Site",
        stepId: "probe-and-site",
        description:
          "The network site this device belongs to. Pre-selected from the devices it is cabled to when they all agree.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownModal: {
          type: NetworkSite,
          labelField: "name",
          valueField: "_id",
        },
        required: false,
        placeholder: "Select Site (optional)",
      },
      ...getSnmpConfigFormFields({ stepId: "snmp" }),
    ] as Fields<NetworkDevice>;
  }, [probes]);

  /*
   * One button on each of these two, not two. ConfirmModal renders a close
   * button whenever onClose is set AND a submit button for onSubmit, so
   * wiring both to "dismiss this" put two controls side by side — and on
   * the loading branch the second was the word "Cancel" rendered disabled
   * under a spinner.
   */
  if (error) {
    return (
      <ConfirmModal
        title={`Add ${props.node.name} to monitoring`}
        description={error}
        submitButtonText="Close"
        onSubmit={props.onClose}
      />
    );
  }

  if (isLoading) {
    /*
     * Held behind a loader rather than opened empty and filled in later.
     * BasicForm reads its initial values ONCE, on the first render in which
     * the fields exist, so a probe or a site that landed afterwards would be
     * computed correctly and then never reach a single field.
     */
    return (
      <ConfirmModal
        title={`Add ${props.node.name} to monitoring`}
        description="Reading what the map already knows about this device..."
        submitButtonText="Cancel"
        onSubmit={props.onClose}
      />
    );
  }

  return (
    <ModelFormModal<NetworkDevice>
      modelType={NetworkDevice}
      name="Add Unmanaged Neighbour To Monitoring"
      title={`Add ${props.node.name} to monitoring`}
      description={[draft.provenance, ...draft.warnings].join(" ")}
      submitButtonText="Add Device"
      modalWidth={ModalWidth.Medium}
      initialValues={initialValues}
      onClose={props.onClose}
      onSuccess={(device: NetworkDevice) => {
        props.onSuccess(device);
      }}
      formProps={{
        name: "Add Unmanaged Neighbour To Monitoring",
        modelType: NetworkDevice,
        id: "add-neighbor-to-monitoring-form",
        formType: FormType.Create,
        steps: [
          {
            title: "Monitoring",
            id: "monitoring-method",
          },
          {
            title: "Device Details",
            id: "device-details",
          },
          {
            title: "Probe & Site",
            id: "probe-and-site",
          },
          {
            /*
             * Hidden wholesale for a monitor-backed device, exactly as the
             * Devices create form hides it: nothing polls such a device, so
             * there is nothing for a credential to be used for.
             */
            title: "SNMP Credentials",
            id: "snmp",
            showIf: isSnmpDevice,
          },
        ],
        fields: formFields,
      }}
    />
  );
};

export default AddNeighborToMonitoringModal;
