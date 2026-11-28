import MonitorTemplateChangeRunner, {
  MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES,
  MAX_MONITOR_TEMPLATE_CHANGE_RESUMES,
  MONITOR_NOT_REACHED_FAILED,
  MONITOR_NOT_REACHED_STOPPED,
  MONITOR_TEMPLATE_CHANGE_JOB,
  MONITOR_TEMPLATE_CHANGE_MAX_QUEUED_MS,
  MONITOR_TEMPLATE_CHANGE_STALE_RUNNING_MS,
} from "../../../../Server/Utils/Monitor/MonitorTemplateChangeRunner";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorTemplateChangeService from "../../../../Server/Services/MonitorTemplateChangeService";
import MonitorTemplateService from "../../../../Server/Services/MonitorTemplateService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import MonitorTemplateChange from "../../../../Models/DatabaseModels/MonitorTemplateChange";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_MONITORS_PER_TEMPLATE_CHANGE,
  MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeProgress,
  MonitorTemplateChangeResults,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
  MonitorTemplateLinkResult,
  readMonitorTemplateChangeProgress,
  readMonitorTemplateChangeResults,
} from "../../../../Types/Monitor/MonitorTemplateChange";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CHANGING MANY MONITORS' TEMPLATE, ON THE SERVER (issues #11260, #11266).
 *
 * The runner is driven against in-memory stand-ins for what it writes
 * through - the change's own rows, the monitors, the template - so each test
 * says what the database holds and reads back what the change did: which
 * monitors it moved, as whom, what it wrote about each one left out, and
 * when. The permission checks are the real ones, on props built the way a
 * request's are.
 */

jest.mock("../../../../Server/Services/MonitorTemplateChangeService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorTemplateService", () => {
  return {
    __esModule: true,
    default: {
      readTemplateToLinkOrUnlink: jest.fn(),
      assertNothingProvisionsFrom: jest.fn(),
      linkMonitor: jest.fn(),
      unlinkMonitor: jest.fn(),
      deleteOneById: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), findOneById: jest.fn(), countBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Infrastructure/Queue", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/Infrastructure/Queue",
  );
  return {
    ...actual,
    __esModule: true,
    default: { addJob: jest.fn() },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/Billing/CallerPlan", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../../Server/Utils/Billing/CallerPlan",
  );

  // The props a test builds carry their plan already.
  const CallerPlanWithTestProps: Record<string, unknown> = Object.create(
    actual.default,
  );
  CallerPlanWithTestProps["withPlan"] = jest.fn(async (props: unknown) => {
    return props;
  });

  return { __esModule: true, default: CallerPlanWithTestProps };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const PERSON_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000001",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000001",
);

const MONITOR_EDITOR: Array<Permission> = [
  Permission.ReadProjectMonitor,
  Permission.EditProjectMonitor,
  Permission.ReadMonitorTemplate,
];
const TEMPLATE_DELETER: Array<Permission> = [
  ...MONITOR_EDITOR,
  Permission.DeleteMonitorTemplate,
];

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: PERSON_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

function monitorIds(count: number): Array<string> {
  return Array.from({ length: count }, (): string => {
    return ObjectID.generate().toString();
  });
}

// ---- What the database holds.

interface FakeDatabase {
  changes: Map<string, MonitorTemplateChange>;
  writes: Array<{ id: string; data: JSONObject }>;
  template: MonitorTemplate | null;
  // What each monitor's link or unlink does, by id: a result or an error.
  outcomeOf: (monitorId: string) => MonitorTemplateLinkResult | Error;
  // The calls of the link and unlink, in order.
  linked: Array<{ monitorId: string; props: unknown; apply: unknown }>;
  unlinked: Array<{ monitorId: string; clear: unknown; templateId: unknown }>;
  linkedToTemplate: Array<string>;
  stillLinkedCount: number;
  deletedTemplates: Array<string>;
  monitorNames: Map<string, string>;
}

let db: FakeDatabase;
let personProps: DatabaseCommonInteractionProps;
let clock: number;

function changed(
  resolved: { incidents?: number; alerts?: number } = {},
): MonitorTemplateLinkResult {
  return {
    outcome: MonitorTemplateChangeOutcome.Changed,
    resolvedIncidentCount: resolved.incidents || 0,
    resolvedAlertCount: resolved.alerts || 0,
  };
}

function installFakes(): void {
  const changeService: Record<string, jest.Mock> =
    MonitorTemplateChangeService as unknown as Record<string, jest.Mock>;

  changeService["create"]!.mockImplementation((async (data: {
    data: MonitorTemplateChange;
  }): Promise<MonitorTemplateChange> => {
    const row: MonitorTemplateChange = data.data;
    row.id = ObjectID.generate();
    row.createdAt = new Date(clock);
    row.updatedAt = new Date(clock);
    db.changes.set(row.id.toString(), row);
    return row;
  }) as never);

  const findRow: (id: unknown) => MonitorTemplateChange | null = (
    id: unknown,
  ): MonitorTemplateChange | null => {
    return db.changes.get(String(id)) || null;
  };

  changeService["findOneById"]!.mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<MonitorTemplateChange | null> => {
    return findRow(data.id);
  }) as never);

  changeService["findOneBy"]!.mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<MonitorTemplateChange | null> => {
    if (data.query["_id"]) {
      return findRow(data.query["_id"]);
    }

    const status: unknown = data.query["status"];

    return (
      Array.from(db.changes.values()).find(
        (row: MonitorTemplateChange): boolean => {
          return row.status === status;
        },
      ) || null
    );
  }) as never);

  changeService["findBy"]!.mockImplementation((async (): Promise<
    Array<MonitorTemplateChange>
  > => {
    return Array.from(db.changes.values()).filter(
      (row: MonitorTemplateChange): boolean => {
        return (
          row.status === MonitorTemplateChangeStatus.Queued ||
          row.status === MonitorTemplateChangeStatus.Running
        );
      },
    );
  }) as never);

  changeService["updateOneById"]!.mockImplementation((async (data: {
    id: ObjectID;
    data: JSONObject;
  }): Promise<void> => {
    const row: MonitorTemplateChange | null = findRow(data.id);

    db.writes.push({ id: data.id.toString(), data: { ...data.data } });

    if (row) {
      Object.assign(row, JSON.parse(JSON.stringify(data.data)));
      row.updatedAt = new Date(clock);
    }
  }) as never);

  const templateService: Record<string, jest.Mock> =
    MonitorTemplateService as unknown as Record<string, jest.Mock>;

  templateService["readTemplateToLinkOrUnlink"]!.mockImplementation(
    (async (): Promise<MonitorTemplate> => {
      if (!db.template) {
        throw new BadDataException("This monitor template does not exist.");
      }
      return db.template;
    }) as never,
  );

  templateService["assertNothingProvisionsFrom"]!.mockResolvedValue(
    undefined as never,
  );

  templateService["linkMonitor"]!.mockImplementation((async (data: {
    monitorId: ObjectID;
    props: unknown;
    applyTemplateSettings: unknown;
  }): Promise<MonitorTemplateLinkResult> => {
    db.linked.push({
      monitorId: data.monitorId.toString(),
      props: data.props,
      apply: data.applyTemplateSettings,
    });
    const outcome: MonitorTemplateLinkResult | Error = db.outcomeOf(
      data.monitorId.toString(),
    );
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }) as never);

  templateService["unlinkMonitor"]!.mockImplementation((async (data: {
    monitorId: ObjectID;
    clearTemplateSettings: unknown;
    monitorTemplateId: unknown;
  }): Promise<MonitorTemplateLinkResult> => {
    db.unlinked.push({
      monitorId: data.monitorId.toString(),
      clear: data.clearTemplateSettings,
      templateId: data.monitorTemplateId,
    });
    const outcome: MonitorTemplateLinkResult | Error = db.outcomeOf(
      data.monitorId.toString(),
    );
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }) as never);

  templateService["deleteOneById"]!.mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<void> => {
    db.deletedTemplates.push(data.id.toString());
  }) as never);

  const monitorService: Record<string, jest.Mock> =
    MonitorService as unknown as Record<string, jest.Mock>;

  monitorService["findBy"]!.mockImplementation((async (data: {
    skip: number;
    limit: number;
  }): Promise<Array<Monitor>> => {
    return db.linkedToTemplate
      .slice(data.skip, data.skip + data.limit)
      .map((id: string): Monitor => {
        return new Monitor(new ObjectID(id));
      });
  }) as never);

  monitorService["findOneById"]!.mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Monitor | null> => {
    const name: string | undefined = db.monitorNames.get(data.id.toString());

    if (!name) {
      return null;
    }

    const monitor: Monitor = new Monitor(data.id);
    monitor.name = name;
    return monitor;
  }) as never);

  monitorService["countBy"]!.mockImplementation(
    (async (): Promise<PositiveNumber> => {
      return new PositiveNumber(db.stillLinkedCount);
    }) as never,
  );

  (Queue.addJob as unknown as jest.Mock).mockResolvedValue(undefined as never);
  (Semaphore.lock as unknown as jest.Mock).mockResolvedValue({} as never);
  (Semaphore.release as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
}

function template(): MonitorTemplate {
  const monitorTemplate: MonitorTemplate = new MonitorTemplate(TEMPLATE_ID);
  monitorTemplate.projectId = PROJECT_ID;
  monitorTemplate.monitorType = MonitorType.NetworkDevice;
  monitorTemplate.templateName = "WB Ping Monitor Template v2";
  return monitorTemplate;
}

beforeEach(() => {
  jest.clearAllMocks();
  clock = Date.UTC(2026, 10, 27, 12, 0, 0);
  MonitorTemplateChangeRunner.now = (): number => {
    return clock;
  };

  db = {
    changes: new Map<string, MonitorTemplateChange>(),
    writes: [],
    template: template(),
    outcomeOf: (): MonitorTemplateLinkResult => {
      return changed();
    },
    linked: [],
    unlinked: [],
    linkedToTemplate: [],
    stillLinkedCount: 0,
    deletedTemplates: [],
    monitorNames: new Map<string, string>(),
  };

  personProps = propsWith(MONITOR_EDITOR);

  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return personProps;
    }) as never);

  installFakes();
});

afterEach(() => {
  MonitorTemplateChangeRunner.now = (): number => {
    return Date.now();
  };
  jest.restoreAllMocks();
});

async function startLink(
  ids: Array<string>,
  applyTemplateSettings: boolean = true,
): Promise<MonitorTemplateChange> {
  return await MonitorTemplateChangeRunner.start({
    projectId: PROJECT_ID,
    props: personProps,
    monitorTemplateId: TEMPLATE_ID.toString(),
    settings: {
      kind: MonitorTemplateChangeKind.Link,
      applyTemplateSettings: applyTemplateSettings,
    },
    monitorIds: ids,
  });
}

async function run(changeId: ObjectID): Promise<string> {
  return await MonitorTemplateChangeRunner.processChange({
    changeId: changeId,
    deadline: clock + 60 * 60 * 1000,
  });
}

function resultsOf(row: MonitorTemplateChange): MonitorTemplateChangeResults {
  return readMonitorTemplateChangeResults(row.results);
}

function progressOf(row: MonitorTemplateChange): MonitorTemplateChangeProgress {
  return readMonitorTemplateChangeProgress(row.progress);
}

describe("asking for a change", () => {
  test("records it Queued, with its settings, the monitors in order and an empty tally, and queues the project's job", async () => {
    const ids: Array<string> = monitorIds(3);

    const row: MonitorTemplateChange = await startLink([...ids, ids[0]!]);

    expect(row.status).toBe(MonitorTemplateChangeStatus.Queued);
    expect(row.monitorIds).toEqual(ids);
    expect(row.monitorTemplateId?.toString()).toBe(TEMPLATE_ID.toString());
    expect(row.monitorTemplateName).toBe("WB Ping Monitor Template v2");
    expect(row.createdByUserId?.toString()).toBe(PERSON_ID.toString());
    expect(row.settings).toEqual({
      kind: MonitorTemplateChangeKind.Link,
      applyTemplateSettings: true,
      clearTemplateSettings: false,
      deleteTemplateWhenDone: false,
    });
    expect(progressOf(row).total).toBe(3);
    expect(Queue.addJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      MONITOR_TEMPLATE_CHANGE_JOB,
      { projectId: PROJECT_ID.toString() },
      expect.objectContaining({
        deduplication: expect.objectContaining({
          id: `monitor-template-change-${PROJECT_ID.toString()}`,
        }),
      }),
    );
  });

  test("is refused to someone who may not edit monitors, in a sentence that says so", async () => {
    personProps = propsWith([Permission.ReadProjectMonitor]);

    await expect(startLink(monitorIds(1))).rejects.toThrow(
      "You may not edit monitors in this project, so you cannot change their template. Ask a Project Owner or Project Admin.",
    );
    expect(db.changes.size).toBe(0);
  });

  test("is refused without a person, a template for a link, or monitors", async () => {
    await expect(
      MonitorTemplateChangeRunner.start({
        projectId: PROJECT_ID,
        props: { tenantId: PROJECT_ID, isRoot: true },
        monitorTemplateId: TEMPLATE_ID.toString(),
        settings: { kind: MonitorTemplateChangeKind.Link },
        monitorIds: monitorIds(1),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    await expect(
      MonitorTemplateChangeRunner.start({
        projectId: PROJECT_ID,
        props: personProps,
        monitorTemplateId: undefined,
        settings: { kind: MonitorTemplateChangeKind.Link },
        monitorIds: monitorIds(1),
      }),
    ).rejects.toThrow("Pick the template to link the monitors to");

    await expect(startLink([])).rejects.toThrow(
      "Select the monitors to change, then try again.",
    );
    await expect(startLink(["not-an-id"])).rejects.toThrow(
      "One of the selected monitors was not recognised",
    );
  });

  test("takes as many monitors as a list selects, and no more", async () => {
    const row: MonitorTemplateChange = await startLink(
      monitorIds(MAX_MONITORS_PER_TEMPLATE_CHANGE),
    );

    expect((row.monitorIds || []).length).toBe(
      MAX_MONITORS_PER_TEMPLATE_CHANGE,
    );

    await expect(
      startLink(monitorIds(MAX_MONITORS_PER_TEMPLATE_CHANGE + 1)),
    ).rejects.toThrow(
      `One change takes at most ${MAX_MONITORS_PER_TEMPLATE_CHANGE} monitors`,
    );
  });

  test("reads every monitor linked to the template, as the person, for a change of them all", async () => {
    db.linkedToTemplate = monitorIds(10_500);

    const row: MonitorTemplateChange = await MonitorTemplateChangeRunner.start({
      projectId: PROJECT_ID,
      props: propsWith(TEMPLATE_DELETER),
      monitorTemplateId: TEMPLATE_ID.toString(),
      settings: {
        kind: MonitorTemplateChangeKind.Unlink,
        clearTemplateSettings: true,
        deleteTemplateWhenDone: true,
      },
      monitorIds: undefined,
      allLinkedToTemplate: true,
    });

    expect(row.monitorIds).toEqual(db.linkedToTemplate);
    expect(
      (MonitorService.findBy as unknown as jest.Mock).mock.calls.every(
        (call: Array<unknown>): boolean => {
          return (
            (
              call[0] as { props: DatabaseCommonInteractionProps }
            ).props.userId?.toString() === PERSON_ID.toString()
          );
        },
      ),
    ).toBe(true);
  });

  test("a template's delete asks first whether a rule or a policy would refuse it, and who may delete templates", async () => {
    const assertSpy: jest.Mock =
      MonitorTemplateService.assertNothingProvisionsFrom as unknown as jest.Mock;
    assertSpy.mockRejectedValueOnce(
      new BadDataException(
        "WB Ping Monitor Template v2 is used by 1 network device auto-import rule (Warehouse).",
      ),
    );

    await expect(
      MonitorTemplateChangeRunner.start({
        projectId: PROJECT_ID,
        props: propsWith(TEMPLATE_DELETER),
        monitorTemplateId: TEMPLATE_ID.toString(),
        settings: {
          kind: MonitorTemplateChangeKind.Unlink,
          clearTemplateSettings: true,
          deleteTemplateWhenDone: true,
        },
        allLinkedToTemplate: true,
        monitorIds: undefined,
      }),
    ).rejects.toThrow("is used by 1 network device auto-import rule");

    await expect(
      MonitorTemplateChangeRunner.start({
        projectId: PROJECT_ID,
        props: personProps,
        monitorTemplateId: TEMPLATE_ID.toString(),
        settings: {
          kind: MonitorTemplateChangeKind.Unlink,
          deleteTemplateWhenDone: true,
        },
        allLinkedToTemplate: true,
        monitorIds: undefined,
      }),
    ).rejects.toThrow("You may not delete monitor templates in this project.");
    expect(db.changes.size).toBe(0);
  });
});

describe("the worker changing the monitors", () => {
  test("links each monitor as the person, with the template's settings, and counts what it did", async () => {
    const ids: Array<string> = monitorIds(4);
    db.outcomeOf = (id: string): MonitorTemplateLinkResult => {
      return id === ids[1]
        ? {
            outcome: MonitorTemplateChangeOutcome.Unchanged,
            resolvedIncidentCount: 0,
            resolvedAlertCount: 0,
          }
        : changed({ incidents: 1, alerts: 2 });
    };

    const row: MonitorTemplateChange = await startLink(ids);
    await run(row.id!);

    expect(
      db.linked.map((call: { monitorId: string }) => {
        return call.monitorId;
      }),
    ).toEqual(ids);
    expect(
      db.linked.every((call: { props: unknown; apply: unknown }): boolean => {
        return call.props === personProps && call.apply === true;
      }),
    ).toBe(true);
    expect(row.status).toBe(MonitorTemplateChangeStatus.Completed);
    expect(progressOf(row)).toMatchObject({
      total: 4,
      processed: 4,
      changed: 3,
      unchanged: 1,
      skipped: 0,
      failed: 0,
      resolvedIncidents: 3,
      resolvedAlerts: 6,
    });
    expect(resultsOf(row).lines).toEqual([]);
    expect(row.startedAt).toBeTruthy();
    expect(row.completedAt).toBeTruthy();
  });

  test("unlinks each monitor from the template, clearing its criteria when asked", async () => {
    const ids: Array<string> = monitorIds(2);
    const row: MonitorTemplateChange = await MonitorTemplateChangeRunner.start({
      projectId: PROJECT_ID,
      props: personProps,
      monitorTemplateId: TEMPLATE_ID.toString(),
      settings: {
        kind: MonitorTemplateChangeKind.Unlink,
        clearTemplateSettings: true,
      },
      monitorIds: ids,
    });

    await run(row.id!);

    expect(db.unlinked).toEqual(
      ids.map((id: string) => {
        return {
          monitorId: id,
          clear: true,
          templateId: TEMPLATE_ID,
        };
      }),
    );
    expect(progressOf(row).changed).toBe(2);
  });

  test("leaves out a monitor it was refused for, with the refusal and its name, and tries again one that failed", async () => {
    const ids: Array<string> = monitorIds(3);
    db.monitorNames.set(ids[0]!, "core-sw-01");
    db.outcomeOf = (id: string): MonitorTemplateLinkResult | Error => {
      if (id === ids[0]) {
        return new BadDataException(
          "The device this monitor was made for already has a monitor linked to this template: core-sw-01 - Interfaces. Delete one of the two, or link this one to another template.",
        );
      }

      if (id === ids[1]) {
        return new Error("Connection terminated unexpectedly");
      }

      return changed();
    };

    const row: MonitorTemplateChange = await startLink(ids);
    await run(row.id!);

    expect(resultsOf(row).lines).toEqual([
      {
        monitorId: ids[0],
        monitorName: "core-sw-01",
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason:
          "The device this monitor was made for already has a monitor linked to this template: core-sw-01 - Interfaces. Delete one of the two, or link this one to another template.",
      },
      {
        monitorId: ids[1],
        outcome: MonitorTemplateChangeOutcome.Failed,
        reason: "Connection terminated unexpectedly",
      },
    ]);
    expect(progressOf(row)).toMatchObject({
      changed: 1,
      skipped: 1,
      failed: 1,
    });

    const view: MonitorTemplateChangeView = MonitorTemplateChangeRunner.toView({
      row: row,
    });

    // Retry tries the one that failed; the one refused would be refused again.
    expect(view.retryableCount).toBe(1);
  });

  test("stops before its next monitor when asked, and lists the rest as not reached", async () => {
    const ids: Array<string> = monitorIds(5);
    const row: MonitorTemplateChange = await startLink(ids);

    db.outcomeOf = (id: string): MonitorTemplateLinkResult => {
      if (id === ids[1]) {
        // Someone presses Stop while the second monitor is being changed.
        db.changes.get(row.id!.toString())!.stopRequestedAt = new Date(clock);
        clock += 2000;
      }

      return changed();
    };

    expect(await run(row.id!)).toBe("stopped");

    expect(row.status).toBe(MonitorTemplateChangeStatus.Stopped);
    expect(db.linked).toHaveLength(2);
    expect(
      resultsOf(row).lines.map((line: MonitorTemplateChangeLine) => {
        return [line.monitorId, line.outcome, line.reason];
      }),
    ).toEqual(
      ids.slice(2).map((id: string) => {
        return [
          id,
          MonitorTemplateChangeOutcome.NotReached,
          MONITOR_NOT_REACHED_STOPPED,
        ];
      }),
    );
    expect(progressOf(row)).toMatchObject({
      processed: 5,
      changed: 2,
      notReached: 3,
    });
  });

  test("hands over to a fresh job at its deadline, and the next picks up where it stopped", async () => {
    const ids: Array<string> = monitorIds(4);
    const row: MonitorTemplateChange = await startLink(ids);

    db.outcomeOf = (): MonitorTemplateLinkResult => {
      clock += 1000;
      return changed();
    };

    const finish: string = await MonitorTemplateChangeRunner.processChange({
      changeId: row.id!,
      deadline: clock + 1500,
    });

    expect(finish).toBe("handover");
    expect(resultsOf(row).processedCount).toBe(2);
    expect(row.status).toBe(MonitorTemplateChangeStatus.Running);

    await run(row.id!);

    expect(
      db.linked.map((call: { monitorId: string }) => {
        return call.monitorId;
      }),
    ).toEqual(ids);
    expect(row.status).toBe(MonitorTemplateChangeStatus.Completed);
    expect(progressOf(row).changed).toBe(4);
  });

  test("fails as a whole when every monitor fails for the same reason, and leaves the rest to a retry", async () => {
    const ids: Array<string> = monitorIds(
      MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES + 5,
    );
    db.outcomeOf = (): Error => {
      return new Error(
        'Monitor status "Degraded" does not exist in this project.',
      );
    };

    const row: MonitorTemplateChange = await startLink(ids);
    await run(row.id!);

    expect(row.status).toBe(MonitorTemplateChangeStatus.Failed);
    expect(row.error).toContain(
      'Monitor status "Degraded" does not exist in this project.',
    );
    expect(db.linked).toHaveLength(MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES);
    expect(progressOf(row)).toMatchObject({
      failed: MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES,
      notReached: 5,
    });
    expect(
      MonitorTemplateChangeRunner.toView({ row: row }).retryableCount,
    ).toBe(ids.length);
  });

  test("stops changing monitors for someone who lost the right to edit them, and says why", async () => {
    const ids: Array<string> = monitorIds(3);
    const row: MonitorTemplateChange = await startLink(ids);

    db.outcomeOf = (): MonitorTemplateLinkResult => {
      // Half a minute on, the person's permissions are read again: gone.
      clock += 31_000;
      personProps = propsWith([Permission.ReadProjectMonitor]);
      return changed();
    };

    await run(row.id!);

    expect(row.status).toBe(MonitorTemplateChangeStatus.Failed);
    expect(row.error).toContain("You may not edit monitors in this project");
    expect(db.linked).toHaveLength(1);
    expect(progressOf(row)).toMatchObject({ changed: 1, notReached: 2 });
    expect(resultsOf(row).lines[0]!.reason).toBe(MONITOR_NOT_REACHED_FAILED);
  });

  test("fails a link whose template was deleted before it ran, keeping nothing half-done", async () => {
    const row: MonitorTemplateChange = await startLink(monitorIds(2));
    db.template = null;

    await run(row.id!);

    expect(row.status).toBe(MonitorTemplateChangeStatus.Failed);
    expect(row.error).toContain(
      'The template "WB Ping Monitor Template v2" was deleted, or you may no longer read it',
    );
    expect(db.linked).toHaveLength(0);
    expect(progressOf(row).notReached).toBe(2);
  });
});

describe("a template's delete that clears its monitors first", () => {
  async function startDelete(
    ids: Array<string>,
  ): Promise<MonitorTemplateChange> {
    personProps = propsWith(TEMPLATE_DELETER);
    db.linkedToTemplate = ids;

    return await MonitorTemplateChangeRunner.start({
      projectId: PROJECT_ID,
      props: personProps,
      monitorTemplateId: TEMPLATE_ID.toString(),
      settings: {
        kind: MonitorTemplateChangeKind.Unlink,
        clearTemplateSettings: true,
        deleteTemplateWhenDone: true,
      },
      allLinkedToTemplate: true,
      monitorIds: undefined,
    });
  }

  test("deletes the template, as the person, once nothing is linked to it", async () => {
    const row: MonitorTemplateChange = await startDelete(monitorIds(3));
    db.stillLinkedCount = 0;

    await run(row.id!);

    expect(db.unlinked).toHaveLength(3);
    expect(db.deletedTemplates).toEqual([TEMPLATE_ID.toString()]);
    expect(
      MonitorTemplateChangeRunner.toView({ row: row }).isTemplateDeleted,
    ).toBe(true);
  });

  test("keeps the template, and says how many monitors are still linked, when some are", async () => {
    const row: MonitorTemplateChange = await startDelete(monitorIds(3));
    db.stillLinkedCount = 2;

    await run(row.id!);

    expect(db.deletedTemplates).toEqual([]);

    const view: MonitorTemplateChangeView = MonitorTemplateChangeRunner.toView({
      row: row,
    });

    expect(view.isTemplateDeleted).toBe(false);
    expect(view.templateStillLinkedCount).toBe(2);
    expect(view.status).toBe(MonitorTemplateChangeStatus.Completed);
  });

  test("deletes a template with no monitor linked to it at all", async () => {
    const row: MonitorTemplateChange = await startDelete([]);

    await run(row.id!);

    expect(db.deletedTemplates).toEqual([TEMPLATE_ID.toString()]);
  });
});

describe("stopping, retrying and the sweep", () => {
  test("a queued change stops at once, with every monitor not reached", async () => {
    const ids: Array<string> = monitorIds(3);
    const row: MonitorTemplateChange = await startLink(ids);

    await MonitorTemplateChangeRunner.stop({
      projectId: PROJECT_ID,
      props: personProps,
      changeId: row.id!,
    });

    expect(row.status).toBe(MonitorTemplateChangeStatus.Stopped);
    expect(progressOf(row).notReached).toBe(3);
    expect(
      MonitorTemplateChangeRunner.toView({ row: row }).retryableCount,
    ).toBe(3);
  });

  test("a retry is a new change of what failed or was not reached, with the same settings", async () => {
    const ids: Array<string> = monitorIds(4);
    db.outcomeOf = (id: string): MonitorTemplateLinkResult | Error => {
      if (id === ids[0]) {
        return new BadDataException("Another type.");
      }
      if (id === ids[2]) {
        return new Error("timeout");
      }
      return changed();
    };

    const row: MonitorTemplateChange = await startLink(ids, false);
    await run(row.id!);

    const retried: MonitorTemplateChange =
      await MonitorTemplateChangeRunner.retry({
        projectId: PROJECT_ID,
        props: personProps,
        changeId: row.id!,
      });

    expect(retried.monitorIds).toEqual([ids[2]]);
    expect(retried.retryOfChangeId?.toString()).toBe(row.id!.toString());
    expect(
      (retried.settings as unknown as { applyTemplateSettings: boolean })
        .applyTemplateSettings,
    ).toBe(false);
  });

  test("a change still running cannot be retried, and one with nothing left says so", async () => {
    const row: MonitorTemplateChange = await startLink(monitorIds(1));

    await expect(
      MonitorTemplateChangeRunner.retry({
        projectId: PROJECT_ID,
        props: personProps,
        changeId: row.id!,
      }),
    ).rejects.toThrow("This change is still running.");

    await run(row.id!);

    await expect(
      MonitorTemplateChangeRunner.retry({
        projectId: PROJECT_ID,
        props: personProps,
        changeId: row.id!,
      }),
    ).rejects.toThrow("Nothing in this change failed or was left out");
  });

  test("the sweep picks up a change a dead worker left, and fails one past its resumes or waiting too long", async () => {
    const stale: MonitorTemplateChange = await startLink(monitorIds(2));
    const tooOften: MonitorTemplateChange = await startLink(monitorIds(2));
    const waitedTooLong: MonitorTemplateChange = await startLink(monitorIds(2));

    stale.status = MonitorTemplateChangeStatus.Running;
    tooOften.status = MonitorTemplateChangeStatus.Running;
    tooOften.resumeCount = MAX_MONITOR_TEMPLATE_CHANGE_RESUMES;

    clock += MONITOR_TEMPLATE_CHANGE_STALE_RUNNING_MS + 1000;
    waitedTooLong.createdAt = new Date(
      clock - MONITOR_TEMPLATE_CHANGE_MAX_QUEUED_MS - 1000,
    );
    (Queue.addJob as unknown as jest.Mock).mockClear();

    await MonitorTemplateChangeRunner.sweep(new Date(clock));

    expect(stale.resumeCount).toBe(1);
    expect(tooOften.status).toBe(MonitorTemplateChangeStatus.Failed);
    expect(tooOften.error).toContain("more often than it is picked up again");
    expect(waitedTooLong.status).toBe(MonitorTemplateChangeStatus.Failed);
    expect(waitedTooLong.error).toContain("waited too long to start");
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
  });

  test("the project's changes run one at a time: a job that cannot take the project's lock leaves it to the one that holds it", async () => {
    (Semaphore.lock as unknown as jest.Mock).mockRejectedValueOnce(
      new Error("held"),
    );
    const row: MonitorTemplateChange = await startLink(monitorIds(2));

    await MonitorTemplateChangeRunner.runProjectChanges(PROJECT_ID);

    expect(row.status).toBe(MonitorTemplateChangeStatus.Queued);
    expect(db.linked).toHaveLength(0);

    await MonitorTemplateChangeRunner.runProjectChanges(PROJECT_ID);

    expect(row.status).toBe(MonitorTemplateChangeStatus.Completed);
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });
});

describe("a change as the Dashboard draws it", () => {
  test("carries its counts and at most a page of lines, unless every line is asked for", async () => {
    const ids: Array<string> = monitorIds(
      MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT + 20,
    );
    db.outcomeOf = (): Error => {
      return new BadDataException("Another type.");
    };

    const row: MonitorTemplateChange = await startLink(ids);
    await run(row.id!);

    const view: MonitorTemplateChangeView = MonitorTemplateChangeRunner.toView({
      row: row,
    });

    expect(view.lines).toHaveLength(MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT);
    expect(view.isLinesTruncated).toBe(true);
    expect(view.progress.skipped).toBe(ids.length);
    expect(
      MonitorTemplateChangeRunner.toView({ row: row, allLines: true }).lines,
    ).toHaveLength(ids.length);
  });
});
