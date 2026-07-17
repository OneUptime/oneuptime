import PageComponentProps from "../PageComponentProps";
import ProbeUtil from "../../Utils/Probe";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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
import { getSnmpConfigFormFields } from "./SnmpConfigFormFields";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

type DiscoveredDeviceEntry = DiscoveredNetworkDevice;

type GetDiscoveredDevicesFunction = (
  scan: NetworkDeviceDiscoveryScan | null,
) => Array<DiscoveredDeviceEntry>;

const getDiscoveredDevices: GetDiscoveredDevicesFunction = (
  scan: NetworkDeviceDiscoveryScan | null,
): Array<DiscoveredDeviceEntry> => {
  const raw: unknown = scan?.discoveredDevices;
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  return raw as Array<DiscoveredDeviceEntry>;
};

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
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>("");

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

  const openReviewModal: OpenReviewModalFunction = (
    scan: NetworkDeviceDiscoveryScan,
  ): void => {
    const entries: Array<DiscoveredDeviceEntry> = getDiscoveredDevices(scan);

    // Preselect every device that is not already registered.
    const initialSelection: Record<string, boolean> = {};
    for (const entry of entries) {
      if (entry.ipAddress && !entry.isAlreadyRegistered) {
        initialSelection[entry.ipAddress] = true;
      }
    }

    setScanToReview(scan);
    setSelectedIps(initialSelection);
    setImportError("");
    setShowReviewModal(true);
  };

  const closeReviewModal: VoidFunction = (): void => {
    setShowReviewModal(false);
    setScanToReview(null);
    setSelectedIps({});
    setImportError("");
  };

  const importSelectedDevices: PromiseVoidFunction =
    async (): Promise<void> => {
      if (!scanToReview) {
        return;
      }

      const entriesToImport: Array<DiscoveredDeviceEntry> =
        getDiscoveredDevices(scanToReview).filter(
          (entry: DiscoveredDeviceEntry) => {
            return (
              Boolean(entry.ipAddress) &&
              !entry.isAlreadyRegistered &&
              Boolean(selectedIps[entry.ipAddress])
            );
          },
        );

      if (entriesToImport.length === 0) {
        return;
      }

      setIsImporting(true);
      setImportError("");

      let successCount: number = 0;
      const failures: Array<string> = [];

      for (const entry of entriesToImport) {
        try {
          const device: NetworkDevice = new NetworkDevice();
          device.projectId = ProjectUtil.getCurrentProjectId()!;
          device.name = entry.sysName || entry.ipAddress;
          device.hostname = entry.ipAddress;

          if (entry.sysDescr) {
            device.description = entry.sysDescr.substring(0, 500);
          }

          if (scanToReview.probeId) {
            device.probeId = new ObjectID(scanToReview.probeId.toString());
          }

          if (scanToReview.snmpVersion) {
            device.snmpVersion = scanToReview.snmpVersion;
          }

          if (scanToReview.snmpCommunityString) {
            device.snmpCommunityString = scanToReview.snmpCommunityString;
          }

          if (scanToReview.snmpPort) {
            device.snmpPort = scanToReview.snmpPort;
          }

          // Carry the v3 credentials so a v3 scan imports as a v3 device.
          if (scanToReview.snmpV3SecurityLevel) {
            device.snmpV3SecurityLevel = scanToReview.snmpV3SecurityLevel;
          }

          if (scanToReview.snmpV3Username) {
            device.snmpV3Username = scanToReview.snmpV3Username;
          }

          if (scanToReview.snmpV3AuthProtocol) {
            device.snmpV3AuthProtocol = scanToReview.snmpV3AuthProtocol;
          }

          if (scanToReview.snmpV3AuthKey) {
            device.snmpV3AuthKey = scanToReview.snmpV3AuthKey;
          }

          if (scanToReview.snmpV3PrivProtocol) {
            device.snmpV3PrivProtocol = scanToReview.snmpV3PrivProtocol;
          }

          if (scanToReview.snmpV3PrivKey) {
            device.snmpV3PrivKey = scanToReview.snmpV3PrivKey;
          }

          await ModelAPI.create<NetworkDevice>({
            model: device,
            modelType: NetworkDevice,
          });

          successCount++;
        } catch (err) {
          failures.push(`${entry.ipAddress}: ${API.getFriendlyMessage(err)}`);
        }
      }

      setIsImporting(false);

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
        setImportError(failures.join(" "));
      } else {
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
    getDiscoveredDevices(scanToReview);

  const selectedCount: number = reviewEntries.filter(
    (entry: DiscoveredDeviceEntry) => {
      return (
        Boolean(entry.ipAddress) &&
        !entry.isAlreadyRegistered &&
        Boolean(selectedIps[entry.ipAddress])
      );
    },
  ).length;

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
            "Scan a subnet for SNMP devices from a probe, then review the results and import the devices you want to monitor.",
        }}
        noItemsMessage={
          "No discovery scans yet. Start one to sweep a subnet for SNMP devices."
        }
        formFields={[
          {
            field: {
              cidr: true,
            },
            title: "Subnet (CIDR)",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "192.168.1.0/24",
            description: "Subnet to scan in CIDR notation, e.g. 192.168.1.0/24",
          },
          {
            field: {
              probe: true,
            },
            title: "Probe",
            description: "Which probe should scan this subnet?",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: probes.map((probe: Probe) => {
              if (!probe.name || !probe._id) {
                throw new BadDataException(`Probe name or id is missing`);
              }

              return {
                label: probe.name,
                value: probe._id,
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
          }),
          {
            field: {
              isRecurring: true,
            },
            title: "Repeat this scan",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Re-run this scan automatically to keep discovery continuous. Newly found devices still wait for your review before import.",
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
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "60",
            description:
              "How often to re-run this scan, in minutes. Minimum 15 minutes.",
            validation: {
              minValue: 15,
            },
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
            title: "Subnet",
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
              if (
                item.respondedHostCount === undefined ||
                item.respondedHostCount === null
              ) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              return (
                <span className="text-sm text-gray-900">
                  {`${item.respondedHostCount} of ${
                    item.scannedHostCount ?? "?"
                  } hosts`}
                </span>
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
          description={`Devices that responded to SNMP in ${
            scanToReview.cidr || "the scanned subnet"
          }. Select the ones you want to import as Network Devices.`}
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
            {reviewEntries.length === 0 && (
              <p className="text-sm text-gray-500">
                This scan did not find any SNMP devices.
              </p>
            )}
            {reviewEntries.map(
              (entry: DiscoveredDeviceEntry, index: number): ReactElement => {
                return (
                  <div
                    key={`${entry.ipAddress}-${index}`}
                    className="flex items-start justify-between gap-3 border-b border-gray-100 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <CheckboxElement
                        dataTestId={`discovered-device-checkbox-${entry.ipAddress}`}
                        value={
                          entry.isAlreadyRegistered
                            ? false
                            : Boolean(selectedIps[entry.ipAddress])
                        }
                        disabled={
                          Boolean(entry.isAlreadyRegistered) || isImporting
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
                    {entry.isAlreadyRegistered && (
                      <span className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        Already added
                      </span>
                    )}
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
