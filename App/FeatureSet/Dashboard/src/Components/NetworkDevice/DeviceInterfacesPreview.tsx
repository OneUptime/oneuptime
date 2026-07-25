import {
  isProblemInterface,
  rankInterfacesForAttention,
} from "./InterfaceAttentionUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const PREVIEW_ROW_COUNT: number = 6;

/*
 * Compact interface digest for the device Overview: the few ports most
 * worth attention (down ports first, then hottest), with a link to the
 * full Interfaces page. Replaces the full interfaces table that used to
 * make the Overview page unscrollable on big switches.
 */
const DeviceInterfacesPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [interfaces, setInterfaces] = useState<Array<NetworkInterface>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchInterfaces: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const result: ListResult<NetworkInterface> =
        await ModelAPI.getList<NetworkInterface>({
          modelType: NetworkInterface,
          query: {
            networkDeviceId: props.modelId.toString(),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            alias: true,
            interfaceIndex: true,
            isOperationallyUp: true,
            isAdministrativelyUp: true,
            utilizationPercent: true,
            inRateMbps: true,
            outRateMbps: true,
            errorsPerSecond: true,
          },
          sort: {
            interfaceIndex: SortOrder.Ascending,
          },
        });

      setInterfaces(result.data);
      setTotalCount(result.count);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchInterfaces().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  const interfacesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_INTERFACES] as Route,
    { modelId: props.modelId },
  );

  type GetStatusDotFunction = (row: NetworkInterface) => ReactElement;

  const getStatusDot: GetStatusDotFunction = (
    row: NetworkInterface,
  ): ReactElement => {
    if (!row.isAdministrativelyUp) {
      return (
        <span
          title="Administratively disabled"
          className="inline-block h-2 w-2 rounded-full bg-gray-400"
        ></span>
      );
    }

    if (row.isOperationallyUp) {
      return (
        <span
          title="Up"
          className="inline-block h-2 w-2 rounded-full bg-emerald-500"
        ></span>
      );
    }

    return (
      <span
        title="Down"
        className="inline-block h-2 w-2 rounded-full bg-red-500"
      ></span>
    );
  };

  type GetContentFunction = () => ReactElement;

  const getContent: GetContentFunction = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (interfaces.length === 0) {
      return (
        <p className="py-6 text-center text-sm text-gray-500">
          No interfaces discovered yet. Interfaces appear after the first
          successful SNMP poll.
        </p>
      );
    }

    const previewRows: Array<NetworkInterface> = rankInterfacesForAttention(
      interfaces,
      PREVIEW_ROW_COUNT,
    );

    const downCount: number = interfaces.filter(
      (row: NetworkInterface): boolean => {
        return isProblemInterface(row);
      },
    ).length;

    return (
      <div>
        {downCount > 0 && (
          <p className="mb-3 text-sm font-medium text-red-700">
            {downCount} interface{downCount === 1 ? " is" : "s are"} down on
            this device.
          </p>
        )}
        <div className="divide-y divide-gray-100">
          {previewRows.map((row: NetworkInterface): ReactElement => {
            return (
              <div
                key={row._id?.toString()}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {getStatusDot(row)}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {row.name || `ifIndex ${row.interfaceIndex}`}
                    </div>
                    {row.alias && (
                      <div className="truncate text-xs text-gray-500">
                        {row.alias}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-4 text-sm text-gray-600">
                  <span className="hidden sm:inline">
                    {row.inRateMbps !== undefined && row.inRateMbps !== null
                      ? `${row.inRateMbps} / ${row.outRateMbps ?? "—"} Mbps`
                      : "—"}
                  </span>
                  <span
                    className={
                      (row.utilizationPercent || 0) >= 80
                        ? "font-semibold text-amber-700"
                        : "text-gray-500"
                    }
                  >
                    {row.utilizationPercent !== undefined &&
                    row.utilizationPercent !== null
                      ? `${row.utilizationPercent}%`
                      : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 border-t border-gray-100 pt-3">
          <AppLink
            to={interfacesRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {`View all ${totalCount} interfaces →`}
          </AppLink>
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Interfaces"
      description="Ports that need attention first — down ports, then the busiest."
    >
      {getContent()}
    </Card>
  );
};

export default DeviceInterfacesPreview;
