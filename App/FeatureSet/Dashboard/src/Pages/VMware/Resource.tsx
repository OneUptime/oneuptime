import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
  useRef,
} from "react";
import { useParams } from "react-router-dom";
import VMwareSource from "Common/Models/DatabaseModels/VMwareSource";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import VMwareCreateMonitorButton from "../../Components/VMware/CreateMonitorButton";
import ResourceOverviewTab from "../../Components/Infrastructure/ResourceOverviewTab";
import EmbeddedMetricCard from "../../Components/Metrics/EmbeddedMetricCard";
import VMwareStatus from "../../Components/VMware/Status";
import {
  metricQuery,
  resourceStatus,
  resourceTypeLabel,
  sourceRoute,
} from "./Utils";

const VMwareResourceView: FunctionComponent = (): ReactElement => {
  const { modelId, subModelId } = useParams<{
    modelId: string;
    subModelId: string;
  }>();
  const [source, setSource] = useState<VMwareSource | null>(null);
  const [resource, setResource] = useState<VMwareResource | null>(null);
  const [error, setError] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [expectedRunning, setExpectedRunning] = useState<string>("inherit");
  const [maintenanceMode, setMaintenanceMode] = useState<string>("inherit");
  const dirtyPolicy: React.MutableRefObject<boolean> = useRef<boolean>(false);
  useEffect(() => {
    dirtyPolicy.current = false;
    setSaved(false);
  }, [modelId, subModelId]);
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setRefresh((value: number) => value + 1);
    }, 30000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const [refresh, setRefresh] = useState<number>(0);
  useEffect(() => {
    let disposed: boolean = false;
    const fetchData: () => Promise<void> = async (): Promise<void> => {
      try {
        const [nextSource, nextResource]: [
          VMwareSource | null,
          VMwareResource | null,
        ] = await Promise.all([
          ModelAPI.getItem({
            modelType: VMwareSource,
            id: new ObjectID(modelId!),
            select: {
              _id: true,
              name: true,
              sourceIdentifier: true,
              metrics: true,
              lastSeenAt: true,
              lastCollectionAt: true,
              collectionIntervalSeconds: true,
              lastSuccessfulCollectionAt: true,
              isArchived: true,
            },
          }),
          ModelAPI.getItem({
            modelType: VMwareResource,
            id: new ObjectID(subModelId!),
            select: {
              _id: true,
              sourceId: true,
              name: true,
              resourceIdentifier: true,
              resourceType: true,
              metadata: true,
              metrics: true,
              lastSeenAt: true,
              lastReportedAt: true,
              expectedRunning: true,
              maintenanceMode: true,
              isArchived: true,
            },
          }),
        ]);
        if (disposed) {
          return;
        }
        if (
          !nextSource ||
          !nextResource ||
          nextResource.sourceId?.toString() !== modelId
        ) {
          setError("VMware resource not found in this source.");
          return;
        }
        setSource(nextSource);
        setResource(nextResource);
        setError("");
        if (!dirtyPolicy.current) {
          setExpectedRunning(
            nextResource.expectedRunning === undefined ||
              nextResource.expectedRunning === null
              ? "inherit"
              : String(nextResource.expectedRunning),
          );
          setMaintenanceMode(
            nextResource.maintenanceMode === undefined ||
              nextResource.maintenanceMode === null
              ? "inherit"
              : String(nextResource.maintenanceMode),
          );
        }
      } catch (err) {
        if (!disposed) {
          setError(API.getFriendlyMessage(err));
        }
      }
    };
    void fetchData();
    return () => {
      disposed = true;
    };
  }, [modelId, subModelId, refresh]);
  const save: () => Promise<void> = async (): Promise<void> => {
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const data: JSONObject = {
        maintenanceMode:
          maintenanceMode === "inherit" ? null : maintenanceMode === "true",
      };
      if (resource?.resourceType === "vm") {
        data["expectedRunning"] =
          expectedRunning === "inherit" ? null : expectedRunning === "true";
      }
      await ModelAPI.updateById({
        modelType: VMwareResource,
        id: new ObjectID(subModelId!),
        data,
      });
      dirtyPolicy.current = false;
      setSaved(true);
      setRefresh((value: number) => value + 1);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  };
  if (error) {
    return <ErrorMessage message={error} />;
  }
  if (!source || !resource) {
    return <PageLoader isVisible={true} />;
  }
  const editable: boolean = PermissionGate.check(
    new VMwareResource(),
    ModelAction.Update,
  ).isAllowed;
  const kind: string = resource.resourceType || "host";
  const parent: unknown = resource.metadata?.["oneuptime.vmware.parent.name"];
  return (
    <div className="space-y-6">
      <Link
        to={sourceRoute(source._id!)}
        className="text-sm font-medium text-indigo-600 dark:text-indigo-300"
      >
        ← {source.name || source.sourceIdentifier}
      </Link>
      <Card
        title={
          resource.name || resource.resourceIdentifier || "VMware resource"
        }
        description={resourceTypeLabel(resource.resourceType)}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <VMwareStatus status={resourceStatus(resource, source)} />
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
              resourceIdentifier={resource.resourceIdentifier}
              resourceType={resource.resourceType}
            />
          </div>
        </div>
        <ResourceOverviewTab
          isLoading={false}
          labels={{}}
          annotations={{}}
          summaryFields={[
            {
              title: "Resource identifier",
              value: resource.resourceIdentifier || "—",
            },
            {
              title: "Parent",
              value: typeof parent === "string" ? parent : "—",
            },
            {
              title: "Last observed",
              value: resource.lastSeenAt
                ? new Date(resource.lastSeenAt).toLocaleString()
                : "Not observed",
            },
            {
              title: "Reported health",
              value: String(
                resource.metadata?.["oneuptime.vmware.resource.state"] ||
                  "Unknown",
              ),
            },
          ]}
        />
      </Card>
      <Card
        title="Monitoring expectations"
        description="Power state alone does not establish an outage. Set the expectation for this resource; changes apply to the existing VMware monitor rules."
      >
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {kind === "vm" && (
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Expected to run
                <select
                  aria-label="Expected to run"
                  value={expectedRunning}
                  disabled={!editable || saving}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    dirtyPolicy.current = true;
                    setExpectedRunning(event.target.value);
                    setSaved(false);
                  }}
                  className="mt-2 block w-full rounded-md border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-900"
                >
                  <option value="inherit">Use collector policy</option>
                  <option value="true">
                    Yes — this VM should remain running
                  </option>
                  <option value="false">No — power-off is allowed</option>
                </select>
              </label>
            )}
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Maintenance
              <select
                aria-label="Maintenance"
                value={maintenanceMode}
                disabled={!editable || saving}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  dirtyPolicy.current = true;
                  setMaintenanceMode(event.target.value);
                  setSaved(false);
                }}
                className="mt-2 block w-full rounded-md border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-900"
              >
                <option value="inherit">Use collector policy</option>
                <option value="true">In maintenance</option>
                <option value="false">Not in maintenance</option>
              </select>
            </label>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Maintenance suppresses resource availability alerts. Collection
            failures are monitored separately. VMware actions such as starting
            or stopping a VM remain in vSphere.
          </p>
          {saveError && <ErrorMessage message={saveError} />}
          {saved && (
            <p
              role="status"
              className="text-sm text-emerald-700 dark:text-emerald-300"
            >
              Monitoring expectations saved.
            </p>
          )}
          {editable && (
            <Button
              title="Save expectations"
              buttonStyle={ButtonStyleType.PRIMARY}
              isLoading={saving}
              onClick={() => {
                void save();
              }}
            />
          )}
        </div>
      </Card>
      <EmbeddedMetricCard
        title="Resource performance"
        description="Historical measurements reported by vSphere. Unavailable measurements remain empty."
        queryConfigs={
          kind === "datastore"
            ? [
                metricQuery(
                  source.sourceIdentifier!,
                  "oneuptime.vmware.datastore.disk.utilization",
                  "Datastore used (%)",
                  resource.resourceIdentifier,
                ),
              ]
            : kind === "host" || kind === "vm"
              ? [
                  metricQuery(
                    source.sourceIdentifier!,
                    `oneuptime.vmware.${kind}.cpu.utilization`,
                    "CPU utilization (%)",
                    resource.resourceIdentifier,
                  ),
                  metricQuery(
                    source.sourceIdentifier!,
                    `oneuptime.vmware.${kind}.memory.utilization`,
                    "Memory utilization (%)",
                    resource.resourceIdentifier,
                  ),
                ]
              : [
                  metricQuery(
                    source.sourceIdentifier!,
                    "oneuptime.vmware.resource.state",
                    "Reported health (1 healthy · 2 warning · 3 critical)",
                    resource.resourceIdentifier,
                  ),
                ]
        }
      />
    </div>
  );
};
export default VMwareResourceView;
