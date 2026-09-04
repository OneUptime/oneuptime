import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ProbeUtil from "../../Utils/Probe";
import Route from "Common/Types/API/Route";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "Common/Models/DatabaseModels/Probe";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import OneUptimeDate from "Common/Types/Date";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelField, {
  CustomElementProps,
} from "Common/UI/Components/Forms/Types/Field";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import SnmpConfigListEditor from "../../Components/NetworkDevice/SnmpConfigListEditor";
import { DEFAULT_SNMP_VERSION } from "./SnmpConfigFormFields";
import { DiscoveryScanSnmpConfig } from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import {
  MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
  isIcmpOnlyScan,
  isSnmpStepNeeded,
  validateRescanInterval,
  validateScanName,
  validateScanTarget,
  validateSnmpConfigs,
} from "./DiscoveryScanFormValidation";
import ScanModeUtil, {
  ScanMethodLabel,
} from "Common/Utils/NetworkDiscovery/ScanModeUtil";
import {
  buildDeviceName,
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
} from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeReverseDnsName } from "Common/Utils/NetworkDiscovery/ReverseDnsNameUtil";
import {
  buildPingMonitorForDiscoveredHost,
  MonitorCriteriaSeedIds,
} from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import PingMonitorSeedIds from "../../Components/NetworkDevice/PingMonitorSeedIds";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  DiscoveryScanOutcome,
  getDiscoveredHosts,
  summarizeDiscoveryScan,
} from "../../Components/NetworkDevice/DiscoveryScanOutcome";
import {
  DiscoveredHostFilter,
  DiscoveredHostFilterOption,
  ImportedIpAddressesByScanId,
  ShownDiscoveredHost,
  areAllShownHostsSelected,
  countSelectableShownHosts,
  getDiscoveredHostFilterEmptyMessage,
  getDiscoveredHostFilterLabel,
  getDiscoveredHostFilterOptions,
  getDiscoveredHostsToImport,
  getImportedIpAddressesForScan,
  getInitialSelection,
  getShownDiscoveredHosts,
  isPingOnlyDiscoveredHost,
  isSelectableDiscoveredHost,
  markDiscoveredHostsAsRegistered,
  normalizeDiscoveredHosts,
  toggleSelectionForShownHosts,
  withImportedIpAddresses,
} from "../../Components/NetworkDevice/DiscoveredHostFilter";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

type DiscoveredDeviceEntry = DiscoveredNetworkDevice;

/*
 * The scan's optional name — the first field of the create wizard, and the
 * first field of the Edit dialog.
 *
 * It carries a `stepId` because the wizard is stepped. The Edit dialog is not,
 * and simply does not read it: BasicForm renders every field when a form
 * declares no steps, and Validation skips its step guard for the same reason.
 * See Common/UI/Components/Forms/BasicForm.
 */
const SCAN_NAME_FORM_FIELD: ModelField<NetworkDeviceDiscoveryScan> = {
  field: {
    name: true,
  },
  title: "Name",
  stepId: "scan-target",
  fieldType: FormFieldSchemaType.Text,
  required: false,
  placeholder: "Router Discovery - Region 1100",
  /*
   * Deliberately the FIRST thing the wizard asks for, and deliberately not
   * required. A scan is identified in the list by whatever is here, falling
   * back to its target — so the question is worth asking before the target is
   * typed, and worth not insisting on for the operator sweeping one subnet
   * once (issue #3391).
   */
  description:
    "Optional. What this scan is for - 'Router Discovery - Region 1100' - so you can tell it apart from other scans without matching address ranges by eye. The list shows the scan target instead when this is empty.",
  customValidation: validateScanName,
};

/*
 * The three questions a discovery scan is defined by, in the order they are
 * asked. Declared once and handed to BOTH the create wizard on the table and
 * the Edit dialog below, because a step the edit form does not have is a
 * setting that can be created and then never corrected — which is the whole
 * of OneUptime issue #3444.
 */
const DISCOVERY_SCAN_FORM_STEPS: Array<FormStep<NetworkDeviceDiscoveryScan>> = [
  { title: "Scan Target", id: "scan-target" },
  /*
   * The middle step is SKIPPED for an ICMP-only scan, rather than shown with
   * everything on it hidden: BasicForm validates only the fields of the step
   * being submitted, so a step that is not in this list can never be that step
   * — which is what stops "SNMP Version is required" blocking a scan that was
   * never going to send SNMP (issue #3445).
   *
   * A NAMED predicate, not an inline arrow: NetworkFormStepsInvariants parses
   * this block out of the source expecting string literals and predicate names,
   * and an inline arrow could carry a `]}` that truncates its match.
   */
  { title: "SNMP Credentials", id: "snmp", showIf: isSnmpStepNeeded },
  { title: "Schedule", id: "schedule" },
];

export type GetDiscoveryScanFormFieldsFunction = (
  probes: Array<Probe>,
) => Array<ModelField<NetworkDeviceDiscoveryScan>>;

/*
 * Every field of a discovery scan, for both the create wizard and the Edit
 * dialog. A factory rather than a constant only because the probe dropdown's
 * options are fetched at runtime.
 *
 * ONE definition on purpose. Two copies would be two sets of descriptions, two
 * validators and two `showIf` chains to keep in step, and the copy that
 * drifted would be the edit one — the one nobody exercises until they are
 * already trying to fix a scan that is not working.
 */
const getDiscoveryScanFormFields: GetDiscoveryScanFormFieldsFunction = (
  probes: Array<Probe>,
): Array<ModelField<NetworkDeviceDiscoveryScan>> => {
  return [
    SCAN_NAME_FORM_FIELD,
    {
      field: {
        cidr: true,
      },
      title: "Scan Target",
      stepId: "scan-target",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "192.168.1.0/24",
      /*
       * Both notations are described here rather than only CIDR because
       * octet ranges are the only way to express the common real-world
       * shape "the same handful of addresses in every one of these
       * /24s" without creating hundreds of separate scans.
       */
      description:
        "Either a subnet in CIDR notation (192.168.1.0/24), or an octet range where any octet may be an inclusive low-high range — 10.16-22.0-255.51-66 sweeps .51 to .66 in every /24 from 10.16 to 10.22. " +
        `A single scan may cover at most ${ScanTargetUtil.MAX_SCAN_HOSTS.toLocaleString("en-US")} addresses.`,
      /*
       * Parses the target with exactly the function the server validates
       * it with, on the step it was typed on. Without this the field's
       * only check was `required`, so any non-empty string — a phone
       * number, a hostname, a reversed octet range — walked through all
       * three steps and surfaced as one combined banner above the
       * Schedule step (issue #3377).
       *
       * It covers the length ceiling too, so no `validation.maxLength`
       * is declared beside it: ModelForm infers 100 from the ShortText
       * column, but customValidation runs after validateLength and would
       * overwrite that message anyway — and the parser's own cap is the
       * 64 the server enforces, not the column's 100.
       */
      customValidation: validateScanTarget,
      /*
       * The most surprising thing about an octet range is how much of it there
       * is: 10.16-22.0-255.51-66 is 28,672 addresses, and nothing on the form
       * said so until the sweep had been queued.
       *
       * Gated on the COUNT rather than on validity, so a target OVER the
       * ceiling — the one case where the size is the entire problem — still
       * states its size next to the error explaining it. countHosts returns 0
       * for anything it cannot parse, so a half-typed target says nothing at
       * all and never talks over the inline validation message.
       */
      getFooterElement: (
        values: FormValues<NetworkDeviceDiscoveryScan>,
      ): ReactElement | undefined => {
        const hostCount: number = ScanTargetUtil.countHosts(
          String(values.cidr ?? "").trim(),
        );

        if (!hostCount) {
          return undefined;
        }

        return (
          <p className="mt-1 text-xs text-gray-500">
            {`This target sweeps ${hostCount.toLocaleString("en-US")} ${
              hostCount === 1 ? "address" : "addresses"
            }.`}
          </p>
        );
      },
    },
    {
      field: {
        probe: true,
      },
      title: "Probe",
      stepId: "scan-target",
      /*
       * A probe can only sweep a subnet it can actually route to, so
       * this list is the real constraint on what you can discover — not
       * a preference. Say so here rather than letting the operator pick
       * a probe in another network and wait for an empty result.
       */
      description:
        "The probe that sweeps this subnet. It has to be able to reach the subnet directly — a probe in another network, or outside the firewall, will scan and find nothing. If you have no probe deployed on this network yet, create a custom probe and run it there; it appears in this list once it connects.",
      sideLink: {
        text: "Create a custom probe",
        url: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
        ),
        openLinkInNewTab: true,
      },
      fieldType: FormFieldSchemaType.Dropdown,
      /*
       * A probe with no id cannot be scanned with, so it is dropped.
       * A probe with no NAME still can be, so it is kept under a
       * stand-in label.
       *
       * This used to throw for either. The .map runs in the component's
       * render body, not lazily when the create modal opens, so a single
       * unnamed probe row — a global probe, or one registered before it
       * was named — did not degrade the dropdown: it threw during render
       * and blanked the entire Discovery Scans page, including the list
       * of existing scans.
       */
      dropdownOptions: probes
        .filter((probe: Probe) => {
          return Boolean(probe._id);
        })
        .map((probe: Probe) => {
          return {
            label: probe.name || `Probe ${probe._id}`,
            value: probe._id!,
          };
        }),
      required: true,
      placeholder: "Probe",
    },
    /*
     * The scan's method, on the step BEFORE the one it hides — never on the
     * step it hides. BasicForm navigates the FILTERED step array, so a toggle
     * living on a step it can remove would leave currentFormStepId naming a
     * step that is no longer there: findIndex returns -1, the advance branch is
     * skipped, and Next silently does nothing while still reading "Next".
     */
    {
      field: {
        isSnmpEnabled: true,
      },
      title: "Check SNMP on hosts that answer",
      stepId: "scan-target",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      /*
       * A toggle is never "optional" in the sense that label means, and
       * FieldLabel appends "(Optional)" to every non-required field.
       */
      hideOptionalLabel: true,
      sectionTitle: "What to check",
      sectionDescription:
        "Every scan pings each address in the range to find what is alive. SNMP is the second question: it is what gives a device its name and vendor, and what lets OneUptime poll it for interfaces and health.",
      description:
        "Leave this on to identify what answers, using the credentials on the next step. Turn it off for an ICMP-only sweep: no SNMP packet is sent, no credentials are asked for, and the SNMP step is skipped. Everything an ICMP-only scan finds imports as a device pinged by the scan's probe; add SNMP credentials later for inventory.",
      /*
       * Clear the credentials on the way past. Hiding the fields is not enough
       * on its own: ModelForm builds the request body from every DECLARED field
       * without checking whether it was visible, so a v3 passphrase typed
       * before the operator changed their mind would be stored on a scan that
       * will never send it.
       *
       * FormField calls this BEFORE setFieldValue, and setFieldValue spreads
       * from the object handed back here, so the clearing survives the very
       * keystroke that caused it.
       *
       * snmpVersion is RESET to its default rather than cleared. Clearing it
       * leaves a required Dropdown holding nothing, which then fails with
       * "SNMP Version is required" on a control that visibly reads V2c the
       * moment the operator turns SNMP back on — issue #3445's own symptom,
       * reintroduced on the way out of it.
       */
      onChange: (
        value: boolean,
        currentFormValues: FormValues<NetworkDeviceDiscoveryScan>,
        setNewFormValues: (
          values: FormValues<NetworkDeviceDiscoveryScan>,
        ) => void,
      ): void => {
        if (value) {
          return;
        }

        setNewFormValues({
          ...currentFormValues,
          isSnmpEnabled: false,
          /*
           * The credential LIST first, because that is where a scan's
           * community strings and v3 passphrases actually live now (issue
           * #3458). The flattened fields below it are no longer collected by
           * this form at all — the editor writes them server-side, mirrored
           * from the list's first entry — but they are cleared here too, so a
           * value that reached the form some other way cannot ride along on a
           * scan that will never send SNMP.
           */
          snmpConfigs: undefined,
          snmpVersion: DEFAULT_SNMP_VERSION,
          snmpCommunityString: undefined,
          snmpPort: undefined,
          snmpV3SecurityLevel: undefined,
          snmpV3Username: undefined,
          snmpV3AuthProtocol: undefined,
          snmpV3AuthKey: undefined,
          snmpV3PrivProtocol: undefined,
          snmpV3PrivKey: undefined,
        });
      },
    },
    /*
     * The scan's ORDERED LIST of SNMP credential sets, first match wins.
     *
     * This step used to spread the nine flat fields from
     * getSnmpConfigFormFields — the same helper the NetworkDevice forms still
     * use — which allowed exactly one credential set per scan. Real subnets are
     * mixed, so such a scan quietly missed every device speaking a version or
     * community it was not configured for, and the only workaround was one scan
     * per credential (issue #3458).
     *
     * A repeated block cannot be expressed as Fields — a Field is one value at
     * one key — so this is a CustomComponent bound to the `snmpConfigs` column,
     * exactly like the device's Health OIDs list. The editor still takes its
     * labels, dropdown options and v3 reveal chain FROM SnmpConfigFormFields,
     * so it and the device forms cannot drift.
     *
     * Gated on the scan's method as well, exactly as the flat fields were. The
     * step-level showIf is what an operator sees in the wizard; this is what
     * holds where there are no steps at all — the Edit dialog lays these same
     * fields out on one page (issue #3445).
     */
    {
      field: {
        snmpConfigs: true,
      },
      title: "SNMP Configs",
      stepId: "snmp",
      fieldType: FormFieldSchemaType.CustomComponent,
      /*
       * Required, and it is the editor that keeps the promise: it seeds one
       * card and refuses to delete the last one. This is the backstop for a
       * value that reaches the form some other way — an empty array
       * stringifies to "" and fails required, and validateSnmpConfigs then
       * replaces that message with one that says what to do about it.
       */
      required: true,
      description:
        "Every credential set this scan tries, in order, stopping at the first that answers each host. Add one per group of devices that share a version and community or v3 user.",
      customValidation: validateSnmpConfigs,
      /*
       * An ICMP-only scan sends no SNMP packet, so it asks for no credentials.
       * Hidden rather than merely ignored: Validation skips a hidden field's
       * rules, so `required` above cannot block a ping sweep from being saved.
       */
      showIf: (item: FormValues<NetworkDeviceDiscoveryScan>): boolean => {
        return !isIcmpOnlyScan(item);
      },
      getCustomElement: (
        value: FormValues<NetworkDeviceDiscoveryScan>,
        customElementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <SnmpConfigListEditor
            {...customElementProps}
            /*
             * Re-passed AFTER the spread on purpose. FormField hands a
             * CustomComponent `currentValues[fieldName] || ""`, so an
             * untouched create form supplies an empty STRING rather than an
             * empty list — see DeviceHealthOidsFormField, which re-passes for
             * the same reason.
             */
            initialValue={
              (value.snmpConfigs as
                | Array<DiscoveryScanSnmpConfig>
                | undefined) || []
            }
          />
        );
      },
    },
    {
      field: {
        isRecurring: true,
      },
      title: "Repeat this scan",
      stepId: "schedule",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // "Repeat this scan (Optional)" is noise on a toggle. Same as the method toggle above.
      hideOptionalLabel: true,
      description:
        "Re-run this scan automatically to keep discovery continuous. Newly found devices wait for your review before import, unless an auto-import rule matches them.",
    },
    /*
     * Only meaningful together with the toggle above, so it reveals
     * itself the same way the v3 credential fields do in
     * SnmpConfigFormFields.ts: showIf on the controlling value.
     */
    {
      field: {
        rescanIntervalInMinutes: true,
      },
      title: "Rescan Interval (Minutes)",
      stepId: "schedule",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "60",
      description: `How often to re-run this scan, in minutes. Minimum ${MINIMUM_RESCAN_INTERVAL_IN_MINUTES} minutes.`,
      /*
       * One validator rather than a `validation: { minValue }` beside it:
       * the built-in minimum runs the value through parseInt, so "20.5"
       * reads as 20 and clears a floor of 15 before failing the INSERT
       * against an integer column — and customValidation runs last, so a
       * minValue declared alongside would only have its message
       * overwritten. See DiscoveryScanFormValidation.
       */
      customValidation: validateRescanInterval,
      showIf: (item: FormValues<NetworkDeviceDiscoveryScan>): boolean => {
        return Boolean(item.isRecurring);
      },
    },
  ];
};

/*
 * The same fields, laid out for the Edit dialog: one page, grouped under the
 * headings the create wizard uses as step titles.
 *
 * NOT a wizard. A stepped form has no Back button — the only way backwards is
 * the step rail, which BasicForm hides below the `lg` breakpoint — and walking
 * three steps to reach the toggle you came to flip is the wrong shape for a
 * repair. The headings come from DISCOVERY_SCAN_FORM_STEPS rather than being
 * written out again, so the two layouts can never describe the same field as
 * belonging to two different things.
 *
 * BasicForm renders every field when a form declares no steps, and Validation
 * skips its step guard for the same reason, so the fields keep the `stepId`
 * the wizard needs and it simply goes unread here.
 */
const getDiscoveryScanEditFormFields: GetDiscoveryScanFormFieldsFunction = (
  probes: Array<Probe>,
): Array<ModelField<NetworkDeviceDiscoveryScan>> => {
  const titledStepIds: Set<string> = new Set<string>();

  return getDiscoveryScanFormFields(probes).map(
    (field: ModelField<NetworkDeviceDiscoveryScan>) => {
      const stepId: string | undefined = field.stepId;

      if (!stepId || titledStepIds.has(stepId)) {
        return field;
      }

      const step: FormStep<NetworkDeviceDiscoveryScan> | undefined =
        DISCOVERY_SCAN_FORM_STEPS.find(
          (candidate: FormStep<NetworkDeviceDiscoveryScan>) => {
            return candidate.id === stepId;
          },
        );

      if (!step) {
        return field;
      }

      titledStepIds.add(stepId);

      // The first field of each group carries the group's heading.
      return { ...field, sectionTitle: step.title };
    },
  );
};
/**
 * Create the optional Ping monitor for a ping-only host — the one-click path
 * to incidents, alerts and status pages for a device the probe already pings
 * — and return its id so the device can be created already bound to it.
 *
 * The scan's own probe is attached explicitly rather than letting the monitor
 * fall back to the project's defaults. That matters more than it looks: the
 * defaults include GLOBAL probes, which sit on the public internet and cannot
 * reach an RFC1918 address — so a monitor left on defaults for 10.246.174.13
 * would fail every check and drive the device to "Offline". That is a worse
 * answer than the probe's own ping, because it looks like a real outage. The
 * scan's probe is the one that just proved the host answers ping, so it is
 * exactly the right one to keep asking.
 */
async function createPingMonitorForHost(data: {
  host: DiscoveredDeviceEntry;
  deviceName: string;
  scan: NetworkDeviceDiscoveryScan;
  seedIds: MonitorCriteriaSeedIds;
}): Promise<ObjectID> {
  const monitor: Monitor = buildPingMonitorForDiscoveredHost({
    projectId: ProjectUtil.getCurrentProjectId()!,
    host: data.host,
    deviceName: data.deviceName,
    seedIds: data.seedIds,
  });

  const response: HTTPResponse<
    JSONObject | JSONArray | Monitor | Array<Monitor>
  > = await ModelAPI.create<Monitor>({
    model: monitor,
    modelType: Monitor,
    miscDataProps: data.scan.probeId
      ? { probes: [data.scan.probeId.toString()] }
      : {},
  });

  /*
   * `?? undefined` rather than a bare `?.id`: BaseModel.id is `ObjectID |
   * null`, so the optional chain yields `ObjectID | null | undefined` and the
   * annotation below refuses it under strictNullChecks. The Dashboard's own
   * build never noticed, but the Common suite type-checks this file when it
   * renders the page, and it failed to compile there.
   */
  const createdMonitorId: ObjectID | undefined =
    (response.data as Monitor | undefined)?.id ?? undefined;

  if (!createdMonitorId) {
    throw new BadDataException(
      "The Ping monitor was created but the server did not return its id, so it could not be bound to this device.",
    );
  }

  return createdMonitorId;
}

/**
 * Remove a monitor created moments ago for a device whose own create then
 * failed. Swallows its own errors: the operator needs the import failure, not
 * a second message about the cleanup of it. A monitor that survives this is
 * visible and deletable in the monitor list.
 */
async function deleteMonitorQuietly(monitorId: ObjectID): Promise<void> {
  try {
    await ModelAPI.deleteItem<Monitor>({
      modelType: Monitor,
      id: monitorId,
    });
  } catch {
    // Intentionally ignored - see above.
  }
}

const NetworkDeviceDiscovery: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [refreshToggle, setRefreshToggle] = useState<string>("");

  // Review Results modal state.
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  /*
   * The scan the Edit dialog is open for, or null.
   *
   * Every setting a scan has used to be fixed at creation: a typo'd subnet, a
   * probe on the wrong side of a firewall, a community string the devices
   * reject — none of them could be corrected, and the only way out was to
   * delete the scan and lose its results with it (OneUptime issue #3444).
   */
  const [scanToEdit, setScanToEdit] =
    useState<NetworkDeviceDiscoveryScan | null>(null);
  const [scanToReview, setScanToReview] =
    useState<NetworkDeviceDiscoveryScan | null>(null);
  const [selectedIps, setSelectedIps] = useState<Record<string, boolean>>({});
  /*
   * Which group of hosts the dialog is showing — and, because Import is scoped
   * to the view, which group Import brings in. See DiscoveredHostFilter.
   */
  const [hostFilter, setHostFilter] = useState<DiscoveredHostFilter>(
    DiscoveredHostFilter.All,
  );
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>("");
  /*
   * Whether the operator asked for a Ping monitor to be created and bound to
   * each ping-only host in this import.
   *
   * OFF by default, and deliberately so: a monitor is a billable, plan-limited
   * resource, and creating fourteen of them must be something the operator
   * chose rather than a side effect of recording inventory. Without it the
   * import behaves exactly as it always has.
   */
  const [createPingMonitors, setCreatePingMonitors] = useState<boolean>(false);
  /*
   * Addresses imported from each scan, per scan id. The scan's own
   * `isAlreadyRegistered` flags were frozen when the probe uploaded its
   * results, so without this the dialog would re-offer what it just imported
   * — which now matters, because importing one group and then the other is
   * the intended flow rather than an unusual one.
   *
   * Kept for the life of the page rather than the life of the dialog, so
   * closing and reopening the same scan does not resurrect imported hosts;
   * and keyed by scan so a long import that lands after the operator has
   * moved to a different scan cannot mark that scan's hosts.
   */
  const [importedIpAddressesByScanId, setImportedIpAddressesByScanId] =
    useState<ImportedIpAddressesByScanId>({});
  /*
   * The scan the dialog is showing right now, readable from inside an import
   * that started minutes ago. State would be the value captured when the run
   * began, which is exactly the value that cannot answer "is this still the
   * dialog I was importing for".
   */
  const reviewedScanIdRef: React.MutableRefObject<string> = useRef<string>("");

  const fetchProbes: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const probes: Array<Probe> = await ProbeUtil.getAllProbes();
      setProbes(probes);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchProbes().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  type OpenReviewModalFunction = (scan: NetworkDeviceDiscoveryScan) => void;

  type GetReviewHostsFunction = (
    scan: NetworkDeviceDiscoveryScan | null,
    importedByScanId?: ImportedIpAddressesByScanId,
  ) => Array<DiscoveredDeviceEntry>;

  /*
   * The list the dialog reasons about: what the probe found, with anything
   * already imported from this scan flipped to already-registered. Every
   * count, filter and import path goes through this so they cannot disagree
   * about what is still importable.
   */
  const getReviewHosts: GetReviewHostsFunction = (
    scan: NetworkDeviceDiscoveryScan | null,
    importedByScanId?: ImportedIpAddressesByScanId,
  ): Array<DiscoveredDeviceEntry> => {
    return markDiscoveredHostsAsRegistered({
      /*
       * Normalised first: the jsonb comes verbatim off the probe, and a null
       * row or a numeric address used to break a different rule at each call
       * site. See normalizeDiscoveredHosts.
       */
      hosts: normalizeDiscoveredHosts(getDiscoveredHosts(scan)),
      importedIpAddresses: getImportedIpAddressesForScan({
        importedByScanId: importedByScanId || importedIpAddressesByScanId,
        scanId: scan?._id,
      }),
    });
  };

  const openReviewModal: OpenReviewModalFunction = (
    scan: NetworkDeviceDiscoveryScan,
  ): void => {
    setScanToReview(scan);
    // Answers "is this still the dialog I am importing for" from a stale run.
    reviewedScanIdRef.current = scan._id || "";
    /*
     * Preselect every host that is not already registered. Ping-only hosts
     * are included: they import with no credentials and are pinged by the
     * scan's probe, rather than carrying credentials they never answered to.
     * Read through the overlay so reopening a scan does not re-tick what was
     * already imported from it.
     */
    setSelectedIps(getInitialSelection(getReviewHosts(scan)));
    // Every scan opens on the whole list; narrowing is the operator's move.
    setHostFilter(DiscoveredHostFilter.All);
    setImportError("");
    /*
     * Per-dialog, not per-page: opting a batch of phones into monitors says
     * nothing about the next scan, which may be a rack of switches.
     */
    setCreatePingMonitors(false);
    setShowReviewModal(true);
  };

  const closeReviewModal: VoidFunction = (): void => {
    setShowReviewModal(false);
    setScanToReview(null);
    reviewedScanIdRef.current = "";
    setSelectedIps({});
    setHostFilter(DiscoveredHostFilter.All);
    setImportError("");
    setCreatePingMonitors(false);
    /*
     * importedIpAddressesByScanId is deliberately NOT cleared. It is what
     * stops a reopened scan offering hosts that are already in the inventory,
     * and the scan row it describes does not change when the dialog closes.
     */
  };

  const importSelectedDevices: PromiseVoidFunction =
    async (): Promise<void> => {
      if (!scanToReview) {
        return;
      }

      /*
       * The scan this run belongs to. Importing a large group is thousands of
       * sequential creates and takes minutes, during which the dialog can be
       * closed and another scan opened — so everything this run does when it
       * finally lands has to be attributed to the scan it started on, not to
       * whatever is on screen by then.
       */
      const runScanId: string = scanToReview._id || "";

      /*
       * Selected AND currently shown. Scoping to the active filter is what
       * makes "show only SNMP, press Import" import only the SNMP devices
       * instead of every ticked host in the scan (issue #3322).
       */
      const entriesToImport: Array<DiscoveredDeviceEntry> =
        getDiscoveredHostsToImport({
          hosts: getReviewHosts(scanToReview),
          filter: hostFilter,
          selectedIpAddresses: selectedIps,
        });

      if (entriesToImport.length === 0) {
        return;
      }

      setIsImporting(true);
      setImportError("");

      const importedNow: Array<string> = [];
      const failures: Array<string> = [];
      /*
       * Hosts that imported fine but whose Ping monitor could not be created
       * — a free-plan quota running out mid-batch is the usual cause. Kept
       * apart from `failures` because the two need different words: those
       * hosts ARE in the inventory, they just have nothing reporting on them
       * yet, so the message tells the operator what is still missing rather
       * than implying the import did not happen.
       */
      const monitorFailures: Array<string> = [];

      /*
       * Whether this run will provision monitors, and the four project-scoped
       * ids they are seeded from.
       *
       * Resolved ONCE, before the loop: they describe the project, not any one
       * host, and a fourteen-host import must not repeat these queries
       * fourteen times. A project missing a status or a severity fails here,
       * as one clear message, rather than fourteen times over as a per-host
       * import failure.
       */
      const wantsPingMonitors: boolean =
        createPingMonitors &&
        entriesToImport.some((entry: DiscoveredDeviceEntry) => {
          return isPingOnlyDiscoveredHost(entry);
        });

      let pingMonitorSeedIds: MonitorCriteriaSeedIds | null = null;

      if (wantsPingMonitors) {
        try {
          pingMonitorSeedIds = await PingMonitorSeedIds.resolve();
        } catch (err) {
          setIsImporting(false);
          setImportError(API.getFriendlyMessage(err));
          return;
        }
      }

      for (const entry of entriesToImport) {
        /*
         * A monitor created for this host that must be cleaned up if the
         * device create then fails — otherwise a failed import leaves a
         * billable monitor behind pointing at a device that does not exist.
         */
        let provisionedMonitorId: ObjectID | null = null;

        try {
          /*
           * The shared recipe (Common/Utils/NetworkDiscovery/
           * DiscoveredDeviceBuilder): name, hostname, description, the scan's
           * probe with polling on, and — for SNMP hosts — the scan's
           * credentials. A ping-only host gets the probe and none of the
           * SNMP setup: it is pinged until credentials are added. The
           * server-side auto-import rule engine builds through the same
           * function, so a hand-imported host and a rule-imported host are
           * the same device.
           */
          const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
            projectId: ProjectUtil.getCurrentProjectId()!,
            host: entry,
            scan: scanToReview,
          });

          /*
           * The optional Ping monitor for a ping-only host. The device is
           * pinged by the scan's probe and has a status from its first poll
           * without one (the #3447 dead end — no probe, nothing polling it,
           * "Pending" forever — is gone); what a monitor adds is incidents,
           * alerts and status-page visibility, and it is the only one-click
           * path to those until alert policies land. So when the operator
           * asked for it, create the Ping monitor FIRST and carry its id
           * onto the device — binding at create time is what makes
           * NetworkDeviceService stamp the monitor's status onto the device
           * immediately, rather than waiting for the monitor's next status
           * CHANGE (#3392).
           *
           * The monitor is an ENHANCEMENT to the import, not a precondition
           * for it, so its failure must not cost the operator the device.
           * A project on the free plan runs out of monitor quota partway
           * through a fourteen-host batch; failing those hosts entirely
           * would mean the operator gets neither the monitor nor the
           * inventory they actually asked to import. So a monitor failure is
           * recorded as its own warning and the device is created unbound —
           * which is exactly the behaviour of an import with the option off.
           */
          if (pingMonitorSeedIds && isPingOnlyDiscoveredHost(entry)) {
            /*
             * The monitor is named after the HOST, which means the address has
             * to be in it whenever the device name is not the address itself.
             *
             * Before issue #3529 that was automatic: a ping-only host WAS
             * named by its address, so "Ping 10.18.166.51" identified exactly
             * one thing. Now the device carries a PTR name, and PTR names are
             * not unique — a DHCP range published under one wildcard record
             * gives every host in it the same one. Importing that range with
             * "Create a Ping monitor" ticked produced N monitors all called
             * "Ping dhcp-pool.corp.example.com", bound to N correctly
             * distinguished devices. Nothing failed; Monitor.name has no
             * unique constraint and its slug carries random digits. The
             * monitor list simply stopped being navigable.
             *
             * Qualifying with the address restores the property the address
             * used to provide for free, and buildFallbackDeviceName is reused
             * rather than re-composed so the monitor and the collision-retry
             * device end up spelling the same host the same way.
             */
            const monitorSubjectName: string =
              device.name && device.name !== entry.ipAddress
                ? buildFallbackDeviceName(entry)
                : device.name || entry.ipAddress;

            try {
              provisionedMonitorId = await createPingMonitorForHost({
                host: entry,
                deviceName: monitorSubjectName,
                scan: scanToReview,
                seedIds: pingMonitorSeedIds,
              });

              device.monitorId = provisionedMonitorId;
            } catch (monitorErr) {
              monitorFailures.push(
                `${entry.ipAddress}: ${API.getFriendlyMessage(monitorErr)}`,
              );
            }
          }

          try {
            await ModelAPI.create<NetworkDevice>({
              model: device,
              modelType: NetworkDevice,
            });
          } catch (createErr) {
            /*
             * One retry under the address-qualified name, exactly as the
             * server-side auto-import rule engine does it
             * (NetworkDeviceAutoImportRuleEngineService). Device names are
             * unique per project, and this batch can now contain hosts that
             * genuinely share one.
             *
             * Reverse DNS (issue #3529) is what made that ordinary. Ping-only
             * hosts used to be named by their addresses, so two of them could
             * never collide with each other; now a single wildcard PTR record
             * — `*.166.18.10.in-addr.arpa IN PTR dhcp-pool.corp.example.com`,
             * which is how a DHCP range is routinely published — gives every
             * host in the range the same name. Without this retry the first
             * host imported and the other 199 failed with "Network Device
             * with the same name already exists", turning the feature into a
             * regression for exactly the estates it was built for.
             *
             * The fallback appends ` (<address>)`, which is unique per host
             * by construction. If THAT also fails the error is real and is
             * reported against this host; the first error is the one worth
             * showing, since the second is usually a consequence of it.
             */
            device.name = buildFallbackDeviceName(entry);

            try {
              await ModelAPI.create<NetworkDevice>({
                model: device,
                modelType: NetworkDevice,
              });
            } catch {
              throw createErr;
            }
          }

          importedNow.push(entry.ipAddress);
        } catch (err) {
          /*
           * Best effort, and deliberately silent on its own failure: the
           * import error the operator needs to see is the one below, not a
           * second error about tidying up after it.
           */
          if (provisionedMonitorId) {
            await deleteMonitorQuietly(provisionedMonitorId);
          }

          failures.push(`${entry.ipAddress}: ${API.getFriendlyMessage(err)}`);
        }
      }

      setIsImporting(false);

      /*
       * Retire what was imported so it cannot be imported a second time, and
       * so the row shows "Already added" like any other registered host.
       *
       * Recorded against this run's own scan, and merged functionally, so it
       * is correct whether or not the operator has moved on and whether or
       * not another import already wrote to the store.
       */
      const importedAfterThisRun: ImportedIpAddressesByScanId =
        withImportedIpAddresses({
          importedByScanId: importedIpAddressesByScanId,
          scanId: runScanId,
          ipAddresses: importedNow,
        });

      setImportedIpAddressesByScanId((current: ImportedIpAddressesByScanId) => {
        return withImportedIpAddresses({
          importedByScanId: current,
          scanId: runScanId,
          ipAddresses: importedNow,
        });
      });

      /*
       * Whether the dialog still belongs to this run. A run that outlived its
       * dialog must not push its errors onto whatever is open now, and must
       * not close it.
       */
      const isStillTheSameReview: boolean =
        reviewedScanIdRef.current === runScanId;

      /*
       * A monitor that could not be created is reported alongside the import
       * failures, but worded apart from them on purpose. A host in `failures`
       * is NOT in the inventory. A host in `monitorFailures` IS — it just
       * imported without the monitor that was going to report on it, so it is
       * sitting on "Pending" and the operator needs to know which ones and
       * why (a free-plan quota running out mid-batch is the usual reason).
       *
       * Folded in here rather than reported through a second channel so that
       * either kind keeps the dialog open: closing on a monitor-only problem
       * would show the message for exactly as long as it took to disappear.
       */
      if (monitorFailures.length > 0) {
        failures.push(
          `Imported, but no Ping monitor could be created for ${monitorFailures.length === 1 ? "this host" : "these hosts"} — ${monitorFailures.length === 1 ? "it is" : "they are"} in your inventory and pinged by the probe, but will not raise incidents until a monitor exists: ${monitorFailures.join(" ")}`,
        );
      }

      if (failures.length > 0) {
        if (isStillTheSameReview) {
          setImportError(failures.join(" "));
        }
      } else if (
        isStillTheSameReview &&
        /*
         * Closing on success is right only when there is nothing left to do.
         * Importing group by group means the usual case is now "the SNMP
         * devices are in, the ping-only ones are still waiting" — closing
         * there would throw away the review and make the operator reopen the
         * scan to finish the job.
         *
         * The test is on what is still SELECTED, not on what is still
         * selectable. Gating on selectable would keep the dialog open after a
         * complete import whenever the operator had deliberately unticked a
         * host — showing them a dialog whose only button reads "Import
         * Selected (0)" and is disabled, with nothing left to do in it.
         */
        getDiscoveredHostsToImport({
          hosts: getReviewHosts(scanToReview, importedAfterThisRun),
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: selectedIps,
        }).length === 0
      ) {
        closeReviewModal();
      }

      // Refresh the scans table.
      setRefreshToggle(Date.now().toString());
    };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const reviewEntries: Array<DiscoveredDeviceEntry> =
    getReviewHosts(scanToReview);

  // Group sizes come off the whole scan, so every button keeps its own count.
  const hostFilterOptions: Array<FilterButtonOption> =
    getDiscoveredHostFilterOptions(reviewEntries).map(
      (option: DiscoveredHostFilterOption) => {
        return {
          label: option.label,
          value: option.value,
        };
      },
    );

  /*
   * Each row carries its position in the UNFILTERED scan, so its React key
   * does not change when the filter does — see ShownDiscoveredHost.
   */
  const shownEntries: Array<ShownDiscoveredHost> = getShownDiscoveredHosts({
    hosts: reviewEntries,
    filter: hostFilter,
  });

  /*
   * What Import will actually create — selected AND shown — so the number on
   * the button can never promise something other than what the press does.
   */
  const selectedCount: number = getDiscoveredHostsToImport({
    hosts: reviewEntries,
    filter: hostFilter,
    selectedIpAddresses: selectedIps,
  }).length;

  const selectableShownCount: number = countSelectableShownHosts({
    hosts: reviewEntries,
    filter: hostFilter,
  });

  const areAllShownSelected: boolean = areAllShownHostsSelected({
    hosts: reviewEntries,
    filter: hostFilter,
    selectedIpAddresses: selectedIps,
  });

  /*
   * Counted across the WHOLE scan rather than the group on screen, so the
   * ping-monitor option does not appear and vanish as the operator switches
   * filters. The import itself still only touches what is selected and shown.
   */
  const noSnmpHostCount: number = reviewEntries.filter(
    (entry: DiscoveredDeviceEntry) => {
      return isPingOnlyDiscoveredHost(entry);
    },
  ).length;

  /*
   * Whether the scan under review asked anything about SNMP. Null-safe on
   * purpose: this is computed on every render, including the ones where no
   * scan is being reviewed at all, and a scan with no method column — every
   * scan created before issue #3445 — reads as an SNMP scan, which it was.
   *
   * Note it is NOT the same question as noSnmpHostCount above: that counts
   * hosts this sweep found without SNMP, which an ordinary SNMP scan of a
   * subnet full of unmanaged gear produces too. This one is about what the
   * scan was allowed to ask.
   */
  const isIcmpOnlyReview: boolean = ScanModeUtil.isIcmpOnly(scanToReview);

  return (
    <Fragment>
      <ModelTable<NetworkDeviceDiscoveryScan>
        modelType={NetworkDeviceDiscoveryScan}
        id="network-device-discovery-scans-table"
        userPreferencesKey="network-device-discovery-scans-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        refreshToggle={refreshToggle}
        name="Network Device Discovery Scans"
        /*
         * Both halves of a scan's identity are searchable, because either one
         * can be the thing the operator remembers: the purpose they gave it,
         * or the range they know it covers.
         */
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              cidr: true,
            },
            title: "Scan Target",
            type: FieldType.Text,
          },
        ]}
        cardProps={{
          title: "Discovery Scans",
          description:
            "Sweep a subnet or octet range from a probe - ping only, or ping plus SNMP - then review what answered and import the devices you want to monitor.",
        }}
        noItemsMessage={
          "No discovery scans yet. Start one to sweep a subnet or octet range and see what answers."
        }
        formSteps={DISCOVERY_SCAN_FORM_STEPS}
        formFields={getDiscoveryScanFormFields(probes)}
        columns={[
          /*
           * The scan's identity, in one column: its name if it has one, with
           * the address range it sweeps underneath. A scan with no name reads
           * exactly as it did before names existed — the target alone, on the
           * first line — so this is the DEFAULT identity cell rather than a
           * name column sitting beside a target column and leaving half the
           * rows with an empty cell where their name would be (issue #3391).
           *
           * The target is also available on its own, as the Scan Target column
           * below — off by default, so it is never printed twice in the layout
           * this was designed to produce.
           */
          {
            /*
             * BOTH fields are declared, not just the one the column is keyed
             * on: getExportKeysFromColumn builds the CSV row out of a column's
             * declared fields alone (selectMoreFields never reaches it), so a
             * column that reached `cidr` through selectMoreFields would export
             * an EMPTY cell for every scan without a name - which is every
             * scan that predates the column. The cell on screen would still
             * show the target, so the loss would be silent and export-only.
             */
            field: {
              name: true,
              cidr: true,
            },
            title: "Scan",
            type: FieldType.Element,
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              const name: string | null = ScanNameUtil.getDisplayName(item);

              return (
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-gray-900">
                      {name || item.cidr || "—"}
                    </div>
                    {/*
                     * What this scan checks with, for the rows where nothing
                     * else says: a Pending or In Progress ICMP-only scan has no
                     * result summary yet, and every other cell on the row looks
                     * exactly like an SNMP scan's.
                     *
                     * Read from selectMoreFields rather than declared in this
                     * column's `field`, deliberately. getExportKeysFromColumn
                     * builds the CSV row out of a column's declared fields, and
                     * this column's pair is its identity — the name and the
                     * range it sweeps. A badge is decoration on that identity,
                     * not a third thing the cell is keyed on.
                     *
                     * The label comes from the shared enum, not a literal, so
                     * the badge and any other surface that names a scan's
                     * method say the same word.
                     */}
                    {ScanModeUtil.isIcmpOnly(item) && (
                      <span
                        className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                        title="This scan pings each address and asks nothing else of what answers. Its hosts import as devices pinged by the scan's probe; add SNMP credentials later for inventory."
                      >
                        {ScanMethodLabel.PingOnly}
                      </span>
                    )}
                  </div>
                  {name && item.cidr ? (
                    <div className="text-xs text-gray-500">{item.cidr}</div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          /*
           * The scan target on its own (issue #3446). The Scan column above
           * already puts it on screen in every row, so this is not how the
           * target becomes visible — it is how it becomes a COLUMN: a header
           * that says the words the filter says, one you can sort on, and one
           * the CSV carries under its own heading instead of glued to the name
           * with a semicolon.
           *
           * It ships switched off. The filter for it was added by the same
           * commit that folded the standalone column into Scan, which is the
           * mismatch #3446 reports; putting it back visible would print the
           * target twice in every named row and undo #3391's layout for
           * everyone, so it lives in Customize Columns and each viewer decides.
           *
           * The `id` is explicit and deliberately NOT the `cidr` that
           * getColumnBaseId would derive from the field. A column with that
           * derived id shipped as the FIRST column of this same table (same
           * userPreferencesKey) up to 12.0.22, so a viewer who arranged their
           * columns back then still has "cidr" sitting in the stored `order`
           * in localStorage — and an id present in `order` overrides
           * isHiddenByDefault (Common/UI/Components/ModelTable/
           * ColumnPreference.ts). Reusing it would silently switch this column
           * ON for exactly those viewers, in a column set where it now
           * duplicates the Scan cell. An id that has never shipped keeps the
           * stale entry being dropped by sanitizeColumnPreference instead.
           *
           * Sorting is left enabled, matching every other address-shaped text
           * column in the product (NetworkDevice Endpoints "IP Address",
           * NetworkSite Assignment Rules "Subnet CIDR"). It is a lexicographic
           * sort over a varchar holding two notations — so 9.9.9.0/24 lands
           * after 192.168.1.0/24 — which groups a project's 10.x and 192.168.x
           * sweeps together without claiming to be address order.
           *
           * With this column switched on the target appears in two CSV
           * columns: here, and inside "Scan", whose exportKeys are
           * ["name", "cidr"]. That is accepted rather than fixed by trimming
           * the Scan column's fields — see the comment above it for why those
           * two fields are load-bearing.
           */
          {
            id: "scanTarget",
            field: {
              cidr: true,
            },
            title: "Scan Target",
            type: FieldType.Text,
            isHiddenByDefault: true,
            /*
             * `cidr` is NOT NULL, so this is near-hypothetical — but a bare
             * FieldType.Text cell renders "" for a missing value, and the
             * mobile card drops the whole labelled block, so the "Scan Target"
             * label itself would vanish. Every other cell on this table shows
             * an em-dash instead.
             */
            noValueMessage: "—",
            /*
             * The six sibling columns all wrap their content in a gray-900 /
             * gray-600 span; the default cell class is a lighter gray-500,
             * which would make the column a viewer just switched on read as
             * disabled. This gives parity without paying for a getElement.
             */
            contentClassName: "text-sm text-gray-900",
          },
          {
            field: {
              probe: {
                name: true,
              },
            },
            title: "Probe",
            type: FieldType.Text,
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.probe?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              const status: string = (item.status as string) || "Pending";

              let colorClassName: string = "text-gray-500";
              if (status === "In Progress") {
                colorClassName = "text-blue-600";
              } else if (status === "Completed") {
                colorClassName = "text-green-600";
              } else if (status === "Failed") {
                colorClassName = "text-red-600";
              }

              return (
                <span className={`text-sm font-medium ${colorClassName}`}>
                  {status}
                </span>
              );
            },
          },
          {
            field: {
              respondedHostCount: true,
            },
            title: "Responded Hosts",
            type: FieldType.Element,
            /*
             * This cell carries whole sentences written by the server and by
             * the probe - the requeue note an edit writes (RETIRE_RUN_PAYLOAD
             * in Common/Server/Services/NetworkDeviceDiscoveryScanService.ts),
             * the probe's account of an ICMP-only sweep, the unclaimed-scan
             * diagnosis - and statusMessage is a 500-character column. Without
             * this the cell inherits the row's `whitespace-nowrap` and the
             * sentence is painted straight over the Recurrence and Started
             * cells beside it (OneUptime issue #3585).
             */
            wrapContent: true,
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              const outcome: DiscoveryScanOutcome =
                summarizeDiscoveryScan(item);

              /*
               * No host counts yet. That used to render a bare em-dash and
               * stop, which threw away the only explanation a scan that never
               * ran ever gets: the worker's "nobody has claimed this" note
               * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts)
               * and the stale-In-Progress reaper's "the probe did not report a
               * result within 2 hours" were both written to statusMessage,
               * fetched by this page, and then rendered nowhere — so a stuck
               * scan looked identical to one that had simply just been
               * submitted (OneUptime issue #3287).
               */
              if (!outcome.hasReported) {
                if (!outcome.explanation) {
                  return <span className="text-sm text-gray-400">—</span>;
                }

                return (
                  <div
                    className="text-xs text-gray-500"
                    title={outcome.explanation}
                  >
                    {outcome.explanation}
                  </div>
                );
              }

              /*
               * The count is SNMP responders only, so "0 of 254" on its own
               * reads as "there is nothing on this subnet" even when the sweep
               * found live hosts that simply did not answer SNMP. Both extra
               * lines below exist to keep a zero from being mistaken for an
               * empty network: the ping-only tally, and the probe's own
               * explanation of the sweep — which was already being stored and
               * fetched, and was simply never rendered anywhere.
               */
              return (
                <div>
                  <div className="text-sm text-gray-900">
                    {outcome.respondedHostSummary}
                  </div>
                  {/*
                   * "Scanning - 1,024 of 15,360 addresses swept so far".
                   *
                   * Without it the line above is read as this sweep's verdict
                   * on the range, and a long scan that is working perfectly
                   * looks like a finished scan of the wrong subnet (OneUptime
                   * issue #3598). Blue rather than grey because it is the one
                   * line here that describes something still happening.
                   */}
                  {outcome.progressSummary && (
                    <div className="text-xs text-blue-600">
                      {outcome.progressSummary}
                    </div>
                  )}
                  {outcome.pingOnlyHostCount > 0 && (
                    <div className="text-xs text-gray-500">
                      {`+ ${outcome.pingOnlyHostCount} alive without SNMP`}
                    </div>
                  )}
                  {outcome.explanation && (
                    <div
                      className="text-xs text-gray-500 mt-1"
                      title={outcome.explanation}
                    >
                      {outcome.explanation}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              isRecurring: true,
            },
            title: "Recurrence",
            type: FieldType.Element,
            hideOnMobile: true,
            /*
             * Both of this column's second lines are sentences rather than
             * labels - "Next scan is scheduled when this run finishes" (45
             * characters) and "No next scan is scheduled. Open Edit and save
             * to schedule one." (62) - and one of them renders in the very row
             * that reports #3585: the same RETIRE_RUN_PAYLOAD write that sets
             * the status message also sets status Pending and nextScanAt NULL,
             * which is exactly the first of those two branches. This column
             * has no width cap of its own, so its symptom is a column stretched
             * to fit one long line rather than an overlap - the other half of
             * the deformed row in the report. Capped narrower than Responded
             * Hosts on purpose: this column's headline is "Every 60 min".
             */
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              if (!item.isRecurring) {
                return <span className="text-sm text-gray-400">One-time</span>;
              }

              const nextScanAt: Date | null = item.nextScanAt
                ? OneUptimeDate.fromString(item.nextScanAt)
                : null;

              /*
               * A recurring scan with no next run used to render as the
               * interval alone, and the second line was simply left off. That
               * is the one state where the row most needs a second line: a
               * scan whose recurrence is on and whose nextScanAt is NULL is
               * never picked up by the requeue worker, because `NULL <= now`
               * is UNKNOWN in SQL — so "Every 60 min" was, for those rows, a
               * flat untruth with nothing to hint at it (OneUptime issue
               * #3444). The server now derives the column instead, so a row
               * like that should no longer exist; if one does, it says so.
               */
              const isRunUnderway: boolean =
                item.status === "Pending" || item.status === "In Progress";

              return (
                <div>
                  <div className="text-sm text-gray-900">
                    {item.rescanIntervalInMinutes
                      ? `Every ${item.rescanIntervalInMinutes} min`
                      : "Recurring"}
                  </div>
                  {nextScanAt ? (
                    <div
                      className="text-xs text-gray-500"
                      title={OneUptimeDate.getDateAsLocalFormattedString(
                        nextScanAt,
                      )}
                    >
                      {/* fromNow renders e.g. "in 12 minutes". */}
                      {`Next scan ${OneUptimeDate.fromNow(nextScanAt)}`}
                    </div>
                  ) : isRunUnderway ? (
                    <div className="text-xs text-gray-500">
                      Next scan is scheduled when this run finishes
                    </div>
                  ) : (
                    <div className="text-xs text-yellow-600">
                      No next scan is scheduled. Open Edit and save to schedule
                      one.
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Started",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
        selectMoreFields={{
          scannedHostCount: true,
          discoveredDevices: true,
          /*
           * The scan's method — read by the outcome summary and by the Review
           * dialog, both of which say different things about a sweep that
           * asked nothing about SNMP.
           */
          isSnmpEnabled: true,
          // Recurrence details rendered inside the "Recurrence" column.
          rescanIntervalInMinutes: true,
          nextScanAt: true,
          probeId: true,
          /*
           * The credential list, so the import below can build each device
           * with the config that ACTUALLY answered that host rather than with
           * the scan's first one. The flattened columns below it are still
           * selected: they are what a legacy scan (and a scan saved by an API
           * caller that only knows those fields) carries, and
           * SnmpScanConfigUtil falls back to them.
           */
          snmpConfigs: true,
          snmpVersion: true,
          snmpCommunityString: true,
          snmpPort: true,
          // v3 credentials, so the import below can copy them onto the device.
          snmpV3SecurityLevel: true,
          snmpV3Username: true,
          snmpV3AuthProtocol: true,
          snmpV3AuthKey: true,
          snmpV3PrivProtocol: true,
          snmpV3PrivKey: true,
          statusMessage: true,
        }}
        actionButtons={[
          {
            title: "Edit",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Pencil,
            /*
             * Hidden for anyone who could not save the edit anyway. The table
             * sets isEditable={false}, so this button is the only edit
             * affordance on the page and nothing else is gating it — a viewer
             * would otherwise open a dialog whose fields ModelForm has already
             * dropped for want of the update permission, and which says
             * nothing about why it is empty.
             */
            isVisible: (): boolean => {
              return PermissionGate.check(
                new NetworkDeviceDiscoveryScan(),
                ModelAction.Update,
              ).isAllowed;
            },
            onClick: async (
              item: NetworkDeviceDiscoveryScan,
              onCompleteAction: VoidFunction,
            ) => {
              setScanToEdit(item);
              onCompleteAction();
            },
          },
          {
            title: "Review Results",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            /*
             * A RUNNING scan qualifies too, once it has found something.
             *
             * A sweep uploads what it has found every 30 seconds, so the hosts
             * on an In Progress row are as real as a finished scan's — the
             * probe found them; it simply has more of the range to cover. On a
             * long scan, waiting for the whole range is what made hundreds of
             * already-discovered switches unimportable for a day (OneUptime
             * issues #3598 and #3599), and the import itself is idempotent per
             * (project, address), so re-opening the dialog when more hosts
             * arrive costs nothing.
             *
             * Gated on there being results rather than on the status alone: a
             * scan that has just been claimed has an empty dialog to offer,
             * which is a worse answer than no button.
             */
            isVisible: (item: NetworkDeviceDiscoveryScan): boolean => {
              if (item.status === "Completed") {
                return true;
              }

              return (
                item.status === "In Progress" &&
                getDiscoveredHosts(item).length > 0
              );
            },
            onClick: async (
              item: NetworkDeviceDiscoveryScan,
              onCompleteAction: VoidFunction,
            ) => {
              openReviewModal(item);
              onCompleteAction();
            },
          },
        ]}
      />

      {scanToEdit && (
        /*
         * Everything about the scan except what it found. ModelFormModal
         * fetches the row, prefills every box from it and PATCHes the lot;
         * the server works out what actually changed and, if the sweep itself
         * did, re-queues the scan — see NetworkDeviceDiscoveryScanService.
         *
         * This replaced a Rename dialog that offered the name alone. Name is
         * still the first thing in the form, and a save that changes only the
         * name is inert exactly as the rename was: the server compares values,
         * not which keys the form posted.
         */
        <ModelFormModal<NetworkDeviceDiscoveryScan>
          modelType={NetworkDeviceDiscoveryScan}
          modelIdToEdit={scanToEdit.id!}
          name="Edit Discovery Scan"
          title="Edit Discovery Scan"
          description={`Change what this scan sweeps, which probe runs it, the credentials it tries, or how often it repeats. It currently sweeps ${
            scanToEdit.cidr || "the address range it was created with"
          }.`}
          /*
           * The one consequence that is not obvious from the form: a changed
           * sweep makes the last run's hosts describe a scan that no longer
           * exists, so they go. Said before the operator saves rather than
           * discovered afterwards in an empty Review Results dialog.
           */
          footer={
            <Alert
              type={AlertType.INFO}
              strongTitle="Changing the target, probe or credentials re-runs the scan"
              title="The scan goes back to Pending and sweeps again with the new settings, and the hosts the last run found are cleared - they describe settings this scan no longer has. Devices you have already imported are not touched. Changing only the name or the schedule leaves the results alone."
            />
          }
          modalWidth={ModalWidth.Medium}
          submitButtonText="Save Changes"
          onClose={() => {
            setScanToEdit(null);
          }}
          onSuccess={() => {
            setScanToEdit(null);
            /*
             * Same refresh the import path uses. The server's re-queue runs
             * inside onUpdateSuccess, which the request waits on, so the
             * refetched row already shows Pending rather than the results it
             * is about to lose.
             */
            setRefreshToggle(Date.now().toString());
          }}
          formProps={{
            name: "Edit Discovery Scan",
            modelType: NetworkDeviceDiscoveryScan,
            id: "edit-network-device-discovery-scan-form",
            fields: getDiscoveryScanEditFormFields(probes),
            formType: FormType.Update,
          }}
        />
      )}

      {showReviewModal && scanToReview && (
        <Modal
          title="Review Discovered Devices"
          /*
           * This used to end "hosts without SNMP cannot be imported", which
           * stopped being true when ping-only hosts started importing at all
           * — and reads as a flat contradiction next to a No SNMP filter that
           * exists precisely to import them as a batch.
           */
          description={`Hosts that responded in ${
            ScanNameUtil.getScanLabel(scanToReview) ||
            "the scanned address range"
          }. ${
            /*
             * An ICMP-only sweep has exactly one group, so the sentence about
             * choosing between two would be describing a filter row that is
             * not on screen — and "hosts without SNMP" reads as a caveat about
             * a shortfall rather than the thing the operator asked for.
             */
            isIcmpOnlyReview
              ? "This scan checked ICMP only, so pick the hosts you want and import — they all arrive as devices pinged by the scan's probe; add SNMP credentials later for inventory. Turn on 'Create a Ping monitor' below if you also want incidents."
              : "Filter to a group, pick the hosts you want, and import — SNMP hosts arrive with the scan's credentials and are walked for inventory, hosts without SNMP are pinged by the scan's probe until you add some."
          }${
            /*
             * The probe's summary of the sweep. Most valuable precisely when
             * this list is empty, which is the one case where the operator
             * otherwise has nothing at all to go on.
             */
            scanToReview.statusMessage ? ` ${scanToReview.statusMessage}` : ""
          }`}
          modalWidth={ModalWidth.Medium}
          isLoading={isImporting}
          error={importError || undefined}
          onClose={closeReviewModal}
          submitButtonText={`Import Selected (${selectedCount})`}
          disableSubmitButton={selectedCount === 0}
          onSubmit={() => {
            importSelectedDevices().catch((err: Error) => {
              setIsImporting(false);
              setImportError(API.getFriendlyMessage(err));
            });
          }}
        >
          <div>
            {reviewEntries.length > 0 && (
              <div className="mb-3 border-b border-gray-200 pb-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  {/*
                   * Not offered on a scan that asked nothing about SNMP. The
                   * row would read "All (2,890) · SNMP (0) · No SNMP (2,890)"
                   * — two identical groups and one permanently empty button
                   * whose empty message, "No host in this scan answered SNMP.",
                   * reads as a credential failure on a sweep that carried no
                   * credentials. hostFilter is reset to All when the dialog
                   * opens and closes, so hiding the row cannot strand anyone
                   * on a group they can no longer leave.
                   */}
                  {!isIcmpOnlyReview && (
                    <FilterButtons
                      options={hostFilterOptions}
                      selectedValue={hostFilter}
                      onSelect={(value: string) => {
                        setHostFilter(value as DiscoveredHostFilter);
                      }}
                    />
                  )}
                  {/*
                   * The answer to "2,890 hosts are pre-checked and I only want
                   * the switches": clear this group, or take all of it, in one
                   * press. Scoped to the group on screen, so using it on one
                   * filter never disturbs the other.
                   */}
                  <Button
                    title={
                      areAllShownSelected
                        ? `Clear all (${selectableShownCount.toLocaleString("en-US")})`
                        : `Select all (${selectableShownCount.toLocaleString("en-US")})`
                    }
                    dataTestId="discovered-device-select-all"
                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                    buttonSize={ButtonSize.Small}
                    disabled={selectableShownCount === 0 || isImporting}
                    onClick={() => {
                      setSelectedIps((current: Record<string, boolean>) => {
                        return toggleSelectionForShownHosts({
                          hosts: reviewEntries,
                          filter: hostFilter,
                          selectedIpAddresses: current,
                        });
                      });
                    }}
                  />
                </div>
                {/*
                 * Import is scoped to the group on screen, and that has to be
                 * said out loud: an operator who filters to SNMP and presses
                 * Import needs to know both that the ping-only hosts are not
                 * coming along, and that their ticks are still there when they
                 * switch back.
                 */}
                <p className="mt-2 text-xs text-gray-500">
                  {hostFilter === DiscoveredHostFilter.All
                    ? `${selectedCount.toLocaleString("en-US")} of ${selectableShownCount.toLocaleString("en-US")} importable hosts selected.`
                    : `${selectedCount.toLocaleString("en-US")} of ${selectableShownCount.toLocaleString("en-US")} importable ${getDiscoveredHostFilterLabel(hostFilter)} hosts selected. Import brings in this group only — selections in the other group are kept, so you can switch and import it too.`}
                </p>
              </div>
            )}
            {/*
             * The optional one-click path to incidents for the ping-only
             * hosts.
             *
             * A host that answered ping but not SNMP imports as a device the
             * scan's probe pings, so it has a status from its first poll —
             * the "Pending forever" of OneUptime/oneuptime#3447 (no probe,
             * nothing polling it, fourteen hand-made monitors and fourteen
             * device edits to escape) is gone. What a Ping monitor still adds
             * is incidents, alerts and status-page visibility, and until
             * alert policies land this opt-in is the only way to get those
             * without creating each monitor by hand.
             *
             * OFF by default on purpose: monitors are billable and
             * plan-limited, so creating a batch of them is the operator's
             * decision, not a side effect of recording inventory. Shown only
             * when this scan actually found hosts it applies to.
             */}
            {noSnmpHostCount > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <Toggle
                  title={`Also create a Ping monitor for each host without SNMP to get incidents (optional) — ${noSnmpHostCount.toLocaleString("en-US")} ${noSnmpHostCount === 1 ? "host" : "hosts"}`}
                  description="These hosts are already pinged by the probe that ran this scan and read Up or Down on their own. A Ping monitor is what raises incidents and alerts and puts them on a status page: this creates one per host — on the same probe, so it can reach them — and binds it. Monitors count towards your plan. Incidents stay off until you turn them on per monitor."
                  initialValue={createPingMonitors}
                  value={createPingMonitors}
                  dataTestId="discovered-device-create-ping-monitors"
                  onChange={(value: boolean) => {
                    setCreatePingMonitors(value);
                  }}
                />
              </div>
            )}
            {reviewEntries.length === 0 && (
              <p className="text-sm text-gray-500">
                {getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.All)}
              </p>
            )}
            {reviewEntries.length > 0 && shownEntries.length === 0 && (
              <p className="text-sm text-gray-500">
                {getDiscoveredHostFilterEmptyMessage(hostFilter)}
              </p>
            )}
            {shownEntries.map(
              (shownEntry: ShownDiscoveredHost): ReactElement => {
                const entry: DiscoveredDeviceEntry = shownEntry.host;
                /*
                 * Ping-only hosts (snmpReachable === false) import too, with
                 * no credentials and pinged by the scan's probe, rather than
                 * carrying credentials they never answered to. They are
                 * badged so the operator knows what they are agreeing to.
                 * Legacy rows (snmpReachable undefined) import with the
                 * scan's credentials, as before.
                 */
                const isPingOnly: boolean = isPingOnlyDiscoveredHost(entry);
                /*
                 * The SAME predicate every count, the bulk toggle and the
                 * import path use. The row used to spell out its own version
                 * of it, which left a host with a blank address rendering an
                 * enabled checkbox that no count would ever agree existed.
                 */
                const isSelectable: boolean = isSelectableDiscoveredHost(entry);
                const isChecked: boolean =
                  isSelectable && Boolean(selectedIps[entry.ipAddress]);
                /*
                 * `buildDeviceName`, not the unclamped display name: this row
                 * shows the name the device will ACTUALLY be created with,
                 * character for character.
                 *
                 * Since issue #3529 a name can be a 253-character FQDN where
                 * it used to be a 15-character address, and the builder clamps
                 * at 80 for the slug's sake. Rendering the unclamped value
                 * meant the operator ticked a box next to one name and got a
                 * device with a shorter, different one — a WYSIWYG break that
                 * only ever showed up on the longest, least memorable names.
                 * The full PTR name is not lost: when it differs from what is
                 * shown here it appears on the line below.
                 */
                const displayName: string = buildDeviceName(entry);
                /*
                 * Shown BESIDE the address when it is not already the line
                 * above: an SNMP device whose sysName and PTR record disagree
                 * is worth surfacing rather than hiding — it is either two
                 * teams naming one box, or a stale reverse zone, and both are
                 * things an operator wants to see while deciding to import.
                 * It is also where a PTR name too long to be a device name
                 * remains readable.
                 *
                 * Re-normalised rather than read raw. Every path that feeds
                 * this modal goes through normalizeDiscoveredHosts today, so
                 * the value is already clean — but this is the one place the
                 * attacker-chosen bytes would be rendered verbatim if that
                 * ever stopped being true, and the guarantee is cheap enough
                 * not to rest on a caller.
                 */
                const normalizedDnsHostname: string | undefined =
                  normalizeReverseDnsName(entry.dnsHostname);
                const secondaryDnsHostname: string | undefined =
                  normalizedDnsHostname && normalizedDnsHostname !== displayName
                    ? normalizedDnsHostname
                    : undefined;
                return (
                  <div
                    /*
                     * Scan position, not position in the filtered list — see
                     * ShownDiscoveredHost. A key that moved with the filter
                     * would remount every row on every filter click, and a
                     * remounted CheckboxElement paints unticked for a frame.
                     */
                    key={`${entry.ipAddress}-${shownEntry.scanIndex}`}
                    className="flex items-start justify-between gap-3 border-b border-gray-100 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <CheckboxElement
                        dataTestId={`discovered-device-checkbox-${entry.ipAddress}`}
                        /*
                         * initialValue as well as value: CheckboxElement seeds
                         * its own state from initialValue and only reconciles
                         * value in a passive effect, so without this a row
                         * mounts unticked and corrects itself a frame later.
                         */
                        initialValue={isChecked}
                        value={isChecked}
                        disabled={!isSelectable || isImporting}
                        /*
                         * A bare checkbox in a list is announced as
                         * "checkbox" and nothing else; a disabled one that
                         * does not say why reads as broken rather than as
                         * deliberate.
                         */
                        ariaLabel={`Import ${displayName} (${entry.ipAddress || "no address"})`}
                        hoverText={
                          entry.isAlreadyRegistered
                            ? "Already added as a Network Device."
                            : entry.ipAddress
                              ? undefined
                              : "This host reported no address, so it cannot be imported."
                        }
                        onChange={(value: boolean) => {
                          setSelectedIps((current: Record<string, boolean>) => {
                            return {
                              ...current,
                              [entry.ipAddress]: value,
                            };
                          });
                        }}
                      />
                      <div className="min-w-0">
                        <div
                          className="truncate text-sm font-medium text-gray-900"
                          title={displayName}
                        >
                          {displayName}
                        </div>
                        <div className="truncate text-sm text-gray-500">
                          {entry.ipAddress}
                          {secondaryDnsHostname && (
                            <span className="text-gray-400">
                              {" · "}
                              {secondaryDnsHostname}
                            </span>
                          )}
                        </div>
                        {entry.sysDescr && (
                          <div className="mt-0.5 truncate text-xs text-gray-400">
                            {entry.sysDescr}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {isPingOnly && (
                        <span
                          className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600"
                          title="Responds to ping only. Imports as a device pinged by the scan's probe, with no SNMP credentials — add them later for interfaces and inventory. Turn on 'Create a Ping monitor' above if you also want incidents."
                        >
                          No SNMP
                        </span>
                      )}
                      {entry.isAlreadyRegistered && (
                        <span className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                          Already added
                        </span>
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </Modal>
      )}
    </Fragment>
  );
};

export default NetworkDeviceDiscovery;
