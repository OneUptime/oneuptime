import fs from "fs";
import path from "path";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  findHookColumnWrites,
  HookColumnWrite,
  HookWriteKind,
} from "../../Helpers/HookColumnWriteScan";
import { modelFileOf } from "../../Helpers/ReferenceNameScan";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A SERVICE'S WRITE HOOKS WRITE ONLY WHAT THEIR CALLERS MAY WRITE.
 *
 * DatabaseService checks a create's record and an update's data AS THE
 * HOOKS LEAVE THEM against the caller's column permissions: the create
 * column check runs after onBeforeCreate, the update's after
 * onBeforeUpdate. So a value a hook writes - null included - is asked of the
 * caller as if they had sent it, and a hook that writes a column its callers
 * may not write refuses every write they make:
 *
 *   - "User is not allowed to create on fileId column of Packet Capture":
 *     PacketCaptureService stamped fileId null, and nobody could start a
 *     packet capture from the dashboard - the project owner included.
 *   - "User is not allowed to update on backfillRequestedAt column of Alert
 *     Measurement": the measurement services stamped their backfill in
 *     onBeforeUpdate, and nobody could change what a measurement means.
 *   - "... isOwnerNotified column of Alert Episode State Timeline", on an
 *     episode's first state; "... slackUserId column of Slack Account"
 *     before that (WorkspaceMethodStampedColumnCreate).
 *
 * Every one passed its tests: they called the hook alone, as root. This reads
 * every service's create and update hooks (and the methods they call) for
 * the columns they write (Tests/Helpers/HookColumnWriteScan), and holds each
 * one to the model: every permission the table's create (or update) list
 * names must reach the column as well. A value the hook decides that no
 * caller may write belongs:
 *
 *   - in onCreatePermitted / onUpdatePermitted, which run after every
 *     permission check (IncidentService's template, the measurements'
 *     backfill);
 *   - on a column marked computed, for a create (name and status of a
 *     packet capture, isOwnerNotified of a state timeline);
 *   - or nowhere: RelationIdUtil.leaveOut leaves a reference out of the
 *     write, where stamp(..., null) writes a null.
 *
 * A write that only rewrites what the request itself sent - trims it, checks
 * it - holds the caller to the column's list for what they sent, hook or no
 * hook, and is left alone (HookColumnWrite.onlyWhenSent).
 */

const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);
const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);

interface Refusal {
  key: string;
  write: HookColumnWrite;
  refusedFor: Array<Permission>;
}

/*
 * Writes that refuse someone the table names, and why that someone never
 * makes the write. Keyed "<file>#<create|update>#<column>"; each names the
 * permissions it covers, no more. An entry the scan no longer needs fails
 * below: delete it.
 */
const ALLOWED_REFUSALS: Record<
  string,
  { permissions: Array<Permission>; reason: string }
> = {
  "StatusPageSubscriberService.ts#create#subscriptionConfirmationToken": {
    permissions: [Permission.Public],
    reason:
      "A visitor signs up through StatusPageAPI's subscribe route, which creates the subscriber as root (createFromStatusPageSignUp). Through the CRUD route a Public caller is refused before this column: the create must name the project, and projectId is not theirs to write.",
  },
};

function loadModel(modelFile: string): DatabaseBaseModel | null {
  const exported: unknown = (
    jest.requireActual(path.join(MODELS_DIRECTORY, modelFile)) as {
      default?: unknown;
    }
  ).default;

  if (typeof exported !== "function") {
    return null;
  }

  try {
    const model: unknown = new (exported as new () => unknown)();

    return model instanceof DatabaseBaseModel ? model : null;
  } catch {
    return null;
  }
}

// A signed-in member of a project, holding exactly `permission` there.
function callerHolding(permission: Permission): DatabaseCommonInteractionProps {
  const projectId: ObjectID = ObjectID.generate();

  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

const REQUEST_TYPE: Record<HookWriteKind, DatabaseRequestType> = {
  create: DatabaseRequestType.Create,
  update: DatabaseRequestType.Update,
};

/*
 * The writes of one service's hooks that a permission of the table's list
 * would be refused for - the allowed ones left in, for the caller to weigh.
 */
function refusalsOf(file: string, text: string): Array<Refusal> {
  const modelFile: string | null = modelFileOf(text);
  const model: DatabaseBaseModel | null = modelFile
    ? loadModel(modelFile)
    : null;

  if (!model) {
    return [];
  }

  const modelType: new () => DatabaseBaseModel =
    model.constructor as new () => DatabaseBaseModel;
  const tableColumns: Array<string> = model.getTableColumns().columns;
  const refusals: Array<Refusal> = [];

  for (const write of findHookColumnWrites(file, text)) {
    if (write.onlyWhenSent || !tableColumns.includes(write.column)) {
      continue;
    }

    const metadata: TableColumnMetadata = model.getTableColumnMetadata(
      write.column,
    );

    // The create column check lets these through (ColumnPermissions).
    if (
      write.kind === "create" &&
      (metadata?.computed || metadata?.forceGetDefaultValueOnCreate)
    ) {
      continue;
    }

    const tablePermissions: Array<Permission> =
      (write.kind === "create"
        ? model.createRecordPermissions
        : model.updateRecordPermissions) || [];

    const refusedFor: Array<Permission> = tablePermissions.filter(
      (permission: Permission): boolean => {
        return !ColumnPermissions.getModelColumnsByPermissions(
          modelType,
          ColumnPermissions.getColumnCheckRows(callerHolding(permission)),
          REQUEST_TYPE[write.kind],
        ).columns.includes(write.column);
      },
    );

    if (refusedFor.length > 0) {
      refusals.push({
        key: `${file}#${write.kind}#${write.column}`,
        write: write,
        refusedFor: refusedFor,
      });
    }
  }

  return refusals;
}

// What is left once the allowed permissions are taken out.
function unexplained(refusals: Array<Refusal>): Array<string> {
  const lines: Array<string> = [];

  for (const refusal of refusals) {
    const allowed: Array<Permission> =
      ALLOWED_REFUSALS[refusal.key]?.permissions || [];
    const left: Array<Permission> = refusal.refusedFor.filter(
      (permission: Permission): boolean => {
        return !allowed.includes(permission);
      },
    );

    if (left.length > 0) {
      lines.push(
        `${refusal.write.file}:${refusal.write.line} ${refusal.write.kind} hook (${refusal.write.method}) writes ${refusal.write.column}, which a caller holding ${left.join(", ")} may not ${refusal.write.kind}: ${refusal.write.text}`,
      );
    }
  }

  return lines;
}

function serviceSources(): Array<{ file: string; text: string }> {
  return fs
    .readdirSync(SERVICES_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    })
    .sort()
    .map((file: string): { file: string; text: string } => {
      return {
        file: file,
        text: fs.readFileSync(path.join(SERVICES_DIRECTORY, file), "utf8"),
      };
    });
}

function serviceSource(file: string): string {
  return fs.readFileSync(path.join(SERVICES_DIRECTORY, file), "utf8");
}

// `text` with `before` replaced by `after`, exactly once.
function rewritten(text: string, before: string, after: string): string {
  expect(text.split(before)).toHaveLength(2);

  return text.replace(before, after);
}

describe("every service's write hooks, held to who may write", () => {
  const sources: Array<{ file: string; text: string }> = serviceSources();
  const refusals: Array<Refusal> = sources.flatMap(
    (source: { file: string; text: string }): Array<Refusal> => {
      return refusalsOf(source.file, source.text);
    },
  );

  test("no create or update hook writes a column that someone the table lets write may not", () => {
    expect(unexplained(refusals)).toEqual([]);
  });

  test("every allowed refusal is still one the hooks make, for exactly the permissions it names", () => {
    for (const [key, allowed] of Object.entries(ALLOWED_REFUSALS)) {
      const refusal: Refusal | undefined = refusals.find(
        (candidate: Refusal): boolean => {
          return candidate.key === key;
        },
      );

      expect([key, Boolean(refusal)]).toEqual([key, true]);
      expect([key, [...refusal!.refusedFor].sort()]).toEqual([
        key,
        [...allowed.permissions].sort(),
      ]);
    }
  });

  test("the scan reads the hooks' writes, across the services", () => {
    const writes: Array<HookColumnWrite> = sources.flatMap(
      (source: { file: string; text: string }): Array<HookColumnWrite> => {
        return findHookColumnWrites(source.file, source.text);
      },
    );

    expect(writes.length).toBeGreaterThan(400);

    const has: (
      file: string,
      kind: HookWriteKind,
      column: string,
    ) => boolean = (
      file: string,
      kind: HookWriteKind,
      column: string,
    ): boolean => {
      return writes.some((write: HookColumnWrite): boolean => {
        return (
          write.file === file && write.kind === kind && write.column === column
        );
      });
    };

    // A stamp through a constant list of names.
    expect(has("PacketCaptureService.ts", "create", "probeId")).toBe(true);
    // A computed column the hook decides.
    expect(has("PacketCaptureService.ts", "create", "status")).toBe(true);
    expect(
      has("IncidentStateTimelineService.ts", "create", "isOwnerNotified"),
    ).toBe(true);
    expect(has("MonitorService.ts", "create", "currentMonitorStatusId")).toBe(
      true,
    );
    expect(has("IncidentService.ts", "create", "currentIncidentStateId")).toBe(
      true,
    );
    // A helper the hook hands the payload to.
    expect(has("ProjectService.ts", "update", "dataResidency")).toBe(true);
  });
});

describe("it would have caught the writes it was written for", () => {
  test("PacketCaptureService stamping fileId null: every starter refused", () => {
    const text: string = rewritten(
      serviceSource("PacketCaptureService.ts"),
      "RelationIdUtil.leaveOut(data, FILE_RELATION_KEYS);",
      "RelationIdUtil.stamp(data, FILE_RELATION_KEYS, null);",
    );

    expect(
      refusalsOf("PacketCaptureService.ts", text).map(
        (refusal: Refusal): [string, Array<Permission>] => {
          return [refusal.key, refusal.refusedFor];
        },
      ),
    ).toEqual([
      [
        "PacketCaptureService.ts#create#fileId",
        [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.CreatePacketCapture,
        ],
      ],
    ]);

    // The service as it is writes nothing a starter may not.
    expect(
      refusalsOf(
        "PacketCaptureService.ts",
        serviceSource("PacketCaptureService.ts"),
      ),
    ).toEqual([]);
  });

  test("a measurement stamping its backfill in onBeforeUpdate: every editor refused", () => {
    const text: string = rewritten(
      serviceSource("AlertMeasurementService.ts"),
      "    this.updatesThatRewriteHistory.add(updateBy);\n",
      "    this.updatesThatRewriteHistory.add(updateBy);\n    (updateBy.data as unknown as BackfillFields).backfillRequestedAt =\n      OneUptimeDate.getCurrentDate();\n",
    );

    expect(
      refusalsOf("AlertMeasurementService.ts", text).map(
        (refusal: Refusal): [string, Array<Permission>] => {
          return [refusal.key, refusal.refusedFor];
        },
      ),
    ).toEqual([
      [
        "AlertMeasurementService.ts#update#backfillRequestedAt",
        [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditAlertMeasurement,
        ],
      ],
    ]);
  });

  test("the same write in onUpdatePermitted, after the permission checks, is not one", () => {
    expect(
      refusalsOf(
        "AlertMeasurementService.ts",
        serviceSource("AlertMeasurementService.ts"),
      ),
    ).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The scanner, on small services of its own.
 * ---------------------------------------------------------------------------
 */

function service(body: string): string {
  return `
import Model from "../../Models/DatabaseModels/PacketCapture";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";

const FILE_KEYS: Array<string> = ["fileId", "file"];

export class Service extends DatabaseService<Model> {
${body}
}
`;
}

function written(body: string): Array<string> {
  return findHookColumnWrites("Fixture.ts", service(body)).map(
    (write: HookColumnWrite): string => {
      return `${write.kind}:${write.column}${write.onlyWhenSent ? " (only when sent)" : ""}`;
    },
  );
}

describe("findHookColumnWrites: what counts as a write", () => {
  test("an assignment on the payload, under either spelling, and through an alias", () => {
    expect(
      written(`
  protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
    createBy.data.name = "a";
    const data: Record<string, unknown> = createBy.data as unknown as Record<string, unknown>;
    data["status"] = "Pending";
    const again = data;
    again.endReason ??= "x";
    return { createBy, carryForward: null };
  }`),
    ).toEqual(["create:name", "create:status", "create:endReason"]);
  });

  test("RelationIdUtil.stamp, by its first name, through a list or a constant - a null included", () => {
    expect(
      written(`
  protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
    RelationIdUtil.stamp(createBy.data as never, ["probeId", "probe"], id);
    RelationIdUtil.stamp(createBy.data as never, FILE_KEYS, null);
    return { createBy, carryForward: null };
  }`),
    ).toEqual(["create:probeId", "create:fileId"]);
  });

  test("setColumnValue and Object.assign write too", () => {
    expect(
      written(`
  protected override async onBeforeUpdate(updateBy: UpdateBy<Model>): Promise<OnUpdate<Model>> {
    updateBy.data.setColumnValue("bpfFilter", "tcp");
    Object.assign(updateBy.data, { maxPackets: 5, interfaceName });
    return { updateBy, carryForward: null };
  }`),
    ).toEqual([
      "update:bpfFilter",
      "update:maxPackets",
      "update:interfaceName",
    ]);
  });

  test("leaving a column out writes nothing: undefined, void 0, RelationIdUtil.leaveOut", () => {
    expect(
      written(`
  protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
    createBy.data.statusMessage = undefined;
    createBy.data.endReason = void 0;
    RelationIdUtil.leaveOut(createBy.data as never, FILE_KEYS);
    RelationIdUtil.stamp(createBy.data as never, FILE_KEYS, undefined);
    return { createBy, carryForward: null };
  }`),
    ).toEqual([]);
  });

  test("the methods a hook calls are read too, however the payload reaches them", () => {
    expect(
      written(`
  protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
    this.byCreate(createBy);
    this.byData(createBy.data);
    Service.byStatic(1, createBy.data);
    return { createBy, carryForward: null };
  }
  private byCreate(write: CreateBy<Model>): void {
    write.data.name = "a";
  }
  private byData(data: Model): void {
    data.bpfFilter = "tcp";
    this.deeper(data);
  }
  private deeper(record: Model): void {
    record.maxPackets = 1;
  }
  private static byStatic(_n: number, row: Model): void {
    row.maxFileSizeInMB = 1;
  }`),
    ).toEqual([
      "create:name",
      "create:bpfFilter",
      "create:maxFileSizeInMB",
      "create:maxPackets",
    ]);
  });

  test("what other hooks write is not read: onCreatePermitted, onUpdatePermitted and the success hooks run after the checks", () => {
    expect(
      written(`
  protected override async onCreatePermitted(onCreate: OnCreate<Model>): Promise<void> {
    onCreate.createBy.data.fileId = id;
  }
  protected override async onUpdatePermitted(updateBy: UpdateBy<Model>): Promise<void> {
    updateBy.data.status = "Running";
  }
  protected override async onCreateSuccess(onCreate: OnCreate<Model>, created: Model): Promise<Model> {
    onCreate.createBy.data.name = "x";
    return created;
  }`),
    ).toEqual([]);
  });

  test("an object that is not the payload is not written to", () => {
    expect(
      written(`
  protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
    const row: Model = new Model();
    row.fileId = id;
    other.data.name = "x";
    return { createBy, carryForward: null };
  }`),
    ).toEqual([]);
  });
});

describe("findHookColumnWrites: a write made only when the request sent the column", () => {
  function hook(statements: string): string {
    return `
  protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<string, unknown>;
${statements}
    return { createBy, carryForward: null };
  }`;
  }

  test.each([
    [
      "under !== undefined",
      `if (data["name"] !== undefined) { data["name"] = trim(data["name"]); }`,
    ],
    ["under a truthy test", `if (data.name) { data.name = trim(data.name); }`],
    [
      "after leaving when it is undefined",
      `if (data.name === undefined) { return { createBy, carryForward: null }; }\n    data.name = trim(data.name);`,
    ],
    [
      "after throwing when it is falsy",
      `if (!data.name) { throw new Error("x"); }\n    data.name = trim(data.name);`,
    ],
    [
      "after throwing when it is not text",
      `if (typeof data.name !== "string" || isBlank(data.name)) { throw new Error("x"); }\n    data.name = data.name.trim();`,
    ],
    [
      "after leaving when it is == null",
      `if (data.name == null) { return { createBy, carryForward: null }; }\n    data.name = trim(data.name);`,
    ],
    [
      "in the else of === undefined",
      `if (data.name === undefined) { log(); } else { data.name = trim(data.name); }`,
    ],
    [
      "under && with the test",
      `if (ready && data.name !== undefined) { data.name = trim(data.name); }`,
    ],
    [
      "after leaving on an || that holds the test",
      `if (data.name === undefined || skip) { return { createBy, carryForward: null }; }\n    data.name = trim(data.name);`,
    ],
    [
      "under RelationIdUtil.isPresent of its names",
      `if (RelationIdUtil.isPresent(data, ["probeId", "probe"])) { RelationIdUtil.stamp(data, ["probeId", "probe"], id); }`,
    ],
  ])("%s", (_how: string, statements: string) => {
    const writes: Array<string> = written(hook(statements));

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("(only when sent)");
  });

  test.each([
    [
      "under === undefined: the hook's own value",
      `if (data.name === undefined) { data.name = "default"; }`,
    ],
    ["under a falsy test", `if (!data.name) { data.name = "default"; }`],
    [
      "under a test of another column",
      `if (data.bpfFilter !== undefined) { data.name = "x"; }`,
    ],
    [
      "under || with the test",
      `if (ready || data.name !== undefined) { data.name = trim(data.name); }`,
    ],
    [
      "after an if that does not leave",
      `if (data.name === undefined) { log(); }\n    data.name = "x";`,
    ],
    [
      "under !== null, which undefined passes",
      `if (data.name !== null) { data.name = "x"; }`,
    ],
    ["unconditionally", `data.name = "x";`],
  ])("not %s", (_how: string, statements: string) => {
    const writes: Array<string> = written(hook(statements));

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("(only when sent)");
  });
});
