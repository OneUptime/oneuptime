import PageComponentProps from "../PageComponentProps";
import DiscoveryScanProgress, {
  isWaitingForDiscoveryProgress,
} from "../../Components/NetworkDevice/DiscoveryScanProgress";
import DiscoveryScanStatusMessage from "../../Components/NetworkDevice/DiscoveryScanStatusMessage";
import DiscoveryImportDialog from "../../Components/NetworkDevice/DiscoveryImport/DiscoveryImportDialog";
import DiscoveryImportRowStatus from "../../Components/NetworkDevice/DiscoveryImport/DiscoveryImportRowStatus";
import useActiveDiscoveryImports, {
  ActiveDiscoveryImports,
} from "../../Components/NetworkDevice/DiscoveryImport/useActiveDiscoveryImports";
import { DiscoveryImportView } from "Common/Types/NetworkDevice/DiscoveryImport";
import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/NetworkDeviceMetricDescriptions";
import useDiscoveryScanLiveUpdates, {
  DiscoveryScanLiveUpdates,
} from "../../Components/NetworkDevice/useDiscoveryScanLiveUpdates";
import { DiscoveryScanStatus } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import ProbeUtil from "../../Utils/Probe";
import { BILLING_ENABLED } from "Common/UI/Config";
import useRefreshProbesOnFocus from "../../Components/NetworkDevice/useRefreshProbesOnFocus";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "Common/Models/DatabaseModels/Probe";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import OneUptimeDate from "Common/Types/Date";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelField, {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import SnmpConfigListEditor from "../../Components/NetworkDevice/SnmpConfigListEditor";
import DiscoveryScanMethodChoice from "../../Components/NetworkDevice/DiscoveryScanMethodChoice";
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
import {
  DISCOVERY_SCAN_METHOD_FIELD_DESCRIPTION,
  DISCOVERY_SCAN_METHOD_FIELD_TITLE,
  DiscoveryScanMethodBadge,
  NEW_DISCOVERY_SCAN_FORM_VALUES,
  getDiscoveryScanMethodBadge,
} from "./DiscoveryScanMethod";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  ADD_PROBE_LINK_TEXT,
  SCAN_NO_PROBE_DESCRIPTION,
  getDefaultProbeId,
  getGroupedProbeDropdownOptions,
  hasProjectProbe,
} from "../../Components/NetworkDevice/ProbeOptions";
import {
  NetworkQuickAction,
  clearNetworkQuickAction,
  getNetworkQuickActionRoute,
  isNetworkQuickActionRequested,
} from "../../Components/Network/NetworkQuickActions";
import {
  DiscoveryScanOutcome,
  getDiscoveredHosts,
  summarizeDiscoveryScan,
} from "../../Components/NetworkDevice/DiscoveryScanOutcome";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  translatePlural,
  translateTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * More fields on the new-scan form: the name, how hosts are named, and the
 * schedule. A scan is defined by three questions - what to sweep, from
 * which probe, and how: ICMP or SNMP - and those are all the form shows.
 * Everything else has a default that suits a first scan, and the folded
 * header lists it by name, its set values as chips, so nothing is hidden.
 * Built once: BasicForm and FormStepsScan both join consecutive fields into
 * one fold by this one object.
 */
const DISCOVERY_SCAN_MORE_FIELDS: FormFieldCollapsibleSection<NetworkDeviceDiscoveryScan> =
  getAdvancedFormSection<NetworkDeviceDiscoveryScan>();

/*
 * The scan's optional name, under More fields.
 *
 * Not required, and no longer the first thing asked (issue #3391 made it
 * the first field so a scan could be told apart in the list): someone
 * sweeping one subnet needs no name, and the list shows the scan target
 * when there is none. Someone running many scans opens More fields, where
 * it is the first field.
 */
const SCAN_NAME_FORM_FIELD: ModelField<NetworkDeviceDiscoveryScan> = {
  field: {
    name: true,
  },
  title: "Name",
  stepId: "scan-target",
  collapsibleSection: DISCOVERY_SCAN_MORE_FIELDS,
  fieldType: FormFieldSchemaType.Text,
  required: false,
  placeholder: "Router Discovery - Region 1100",
  description: "Left empty, the scan list shows the scan target.",
  customValidation: validateScanName,
};

/*
 * The steps of a scan, declared once and handed to BOTH the create wizard on
 * the table and the Edit dialog below, because a step the edit form does not
 * have is a setting that can be created and then never corrected — which is
 * the whole of OneUptime issue #3444.
 *
 * Two, and only one for an ICMP scan - the method a new scan starts on.
 * What to scan comes first, with its More fields fold (name, naming, and the
 * schedule that used to be a third step of its own); the credentials come
 * second, and only when the scan uses SNMP. An edit dialog opens any step
 * from its step list, so the setting an operator came to change is one
 * click away.
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
       * Both notations are named here rather than only CIDR because octet
       * ranges are the only way to express the common real-world shape
       * "the same handful of addresses in every one of these /24s" without
       * creating hundreds of separate scans. What a range means in full is
       * in the Network Device guide; the line under the box says how many
       * addresses the one typed covers.
       */
      description: translateTemplate(
        "A subnet such as 192.168.1.0/24, or an octet range such as 10.16-22.0-255.51-66. Up to {{max}} addresses.",
        { max: ScanTargetUtil.MAX_SCAN_HOSTS.toLocaleString("en-US") },
      ),
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
            {translatePlural(
              {
                one: "This target sweeps {{count}} address.",
                other: "This target sweeps {{count}} addresses.",
              },
              hostCount,
              { count: hostCount.toLocaleString("en-US") },
            )}
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
      description: hasProjectProbe(probes)
        ? "It must reach the range directly. A probe in another network finds nothing."
        : SCAN_NO_PROBE_DESCRIPTION,
      /*
       * The Network Overview's "Add a probe" dialog, in a new tab so the
       * scan being set up is not lost; the probes are read again when the
       * person comes back (onWindowFocus, on the page).
       */
      sideLink: {
        text: ADD_PROBE_LINK_TEXT,
        url: getNetworkQuickActionRoute(NetworkQuickAction.AddProbe),
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
       * of existing scans. The Add Device form shares the helper now.
       */
      // The project's own probes first, under their heading.
      dropdownOptions: getGroupedProbeDropdownOptions(probes, {
        isOneUptimeCloud: BILLING_ENABLED,
      }),
      required: true,
      /*
       * The project's one custom probe, when it has exactly one: a question
       * with one answer is not a question. An Edit dialog reads the scan's
       * own probe - a default only fills an empty field.
       */
      defaultValue: getDefaultProbeId(probes),
      placeholder: "Probe",
    },
    /*
     * The scan's method: ICMP (ping) or SNMP, two cards, ICMP for a new scan
     * (DiscoveryScanMethod.ts says why the form and the column default
     * differ). It used to be a switch, "Check SNMP on hosts that answer", on
     * by default under five lines of help; each card now says what it does
     * in one line.
     *
     * On the step BEFORE the one it hides — never on the step it hides.
     * BasicForm navigates the FILTERED step array, so a choice living on a
     * step it can remove would leave currentFormStepId naming a step that is
     * no longer there: findIndex returns -1, the advance branch is skipped,
     * and Next silently does nothing while still reading "Next".
     *
     * Bound to the boolean isSnmpEnabled column through a CustomComponent,
     * because CardSelect works in option values and the column is a switch:
     * the form value stays the boolean every rule here already reads.
     */
    {
      field: {
        isSnmpEnabled: true,
      },
      title: DISCOVERY_SCAN_METHOD_FIELD_TITLE,
      /*
       * Each card says what it does; the line under the label says the one
       * thing the cards do not: the choice is not final. Set, too, so the
       * form does not fall back to the column's description, which is
       * written for API readers and repeats the cards.
       */
      description: DISCOVERY_SCAN_METHOD_FIELD_DESCRIPTION,
      stepId: "scan-target",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      /*
       * ICMP for a scan the form starts. The table hands the same value in
       * as the create form's initial values, so it is there from the first
       * render; this default speaks for any other way the form is opened.
       * An Edit dialog shows the scan's own method: a default only fills a
       * value that is undefined.
       */
      defaultValue: NEW_DISCOVERY_SCAN_FORM_VALUES.isSnmpEnabled as boolean,
      /*
       * A choice between two cards always has an answer, and FieldLabel
       * appends "(Optional)" to every non-required field.
       */
      hideOptionalLabel: true,
      getCustomElement: (
        values: FormValues<NetworkDeviceDiscoveryScan>,
        customElementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <DiscoveryScanMethodChoice
            /*
             * Read off the values, not customElementProps.initialValue:
             * FormField hands a CustomComponent `value || ""`, which turns
             * ICMP's false into an empty string.
             */
            isSnmpEnabled={
              values.isSnmpEnabled as boolean | null | undefined
            }
            ariaLabelledby={customElementProps.ariaLabelledby}
            tabIndex={customElementProps.tabIndex}
            error={customElementProps.error}
            onChange={(isSnmpEnabled: boolean) => {
              customElementProps.onChange?.(isSnmpEnabled);
            }}
          />
        );
      },
      /*
       * Clear the credentials on the way to ICMP. Hiding the fields is not
       * enough on its own: ModelForm builds the request body from every
       * DECLARED field without checking whether it was visible, so a v3
       * passphrase typed before the operator changed their mind would be
       * stored on a scan that will never send it.
       *
       * FormField calls this BEFORE setFieldValue, and setFieldValue spreads
       * from the object handed back here, so the clearing survives the very
       * keystroke that caused it.
       *
       * snmpVersion is RESET to its default rather than cleared. Clearing it
       * leaves a required Dropdown holding nothing, which then fails with
       * "SNMP Version is required" on a control that visibly reads V2c the
       * moment the operator picks SNMP again — issue #3445's own symptom,
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
     * More fields starts here: the name, the naming switches and the
     * schedule, one fold at the end of the first step (and nothing after
     * them on it - a fold holds consecutive fields).
     */
    SCAN_NAME_FORM_FIELD,
    /*
     * Whether the probe asks hosts SNMP did not name for their NetBIOS name
     * (OneUptime issue #3677): the Windows machines that otherwise sit in the
     * Review dialog as bare addresses, because they have no PTR record and no
     * SNMP — and, since issue #4518, the ones reverse DNS did name, because a
     * Windows host's own computer name (WB0024KDS04) names the device ahead
     * of whatever its reverse zone says (wb-0024-kds04.wbhq.com).
     *
     * Under More fields, with the other naming switch: most scans leave it
     * as it is. It IS a packet the scan puts on the wire - one UDP datagram
     * to port 137 of each such host, plus a retry - which its description
     * says.
     *
     * On the scan-target step and with no `showIf`, for the naming toggle's
     * reason: an ICMP-only scan removes the SNMP step, and a host with no SNMP
     * is exactly the host that needs another way to be named. Nothing else in
     * the form depends on it, so it has no onChange either.
     *
     * DEFAULTS TO ON FOR A NEW SCAN, while the column defaults to OFF. The two
     * answer different questions. The column speaks for every scan that
     * existed before the upgrade, and a recurring scan on a PCI network must
     * not start sending NBSTAT queries — a textbook reconnaissance signature —
     * because a deploy happened. This default speaks for a scan being created
     * right now, by an operator looking at the toggle and its description, which
     * is the one moment an opt-in is actually visible. The Edit dialog reads
     * the stored value (ModelForm selects every declared field, and BasicForm
     * applies a default only to an undefined value, never to a stored false),
     * so an existing scan opens showing off and saves as off unless changed.
     *
     * NOT a sweep column in NetworkDeviceDiscoveryScanService, so flipping it
     * keeps the last run's results; it only changes what the NEXT run asks.
     * The Edit dialog's footer says so.
     *
     * The description says what it sends and when to turn it off, in one
     * line; the section's heading says where the name it finds ranks. The
     * Review dialog marks each row it names.
     */
    {
      field: {
        isNetbiosLookupEnabled: true,
      },
      title: "Look up Windows names (NetBIOS)",
      stepId: "scan-target",
      collapsibleSection: DISCOVERY_SCAN_MORE_FIELDS,
      /*
       * A small heading inside the fold, over the two naming switches:
       * how a host is named, in order, so the NetBIOS lookup reads as the
       * step it is in that order — the device's own names first (#4518).
       */
      sectionTitle: "Device names",
      sectionDescription:
        "A device is named by its SNMP name, then its Windows (NetBIOS) name, then its reverse-DNS name, then its address.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      // A toggle is always answered one way or the other.
      hideOptionalLabel: true,
      /*
       * What it puts on the wire and when to turn it off. The limits the
       * probe enforces whatever this says (private addresses only, never
       * from a global probe) and the firewall rule it needs are in the
       * Network Device guide.
       */
      description:
        "Asks hosts with no SNMP name for their Windows name (UDP 137). Turn it off if your intrusion detection flags it.",
    },
    /*
     * How the hosts this scan finds are NAMED when they import (OneUptime
     * issue #3678): "core-sw-01" rather than "core-sw-01.corp.example.com".
     *
     * Under More fields, after the NetBIOS lookup. It must stay on the
     * scan-target step, never on the SNMP step: an ICMP-only scan removes
     * that step, and a host with no SNMP is exactly the host named by its
     * reverse-DNS FQDN, so the setting would vanish for the scans it matters
     * most to.
     *
     * No `showIf`, for the same reason: every scan names its hosts, whatever
     * it checks.
     *
     * Defaults to OFF, matching the column. A deploy must not quietly change
     * what an operator's next import is called; a scan that wants short names
     * says so where the operator can see it.
     *
     * The description shows what it does with an example and says the full
     * name is not lost: it is kept on the device as its DNS Name. The rest -
     * a naming choice, not a sweep one, so it is NOT in the service's
     * SWEEP_COLUMNS and flipping it keeps the results; label and owner rules
     * written against full names stop matching short ones - is in the
     * Network Device guide.
     */
    {
      field: {
        useShortDeviceNames: true,
      },
      title: "Name devices by their short hostname",
      stepId: "scan-target",
      collapsibleSection: DISCOVERY_SCAN_MORE_FIELDS,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
      // A toggle is always answered one way or the other.
      hideOptionalLabel: true,
      description:
        "'core-sw-01' instead of 'core-sw-01.corp.example.com'. The full name is kept as the device's DNS Name.",
    },
    {
      field: {
        isRecurring: true,
      },
      title: "Repeat this scan",
      /*
       * On the first step, under More fields: the schedule used to be a
       * step of its own that every scan walked through to reach the button,
       * for a switch most first scans leave off. Its own small heading in
       * the fold, after the naming switches.
       */
      stepId: "scan-target",
      collapsibleSection: DISCOVERY_SCAN_MORE_FIELDS,
      sectionTitle: "Schedule",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // "Repeat this scan (Optional)" is noise on a toggle.
      hideOptionalLabel: true,
      description:
        "Runs the scan again on a schedule. New devices wait for your review, unless an auto import rule matches them.",
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
      stepId: "scan-target",
      collapsibleSection: DISCOVERY_SCAN_MORE_FIELDS,
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "60",
      description: translateTemplate("At least {{minutes}} minutes.", {
        minutes: MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
      }),
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
      title: "Credentials to try",
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
      /*
       * Each set also adds a wait on hosts that answer none of them; the
       * Network Device guide says so, beside how many to add.
       */
      description:
        "Tried in order on each host that answers ping. The first set that works is used.",
      customValidation: validateSnmpConfigs,
      /*
       * An ICMP scan sends no SNMP packet, so it asks for no credentials.
       * Hidden rather than merely ignored: Validation skips a hidden field's
       * rules, so `required` above cannot block an ICMP scan from being saved.
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
  ];
};

const NetworkDeviceDiscovery: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Opened from a "Discover Devices" link (the Overview, the Devices list's
   * empty state): the new-scan form opens as soon as the table is drawn,
   * after the probes are in. Read once, and the action leaves the address
   * at once so a refresh does not open the form again.
   */
  const [isNewScanRequested] = useState<boolean>((): boolean => {
    return isNetworkQuickActionRequested(NetworkQuickAction.DiscoverDevices);
  });

  useEffect(() => {
    if (isNewScanRequested) {
      clearNetworkQuickAction();
    }
  }, [isNewScanRequested]);

  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const liveUpdates: DiscoveryScanLiveUpdates = useDiscoveryScanLiveUpdates();

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
  /*
   * The scan the import dialog is open for (Review Results), and the import
   * it opens on when a row's "View progress" opened it - or null. The import
   * itself runs on the server: the dialog only asks for it and shows it.
   */
  const [scanToReview, setScanToReview] =
    useState<NetworkDeviceDiscoveryScan | null>(null);
  const [importIdToShow, setImportIdToShow] = useState<string | undefined>(
    undefined,
  );
  /*
   * The project's imports that are still running, by scan, so each scan's
   * row shows its import moving - with the dialog closed, or opened by
   * someone else.
   */
  const activeImports: ActiveDiscoveryImports = useActiveDiscoveryImports();

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

  // Back from the "Add a probe" tab: the new probe is in the list at once.
  useRefreshProbesOnFocus(setProbes);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

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
        /*
         * "Start Scan": a scan starts as soon as it is saved, and inside
         * Network it needs no "Network Device Discovery" in front of it.
         */
        createVerb="Start"
        singularName="Scan"
        pluralName="Scans"
        showCreateForm={isNewScanRequested}
        // A new scan starts on ICMP (DiscoveryScanMethod.ts).
        createInitialValues={NEW_DISCOVERY_SCAN_FORM_VALUES}
        showRefreshButton={true}
        refreshToggle={refreshToggle}
        onFetchSuccess={liveUpdates.onRowsLoaded}
        /*
         * The live-progress box, once the scans are read - and only when
         * there is a scan to report on. With none, it said "Scan results up
         * to date ... Review their results below" above "No scans yet".
         */
        topContent={
          liveUpdates.lastRefreshedAt &&
          (liveUpdates.loadedRowCount > 0 || liveUpdates.error) ? (
            <div
              className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${liveUpdates.error ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50"}`}
            >
              <div className="min-w-0">
                <p
                  className={`flex items-center gap-2 text-sm font-medium ${liveUpdates.error ? "text-amber-900" : "text-blue-900"}`}
                  role="status"
                  aria-live="polite"
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${liveUpdates.error ? "bg-amber-500" : liveUpdates.activeCount > 0 ? "bg-blue-500" : "bg-green-500"}`}
                  />
                  {liveUpdates.error
                    ? translator.translateText("Live updates interrupted")
                    : liveUpdates.activeCount > 0
                      ? translator.translatePlural(
                          {
                            one: "{{count}} scan in progress or queued",
                            other: "{{count}} scans in progress or queued",
                          },
                          liveUpdates.activeCount,
                        )
                      : translator.translateText("Scan results up to date")}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {liveUpdates.error
                    ? translator.translateText(
                        "Showing the last known progress. Updates will retry automatically.",
                      )
                    : liveUpdates.activeCount > 0
                      ? translator.translateText(
                          "Progress refreshes every 10 seconds. You can review results while a scan runs.",
                        )
                      : translator.translateText(
                          "No scans on this page are currently running. Review their results below.",
                        )}
                </p>
                {liveUpdates.error && (
                  <p className="mt-1 text-xs text-amber-800">
                    {liveUpdates.error}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>
                  {liveUpdates.isPaused && liveUpdates.activeCount > 0
                    ? translator.translateText(
                        "Updates paused while this tab is hidden",
                      )
                    : liveUpdates.isRefreshing
                      ? translator.translateText("Refreshing progress…")
                      : translator.translateTemplate(
                          "Last refreshed {{time}}",
                          {
                            time: liveUpdates.lastRefreshedAt.toLocaleTimeString(),
                          },
                        )}
                </span>
                {liveUpdates.error && (
                  <Button
                    title="Retry now"
                    buttonSize={ButtonSize.Small}
                    buttonStyle={ButtonStyleType.NORMAL}
                    isLoading={liveUpdates.isRefreshing}
                    onClick={() => {
                      void liveUpdates.refresh();
                    }}
                  />
                )}
              </div>
            </div>
          ) : undefined
        }
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
            "Scan an address range to find the devices on it, then pick the ones to add.",
        }}
        noItemsMessage={
          "No scans yet. Scan a subnet to find the devices on it, then pick the ones to add."
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
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-sm",
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              item = liveUpdates.getScan(item);
              const name: string | null = ScanNameUtil.getDisplayName(item);
              const methodBadge: DiscoveryScanMethodBadge =
                getDiscoveryScanMethodBadge(item);

              return (
                <div className="min-w-56 max-w-xs space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-gray-900">
                      {name || item.cidr || "—"}
                    </div>
                    {/*
                     * The scan's method, ICMP or SNMP, in the words of the two
                     * cards it was started with, the card's line as the
                     * tooltip. Every row says it: both are first-class
                     * choices now, and a Pending or In Progress scan has no
                     * result summary yet to tell them apart.
                     *
                     * Read from selectMoreFields rather than declared in this
                     * column's `field`, deliberately. getExportKeysFromColumn
                     * builds the CSV row out of a column's declared fields, and
                     * this column's pair is its identity — the name and the
                     * range it sweeps. A badge is decoration on that identity,
                     * not a third thing the cell is keyed on.
                     */}
                    <span
                      className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                      title={translator.translateText(
                        methodBadge.description,
                      )}
                      data-testid="discovery-scan-method-badge"
                    >
                      {translator.translateText(methodBadge.text)}
                    </span>
                  </div>
                  {name && item.cidr ? (
                    <div className="text-xs text-gray-500">{item.cidr}</div>
                  ) : (
                    <></>
                  )}
                  <p className="text-xs text-gray-500">
                    {item.probe?.name ||
                      translator.translateText("Probe not available")}
                    {" · "}
                    {item.isRecurring
                      ? item.rescanIntervalInMinutes
                        ? translator.translateTemplate(
                            "Repeats every {{minutes}} min",
                            { minutes: item.rescanIntervalInMinutes },
                          )
                        : translator.translateText("Repeats automatically")
                      : translator.translateText("One-time")}
                  </p>
                  {/*
                   * The message renders once, as a two-line preview, and
                   * offers "Show details" only when that preview actually
                   * cuts it short (issue #3842).
                   */}
                  {item.statusMessage && (
                    <DiscoveryScanStatusMessage
                      message={item.statusMessage}
                      scanLabel={ScanNameUtil.getScanLabel(item) || "this scan"}
                    />
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
            isHiddenByDefault: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
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
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              const activeImport: DiscoveryImportView | undefined =
                activeImports.byScanId.get(item._id?.toString() || "");

              return (
                <div className="space-y-3">
                  <DiscoveryScanProgress scan={liveUpdates.getScan(item)} />
                  {activeImport && (
                    <DiscoveryImportRowStatus
                      view={activeImport}
                      onView={() => {
                        setImportIdToShow(activeImport.id);
                        setScanToReview(liveUpdates.getScan(item));
                      }}
                    />
                  )}
                </div>
              );
            },
          },
          {
            field: {
              respondedHostCount: true,
            },
            title: "Responded Hosts",
            /*
             * "12 of 254 hosts" reads as everything that answered. On an SNMP
             * scan it is only the SNMP responders (the ping-only hosts are
             * the line under it), and mid-sweep the 254 is what has been
             * swept so far - the (i) says both.
             */
            headerTooltip:
              NETWORK_DEVICE_METRIC_DESCRIPTIONS.discoveryRespondedHosts,
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              item = liveUpdates.getScan(item);
              const outcome: DiscoveryScanOutcome =
                summarizeDiscoveryScan(item);
              return (
                <div className="min-w-36 max-w-48 space-y-1">
                  {!outcome.hasReported ||
                  isWaitingForDiscoveryProgress(item) ||
                  item.status === DiscoveryScanStatus.Pending ? (
                    <span className="text-xs text-gray-500">
                      {item.status === DiscoveryScanStatus.Pending
                        ? translator.translateText(
                            "Results will appear when the probe starts.",
                          )
                        : outcome.isInProgress
                          ? translator.translateText(
                              "Hosts appear here as they are discovered.",
                            )
                          : translator.translateText(
                              "No discovery results were reported.",
                            )}
                    </span>
                  ) : (
                    <>
                      <p className="text-sm text-gray-900">
                        {outcome.respondedHostSummary}
                      </p>
                      {outcome.pingOnlyHostCount > 0 && (
                        <p className="text-xs text-gray-500">
                          {translator.translatePlural(
                            {
                              one: "+ {{count}} alive without SNMP",
                              other: "+ {{count}} alive without SNMP",
                            },
                            outcome.pingOnlyHostCount,
                          )}
                        </p>
                      )}
                    </>
                  )}
                  {(outcome.isInProgress ||
                    item.status === DiscoveryScanStatus.Failed) &&
                    !isWaitingForDiscoveryProgress(item) &&
                    getDiscoveredHosts(item).length > 0 && (
                      <p className="text-xs font-medium text-blue-700">
                        {translator.translateText(
                          "Partial results are ready to review.",
                        )}
                      </p>
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
            isHiddenByDefault: true,
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
              item = liveUpdates.getScan(item);
              if (!item.isRecurring) {
                return (
                  <span className="text-sm text-gray-400">
                    {translator.translateText("One-time")}
                  </span>
                );
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
                      ? translator.translateTemplate("Every {{minutes}} min", {
                          minutes: item.rescanIntervalInMinutes,
                        })
                      : translator.translateText("Recurring")}
                  </div>
                  {nextScanAt ? (
                    <div
                      className="text-xs text-gray-500"
                      title={OneUptimeDate.getDateAsLocalFormattedString(
                        nextScanAt,
                      )}
                    >
                      {/* fromNow renders e.g. "in 12 minutes". */}
                      {translator.translateTemplate("Next scan {{time}}", {
                        time: OneUptimeDate.fromNow(nextScanAt),
                      })}
                    </div>
                  ) : isRunUnderway ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateText(
                        "Next scan is scheduled when this run finishes",
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-yellow-600">
                      {translator.translateText(
                        "No next scan is scheduled. Open Edit and save to schedule one.",
                      )}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              startedAt: true,
            },
            title: "Started",
            type: FieldType.DateTime,
            isHiddenByDefault: true,
            hideOnMobile: true,
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              const startedAt: Date | undefined =
                liveUpdates.getScan(item).startedAt;
              return (
                <span className="text-sm text-gray-600">
                  {startedAt
                    ? OneUptimeDate.getDateAsLocalFormattedString(
                        OneUptimeDate.fromString(startedAt),
                      )
                    : translator.translateText("Not started")}
                </span>
              );
            },
          },
        ]}
        selectMoreFields={{
          completedAt: true,
          scannedHostCount: true,
          discoveredDevices: true,
          /*
           * The scan's method — read by the outcome summary and by the Review
           * dialog, both of which say different things about a sweep that
           * asked nothing about SNMP.
           */
          isSnmpEnabled: true,
          /*
           * How the scan names what it imports (issue #3678). The Review
           * dialog re-reads it on open, but the row object it starts from is
           * this one, so it carries the column too rather than a value that
           * silently reads as "full names".
           */
          useShortDeviceNames: true,
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
             * Reviewing and importing what a scan found is the reason a scan
             * with results exists, so whenever this is offered it is the row's
             * button and Edit moves to the ⋯ menu.
             */
            placement: ActionButtonPlacement.Primary,
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
             * Failed runs can be reviewed too when they reported partial
             * results before stopping. Pending runs cannot: any old hosts
             * belong to the preceding run. A newly claimed scan with no hosts
             * has no review to offer yet.
             */
            isVisible: (item: NetworkDeviceDiscoveryScan): boolean => {
              item = liveUpdates.getScan(item);
              if (isWaitingForDiscoveryProgress(item)) {
                return false;
              }
              if (item.status === "Completed") {
                return true;
              }

              return (
                (item.status === DiscoveryScanStatus.InProgress ||
                  item.status === DiscoveryScanStatus.Failed) &&
                getDiscoveredHosts(item).length > 0
              );
            },
            onClick: async (
              item: NetworkDeviceDiscoveryScan,
              onCompleteAction: VoidFunction,
            ) => {
              setImportIdToShow(undefined);
              setScanToReview(liveUpdates.getScan(item));
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
          description={translator.translateTemplate(
            "This scan sweeps {{range}}.",
            {
              range:
                scanToEdit.cidr ||
                translatableTerm("the address range it was created with"),
            },
          )}
          /*
           * The one consequence that is not obvious from the form: a changed
           * sweep makes the last run's hosts describe a scan that no longer
           * exists, so they go. Said before the operator saves rather than
           * discovered afterwards in an empty Review Results dialog - in two
           * short sentences: what re-runs the scan (the sweep columns,
           * SWEEP_COLUMNS in NetworkDeviceDiscoveryScanService, the method
           * among them), and what is lost and what is kept. Anything not
           * named keeps the results; the Network Device guide lists each
           * case, the NetBIOS lookup's "from the next run" included.
           */
          footer={
            <Alert
              type={AlertType.INFO}
              strongTitle="Changing the target, probe, scan method or credentials runs the scan again"
              title="The hosts its last run found are cleared. Devices you already imported stay as they are."
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
            steps: DISCOVERY_SCAN_FORM_STEPS,
            fields: getDiscoveryScanFormFields(probes),
            formType: FormType.Update,
          }}
        />
      )}

      {scanToReview && (
        <DiscoveryImportDialog
          /*
           * One dialog per scan: another scan's review starts from nothing,
           * never from this one's step, selection or import.
           */
          key={scanToReview._id?.toString() || ""}
          scan={scanToReview}
          probes={probes}
          importId={importIdToShow}
          onClose={() => {
            setScanToReview(null);
            setImportIdToShow(undefined);
          }}
          onImportsChanged={() => {
            activeImports.refresh();
            // Hosts it imported read "Already added" on the next review.
            setRefreshToggle(Date.now().toString());
          }}
        />
      )}
    </Fragment>
  );
};

export default NetworkDeviceDiscovery;
