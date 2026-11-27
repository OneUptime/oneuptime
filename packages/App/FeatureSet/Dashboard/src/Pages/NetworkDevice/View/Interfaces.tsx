import PageComponentProps from "../../PageComponentProps";
import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/NetworkDeviceMetricDescriptions";
import TransceiverHealthCard from "../../../Components/NetworkDevice/TransceiverHealthCard";
import FibreChannelPortsCard from "../../../Components/NetworkDevice/FibreChannelPortsCard";
import SnmpFibreChannelUtil from "Common/Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Navigation from "Common/UI/Utils/Navigation";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { BulkActionOnClickProps } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { runBulkAction } from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Query from "Common/Types/BaseDatabase/Query";
import {
  DOWN_INTERFACES_QUERY,
  INTERFACES_SHOW_DOWN,
  INTERFACES_SHOW_PARAM,
} from "../../../Components/NetworkDevice/InterfaceListRoute";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

/*
 * Full interface inventory for one device: counts up top, the optics in its
 * ports (only on a device that reports them), then every port with live
 * rates, utilization, and errors. Monitoring can be muted per interface or
 * in bulk — muted ports are still discovered, just not polled for metrics or
 * alerted on.
 */
const NetworkDeviceInterfaces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  interface InterfaceCounts {
    total: number;
    up: number;
    down: number;
    monitored: number;
  }

  const [counts, setCounts] = useState<InterfaceCounts | null>(null);
  /*
   * The table on the interfaces that are down (#9596): the Down card turns
   * it on and off, and the device hero's "2 down" opens the page with it
   * on (?show=down).
   */
  const [isDownOnly, setIsDownOnly] = useState<boolean>(
    Navigation.getQueryStringByName(INTERFACES_SHOW_PARAM) ===
      INTERFACES_SHOW_DOWN,
  );
  // A stable query: the table reads again only when it changes.
  const tableQuery: Query<NetworkInterface> = useMemo(() => {
    return isDownOnly
      ? { networkDeviceId: modelId.toString(), ...DOWN_INTERFACES_QUERY }
      : { networkDeviceId: modelId.toString() };
  }, [isDownOnly, modelId.toString()]);
  // Bumped after a bulk mute/unmute so the count strip refetches.
  const [countsRefreshToken, setCountsRefreshToken] = useState<number>(0);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const [device, monitored]: [NetworkDevice | null, number] =
        await Promise.all([
          ModelAPI.getItem<NetworkDevice>({
            modelType: NetworkDevice,
            id: modelId,
            select: {
              interfacesTotal: true,
              interfacesUp: true,
              interfacesDown: true,
            },
          }),
          ModelAPI.count<NetworkInterface>({
            modelType: NetworkInterface,
            query: {
              networkDeviceId: modelId.toString(),
              isMonitored: true,
            },
          }),
        ]);

      setCounts({
        total: (device?.interfacesTotal as number) || 0,
        up: (device?.interfacesUp as number) || 0,
        down: (device?.interfacesDown as number) || 0,
        monitored: monitored,
      });
    } catch {
      // The count strip is supplementary — the table below still renders.
      setCounts(null);
    }
  };

  useEffect(() => {
    fetchCounts().catch(() => {
      // handled in fetchCounts.
    });
  }, [countsRefreshToken]);

  /*
   * Bulk mute/unmute: each selected row its own update, through the shared
   * runner (progress, Stop, failures per interface). One at a time: every
   * interface of a device rolls up into that device's health, which each
   * write recomputes.
   */
  type ApplyBulkMonitoringFunction = (
    isMonitored: boolean,
    bulkProps: BulkActionOnClickProps<NetworkInterface>,
  ) => Promise<void>;

  const applyBulkMonitoring: ApplyBulkMonitoringFunction = async (
    isMonitored: boolean,
    bulkProps: BulkActionOnClickProps<NetworkInterface>,
  ): Promise<void> => {
    await runBulkAction<NetworkInterface>({
      actionProps: bulkProps,
      concurrency: 1,
      step: async (item: NetworkInterface): Promise<void> => {
        if (!item.id) {
          throw new BadDataException("Interface ID not found");
        }

        await ModelAPI.updateById<NetworkInterface>({
          id: item.id,
          modelType: NetworkInterface,
          data: {
            isMonitored: isMonitored,
          } as any,
        });
      },
    });

    setCountsRefreshToken((current: number) => {
      return current + 1;
    });
  };

  type GetInterfaceStatusElementFunction = (
    item: NetworkInterface,
  ) => ReactElement;

  /*
   * Why a port is down, in the switch's own words, under its status: a
   * SAN switch says it ("No light", "SFP not present", "Link failure or
   * not-connected"), and nothing else does. Left out when it only repeats
   * the status.
   */
  type GetDownReasonElementFunction = (
    item: NetworkInterface,
    statusWord: string,
  ) => ReactElement;

  const getDownReasonElement: GetDownReasonElementFunction = (
    item: NetworkInterface,
    statusWord: string,
  ): ReactElement => {
    const reason: string = (item.downReason || "").trim();

    if (
      !reason ||
      reason.toLowerCase() === statusWord.toLowerCase() ||
      reason.toLowerCase() ===
        (translator.translateText(statusWord) || statusWord).toLowerCase()
    ) {
      return <></>;
    }

    return (
      <div
        className="mt-0.5 text-xs text-gray-500"
        data-testid="interface-down-reason"
      >
        {reason}
      </div>
    );
  };

  const getInterfaceStatusElement: GetInterfaceStatusElementFunction = (
    item: NetworkInterface,
  ): ReactElement => {
    const isAdminUp: boolean = Boolean(item.isAdministrativelyUp);
    const isOperUp: boolean = Boolean(item.isOperationallyUp);

    if (!isAdminUp) {
      return (
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
            <span className="text-sm font-medium text-gray-500">
              {translator.translateText("Disabled")}
            </span>
          </div>
          {getDownReasonElement(item, "Disabled")}
        </div>
      );
    }

    if (isOperUp) {
      return (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">
            {translator.translateText("Up")}
          </span>
        </div>
      );
    }

    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          <span className="text-sm font-medium text-red-700">
            {translator.translateText("Down")}
          </span>
        </div>
        {getDownReasonElement(item, "Down")}
      </div>
    );
  };

  /*
   * A Fibre Channel port's type beside its name: E-Port (an inter-switch
   * link, drawn as worth knowing), F-Port (a host or an array) and the rest.
   */
  type GetPortTypeElementFunction = (item: NetworkInterface) => ReactElement;

  const getPortTypeElement: GetPortTypeElementFunction = (
    item: NetworkInterface,
  ): ReactElement => {
    const title: string | undefined = SnmpFibreChannelUtil.getPortTypeTitle(
      item.fibreChannelPortType,
    );

    if (!title) {
      return <></>;
    }

    return (
      <Pill
        text={translator.translateText(title) || title}
        tone={
          SnmpFibreChannelUtil.isInterSwitchLink(item.fibreChannelPortType)
            ? PillTone.Info
            : PillTone.Neutral
        }
        isDotHidden={true}
        size={PillSize.Small}
      />
    );
  };

  return (
    <Fragment>
      {counts && (
        <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <InfoCard
            title="Total Interfaces"
            tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.totalInterfaces}
            value={
              <div className="mt-1 text-3xl font-semibold text-gray-900">
                {counts.total}
              </div>
            }
          />
          <InfoCard
            title="Up"
            tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfacesUp}
            value={
              <div className="mt-1 text-3xl font-semibold text-emerald-600">
                {counts.up}
              </div>
            }
          />
          <InfoCard
            title="Down"
            tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfacesDown}
            /*
             * Which ones: the table below on the interfaces that are down,
             * pressed again for every interface.
             */
            onClick={
              counts.down > 0 || isDownOnly
                ? () => {
                    setIsDownOnly(!isDownOnly);
                  }
                : undefined
            }
            isSelected={counts.down > 0 || isDownOnly ? isDownOnly : undefined}
            value={
              <div
                className={`mt-1 text-3xl font-semibold ${
                  counts.down > 0 ? "text-red-600" : "text-gray-900"
                }`}
              >
                {counts.down}
              </div>
            }
          />
          <InfoCard
            title="Monitored"
            tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfacesMonitored}
            value={
              <div className="mt-1 text-3xl font-semibold text-gray-900">
                {counts.monitored}
              </div>
            }
          />
        </div>
      )}
      {/*
       * SFP, SFP+ and QSFP health, port by port. Draws nothing on a device
       * that reports no transceivers.
       */}
      <TransceiverHealthCard networkDeviceId={modelId} />
      {/*
       * A SAN switch's Fibre Channel errors, discards and credit counters,
       * port by port. Draws nothing on a device with no Fibre Channel ports.
       */}
      <FibreChannelPortsCard networkDeviceId={modelId} />
      <ModelTable<NetworkInterface>
        modelType={NetworkInterface}
        id="network-interfaces-table"
        userPreferencesKey="network-interfaces-table"
        query={tableQuery}
        isDeleteable={false}
        isEditable={true}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        name="Network Interfaces"
        sortBy="interfaceIndex"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Interfaces",
          description:
            "Interfaces discovered on this device via SNMP. Toggle monitoring per interface, or select multiple to mute/unmute in bulk.",
        }}
        bulkActions={{
          buttons: [
            {
              title: "Unmute",
              icon: IconProp.Bell,
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                bulkProps: BulkActionOnClickProps<NetworkInterface>,
              ): Promise<void> => {
                await applyBulkMonitoring(true, bulkProps);
              },
            },
            {
              title: "Mute",
              icon: IconProp.BellSlash,
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                bulkProps: BulkActionOnClickProps<NetworkInterface>,
              ): Promise<void> => {
                await applyBulkMonitoring(false, bulkProps);
              },
            },
          ],
        }}
        noItemsMessage={
          "No interfaces discovered yet. Interfaces will appear here after the first successful SNMP poll."
        }
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
              isOperationallyUp: true,
            },
            title: "Operationally Up",
            type: FieldType.Boolean,
          },
          {
            field: {
              isMonitored: true,
            },
            title: "Monitored",
            type: FieldType.Boolean,
          },
        ]}
        formFields={[
          {
            field: {
              isMonitored: true,
            },
            title: "Monitor this Interface",
            description:
              "When enabled, this interface is polled and its metrics are collected.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        selectMoreFields={{
          isAdministrativelyUp: true,
          outRateMbps: true,
          alias: true,
          fibreChannelPortType: true,
          downReason: true,
        }}
        columns={[
          {
            field: {
              interfaceIndex: true,
            },
            title: "Index",
            type: FieldType.Number,
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            // Its name, and its own data under it: the cell reads the name's way.
            getLineText: (item: NetworkInterface): string | undefined => {
              return item.name;
            },
            getElement: (item: NetworkInterface): ReactElement => {
              return (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {item.name}
                    </span>
                    {getPortTypeElement(item)}
                  </div>
                  {item.alias && (
                    <div className="text-xs text-gray-500">{item.alias}</div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              isOperationallyUp: true,
            },
            title: "Status",
            headerTooltip: NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfaceStatus,
            type: FieldType.Element,
            getElement: (item: NetworkInterface): ReactElement => {
              return getInterfaceStatusElement(item);
            },
          },
          {
            field: {
              macAddress: true,
            },
            title: "MAC Address",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              speedInMbps: true,
            },
            title: "Speed (Mbps)",
            headerTooltip: NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfaceSpeed,
            type: FieldType.Number,
            hideOnMobile: true,
          },
          {
            field: {
              inRateMbps: true,
            },
            title: "In / Out (Mbps)",
            headerTooltip:
              NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfaceInOutRate,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkInterface): ReactElement => {
              const inRate: number | undefined =
                (item.inRateMbps as number | undefined) ?? undefined;
              const outRate: number | undefined =
                (item.outRateMbps as number | undefined) ?? undefined;
              return (
                <span className="text-sm text-gray-700">
                  {inRate !== undefined ? inRate : <TableEmptyValue />}
                  <span className="text-gray-400"> / </span>
                  {outRate !== undefined ? outRate : <TableEmptyValue />}
                </span>
              );
            },
          },
          {
            field: {
              utilizationPercent: true,
            },
            title: "Utilization",
            headerTooltip:
              NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfaceUtilization,
            type: FieldType.Percent,
            hideOnMobile: true,
          },
          {
            field: {
              errorsPerSecond: true,
            },
            title: "Errors / sec",
            headerTooltip:
              NETWORK_DEVICE_METRIC_DESCRIPTIONS.interfaceErrorsPerSecond,
            type: FieldType.Number,
            hideOnMobile: true,
          },
          {
            field: {
              isMonitored: true,
            },
            title: "Monitored",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkDeviceInterfaces;
