import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import VMwareSource from "Common/Models/DatabaseModels/VMwareSource";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import VMwareCreateMonitorButton from "../../Components/VMware/CreateMonitorButton";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import VMwareStatus from "../../Components/VMware/Status";
import EmbeddedMetricCard from "../../Components/Metrics/EmbeddedMetricCard";
import VMwareResources from "./Resources";
import { metricQuery, sourceStatus, sourceKindLabel } from "./Utils";

const VMwareSourceView: FunctionComponent = (): ReactElement => {
  const { modelId } = useParams<{ modelId: string }>();
  const [source, setSource] = useState<VMwareSource | null>(null);
  const [error, setError] = useState<string>("");
  const [refresh, setRefresh] = useState<number>(0);
  useEffect(() => {
    let disposed: boolean = false;
    const fetchSource: () => Promise<void> = async (): Promise<void> => {
      try {
        const item: VMwareSource | null = await ModelAPI.getItem({
          modelType: VMwareSource,
          id: new ObjectID(modelId!),
          select: {
            _id: true,
            name: true,
            description: true,
            sourceIdentifier: true,
            kind: true,
            metrics: true,
            lastSeenAt: true,
            lastCollectionAt: true,
            collectionIntervalSeconds: true,
            lastSuccessfulCollectionAt: true,
            isArchived: true,
          },
        });
        if (!disposed) {
          setSource(item);
          setError(item ? "" : "VMware source not found.");
        }
      } catch (err) {
        if (!disposed) {
          setError(API.getFriendlyMessage(err));
        }
      }
    };
    void fetchSource();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setRefresh((value: number) => value + 1);
    }, 30000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [modelId, refresh]);
  if (error) {
    return <ErrorMessage message={error} />;
  }
  if (!source) {
    return <PageLoader isVisible={true} />;
  }
  const status: string = sourceStatus(source);
  const canReadResources: boolean = PermissionGate.check(
    new VMwareResource(),
    ModelAction.Read,
  ).isAllowed;
  return (
    <div className="space-y-6">
      <Card
        title={source.name || source.sourceIdentifier || "VMware source"}
        description={source.description || "vSphere inventory and performance"}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-2">
            <VMwareStatus status={status} />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {source.sourceIdentifier} · {sourceKindLabel(source.kind)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Last successful collection:{" "}
              {source.lastSuccessfulCollectionAt
                ? new Date(source.lastSuccessfulCollectionAt).toLocaleString()
                : "None yet"}{" "}
              · Refreshes every 30 seconds
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              title="Refresh"
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                setRefresh((value: number) => value + 1);
              }}
            />
            <VMwareCreateMonitorButton
              sourceIdentifier={source.sourceIdentifier}
            />
          </div>
        </div>
        {status !== "Connected" && (
          <div
            role="status"
            className="mx-5 mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            Collection is not current. Resource state is unknown and last-known
            inventory is preserved. Check the collector and its VMware
            connection before treating individual resources as unavailable.
          </div>
        )}
      </Card>
      {canReadResources ? (
        <Tabs
          tabs={[
            ...["host", "vm", "datastore", "cluster"].map(
              (resourceType: string) => ({
                name:
                  resourceType === "host"
                    ? "ESXi hosts"
                    : resourceType === "vm"
                      ? "Virtual machines"
                      : resourceType === "datastore"
                        ? "Datastores"
                        : "Clusters",
                children: (
                  <VMwareResources
                    source={source}
                    resourceType={resourceType}
                    refresh={String(refresh)}
                  />
                ),
              }),
            ),
            {
              name: "Performance",
              children: (
                <EmbeddedMetricCard
                  title="Resource utilization"
                  description="Each line represents a resource. Use the time range to inspect historical values; the overview lists current collection status."
                  queryConfigs={[
                    metricQuery(
                      source.sourceIdentifier!,
                      "oneuptime.vmware.host.cpu.utilization",
                      "ESXi host CPU (%)",
                    ),
                    metricQuery(
                      source.sourceIdentifier!,
                      "oneuptime.vmware.host.memory.utilization",
                      "ESXi host memory (%)",
                    ),
                    metricQuery(
                      source.sourceIdentifier!,
                      "oneuptime.vmware.datastore.disk.utilization",
                      "Datastore used (%)",
                    ),
                  ]}
                />
              ),
            },
          ]}
        />
      ) : (
        <Card
          title="Resource inventory"
          description="Your role can view this source. Access to VMware resources is required to view its inventory and performance."
        />
      )}
    </div>
  );
};
export default VMwareSourceView;
