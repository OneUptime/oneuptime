import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import TelemetryIngestionByProject from "./TelemetryIngestionByProject";
import TelemetryIngestionBySignal from "./TelemetryIngestionBySignal";
import Route from "Common/Types/API/Route";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Telemetry diagnostics for the master admin: what this instance is ingesting.
 *
 * Two tabs, because they answer two different questions and each is a table
 * wide enough that stacking them buries the second one:
 *
 *   - "By signal"  — is the pipeline flowing, and how fast? Ingestion rate and
 *                    footprint for logs, metrics and traces. (This card used to
 *                    live on the ClickHouse datastore page; it belongs with the
 *                    rest of the telemetry view, not with shard health.)
 *   - "By project" — who is filling it? The same windows split per tenant, which
 *                    is what an unexplained ingest spike or a noisy-neighbour
 *                    report actually needs.
 *
 * Each tab loads its own data on mount, so opening the page never pays for the
 * per-tenant GROUP BY unless the operator asks for it.
 */
const HealthTelemetry: FunctionComponent = (): ReactElement => {
  const tabs: Array<Tab> = [
    {
      name: "By signal",
      children: <TelemetryIngestionBySignal />,
    },
    {
      name: "By project",
      children: <TelemetryIngestionByProject />,
    },
  ];

  return (
    <HealthPage
      title="Telemetry"
      currentRoute={RouteMap[PageMap.HEALTH_TELEMETRY] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Telemetry ingestion"
      enterpriseFeatureDescription="Live log, metric and trace ingestion for this instance — throughput and footprint per signal, and the same windows split by project."
    >
      <Tabs
        tabs={tabs}
        onTabChange={() => {
          // Each tab owns its own loading; nothing to coordinate here.
        }}
      />
    </HealthPage>
  );
};

export default HealthTelemetry;
