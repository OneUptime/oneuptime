/*
 * ---------------------------------------------------------------------------
 * Runner.agentVersion — the label says "Runner Version", the wire says
 * "agentVersion", and those two facts must move independently forever.
 *
 * The dashboard used to render this field as "Agent Version", which is wrong:
 * the entity is a Runner, and "agent" is the name of a completely different
 * family of things in this product (the Host / Docker / Kubernetes / RUM
 * monitoring agents, which DO have an agent version). Only the display strings
 * were changed.
 *
 * The property name — and therefore the Postgres column, the /api/runner JSON
 * field, and the POST /heartbeat body key — deliberately stays `agentVersion`:
 *
 *   - Runners are customer-pulled containers (`oneuptime/runner:release`) on
 *     their own upgrade cadence. Weeks of skew against the server is normal.
 *   - Renaming the key fails SILENTLY. RunnerIngress only writes the column
 *     when the body carries a non-empty string, so a Runner posting the old key
 *     to a renamed server still gets HTTP 200, still shows as Connected, and
 *     just freezes its reported version forever. No exception, no log, no CI
 *     signal.
 *   - RunnerService.heartbeat writes through `update["agentVersion"]` on an
 *     object cast to `never`, so TypeScript would not catch a missed call site.
 *
 * So this file pins BOTH halves. The title/description assertions fail if
 * someone reverts the wording; the property/column assertions fail if someone
 * "finishes the job" by renaming the field, which is the change that would take
 * production down quietly. The final describe pins that the eleven unrelated
 * monitoring-agent models were NOT swept up in the rename.
 * ---------------------------------------------------------------------------
 */

import CephCluster from "../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../Models/DatabaseModels/Host";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import Runner from "../../Models/DatabaseModels/Runner";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../Models/DatabaseModels/ServerlessFunction";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "agentVersion";

const RUNNER_MODEL_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "Models",
  "DatabaseModels",
  "Runner.ts",
);

/*
 * getTableColumns iterates Object.keys(target), which only sees properties
 * initialized with `= undefined`. It must be given an INSTANCE — passing the
 * class returns an empty dictionary and every assertion below would pass
 * vacuously.
 */
function metadata(): TableColumnMetadata {
  return new Runner().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(
  model: new () => DatabaseBaseModel,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === model && column.propertyName === COLUMN;
  });
}

describe("Runner.agentVersion display label", () => {
  test("is titled 'Runner Version'", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().title).toBe("Runner Version");
  });

  test("no longer says 'Agent Version' anywhere in its metadata", () => {
    expect(metadata().title).not.toBe("Agent Version");
    expect(String(metadata().description)).not.toContain("Agent Version");
  });

  /*
   * The description, not the title, is what actually gets published:
   * ModelSchema prefers description over title when building the Zod
   * `.describe()` text, and that text is what lands in the generated OpenAPI
   * spec, the Terraform provider docs and the MCP tool schemas. The API
   * Reference page renders the description and never renders the title at all.
   * A title-only fix would have left "agent binary" in every published artifact.
   */
  test("describes a Runner binary, not an agent binary", () => {
    const description: string = String(metadata().description);

    expect(description).toBe(
      "Self-reported version of the Runner binary. Updated on each heartbeat.",
    );
    expect(description).not.toContain("agent binary");
    expect(description.toLowerCase()).not.toContain("agent");
  });

  test("still says it is refreshed by the heartbeat", () => {
    expect(String(metadata().description)).toContain("each heartbeat");
  });
});

describe("Runner.agentVersion column contract (must NOT be renamed)", () => {
  /*
   * The load-bearing assertion of this whole file. If someone renames the
   * property to runnerVersion, every deployed Runner keeps POSTing
   * `agentVersion`, the server quietly ignores it, and the dashboard shows a
   * connected Runner whose version never advances again.
   */
  test("the property is still called agentVersion", () => {
    expect(new Runner().getTableColumns().columns).toContain(COLUMN);
    expect(Object.keys(new Runner())).toContain(COLUMN);
  });

  test("no runnerVersion property was introduced alongside it", () => {
    expect(new Runner().getTableColumns().columns).not.toContain(
      "runnerVersion",
    );
  });

  test("the Postgres column is still agentVersion and still nullable", () => {
    const column: ColumnMetadataArgs | undefined = typeOrmColumn(Runner);

    expect(column).toBeDefined();
    expect(column!.propertyName).toBe(COLUMN);
    // No `name` override, so TypeORM derives the DB column from the property.
    expect(column!.options.name).toBeUndefined();
    expect(column!.options.nullable).toBe(true);
  });

  test("is still typed as a Version column", () => {
    expect(metadata().type).toBe(TableColumnType.Version);
  });

  /*
   * required: false is what keeps a Runner creatable before it has ever
   * heartbeated. Flipping it while renaming labels would reject every create.
   */
  test("stays optional on create", () => {
    expect(metadata().required).toBe(false);
  });

  /*
   * The rationale for keeping the wire name lives in a comment on the property.
   * Without it the next reader sees a "Runner Version" label over an
   * `agentVersion` field and reasonably assumes it was an oversight.
   */
  test("carries a comment explaining why the wire name stays agentVersion", () => {
    const source: string = fs.readFileSync(RUNNER_MODEL_PATH, "utf8");
    const squashed: string = source.replace(/\s+/g, " ");

    expect(squashed).toContain("the property");
    expect(squashed).toContain("stays");
    expect(squashed).toContain("agentVersion");
    expect(squashed).toContain("un-redeployed Runner");
  });
});

/*
 * The eleven models below are real monitoring agents / SDKs reporting the
 * version of software OneUptime ships onto a customer host. "Agent Version" is
 * correct for all of them. A find-and-replace across the repo would have
 * renamed them too, so each one is pinned by name — a bulk rename fails here
 * loudly instead of shipping "Runner Version" onto the Kubernetes cluster page.
 */
describe("unrelated monitoring-agent models keep saying 'Agent Version'", () => {
  const AGENT_MODELS: Array<{
    name: string;
    model: new () => DatabaseBaseModel;
  }> = [
    { name: "Host", model: Host },
    { name: "DockerHost", model: DockerHost },
    { name: "PodmanHost", model: PodmanHost },
    { name: "KubernetesCluster", model: KubernetesCluster },
    { name: "DockerSwarmCluster", model: DockerSwarmCluster },
    { name: "CephCluster", model: CephCluster },
    { name: "ProxmoxCluster", model: ProxmoxCluster },
    { name: "CloudResource", model: CloudResource },
    { name: "IoTFleet", model: IoTFleet },
    { name: "RumApplication", model: RumApplication },
    { name: "ServerlessFunction", model: ServerlessFunction },
  ];

  test.each(AGENT_MODELS)(
    "$name.agentVersion is still titled 'Agent Version'",
    ({ model }: { model: new () => DatabaseBaseModel }) => {
      const columnMetadata: TableColumnMetadata =
        new model().getTableColumnMetadata(COLUMN);

      expect(columnMetadata).toBeDefined();
      expect(columnMetadata.title).toBe("Agent Version");
    },
  );

  test("Runner is the only model of the set that says 'Runner Version'", () => {
    const runnerVersionTitled: Array<string> = AGENT_MODELS.filter(
      ({ model }: { model: new () => DatabaseBaseModel }) => {
        return (
          new model().getTableColumnMetadata(COLUMN).title === "Runner Version"
        );
      },
    ).map(({ name }: { name: string }) => {
      return name;
    });

    expect(runnerVersionTitled).toEqual([]);
    expect(metadata().title).toBe("Runner Version");
  });
});
