import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import OneUptimeDate from "Common/Types/Date";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  XCP_NG_HOST_COLUMN_DESCRIPTIONS,
  getXcpNgHostColumns,
  toXcpNgListResource,
} from "../../../Components/XcpNg/XcpNgResourceColumns";
import {
  XcpNgPartRoutes,
  getXcpNgPartRoutes,
} from "../../../Components/XcpNg/Part/XcpNgPartRoutes";
import { fetchXcpNgInventoryRows } from "../../../Components/XcpNg/XcpNgInventoryReads";
import { sortXcpNgByName } from "../Utils/XcpNgPartFacts";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Route from "Common/Types/API/Route";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * An XCP-ng pool's hosts: each one's state as Xen Orchestra reports it
 * (Running, Halted, Unknown; a disabled one says so in grey, a choice
 * someone made), how busy it is, the vCPUs its VMs run on its threads, the
 * VMs it runs, how long it has been up and its power draw - each a step
 * from its own page. Read from the pool's inventory (XcpNgResource), the
 * rows the side menu's count is recounted from.
 */
const XcpNgPoolHosts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // The hosts, and the VMs each one runs (for its VMs column).
  const [rows, setRows] = useState<Array<XcpNgResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const [hosts, vms]: [Array<XcpNgResource>, Array<XcpNgResource>] =
        await Promise.all([
          fetchXcpNgInventoryRows({
            xcpNgPoolId: modelId,
            kind: XcpNgResourceKind.Host,
          }),
          fetchXcpNgInventoryRows({
            xcpNgPoolId: modelId,
            kind: XcpNgResourceKind.VM,
          }),
        ]);
      setRows([...hosts, ...vms]);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading && rows.length === 0) {
    return <PageSkeleton shape="table" />;
  }

  if (error && rows.length === 0) {
    return <ErrorMessage message={error} />;
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const routes: XcpNgPartRoutes = getXcpNgPartRoutes(modelId);
  const resources: Array<InfrastructureResource> = sortXcpNgByName(
    rows.filter((row: XcpNgResource): boolean => {
      return row.kind === XcpNgResourceKind.Host;
    }),
  ).map((row: XcpNgResource): InfrastructureResource => {
    return toXcpNgListResource(row, { now: now, translator: translator });
  });

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Hosts"
      description="The hosts of this XCP-ng pool, how busy each one is, and the VMs it runs."
      resources={resources}
      showGroupColumn={false}
      builtInColumnDescriptions={XCP_NG_HOST_COLUMN_DESCRIPTIONS}
      metricThresholds={{
        cpu: { warning: 80, danger: 90 },
        memory: { warning: 85, danger: 95 },
      }}
      tableIdPrefix="xcp-ng"
      emptyMessage="No hosts yet. A pool's hosts appear here once Xen Orchestra reports the pool."
      columns={getXcpNgHostColumns({
        rows: rows,
        resources: resources,
        translator: translator,
      })}
      getViewRoute={(resource: InfrastructureResource): Route => {
        return routes.getPartRoute(
          "Host",
          resource.additionalAttributes["externalId"] || "",
        );
      }}
    />
  );
};

export default XcpNgPoolHosts;
