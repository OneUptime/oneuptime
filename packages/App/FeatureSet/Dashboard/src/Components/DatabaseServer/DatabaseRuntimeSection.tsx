import ChartCard from "../TelemetryResource/ChartCard";
import {
  DATABASE_RUNTIME_METRICS,
  DatabaseRuntimeMetrics,
  DatabaseRuntimePlatform,
  formatDatabaseRuntimeValue,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import { DatabaseTimePoint } from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Section 2 of a database's Overview, for a database that runs on
 * Kubernetes, Docker or Podman: where it runs, how many instances it has,
 * and the CPU / memory of those instances — read from the pods' / containers'
 * own metrics through the database's member keys.
 */

export interface ComponentProps {
  modelId: ObjectID;
  platform: DatabaseRuntimePlatform;
  runsOn: string;
  workload: string;
  instanceCount: number | null;
  // Pods / containers seen as members in the last 30 days.
  memberCount: number;
  cpuSeries: Array<DatabaseTimePoint>;
  memorySeries: Array<DatabaseTimePoint>;
  isLoading: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
}

const PLATFORM_LABELS: Record<DatabaseRuntimePlatform, string> = {
  [DatabaseRuntimePlatform.Kubernetes]: "Kubernetes",
  [DatabaseRuntimePlatform.Docker]: "Docker",
  [DatabaseRuntimePlatform.Podman]: "Podman",
};

const DatabaseRuntimeSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const metrics: DatabaseRuntimeMetrics =
    DATABASE_RUNTIME_METRICS[props.platform];
  const instanceLabel: string =
    props.platform === DatabaseRuntimePlatform.Kubernetes
      ? "pods"
      : "containers";

  return (
    <div data-testid="database-runtime">
      <Card
        title={`Runtime — ${PLATFORM_LABELS[props.platform]}`}
        description={`Where this database runs and the CPU and memory of its ${instanceLabel}.`}
      >
        <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Runs on
            </dt>
            <dd className="mt-1 text-gray-900">{props.runsOn}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Workload
            </dt>
            <dd className="mt-1 break-all font-mono text-gray-900">
              {props.workload || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Instances
            </dt>
            <dd className="mt-1 text-gray-900">
              {props.instanceCount === null ? "—" : props.instanceCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Tracked {instanceLabel}
            </dt>
            <dd className="mt-1 text-gray-900">
              {props.memberCount}
              <span className="ml-1 text-xs text-gray-500">(last 30 days)</span>
            </dd>
          </div>
        </dl>
      </Card>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title={metrics.cpu.title}
          icon={IconProp.ChartBar}
          iconColor="blue"
          series={
            [
              { seriesName: metrics.cpu.title, data: props.cpuSeries },
            ] as Array<SeriesPoint>
          }
          windowStart={props.windowStart}
          windowEnd={props.windowEnd}
          syncId={`database-${props.modelId.toString()}`}
          yFormatter={(value: number): string => {
            return formatDatabaseRuntimeValue(value, metrics.cpu.unit);
          }}
          loading={props.isLoading && props.cpuSeries.length === 0}
        />
        <ChartCard
          title={metrics.memory.title}
          icon={IconProp.SquareStack}
          iconColor="violet"
          series={
            [
              { seriesName: metrics.memory.title, data: props.memorySeries },
            ] as Array<SeriesPoint>
          }
          windowStart={props.windowStart}
          windowEnd={props.windowEnd}
          syncId={`database-${props.modelId.toString()}`}
          yFormatter={(value: number): string => {
            return formatDatabaseRuntimeValue(value, metrics.memory.unit);
          }}
          loading={props.isLoading && props.memorySeries.length === 0}
        />
      </div>
    </div>
  );
};

export default DatabaseRuntimeSection;
