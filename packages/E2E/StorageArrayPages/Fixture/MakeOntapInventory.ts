/*
 * Writes OntapInventory.json: what OneUptime keeps of what the real NetApp
 * Harvest 26.11.0 served for a stand-in ONTAP cluster and a stand-in Amazon
 * FSx file system (packages/Common/Tests/Fixtures/NetAppHarvest/26.11.0,
 * whose README says what was real), through the agent's shipped collector
 * config and the ingest, as Tests/Helpers/StorageArray/
 * NetAppHarvestRecordings runs them (#11001). The fixture's ONTAP cluster
 * and FSx file system are these rows, and the readings their Overviews ask
 * for are these series.
 *
 * Run from packages/Common when the recordings, the collector config or
 * the extractor change:
 *
 *   npx ts-node --transpile-only ../E2E/StorageArrayPages/Fixture/MakeOntapInventory.ts
 */
import fs from "fs";
import path from "path";
import {
  NetAppIngestOutcome,
  ingestNetAppRecording,
  readNetAppRecording,
  whatTheAgentSends,
} from "../../../Common/Tests/Helpers/StorageArray/NetAppHarvestRecordings";
import { CapturedSeries } from "../../../Common/Tests/Helpers/StorageArray/OpenMetricsCapture";

// The series an Overview reads besides the inventory: latency, open problems.
const READINGS: RegExp =
  /^netapp_(cluster_(read|write)_latency|health_[a-z_]+_alerts)$/;

interface Recorded {
  extras: unknown;
  countsByKind: Record<string, number> | null;
  rows: Array<Record<string, unknown>>;
  readings: Array<CapturedSeries>;
}

function recorded(file: "ontap.prom" | "fsx.prom"): Recorded {
  const outcome: NetAppIngestOutcome = ingestNetAppRecording(file);
  return {
    extras: outcome.extras,
    countsByKind: outcome.countsByKind,
    rows: outcome.rows.map(
      (row: NetAppIngestOutcome["rows"][number]): Record<string, unknown> => {
        // When it was seen is the fixture's own clock's to say.
        const fields: Record<string, unknown> = { ...row };
        delete fields["observedAt"];
        return fields;
      },
    ),
    readings: whatTheAgentSends(readNetAppRecording(file)).filter(
      (series: CapturedSeries): boolean => {
        return READINGS.test(series.name);
      },
    ),
  };
}

const out: string = path.join(__dirname, "OntapInventory.json");
fs.writeFileSync(
  out,
  `${JSON.stringify({ ontap: recorded("ontap.prom"), fsx: recorded("fsx.prom") }, null, 1)}\n`,
);
// eslint-disable-next-line no-console
console.log(`Wrote ${out}`);
