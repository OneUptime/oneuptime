import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Navigation from "Common/UI/Utils/Navigation";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Full interface inventory for one device: counts up top, then every port
 * with live rates, utilization, and errors. Monitoring can be muted per
 * interface or in bulk — muted ports are still discovered, just not
 * polled for metrics or alerted on.
 */
const NetworkDeviceInterfaces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  interface InterfaceCounts {
    total: number;
    up: number;
    down: number;
    monitored: number;
  }

  const [counts, setCounts] = useState<InterfaceCounts | null>(null);
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
   * Bulk mute/unmute. Mirrors the loop in useBulkArchiveActions: update
   * each selected row and stream progress back to the BulkUpdateForm so
   * failures surface per-interface.
   */
  type ApplyBulkMonitoringFunction = (
    isMonitored: boolean,
    bulkProps: BulkActionOnClickProps<NetworkInterface>,
  ) => Promise<void>;

  const applyBulkMonitoring: ApplyBulkMonitoringFunction = async (
    isMonitored: boolean,
    bulkProps: BulkActionOnClickProps<NetworkInterface>,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkProps;

    onBulkActionStart();

    const totalItems: Array<NetworkInterface> = [...items];
    const inProgressItems: Array<NetworkInterface> = [...items];
    const successItems: Array<NetworkInterface> = [];
    const failedItems: Array<BulkActionFailed<NetworkInterface>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
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

        successItems.push(item);
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
    setCountsRefreshToken((current: number) => {
      return current + 1;
    });
  };

  type GetInterfaceStatusElementFunction = (
    item: NetworkInterface,
  ) => ReactElement;

  const getInterfaceStatusElement: GetInterfaceStatusElementFunction = (
    item: NetworkInterface,
  ): ReactElement => {
    const isAdminUp: boolean = Boolean(item.isAdministrativelyUp);
    const isOperUp: boolean = Boolean(item.isOperationallyUp);

    if (!isAdminUp) {
      return (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
          <span className="text-sm font-medium text-gray-500">Disabled</span>
        </div>
      );
    }

    if (isOperUp) {
      return (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">Up</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
        <span className="text-sm font-medium text-red-700">Down</span>
      </div>
    );
  };

  return (
    <Fragment>
      {counts && (
        <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <InfoCard
            title="Total Interfaces"
            value={
              <div className="mt-1 text-3xl font-semibold text-gray-900">
                {counts.total}
              </div>
            }
          />
          <InfoCard
            title="Up"
            value={
              <div className="mt-1 text-3xl font-semibold text-emerald-600">
                {counts.up}
              </div>
            }
          />
          <InfoCard
            title="Down"
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
            value={
              <div className="mt-1 text-3xl font-semibold text-gray-900">
                {counts.monitored}
              </div>
            }
          />
        </div>
      )}
      <ModelTable<NetworkInterface>
        modelType={NetworkInterface}
        id="network-interfaces-table"
        userPreferencesKey="network-interfaces-table"
        query={{
          networkDeviceId: modelId.toString(),
        }}
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
            getElement: (item: NetworkInterface): ReactElement => {
              return (
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {item.name}
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
            type: FieldType.Number,
            hideOnMobile: true,
          },
          {
            field: {
              inRateMbps: true,
            },
            title: "In / Out (Mbps)",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkInterface): ReactElement => {
              const inRate: number | undefined =
                (item.inRateMbps as number | undefined) ?? undefined;
              const outRate: number | undefined =
                (item.outRateMbps as number | undefined) ?? undefined;
              return (
                <span className="text-sm text-gray-700">
                  {inRate !== undefined ? inRate : "—"}
                  <span className="text-gray-400"> / </span>
                  {outRate !== undefined ? outRate : "—"}
                </span>
              );
            },
          },
          {
            field: {
              utilizationPercent: true,
            },
            title: "Utilization",
            type: FieldType.Percent,
            hideOnMobile: true,
          },
          {
            field: {
              errorsPerSecond: true,
            },
            title: "Errors / sec",
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
