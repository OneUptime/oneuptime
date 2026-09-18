import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "../../../../Types/ObjectID";

/*
 * This hook is deliberately fire-and-forget: onCreateSuccess and
 * onUpdateSuccess are awaited by the write that triggered them, and a
 * project-wide backfill can touch thousands of rows, so returning a promise
 * would put the whole sweep inside the settings form's HTTP request.
 *
 * Two things therefore have to be true and neither is visible from a
 * reading of the call site: it must not be awaitable, and a rejected
 * backfill must not become an unhandled rejection that takes the process
 * with it. Both are pinned here.
 */

interface BackfillCall {
  definitionModelType: unknown;
  projectId: ObjectID;
}

const backfillCalls: Array<BackfillCall> = [];
const errorLogs: Array<string> = [];
let backfillResult: Promise<void> = Promise.resolve();

jest.mock("../../../../Server/Services/CustomFieldMappingService", () => {
  return {
    __esModule: true,
    default: {
      backfillProject: (data: {
        definitionModelType: unknown;
        projectId: ObjectID;
      }): Promise<void> => {
        backfillCalls.push(data);
        return backfillResult;
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: (message: unknown): void => {
        errorLogs.push(String(message));
      },
      warn: (): void => {
        // Not asserted on.
      },
      info: (): void => {
        // Not asserted on.
      },
      debug: (): void => {
        // Not asserted on.
      },
    },
  };
});

import { backfillMappedCustomFieldValues } from "../../../../Server/Utils/CustomField/CustomFieldDefinitionMappingHooks";

class FakeIncidentCustomFieldDefinition {}

// The jsdom-flavoured test environment has no setImmediate.
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe("backfillMappedCustomFieldValues", () => {
  beforeEach(() => {
    backfillCalls.length = 0;
    errorLogs.length = 0;
    backfillResult = Promise.resolve();
  });

  test("starts a backfill for the definition's project", () => {
    const projectId: ObjectID = new ObjectID(
      "11111111-1111-1111-1111-111111111111",
    );

    backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: projectId,
      definitionName: "Incident",
    });

    expect(backfillCalls).toEqual([
      {
        definitionModelType: FakeIncidentCustomFieldDefinition,
        projectId: projectId,
      },
    ]);
  });

  /*
   * The name is only ever used to say which change failed. It must not
   * reach the service, which selects rows by model type and project.
   */
  test("does not pass the definition name through to the service", () => {
    backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: new ObjectID("11111111-1111-1111-1111-111111111111"),
      definitionName: "Scheduled Maintenance",
    });

    expect(Object.keys(backfillCalls[0] ?? {}).sort()).toEqual([
      "definitionModelType",
      "projectId",
    ]);
  });

  /*
   * A definition with no project is a global one; there is no project's
   * worth of records to fill in, and asking the service to sweep
   * "undefined" would be a sweep of everything.
   */
  test("does nothing when the definition has no project", () => {
    backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: undefined,
      definitionName: "Alert",
    });

    expect(backfillCalls).toHaveLength(0);
  });

  /*
   * Returning a promise is how this stops being fire-and-forget: the
   * awaiting hook would then wait for the whole sweep and time the
   * settings form's request out.
   */
  test("returns nothing to await", () => {
    const returned: void = backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: new ObjectID("11111111-1111-1111-1111-111111111111"),
      definitionName: "Incident",
    });

    expect(returned).toBeUndefined();
  });

  test("logs a failed backfill instead of leaving it unhandled", async () => {
    backfillResult = Promise.reject(new Error("clickhouse is unreachable"));

    backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: new ObjectID("11111111-1111-1111-1111-111111111111"),
      definitionName: "Incident",
    });

    await flushMicrotasks();

    expect(
      errorLogs.some((line: string): boolean => {
        return line.includes("Incident");
      }),
    ).toBe(true);
  });

  test("names the kind of definition whose backfill failed", async () => {
    backfillResult = Promise.reject(new Error("clickhouse is unreachable"));

    backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: new ObjectID("11111111-1111-1111-1111-111111111111"),
      definitionName: "Scheduled Maintenance",
    });

    await flushMicrotasks();

    expect(errorLogs[0]).toContain("Scheduled Maintenance");
  });

  /*
   * The caller is a hook in the middle of a successful write. A backfill
   * that throws synchronously - not just one that rejects - must not turn
   * a saved definition into a failed request.
   */
  test("a rejected backfill does not propagate to the caller", async () => {
    backfillResult = Promise.reject(new Error("clickhouse is unreachable"));

    expect(() => {
      backfillMappedCustomFieldValues({
        definitionModelType: FakeIncidentCustomFieldDefinition as never,
        projectId: new ObjectID("11111111-1111-1111-1111-111111111111"),
        definitionName: "Alert",
      });
    }).not.toThrow();

    await flushMicrotasks();
  });

  test("starts one backfill per call, per project", () => {
    const first: ObjectID = new ObjectID(
      "11111111-1111-1111-1111-111111111111",
    );
    const second: ObjectID = new ObjectID(
      "22222222-2222-2222-2222-222222222222",
    );

    backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: first,
      definitionName: "Incident",
    });
    backfillMappedCustomFieldValues({
      definitionModelType: FakeIncidentCustomFieldDefinition as never,
      projectId: second,
      definitionName: "Incident",
    });

    expect(
      backfillCalls.map((call: BackfillCall): ObjectID => {
        return call.projectId;
      }),
    ).toEqual([first, second]);
  });
});
