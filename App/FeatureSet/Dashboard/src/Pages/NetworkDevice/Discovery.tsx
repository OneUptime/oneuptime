import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ProbeUtil from "../../Utils/Probe";
import Route from "Common/Types/API/Route";
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
import { ToastType } from "Common/UI/Components/Toast/Toast";
import { ShowToastNotification } from "Common/UI/Components/Toast/ToastInit";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import { getSnmpConfigFormFields } from "./SnmpConfigFormFields";
import {
  MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
  validateRescanInterval,
  validateScanTarget,
} from "./DiscoveryScanFormValidation";
import { buildNetworkDeviceFromDiscoveredHost } from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
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

const NetworkDeviceDiscovery: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [refreshToggle, setRefreshToggle] = useState<string>("");

  // Review Results modal state.
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
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
     * are included: they import as monitor-backed devices rather than as
     * SNMP-credentialed ones that could never be polled. Read through the
     * overlay so reopening a scan does not re-tick what was already imported
     * from it.
     */
    setSelectedIps(getInitialSelection(getReviewHosts(scan)));
    // Every scan opens on the whole list; narrowing is the operator's move.
    setHostFilter(DiscoveredHostFilter.All);
    setImportError("");
    setShowReviewModal(true);
  };

  const closeReviewModal: VoidFunction = (): void => {
    setShowReviewModal(false);
    setScanToReview(null);
    reviewedScanIdRef.current = "";
    setSelectedIps({});
    setHostFilter(DiscoveredHostFilter.All);
    setImportError("");
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

      for (const entry of entriesToImport) {
        try {
          /*
           * The shared recipe (Common/Utils/NetworkDiscovery/
           * DiscoveredDeviceBuilder): name, hostname, description, and — for
           * SNMP hosts — the scan's probe and credentials. A ping-only host
           * gets none of the scan's SNMP setup and polling off; binding a
           * monitor to it is a separate, deliberate step. The server-side
           * auto-import rule engine builds through the same function, so a
           * hand-imported host and a rule-imported host are the same device.
           */
          const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
            projectId: ProjectUtil.getCurrentProjectId()!,
            host: entry,
            scan: scanToReview,
          });

          await ModelAPI.create<NetworkDevice>({
            model: device,
            modelType: NetworkDevice,
          });

          importedNow.push(entry.ipAddress);
        } catch (err) {
          failures.push(`${entry.ipAddress}: ${API.getFriendlyMessage(err)}`);
        }
      }

      setIsImporting(false);

      const successCount: number = importedNow.length;

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
       * not close it — but its toasts still fire, because the devices really
       * were created and the operator needs to know.
       */
      const isStillTheSameReview: boolean =
        reviewedScanIdRef.current === runScanId;

      if (successCount > 0) {
        ShowToastNotification({
          title: "Devices Imported",
          description: `${successCount} network device${
            successCount === 1 ? "" : "s"
          } imported successfully.`,
          type: ToastType.SUCCESS,
        });
      }

      if (failures.length > 0) {
        ShowToastNotification({
          title: "Some Devices Could Not Be Imported",
          description: `${failures.length} device${
            failures.length === 1 ? "" : "s"
          } failed to import.`,
          type: ToastType.DANGER,
        });

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
        filters={[]}
        cardProps={{
          title: "Discovery Scans",
          description:
            "Scan a subnet or octet range for SNMP devices from a probe, then review the results and import the devices you want to monitor.",
        }}
        noItemsMessage={
          "No discovery scans yet. Start one to sweep a subnet or octet range for SNMP devices."
        }
        formSteps={[
          { title: "Scan Target", id: "scan-target" },
          { title: "SNMP Credentials", id: "snmp" },
          { title: "Schedule", id: "schedule" },
        ]}
        formFields={[
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
           * Shared SNMP fields (version, community, full v3 credential set
           * with showIf reveal logic) — the same helper the NetworkDevice
           * forms use, so a v3 subnet scan collects the same credentials a v3
           * device needs and the two can never drift apart.
           */
          ...getSnmpConfigFormFields({
            communityStringDescription:
              "Tried against every host in the subnet. Required for SNMP V1 and V2c. Not used for V3.",
            stepId: "snmp",
          }),
          {
            field: {
              isRecurring: true,
            },
            title: "Repeat this scan",
            stepId: "schedule",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
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
        ]}
        columns={[
          {
            field: {
              cidr: true,
            },
            title: "Scan Target",
            type: FieldType.Text,
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
                    className="text-xs text-gray-500 max-w-md"
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
                  {outcome.pingOnlyHostCount > 0 && (
                    <div className="text-xs text-gray-500">
                      {`+ ${outcome.pingOnlyHostCount} alive without SNMP`}
                    </div>
                  )}
                  {outcome.explanation && (
                    <div
                      className="text-xs text-gray-500 mt-1 max-w-md"
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
            getElement: (item: NetworkDeviceDiscoveryScan): ReactElement => {
              if (!item.isRecurring) {
                return <span className="text-sm text-gray-400">One-time</span>;
              }

              const nextScanAt: Date | null = item.nextScanAt
                ? OneUptimeDate.fromString(item.nextScanAt)
                : null;

              return (
                <div>
                  <div className="text-sm text-gray-900">
                    {item.rescanIntervalInMinutes
                      ? `Every ${item.rescanIntervalInMinutes} min`
                      : "Recurring"}
                  </div>
                  {nextScanAt && (
                    <div
                      className="text-xs text-gray-500"
                      title={OneUptimeDate.getDateAsLocalFormattedString(
                        nextScanAt,
                      )}
                    >
                      {/* fromNow renders e.g. "in 12 minutes". */}
                      {`Next scan ${OneUptimeDate.fromNow(nextScanAt)}`}
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
          // Recurrence details rendered inside the "Recurrence" column.
          rescanIntervalInMinutes: true,
          nextScanAt: true,
          probeId: true,
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
            title: "Review Results",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            isVisible: (item: NetworkDeviceDiscoveryScan): boolean => {
              return item.status === "Completed";
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

      {showReviewModal && scanToReview && (
        <Modal
          title="Review Discovered Devices"
          /*
           * This used to end "hosts without SNMP cannot be imported", which
           * stopped being true when ping-only hosts started importing as
           * monitor-backed devices — and reads as a flat contradiction next to
           * a No SNMP filter that exists precisely to import them as a batch.
           */
          description={`Hosts that responded in ${
            scanToReview.cidr || "the scanned address range"
          }. Filter to a group, pick the hosts you want, and import — SNMP hosts arrive as polled devices, hosts without SNMP as monitor-backed ones.${
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
                  <FilterButtons
                    options={hostFilterOptions}
                    selectedValue={hostFilter}
                    onSelect={(value: string) => {
                      setHostFilter(value as DiscoveredHostFilter);
                    }}
                  />
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
                 * Ping-only hosts (snmpReachable === false) import too, as
                 * monitor-backed devices rather than SNMP-credentialed ones
                 * that could never be polled. They are badged so the
                 * operator knows what they are agreeing to. Legacy rows
                 * (snmpReachable undefined) import as SNMP, as before.
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
                        ariaLabel={`Import ${entry.sysName || entry.ipAddress} (${entry.ipAddress || "no address"})`}
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
                        <div className="text-sm font-medium text-gray-900">
                          {entry.sysName || entry.ipAddress}
                        </div>
                        <div className="text-sm text-gray-500">
                          {entry.ipAddress}
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
                          title="Responds to ping only. Imports as a monitor-backed device: no polling and no credentials, so bind a Ping or IP monitor to it afterwards to give it a status."
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
