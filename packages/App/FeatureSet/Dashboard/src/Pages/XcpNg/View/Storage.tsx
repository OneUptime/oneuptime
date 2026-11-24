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
  XCP_NG_STORAGE_USAGE_COLUMNS,
  getXcpNgStorageColumns,
  toXcpNgListResource,
} from "../../../Components/XcpNg/XcpNgResourceColumns";
import {
  XcpNgPartRoutes,
  getXcpNgPartRoutes,
} from "../../../Components/XcpNg/Part/XcpNgPartRoutes";
import { fetchXcpNgInventoryRows } from "../../../Components/XcpNg/XcpNgInventoryReads";
import { sortXcpNgStorageForGlance } from "../Utils/XcpNgPartFacts";
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
 * An XCP-ng pool's storage repositories: whether each is shared by the pool
 * or local to a host, how full it is (the shared bar, amber past 90% where
 * its alert fires, red past 95%), its size, what is allocated on it against
 * that size (amber, and saying so, when thin provisioning took it past its
 * size), how it stores disks, what it holds and how many virtual disks it
 * holds - the repositories that hold VM disks first, the fullest first.
 */
const XcpNgPoolStorage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // The repositories, and the virtual disks on them (for their count).
  const [rows, setRows] = useState<Array<XcpNgResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const [repositories, disks]: [
        Array<XcpNgResource>,
        Array<XcpNgResource>,
      ] = await Promise.all([
        fetchXcpNgInventoryRows({
          xcpNgPoolId: modelId,
          kind: XcpNgResourceKind.StorageRepository,
        }),
        fetchXcpNgInventoryRows({
          xcpNgPoolId: modelId,
          kind: XcpNgResourceKind.VDI,
        }),
      ]);
      setRows([...repositories, ...disks]);
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
  const resources: Array<InfrastructureResource> = sortXcpNgStorageForGlance(
    rows.filter((row: XcpNgResource): boolean => {
      return row.kind === XcpNgResourceKind.StorageRepository;
    }),
  ).map((row: XcpNgResource): InfrastructureResource => {
    return toXcpNgListResource(row, { now: now, translator: translator });
  });

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Storage Repositories"
      description="The storage repositories of this XCP-ng pool: shared or local to a host, how full each one is, and what is allocated on it."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Host"
      showStatus={false}
      showResourceMetrics={false}
      tableIdPrefix="xcp-ng"
      emptyMessage="No storage repositories yet. A pool's storage repositories appear here once Xen Orchestra reports the pool."
      storageUsageColumns={XCP_NG_STORAGE_USAGE_COLUMNS}
      columns={getXcpNgStorageColumns({
        rows: rows,
        resources: resources,
        translator: translator,
      })}
      getViewRoute={(resource: InfrastructureResource): Route => {
        return routes.getPartRoute(
          "StorageRepository",
          resource.additionalAttributes["externalId"] || "",
        );
      }}
    />
  );
};

export default XcpNgPoolStorage;
