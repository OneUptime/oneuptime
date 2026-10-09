import { downloadPacketCapture, PacketCaptureFile, stopPacketCapture } from "./PacketCaptureApi";
import PacketCaptureReadinessNotice from "./PacketCaptureReadinessNotice";
import {
  CaptureStatusDisplay,
  CaptureView,
  PACKET_CAPTURE_POLL_INTERVAL_IN_MS,
  PacketCaptureReadiness,
  PacketCaptureStatusCopy,
  PacketCaptureTone,
  canDownloadCapture,
  canStopCapture,
  formatClock,
  getCaptureStatusDisplay,
  getPacketCaptureReadiness,
  hasActiveCapture,
} from "./PacketCaptureViewModel";
import StartPacketCaptureModal from "./StartPacketCaptureModal";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import Probe from "Common/Models/DatabaseModels/Probe";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Blue500, Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import PacketCaptureCapabilityUtil, {
  PacketCaptureCapability,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import {
  PACKET_CAPTURE_DOWNLOAD_PERMISSIONS,
  PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
  PACKET_CAPTURE_STOP_PERMISSIONS,
  PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
} from "Common/Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "Common/Types/PacketCapture/PacketCaptureStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import downloadFile from "Common/UI/Utils/DownloadFile";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  /*
   * The probe captures run on, read with its packetCaptureCapability,
   * isGlobalProbe and projectId.
   */
  probe: Probe;
  // On a device's page: only its captures, and new ones are linked to it.
  networkDeviceId?: ObjectID | undefined;
  // The device's address, which a new capture's filter starts with.
  defaultHost?: string | undefined;
  description?: string | undefined;
}

const TONE_COLORS: Record<PacketCaptureTone, Color> = {
  neutral: Gray500,
  active: Blue500,
  success: Green500,
  danger: Red500,
};

function toCaptureView(item: PacketCapture): CaptureView {
  return {
    status: (item.status as PacketCaptureStatus) || PacketCaptureStatus.Pending,
    maxDurationInSeconds: item.maxDurationInSeconds || 0,
    maxPackets: item.maxPackets || 0,
    maxFileSizeInMB: item.maxFileSizeInMB || 0,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    stopRequestedAt: item.stopRequestedAt,
    packetCount: item.packetCount,
    fileSizeInBytes: item.fileSizeInBytes,
    endReason: item.endReason,
    statusMessage: item.statusMessage,
  };
}

/*
 * A probe's packet captures - or, on a device's page, the device's - with
 * Start Packet Capture in the header. While one is waiting or running the
 * list re-reads itself every few seconds and the running one's clock ticks,
 * so nobody has to press Refresh to see their capture finish. A finished
 * capture's row button is Download; a running one's is Stop.
 *
 * Who sees what follows the server's lists: Start for whoever may create a
 * capture (Project Owner, Project Admin, Start Packet Capture), Stop for the
 * same people, Download for Download Packet Capture (or Owner/Admin). A
 * button the reader may not use stays on the row, locked, saying why.
 */
const PacketCapturesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [isActive, setIsActive] = useState<boolean>(false);
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());
  const [showStartModal, setShowStartModal] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");

  const readiness: PacketCaptureReadiness = getPacketCaptureReadiness(
    props.probe,
  );

  const capability: PacketCaptureCapability | null =
    PacketCaptureCapabilityUtil.parse(props.probe.packetCaptureCapability);

  const downloadGate: PermissionGateResult = PermissionGate.checkPermissions(
    PACKET_CAPTURE_DOWNLOAD_PERMISSIONS,
    { sentence: PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE },
  );

  const stopGate: PermissionGateResult = PermissionGate.checkPermissions(
    PACKET_CAPTURE_STOP_PERMISSIONS,
    { sentence: PACKET_CAPTURE_STOP_REFUSED_MESSAGE },
  );

  /*
   * While something is waiting or running: re-read the list every few
   * seconds, and tick the running clocks every second in between.
   */
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const poll: ReturnType<typeof setInterval> = setInterval(() => {
      setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
    }, PACKET_CAPTURE_POLL_INTERVAL_IN_MS);

    const tick: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, 1000);

    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [isActive]);

  const refresh: () => void = (): void => {
    setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
  };

  const renderStatus: (item: PacketCapture) => ReactElement = (
    item: PacketCapture,
  ): ReactElement => {
    const capture: CaptureView = toCaptureView(item);
    const display: CaptureStatusDisplay = getCaptureStatusDisplay(
      capture,
      translator,
      now,
    );

    const isRunning: boolean =
      capture.status === PacketCaptureStatus.Running &&
      !capture.stopRequestedAt;

    const elapsedInSeconds: number =
      isRunning && capture.startedAt
        ? Math.min(
            capture.maxDurationInSeconds,
            (now.getTime() - new Date(capture.startedAt).getTime()) / 1000,
          )
        : 0;

    const progressPercent: number =
      capture.maxDurationInSeconds > 0
        ? Math.max(
            0,
            Math.min(100, (elapsedInSeconds / capture.maxDurationInSeconds) * 100),
          )
        : 0;

    return (
      <div
        className="flex min-w-0 flex-col gap-1"
        data-testid="packet-capture-status"
        data-status={capture.status}
      >
        <div>
          <Pill
            text={PacketCaptureStatusCopy[capture.status]}
            color={TONE_COLORS[display.tone]}
            size={PillSize.Small}
            isPulsing={display.tone === "active"}
          />
        </div>
        {isRunning ? (
          <div
            className="h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-gray-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={capture.maxDurationInSeconds}
            aria-valuenow={Math.round(elapsedInSeconds)}
            aria-valuetext={`${formatClock(elapsedInSeconds)} / ${formatClock(capture.maxDurationInSeconds)}`}
          >
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : (
          <></>
        )}
        <span
          className={`text-xs ${display.tone === "danger" ? "text-red-600" : "text-gray-600"}`}
          data-testid="packet-capture-status-detail"
        >
          {display.detail}
        </span>
        {display.note ? (
          <span
            className="text-xs text-gray-500"
            data-testid="packet-capture-status-note"
          >
            {display.note}
          </span>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderCapture: (item: PacketCapture) => ReactElement = (
    item: PacketCapture,
  ): ReactElement => {
    const startedBy: string =
      item.createdByUser?.name?.toString() ||
      item.createdByUser?.email?.toString() ||
      "";

    const startedAt: string = item.createdAt
      ? OneUptimeDate.fromNow(item.createdAt)
      : "";

    return (
      <div className="flex min-w-0 flex-col gap-1" data-testid="packet-capture-summary">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-gray-900">
            {item.interfaceName === "any"
              ? translator.translateText("All interfaces")
              : item.interfaceName}
          </span>
          {props.networkDeviceId && item.probe?.name ? (
            <span className="text-xs text-gray-500">
              {translator.translateTemplate("on {{probeName}}", {
                probeName: item.probe.name,
              })}
            </span>
          ) : (
            <></>
          )}
        </div>
        {item.bpfFilter ? (
          <code className="max-w-md break-all font-mono text-xs text-gray-700">
            {item.bpfFilter}
          </code>
        ) : (
          <span className="text-xs text-gray-500">
            {translator.translateText("All traffic")}
          </span>
        )}
        <span className="text-xs text-gray-500">
          {startedBy
            ? translator.translateTemplate("Started {{time}} by {{name}}", {
                time: startedAt,
                name: startedBy,
              })
            : translator.translateTemplate("Started {{time}}", {
                time: startedAt,
              })}
        </span>
      </div>
    );
  };

  return (
    <Fragment>
      <ModelTable<PacketCapture>
        modelType={PacketCapture}
        id="packet-captures-table"
        name="Packet Captures"
        userPreferencesKey="packet-captures-table"
        disableUrlState={true}
        disableColumnCustomization={true}
        isDeleteable={true}
        isEditable={false}
        isViewable={false}
        showViewIdButton={false}
        isCreateable={readiness === PacketCaptureReadiness.Ready}
        createVerb="Start"
        singularName="Packet Capture"
        pluralName="Packet Captures"
        onCreateClick={() => {
          setShowStartModal(true);
        }}
        showRefreshButton={true}
        refreshToggle={refreshToggle}
        query={
          props.networkDeviceId
            ? { networkDeviceId: props.networkDeviceId }
            : { probeId: props.probe.id! }
        }
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        onFetchSuccess={(items: Array<PacketCapture>) => {
          setNow(OneUptimeDate.getCurrentDate());
          setIsActive(hasActiveCapture(items.map(toCaptureView)));
        }}
        cardProps={{
          title: "Packet Captures",
          description:
            props.description ||
            "Capture the traffic this probe sees, then download the file and open it in Wireshark.",
        }}
        topContent={
          readiness !== PacketCaptureReadiness.Ready || actionError ? (
            <div className="mb-4 space-y-3">
              {readiness !== PacketCaptureReadiness.Ready ? (
                <PacketCaptureReadinessNotice readiness={readiness} />
              ) : (
                <></>
              )}
              {actionError ? (
                <p
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  role="alert"
                  data-testid="packet-capture-action-error"
                >
                  {actionError}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : undefined
        }
        emptyState={{
          title: "No packet captures yet",
          description:
            readiness === PacketCaptureReadiness.Ready
              ? "Start one to capture what this probe sees. Narrow it to a host or a port, and download the file when it is done."
              : "Once packet capture is on for this probe, the captures you start appear here.",
        }}
        selectMoreFields={{
          bpfFilter: true,
          createdAt: true,
          createdByUser: {
            name: true,
            email: true,
          },
          probe: {
            name: true,
          },
          startedAt: true,
          completedAt: true,
          stopRequestedAt: true,
          maxDurationInSeconds: true,
          maxPackets: true,
          maxFileSizeInMB: true,
          packetCount: true,
          fileSizeInBytes: true,
          endReason: true,
          statusMessage: true,
        }}
        filters={[]}
        columns={[
          {
            field: { interfaceName: true },
            title: "Capture",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            getElement: renderCapture,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Element,
            wrapContent: true,
            getElement: renderStatus,
          },
        ]}
        actionButtons={[
          {
            title: "Download",
            icon: IconProp.Download,
            buttonStyleType: ButtonStyleType.NORMAL,
            disabled: !downloadGate.isAllowed,
            tooltip: downloadGate.disabledReason,
            isVisible: (item: PacketCapture): boolean => {
              return canDownloadCapture(toCaptureView(item));
            },
            onClick: async (
              item: PacketCapture,
              onCompleteAction: () => void,
            ) => {
              try {
                setActionError("");
                const file: PacketCaptureFile = await downloadPacketCapture(
                  item.id!,
                );
                downloadFile({
                  content: new Blob([file.bytes as BlobPart], {
                    type: file.fileType,
                  }),
                  filename: file.fileName,
                });
              } catch (err) {
                setActionError(API.getFriendlyMessage(err));
              } finally {
                onCompleteAction();
              }
            },
          },
          {
            title: "Stop",
            icon: IconProp.Stop,
            buttonStyleType: ButtonStyleType.NORMAL,
            disabled: !stopGate.isAllowed,
            tooltip: stopGate.disabledReason,
            isVisible: (item: PacketCapture): boolean => {
              return canStopCapture(toCaptureView(item));
            },
            onClick: async (
              item: PacketCapture,
              onCompleteAction: () => void,
            ) => {
              try {
                setActionError("");
                await stopPacketCapture(item.id!);
                refresh();
              } catch (err) {
                setActionError(API.getFriendlyMessage(err));
              } finally {
                onCompleteAction();
              }
            },
          },
        ]}
      />

      {showStartModal && capability && props.probe.id ? (
        <StartPacketCaptureModal
          probeId={props.probe.id}
          capability={capability}
          networkDeviceId={props.networkDeviceId}
          defaultHost={props.defaultHost}
          onClose={() => {
            setShowStartModal(false);
          }}
          onStarted={() => {
            setShowStartModal(false);
            setIsActive(true);
            refresh();
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default PacketCapturesTable;
