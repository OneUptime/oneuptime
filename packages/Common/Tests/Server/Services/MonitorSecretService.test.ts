import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import LabelService from "../../../Server/Services/LabelService";
import MonitorSecretService from "../../../Server/Services/MonitorSecretService";
import MonitorService from "../../../Server/Services/MonitorService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorSecretAccess from "../../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * MonitorSecretService owns the three ways a secret can be shared with
 * monitors (#1467):
 *
 *   - on write, the mode is validated, the lists it does not read are
 *     emptied, and the lists it does read may only name this project's
 *     monitors and labels;
 *   - on read, getSecretsForMonitors hands every monitor of a probe's batch
 *     the secrets its mode covers - with a number of queries that does not
 *     grow with the batch - and getSecretsForUnsavedMonitor serves a test run
 *     from the Create Monitor form.
 *
 * The database is a set of in-memory tables behind stubs of the three
 * services' findBy. The secret stub behaves like the real query: it filters on
 * the project, the mode and the relation list, and returns only the matching
 * part of that list, the way TypeORM loads a relation it also filters on. The
 * SQL itself is exercised against a migrated Postgres by
 * MonitorSecretAccessPostgres.test.ts.
 */

const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const PROJECT_B: string = "bbbbbbbb-0000-4000-8000-00000000000b";

const MONITOR_A1: string = "a1a1a1a1-0000-4000-8000-0000000000a1";
const MONITOR_A2: string = "a2a2a2a2-0000-4000-8000-0000000000a2";
const MONITOR_A3: string = "a3a3a3a3-0000-4000-8000-0000000000a3";
const MONITOR_B1: string = "b1b1b1b1-0000-4000-8000-0000000000b1";

const LABEL_A_PROD: string = "1abe1000-0000-4000-8000-0000000000a1";
const LABEL_A_EDGE: string = "1abe1000-0000-4000-8000-0000000000a2";
const LABEL_A_UNUSED: string = "1abe1000-0000-4000-8000-0000000000a3";
const LABEL_B_PROD: string = "1abe1000-0000-4000-8000-0000000000b1";

const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";

const MISSING_ID: string = "deadbeef-0000-4000-8000-000000000000";

interface MonitorRow {
  id: string;
  projectId: string;
  labelIds: Array<string>;
}

interface LabelRow {
  id: string;
  projectId: string;
  name: string;
}

interface SecretRow {
  id: string;
  projectId: string;
  name: string;
  secretValue: string;
  monitorAccess: MonitorSecretAccess;
  monitorIds: Array<string>;
  labelIds: Array<string>;
}

let monitorRows: Array<MonitorRow> = [];
let labelRows: Array<LabelRow> = [];
let secretRows: Array<SecretRow> = [];

interface FindByCall {
  query: Dictionary<unknown>;
  select: Dictionary<unknown>;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

let monitorFindByCalls: Array<FindByCall> = [];
let labelFindByCalls: Array<FindByCall> = [];
let secretFindByCalls: Array<FindByCall> = [];

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("0ee10000-0000-4000-8000-000000000001"),
  tenantId: new ObjectID(PROJECT_A),
};

type OnBeforeCreate = (
  createBy: CreateBy<MonitorSecret>,
) => Promise<OnCreate<MonitorSecret>>;

type OnBeforeUpdate = (
  updateBy: UpdateBy<MonitorSecret>,
) => Promise<OnUpdate<MonitorSecret>>;

/*
 * QueryHelper.any is a Raw operator holding its ids in
 * objectLiteralParameters; a plain value is one id.
 */
function readIds(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  const parameters: Dictionary<unknown> | undefined = (
    value as { objectLiteralParameters?: Dictionary<unknown> }
  ).objectLiteralParameters;

  if (parameters) {
    return (Object.values(parameters)[0] as Array<string> | undefined) || [];
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): string => {
      return String(item);
    });
  }

  return [String(value)];
}

function toMonitor(row: MonitorRow, withLabels: boolean): Monitor {
  const monitor: Monitor = new Monitor(new ObjectID(row.id));
  monitor.projectId = new ObjectID(row.projectId);

  if (withLabels) {
    monitor.labels = row.labelIds.map((id: string): Label => {
      return new Label(new ObjectID(id));
    });
  }

  return monitor;
}

function toSecret(
  row: SecretRow,
  select: Dictionary<unknown>,
  filter: { list: "monitors" | "labels"; ids: Array<string> } | null,
): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret(new ObjectID(row.id));
  secret.projectId = new ObjectID(row.projectId);
  secret.name = row.name;
  secret.secretValue = row.secretValue;
  secret.monitorAccess = row.monitorAccess;

  const listIds: (list: "monitors" | "labels") => Array<string> = (
    list: "monitors" | "labels",
  ): Array<string> => {
    const ids: Array<string> =
      list === "monitors" ? row.monitorIds : row.labelIds;

    // A relation filtered on comes back holding only the matches.
    return filter && filter.list === list
      ? ids.filter((id: string): boolean => {
          return filter.ids.includes(id);
        })
      : ids;
  };

  if (select["monitors"]) {
    secret.monitors = listIds("monitors").map((id: string): Monitor => {
      return new Monitor(new ObjectID(id));
    });
  }

  if (select["labels"]) {
    secret.labels = listIds("labels").map((id: string): Label => {
      return new Label(new ObjectID(id));
    });
  }

  return secret;
}

function secretsFindBy(call: FindByCall): Array<MonitorSecret> {
  const query: Dictionary<unknown> = call.query;

  // The read path: one query per mode.
  if (query["monitorAccess"] !== undefined) {
    const projectIds: Array<string> = readIds(query["projectId"]);
    let filter: { list: "monitors" | "labels"; ids: Array<string> } | null =
      null;

    for (const list of ["monitors", "labels"] as const) {
      if (query[list] !== undefined) {
        filter = { list, ids: readIds(query[list]) };
      }
    }

    return secretRows
      .filter((row: SecretRow): boolean => {
        if (!projectIds.includes(row.projectId)) {
          return false;
        }

        if (row.monitorAccess !== query["monitorAccess"]) {
          return false;
        }

        if (!filter) {
          return true;
        }

        const ids: Array<string> =
          filter.list === "monitors" ? row.monitorIds : row.labelIds;

        return ids.some((id: string): boolean => {
          return filter!.ids.includes(id);
        });
      })
      .map((row: SecretRow): MonitorSecret => {
        return toSecret(row, call.select, filter);
      });
  }

  // The write path reads the stored secret(s) an update matches.
  const ids: Array<string> = readIds(query["_id"]);

  return secretRows
    .filter((row: SecretRow): boolean => {
      return ids.length === 0 || ids.includes(row.id);
    })
    .map((row: SecretRow): MonitorSecret => {
      return toSecret(row, call.select, null);
    });
}

beforeEach(() => {
  monitorRows = [
    { id: MONITOR_A1, projectId: PROJECT_A, labelIds: [LABEL_A_PROD] },
    { id: MONITOR_A2, projectId: PROJECT_A, labelIds: [] },
    {
      id: MONITOR_A3,
      projectId: PROJECT_A,
      labelIds: [LABEL_A_EDGE, LABEL_A_UNUSED],
    },
    { id: MONITOR_B1, projectId: PROJECT_B, labelIds: [LABEL_B_PROD] },
  ];

  labelRows = [
    { id: LABEL_A_PROD, projectId: PROJECT_A, name: "prod" },
    { id: LABEL_A_EDGE, projectId: PROJECT_A, name: "edge" },
    { id: LABEL_A_UNUSED, projectId: PROJECT_A, name: "unused" },
    { id: LABEL_B_PROD, projectId: PROJECT_B, name: "prod (B)" },
  ];

  secretRows = [];
  monitorFindByCalls = [];
  labelFindByCalls = [];
  secretFindByCalls = [];

  jest.spyOn(MonitorService, "findBy").mockImplementation(((
    call: FindByCall,
  ): Promise<Array<Monitor>> => {
    monitorFindByCalls.push(call);

    const ids: Array<string> = readIds(call.query["_id"]);
    const projectId: string | undefined = call.query["projectId"]
      ? String(call.query["projectId"])
      : undefined;

    return Promise.resolve(
      monitorRows
        .filter((row: MonitorRow): boolean => {
          return (
            ids.includes(row.id) && (!projectId || row.projectId === projectId)
          );
        })
        .map((row: MonitorRow): Monitor => {
          return toMonitor(row, Boolean(call.select["labels"]));
        }),
    );
  }) as never);

  jest.spyOn(LabelService, "findBy").mockImplementation(((
    call: FindByCall,
  ): Promise<Array<Label>> => {
    labelFindByCalls.push(call);

    const ids: Array<string> = readIds(call.query["_id"]);

    return Promise.resolve(
      labelRows
        .filter((row: LabelRow): boolean => {
          return ids.includes(row.id);
        })
        .map((row: LabelRow): Label => {
          const label: Label = new Label(new ObjectID(row.id));
          label.projectId = new ObjectID(row.projectId);
          label.name = row.name;
          return label;
        }),
    );
  }) as never);

  jest.spyOn(MonitorSecretService, "findBy").mockImplementation(((
    call: FindByCall,
  ): Promise<Array<MonitorSecret>> => {
    secretFindByCalls.push(call);
    return Promise.resolve(secretsFindBy(call));
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function secretRow(data: Partial<SecretRow>): SecretRow {
  return {
    id: ObjectID.generate().toString(),
    projectId: PROJECT_A,
    name: "secret",
    secretValue: "value",
    monitorAccess: MonitorSecretAccess.SpecificMonitors,
    monitorIds: [],
    labelIds: [],
    ...data,
  };
}

function newSecret(data: Dictionary<unknown>): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = "ApiKey";
  secret.projectId = new ObjectID(PROJECT_A);

  for (const key of Object.keys(data)) {
    (secret as unknown as Dictionary<unknown>)[key] = data[key];
  }

  return secret;
}

function monitors(...ids: Array<string>): Array<Monitor> {
  return ids.map((id: string): Monitor => {
    return new Monitor(new ObjectID(id));
  });
}

function labels(...ids: Array<string>): Array<Label> {
  return ids.map((id: string): Label => {
    return new Label(new ObjectID(id));
  });
}

async function runBeforeCreate(
  data: MonitorSecret,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): Promise<MonitorSecret> {
  const onCreate: OnCreate<MonitorSecret> = await (
    MonitorSecretService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data, props });

  return onCreate.createBy.data;
}

async function runBeforeUpdate(
  data: Dictionary<unknown>,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): Promise<Dictionary<unknown>> {
  const onUpdate: OnUpdate<MonitorSecret> = await (
    MonitorSecretService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: { _id: SECRET_ID },
    data: data as UpdateBy<MonitorSecret>["data"],
    props: props,
    limit: 1,
    skip: 0,
  });

  return onUpdate.updateBy.data as unknown as Dictionary<unknown>;
}

function ids(items: unknown): Array<string> {
  return ((items as Array<Monitor | Label>) || []).map(
    (item: Monitor | Label): string => {
      return item.id!.toString();
    },
  );
}

describe("MonitorSecretService.onBeforeCreate", () => {
  test("a secret created without a mode gets Specific Monitors and keeps its monitors", async () => {
    const created: MonitorSecret = await runBeforeCreate(
      newSecret({ monitors: monitors(MONITOR_A1, MONITOR_A2) }),
    );

    expect(created.monitorAccess).toBe(MonitorSecretAccess.SpecificMonitors);
    expect(ids(created.monitors)).toEqual([MONITOR_A1, MONITOR_A2]);
  });

  test("a null mode is the default too, the way a default-valued column reads null", async () => {
    const created: MonitorSecret = await runBeforeCreate(
      newSecret({ monitorAccess: null, monitors: monitors(MONITOR_A1) }),
    );

    expect(created.monitorAccess).toBe(MonitorSecretAccess.SpecificMonitors);
  });

  test("All Monitors drops both lists before anything is written", async () => {
    const created: MonitorSecret = await runBeforeCreate(
      newSecret({
        monitorAccess: MonitorSecretAccess.AllMonitors,
        monitors: monitors(MONITOR_A1),
        labels: labels(LABEL_A_PROD),
      }),
    );

    expect(created.monitorAccess).toBe(MonitorSecretAccess.AllMonitors);
    expect(created.monitors).toBeUndefined();
    expect(created.labels).toBeUndefined();
  });

  test("Specific Monitors keeps the monitors and drops the labels", async () => {
    const created: MonitorSecret = await runBeforeCreate(
      newSecret({
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitors: monitors(MONITOR_A1),
        labels: labels(LABEL_A_PROD),
      }),
    );

    expect(ids(created.monitors)).toEqual([MONITOR_A1]);
    expect(created.labels).toBeUndefined();
  });

  test("Monitors With Labels keeps the labels and drops the monitors", async () => {
    const created: MonitorSecret = await runBeforeCreate(
      newSecret({
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        monitors: monitors(MONITOR_A1),
        labels: labels(LABEL_A_PROD, LABEL_A_EDGE),
      }),
    );

    expect(created.monitors).toBeUndefined();
    expect(ids(created.labels)).toEqual([LABEL_A_PROD, LABEL_A_EDGE]);
  });

  test.each([
    ["an unknown mode", "Everyone"],
    ["the enum key", "AllMonitors"],
    ["a different case", "all monitors"],
    ["a boolean (the shape of the old toggle)", true],
  ])(
    "refuses %s and names the three modes",
    async (_name: string, value: unknown) => {
      await expect(
        runBeforeCreate(newSecret({ monitorAccess: value })),
      ).rejects.toThrow(
        new BadDataException(
          "Monitor access must be one of: All Monitors, Specific Monitors, Monitors With Labels.",
        ),
      );
    },
  );

  test("refuses a monitor from another project", async () => {
    await expect(
      runBeforeCreate(
        newSecret({ monitors: monitors(MONITOR_A1, MONITOR_B1) }),
      ),
    ).rejects.toThrow(/belong to a different project/);
  });

  test("refuses a label from another project", async () => {
    await expect(
      runBeforeCreate(
        newSecret({
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          labels: labels(LABEL_A_PROD, LABEL_B_PROD),
        }),
      ),
    ).rejects.toThrow(/Label "prod \(B\)"/);
  });

  test("refuses a monitor or label id that does not exist", async () => {
    await expect(
      runBeforeCreate(newSecret({ monitors: monitors(MISSING_ID) })),
    ).rejects.toThrow(/do not exist/);

    await expect(
      runBeforeCreate(
        newSecret({
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          labels: labels(MISSING_ID),
        }),
      ),
    ).rejects.toThrow(/do not exist/);
  });

  test("checks only the list the mode keeps: a list it drops is never stored, so it is not refused", async () => {
    const created: MonitorSecret = await runBeforeCreate(
      newSecret({
        monitorAccess: MonitorSecretAccess.AllMonitors,
        labels: labels(LABEL_B_PROD),
      }),
    );

    expect(created.labels).toBeUndefined();
    expect(labelFindByCalls).toHaveLength(0);
  });

  test("checks against the request's project, not the one in the payload", async () => {
    await expect(
      runBeforeCreate(
        newSecret({
          projectId: new ObjectID(PROJECT_B),
          monitors: monitors(MONITOR_B1),
        }),
      ),
    ).rejects.toThrow(/belong to a different project/);
  });

  test("a root write with no project to compare against does not look anything up", async () => {
    const secret: MonitorSecret = newSecret({
      monitors: monitors(MONITOR_B1),
      projectId: undefined,
    });

    await runBeforeCreate(secret, { isRoot: true });

    expect(monitorFindByCalls).toHaveLength(0);
  });
});

describe("MonitorSecretService.onBeforeUpdate", () => {
  beforeEach(() => {
    secretRows = [
      secretRow({
        id: SECRET_ID,
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A1],
      }),
    ];
  });

  test("an update that does not set the mode leaves both lists alone", async () => {
    const data: Dictionary<unknown> = await runBeforeUpdate({
      name: "Renamed",
    });

    expect(data).toEqual({ name: "Renamed" });
    expect(monitorFindByCalls).toHaveLength(0);
    expect(labelFindByCalls).toHaveLength(0);
  });

  test("Update Secret Value sends only the value, and nothing else is touched", async () => {
    const data: Dictionary<unknown> = await runBeforeUpdate({
      secretValue: "rotated",
    });

    expect(Object.keys(data)).toEqual(["secretValue"]);
  });

  test("setting All Monitors empties both lists", async () => {
    const data: Dictionary<unknown> = await runBeforeUpdate({
      monitorAccess: MonitorSecretAccess.AllMonitors,
      monitors: [MONITOR_A1],
    });

    expect(data["monitorAccess"]).toBe(MonitorSecretAccess.AllMonitors);
    expect(data["monitors"]).toEqual([]);
    expect(data["labels"]).toEqual([]);
  });

  test("setting Specific Monitors empties the labels and keeps the monitors sent", async () => {
    const data: Dictionary<unknown> = await runBeforeUpdate({
      monitorAccess: MonitorSecretAccess.SpecificMonitors,
      monitors: [MONITOR_A2],
      labels: [LABEL_A_PROD],
    });

    expect(data["monitors"]).toEqual([MONITOR_A2]);
    expect(data["labels"]).toEqual([]);
  });

  test("setting Monitors With Labels empties the monitors and keeps the labels sent", async () => {
    const data: Dictionary<unknown> = await runBeforeUpdate({
      monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
      monitors: [MONITOR_A1],
      labels: [LABEL_A_PROD],
    });

    expect(data["monitors"]).toEqual([]);
    expect(data["labels"]).toEqual([LABEL_A_PROD]);
  });

  test("setting a mode without its list leaves that list as it is", async () => {
    const data: Dictionary<unknown> = await runBeforeUpdate({
      monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
    });

    expect(data["monitors"]).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(data, "labels")).toBe(false);
  });

  test("a list sent without a mode is stored as sent, for a client that flips the mode next", async () => {
    const data: Dictionary<unknown> = await runBeforeUpdate({
      labels: [LABEL_A_EDGE],
    });

    expect(data).toEqual({ labels: [LABEL_A_EDGE] });
  });

  test.each([
    ["null", null],
    ["an unknown mode", "Nobody"],
    ["a different case", "specific monitors"],
  ])("refuses %s", async (_name: string, value: unknown) => {
    await expect(runBeforeUpdate({ monitorAccess: value })).rejects.toThrow(
      /Monitor access must be one of/,
    );
  });

  test("refuses a label from another project", async () => {
    await expect(
      runBeforeUpdate({
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [LABEL_A_PROD, LABEL_B_PROD],
      }),
    ).rejects.toThrow(/belong to a different project/);
  });

  test("refuses a monitor from another project, sent as a bare id or as an object", async () => {
    await expect(runBeforeUpdate({ monitors: [MONITOR_B1] })).rejects.toThrow(
      /belong to a different project/,
    );

    await expect(
      runBeforeUpdate({ monitors: [{ _id: MONITOR_B1 }] }),
    ).rejects.toThrow(/belong to a different project/);
  });

  test("does not check the list it just emptied", async () => {
    await runBeforeUpdate({
      monitorAccess: MonitorSecretAccess.AllMonitors,
      monitors: [MONITOR_B1],
      labels: [LABEL_B_PROD],
    });

    expect(monitorFindByCalls).toHaveLength(0);
    expect(labelFindByCalls).toHaveLength(0);
  });

  test("a foreign id the secret already holds can be saved back, so a row written before the check stays editable", async () => {
    secretRows = [
      secretRow({
        id: SECRET_ID,
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A1, MONITOR_B1],
      }),
    ];

    await expect(
      runBeforeUpdate({ monitors: [MONITOR_A1, MONITOR_B1] }),
    ).resolves.toEqual({ monitors: [MONITOR_A1, MONITOR_B1] });

    // ...but it cannot be used to bring in another one.
    await expect(runBeforeUpdate({ labels: [LABEL_B_PROD] })).rejects.toThrow(
      /belong to a different project/,
    );
  });

  test("without a tenant, the project is the one of the secret the update matches", async () => {
    await expect(
      runBeforeUpdate({ monitors: [MONITOR_B1] }, { isRoot: true }),
    ).rejects.toThrow(/belong to a different project/);

    await expect(
      runBeforeUpdate({ monitors: [MONITOR_A2] }, { isRoot: true }),
    ).resolves.toEqual({ monitors: [MONITOR_A2] });
  });
});

describe("MonitorSecretService.getSecretsForMonitors", () => {
  function getSecrets(
    monitorIds: Array<string>,
    projectId?: string,
  ): Promise<Map<string, Array<MonitorSecret>>> {
    return MonitorSecretService.getSecretsForMonitors({
      monitorIds: monitorIds.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      projectId: projectId ? new ObjectID(projectId) : undefined,
    });
  }

  function names(secrets: Array<MonitorSecret> | undefined): Array<string> {
    return (secrets || []).map((secret: MonitorSecret): string => {
      return secret.name!;
    });
  }

  test("no monitors: no queries at all", async () => {
    const result: Map<string, Array<MonitorSecret>> = await getSecrets([]);

    expect(result.size).toBe(0);
    expect(monitorFindByCalls).toHaveLength(0);
    expect(secretFindByCalls).toHaveLength(0);
  });

  test("routes each secret only to the monitors its mode covers, across a batch spanning two projects", async () => {
    secretRows = [
      secretRow({
        name: "allA",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
      secretRow({
        name: "listedA2",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A2],
      }),
      secretRow({
        name: "prodA",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labelIds: [LABEL_A_PROD],
      }),
      secretRow({
        name: "allB",
        projectId: PROJECT_B,
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MONITOR_A1,
      MONITOR_A2,
      MONITOR_A3,
      MONITOR_B1,
    ]);

    expect(names(result.get(MONITOR_A1))).toEqual(["allA", "prodA"]);
    expect(names(result.get(MONITOR_A2))).toEqual(["allA", "listedA2"]);
    expect(names(result.get(MONITOR_A3))).toEqual(["allA"]);
    expect(names(result.get(MONITOR_B1))).toEqual(["allB"]);
  });

  test("a secret never reaches another project's monitor, whatever its lists name", async () => {
    secretRows = [
      // Written before relation lists were checked: lists project A's monitor.
      secretRow({
        name: "listsForeignMonitor",
        projectId: PROJECT_B,
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A1],
      }),
      // Names project A's label.
      secretRow({
        name: "namesForeignLabel",
        projectId: PROJECT_B,
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labelIds: [LABEL_A_PROD],
      }),
      secretRow({
        name: "allB",
        projectId: PROJECT_B,
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MONITOR_A1,
      MONITOR_A2,
    ]);

    expect(result.size).toBe(0);
  });

  test("a list the mode does not read grants nothing", async () => {
    secretRows = [
      secretRow({
        name: "labelsButListsA1",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labelIds: [LABEL_A_EDGE],
        monitorIds: [MONITOR_A1],
      }),
      secretRow({
        name: "listedButLabelledProd",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A3],
        labelIds: [LABEL_A_PROD],
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MONITOR_A1,
      MONITOR_A3,
    ]);

    /*
     * A1 is listed on the label-scoped secret and carries the label of the
     * listed one, and gets neither.
     */
    expect(result.has(MONITOR_A1)).toBe(false);
    expect(names(result.get(MONITOR_A3))).toEqual([
      "labelsButListsA1",
      "listedButLabelledProd",
    ]);
  });

  test("a monitor that may use no secret has no entry", async () => {
    secretRows = [
      secretRow({
        name: "listedA2",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A2],
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MONITOR_A1,
      MONITOR_A2,
    ]);

    expect(Array.from(result.keys())).toEqual([MONITOR_A2]);
  });

  test("a monitor id that matches no monitor gets nothing, and an all-missing batch queries no secrets", async () => {
    secretRows = [
      secretRow({
        name: "allA",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MISSING_ID,
    ]);

    expect(result.size).toBe(0);
    expect(monitorFindByCalls).toHaveLength(1);
    expect(secretFindByCalls).toHaveLength(0);
  });

  test("with a project, only that project's monitors are resolved (a monitor test cannot borrow another project's monitor)", async () => {
    secretRows = [
      secretRow({
        name: "allB",
        projectId: PROJECT_B,
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets(
      [MONITOR_B1],
      PROJECT_A,
    );

    expect(result.size).toBe(0);
    expect(String(monitorFindByCalls[0]!.query["projectId"])).toBe(PROJECT_A);
    expect(secretFindByCalls).toHaveLength(0);

    // The monitor's own project resolves it as usual.
    expect(
      names((await getSecrets([MONITOR_B1], PROJECT_B)).get(MONITOR_B1)),
    ).toEqual(["allB"]);
  });

  test("reads the monitors once, as root, with their project and labels", async () => {
    await getSecrets([MONITOR_A1, MONITOR_A2]);

    expect(monitorFindByCalls).toHaveLength(1);

    const call: FindByCall = monitorFindByCalls[0]!;

    expect(readIds(call.query["_id"]).sort()).toEqual(
      [MONITOR_A1, MONITOR_A2].sort(),
    );
    expect(call.query["projectId"]).toBeUndefined();
    expect(call.select).toEqual({
      _id: true,
      projectId: true,
      labels: {
        _id: true,
      },
    });
    expect(call.props).toEqual({ isRoot: true });
  });

  test("one secret query per mode, each filtered on the batch's projects and on the list it reads", async () => {
    await getSecrets([MONITOR_A1, MONITOR_A2, MONITOR_A3, MONITOR_B1]);

    expect(secretFindByCalls).toHaveLength(3);

    const byMode: Dictionary<FindByCall> = {};

    for (const call of secretFindByCalls) {
      byMode[call.query["monitorAccess"] as string] = call;
      expect(readIds(call.query["projectId"]).sort()).toEqual(
        [PROJECT_A, PROJECT_B].sort(),
      );
      expect(call.props).toEqual({ isRoot: true });
      expect(call.select["name"]).toBe(true);
      expect(call.select["secretValue"]).toBe(true);
      expect(call.select["projectId"]).toBe(true);
      expect(call.select["monitorAccess"]).toBe(true);
    }

    const all: FindByCall = byMode[MonitorSecretAccess.AllMonitors]!;
    expect(all.query["monitors"]).toBeUndefined();
    expect(all.query["labels"]).toBeUndefined();
    expect(all.select["monitors"]).toBeUndefined();
    expect(all.select["labels"]).toBeUndefined();

    const specific: FindByCall = byMode[MonitorSecretAccess.SpecificMonitors]!;
    expect(readIds(specific.query["monitors"]).sort()).toEqual(
      [MONITOR_A1, MONITOR_A2, MONITOR_A3, MONITOR_B1].sort(),
    );
    expect(specific.select["monitors"]).toEqual({ _id: true });
    expect(specific.select["labels"]).toBeUndefined();

    const withLabels: FindByCall =
      byMode[MonitorSecretAccess.MonitorsWithLabels]!;
    expect(readIds(withLabels.query["labels"]).sort()).toEqual(
      [LABEL_A_PROD, LABEL_A_EDGE, LABEL_A_UNUSED, LABEL_B_PROD].sort(),
    );
    expect(withLabels.select["labels"]).toEqual({ _id: true });
    expect(withLabels.select["monitors"]).toBeUndefined();
  });

  test("skips the label query when no monitor in the batch carries a label", async () => {
    await getSecrets([MONITOR_A2]);

    expect(
      secretFindByCalls.map((call: FindByCall): unknown => {
        return call.query["monitorAccess"];
      }),
    ).toEqual([
      MonitorSecretAccess.AllMonitors,
      MonitorSecretAccess.SpecificMonitors,
    ]);
  });

  test("the number of queries does not grow with the batch", async () => {
    for (const count of [1, 25, 250]) {
      monitorRows = [];
      monitorFindByCalls = [];
      secretFindByCalls = [];

      const batch: Array<string> = [];

      for (let i: number = 0; i < count; i++) {
        const id: string = ObjectID.generate().toString();
        batch.push(id);
        monitorRows.push({
          id: id,
          projectId: i % 2 === 0 ? PROJECT_A : PROJECT_B,
          labelIds: [i % 3 === 0 ? LABEL_A_PROD : LABEL_B_PROD],
        });
      }

      await getSecrets(batch);

      expect(monitorFindByCalls).toHaveLength(1);
      expect(secretFindByCalls).toHaveLength(3);
    }
  });

  test("hands back each monitor's secrets sorted by name", async () => {
    secretRows = [
      secretRow({
        name: "zeta",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
      secretRow({
        name: "alpha",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A1],
      }),
      secretRow({
        name: "Mid",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labelIds: [LABEL_A_PROD],
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MONITOR_A1,
    ]);

    expect(names(result.get(MONITOR_A1))).toEqual(["alpha", "Mid", "zeta"]);
  });

  test("the secrets handed back carry the value to substitute", async () => {
    secretRows = [
      secretRow({
        name: "apiKey",
        secretValue: "sk_live_123",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MONITOR_A1,
    ]);

    expect(result.get(MONITOR_A1)![0]!.secretValue).toBe("sk_live_123");
  });

  test("a monitor read back without a project is skipped rather than matched", async () => {
    monitorRows = [{ id: MONITOR_A1, projectId: "", labelIds: [] }];
    secretRows = [
      secretRow({
        name: "allA",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    jest.spyOn(MonitorService, "findBy").mockImplementation((() => {
      const monitor: Monitor = new Monitor(new ObjectID(MONITOR_A1));
      return Promise.resolve([monitor]);
    }) as never);

    const result: Map<string, Array<MonitorSecret>> = await getSecrets([
      MONITOR_A1,
    ]);

    expect(result.size).toBe(0);
  });
});

describe("MonitorSecretService.getSecretsForUnsavedMonitor", () => {
  test("gets the project's All Monitors secrets, and only those, in one query", async () => {
    secretRows = [
      secretRow({
        name: "allA",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
      secretRow({
        name: "listedA1",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A1],
      }),
      secretRow({
        name: "prodA",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labelIds: [LABEL_A_PROD],
      }),
      secretRow({
        name: "allB",
        projectId: PROJECT_B,
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    const secrets: Array<MonitorSecret> =
      await MonitorSecretService.getSecretsForUnsavedMonitor({
        projectId: new ObjectID(PROJECT_A),
      });

    expect(
      secrets.map((secret: MonitorSecret): string => {
        return secret.name!;
      }),
    ).toEqual(["allA"]);

    expect(secretFindByCalls).toHaveLength(1);
    expect(secretFindByCalls[0]!.query["monitorAccess"]).toBe(
      MonitorSecretAccess.AllMonitors,
    );
    expect(readIds(secretFindByCalls[0]!.query["projectId"])).toEqual([
      PROJECT_A,
    ]);
    expect(monitorFindByCalls).toHaveLength(0);
  });

  test("a project with no All Monitors secret gets none", async () => {
    secretRows = [
      secretRow({
        name: "allB",
        projectId: PROJECT_B,
        monitorAccess: MonitorSecretAccess.AllMonitors,
      }),
    ];

    await expect(
      MonitorSecretService.getSecretsForUnsavedMonitor({
        projectId: new ObjectID(PROJECT_A),
      }),
    ).resolves.toEqual([]);
  });
});
