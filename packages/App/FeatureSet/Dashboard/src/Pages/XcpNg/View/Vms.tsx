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
  XCP_NG_VM_COLUMN_DESCRIPTIONS,
  getXcpNgVmColumns,
  toXcpNgListResource,
} from "../../../Components/XcpNg/XcpNgResourceColumns";
import {
  XcpNgPartRoutes,
  getXcpNgPartRoutes,
} from "../../../Components/XcpNg/Part/XcpNgPartRoutes";
import { fetchXcpNgInventoryRows } from "../Utils/XcpNgResourceUtils";
import { isXcpNgControlDomain } from "../Utils/XcpNgHealth";
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
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Route from "Common/Types/API/Route";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * An XCP-ng pool's VMs: each one's state as Xen Orchestra reports it
 * (Running, Halted, Paused, Suspended - Suspended, and a VM halted and left
 * off, are someone's choice and grey; one halted or paused after running in
 * the last day is amber), the host it runs on, how busy it is, its vCPUs,
 * how long it has run or when it last did, and its tags.
 *
 * A host's control domain (dom0) is a VM to XAPI, but it is the host's own:
 * the list leaves the control domains out, as the pool's counts do, and a
 * switch shows them, each marked as one.
 */

export const XCP_NG_SHOW_CONTROL_DOMAINS: string = translationKey(
  "Show control domains",
);

export const XCP_NG_SHOW_CONTROL_DOMAINS_TEST_ID: string =
  "xcp-ng-show-control-domains";

const XcpNgPoolVms: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rows, setRows] = useState<Array<XcpNgResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showControlDomains, setShowControlDomains] = useState<boolean>(false);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const vms: Array<XcpNgResource> = await fetchXcpNgInventoryRows({
        xcpNgPoolId: modelId,
        kind: XcpNgResourceKind.VM,
      });
      setRows(sortXcpNgByName(vms));
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
  const controlDomains: number = rows.filter(isXcpNgControlDomain).length;
  const shown: Array<XcpNgResource> = showControlDomains
    ? rows
    : rows.filter((row: XcpNgResource): boolean => {
        return !isXcpNgControlDomain(row);
      });
  const resources: Array<InfrastructureResource> = shown.map(
    (row: XcpNgResource): InfrastructureResource => {
      return toXcpNgListResource(row, { now: now, translator: translator });
    },
  );

  return (
    <div data-testid="xcp-ng-vms-page">
      {controlDomains > 0 ? (
        <div className="mb-3 flex justify-end">
          <Toggle
            title={XCP_NG_SHOW_CONTROL_DOMAINS}
            tooltip="A host's control domain (dom0) runs XAPI and the host's own services. It is the host's, so it is left out of the pool's VMs unless you show it."
            value={showControlDomains}
            dataTestId={XCP_NG_SHOW_CONTROL_DOMAINS_TEST_ID}
            onChange={(value: boolean): void => {
              setShowControlDomains(value);
            }}
          />
        </div>
      ) : (
        <></>
      )}
      <ResourceTable
        onRefreshClick={() => {
          fetchData().catch(() => {});
        }}
        title="VMs"
        description="The VMs of this XCP-ng pool, the host each one runs on, and how busy it is."
        resources={resources}
        showGroupColumn={true}
        groupColumnTitle="Host"
        groupColumnFoldInto="name"
        builtInColumnDescriptions={XCP_NG_VM_COLUMN_DESCRIPTIONS}
        metricThresholds={{
          cpu: { warning: 80, danger: 90 },
          memory: { warning: 85, danger: 95 },
        }}
        tableIdPrefix="xcp-ng"
        emptyMessage="No VMs yet. A pool's VMs appear here once Xen Orchestra reports the pool."
        columns={getXcpNgVmColumns({ resources: resources })}
        getViewRoute={(resource: InfrastructureResource): Route => {
          return routes.getPartRoute(
            "VM",
            resource.additionalAttributes["externalId"] || "",
          );
        }}
      />
    </div>
  );
};

export default XcpNgPoolVms;
