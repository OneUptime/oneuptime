import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForVMwareVCenter } from "Common/Utils/Telemetry/EntityKey";

const VMwareVCenterLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("vCenter not found.");
        setIsLoading(false);
        return;
      }

      setVCenter(item);
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

  const logQuery: Query<Log> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Log> with
     * inline attribute maps — same workaround the Host/Docker logs pages use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "resource.vmware.vcenter.name": vcenter?.name || "",
      },
    };
    return q as Query<Log>;
  }, [vcenter?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!vcenter?.name) {
    return <ErrorMessage message="vCenter not found." />;
  }

  return (
    <Card
      title="vCenter Logs"
      description="OpenTelemetry logs ingested with this vCenter's vmware.vcenter.name resource attribute — ESXi syslog forwarded through the agent's optional syslog receiver lands here. Use the filter bar to scope by severity, host, or any resource attribute."
    >
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `logQuery.attributes` stays for the histogram / facet scoping —
       * display behavior is unchanged. Do NOT also AND a separate
       * attributes-equality filter into the query itself — that defeats the
       * OR. Drop the attribute fallback (here and in the logQuery merge)
       * once deploy-date + max retention has passed.
       */}
      <DashboardLogsViewer
        id={`vmware-vcenter-logs-${modelId.toString()}`}
        logQuery={logQuery}
        entityScope={{
          entityKeys: [
            keyForVMwareVCenter(
              ProjectUtil.getCurrentProjectId()!.toString(),
              vcenter.name!,
            ),
          ],
          attributeKey: "resource.vmware.vcenter.name",
          attributeValue: vcenter.name!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found. The VMware agent ships metrics only by default — enable the syslog receiver in its collector config and point your ESXi hosts' Syslog.global.logHost at the agent (see the Documentation page) to see ESXi syslog here, or send any OpenTelemetry logs stamped with this vCenter's vmware.vcenter.name resource attribute."
      />
    </Card>
  );
};

export default VMwareVCenterLogs;
