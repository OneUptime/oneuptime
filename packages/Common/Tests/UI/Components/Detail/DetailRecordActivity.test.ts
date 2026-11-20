import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EmailLog from "../../../../Models/DatabaseModels/EmailLog";
import User from "../../../../Models/DatabaseModels/User";
import RecordActorType from "../../../../Types/Database/RecordActor";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import {
  getNamedActorIds,
  getPersonName,
  getRecordActivitySelect,
  RecordActivity,
  readRecordActivity,
  withActorNames,
} from "../../../../UI/Components/Detail/DetailRecordActivity";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO MADE A RECORD AND WHO LAST MODIFIED IT, AS ITS LINE READS IT (#10290).
 *
 * What a record's read asks for, only of the columns its reader may read,
 * and what the line says once read: each "who" as what it was - a person, an
 * API key, a workflow, an MCP client, a server admin, OneUptime - and nothing
 * missing read as anyone.
 */

const API_KEY_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000a1";
const WORKFLOW_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000c1";
const GRANT_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000d1";
const CREATED_AT: Date = new Date("2026-09-30T13:25:13.000Z");
const MODIFIED_AT: Date = new Date("2026-11-19T09:12:00.000Z");

function person(name: string | null, email?: string): User {
  const user: User = new User();

  if (name !== null) {
    user.name = new Name(name);
  }

  if (email) {
    user.email = new Email(email);
  }

  return user;
}

function monitor(values: Record<string, unknown>): Monitor {
  const record: Monitor = new Monitor();

  for (const [key, value] of Object.entries(values)) {
    (record as unknown as Record<string, unknown>)[key] = value;
  }

  return record;
}

// What a reader who may read every column asks of a monitor.
const EVERY_COLUMN: Record<string, unknown> = getRecordActivitySelect(
  new Monitor(),
  (): boolean => {
    return true;
  },
);

describe("what a read asks for", () => {
  test("a reader who may read them all: the times, the kinds, the ids, and who the people are", () => {
    expect(EVERY_COLUMN).toEqual({
      createdAt: true,
      createdByActorType: true,
      createdByActorId: true,
      lastModifiedAt: true,
      lastModifiedByActorType: true,
      lastModifiedByActorId: true,
      createdByUser: { name: true, email: true },
      lastModifiedByUser: { name: true, email: true },
    });
  });

  test("only the columns the reader may read: the server refuses a whole read that names one they may not", () => {
    const allowed: Set<string> = new Set<string>([
      "createdAt",
      "lastModifiedAt",
      "lastModifiedByActorType",
    ]);

    expect(
      getRecordActivitySelect(new Monitor(), (column: string): boolean => {
        return allowed.has(column);
      }),
    ).toEqual({
      createdAt: true,
      lastModifiedAt: true,
      lastModifiedByActorType: true,
    });
  });

  test("a reader who may read none of them asks for nothing", () => {
    expect(
      getRecordActivitySelect(new Monitor(), (): boolean => {
        return false;
      }),
    ).toEqual({});
  });

  test("a model without a creator relation is not asked for one", () => {
    const select: Record<string, unknown> = getRecordActivitySelect(
      new EmailLog(),
      (): boolean => {
        return true;
      },
    );

    expect(select).not.toHaveProperty("createdByUser");
    expect(select["lastModifiedByUser"]).toEqual({ name: true, email: true });
  });

  test("a person is read for who they are, and nothing more", () => {
    expect(EVERY_COLUMN["createdByUser"]).toEqual({ name: true, email: true });
  });
});

describe("what the line says", () => {
  test("a person created it and a person modified it: their names", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({
        createdAt: CREATED_AT,
        createdByActorType: RecordActorType.User,
        createdByUser: person("Nawaz Dhandala"),
        lastModifiedAt: MODIFIED_AT,
        lastModifiedByActorType: RecordActorType.User,
        lastModifiedByUser: person("Simon Larsen"),
      }),
      EVERY_COLUMN,
    );

    expect(activity).toEqual({
      created: {
        at: CREATED_AT,
        by: { type: "User", personName: "Nawaz Dhandala" },
      },
      lastModified: {
        at: MODIFIED_AT,
        by: { type: "User", personName: "Simon Larsen" },
      },
    });
  });

  test("an API key created it and a workflow modified it: their kinds and ids, and no person", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({
        createdAt: CREATED_AT,
        createdByActorType: RecordActorType.ApiKey,
        createdByActorId: new ObjectID(API_KEY_ID),
        createdByUser: null,
        lastModifiedAt: MODIFIED_AT,
        lastModifiedByActorType: RecordActorType.Workflow,
        lastModifiedByActorId: new ObjectID(WORKFLOW_ID),
        lastModifiedByUser: null,
      }),
      EVERY_COLUMN,
    );

    expect(activity.created?.by).toEqual({
      type: "ApiKey",
      actorId: API_KEY_ID,
    });
    expect(activity.lastModified?.by).toEqual({
      type: "Workflow",
      actorId: WORKFLOW_ID,
    });
  });

  test("OneUptime created it: OneUptime, and never a person", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({
        createdAt: CREATED_AT,
        createdByActorType: RecordActorType.System,
        createdByUser: null,
      }),
      EVERY_COLUMN,
    );

    expect(activity.created).toEqual({
      at: CREATED_AT,
      by: { type: "System" },
    });
    expect(activity.lastModified).toBeNull();
  });

  test("an MCP client modified it, for its member: the client's authorization and the member", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({
        lastModifiedAt: MODIFIED_AT,
        lastModifiedByActorType: RecordActorType.McpClient,
        lastModifiedByActorId: new ObjectID(GRANT_ID),
        lastModifiedByUser: person("Simon Larsen"),
      }),
      EVERY_COLUMN,
    );

    expect(activity.lastModified?.by).toEqual({
      type: "McpClient",
      actorId: GRANT_ID,
      personName: "Simon Larsen",
    });
  });

  test("a person with no name is named by their email", () => {
    expect(getPersonName(person(null, "ops@example.com"))).toBe(
      "ops@example.com",
    );
    expect(getPersonName(person("  "))).toBe("");
    expect(
      getPersonName({ name: { _type: "Name", value: "Ada Lovelace" } }),
    ).toBe("Ada Lovelace");
    expect(getPersonName(null)).toBe("");
    expect(getPersonName("Ada")).toBe("");
  });

  test("a person the read asked for and did not find is no longer in OneUptime", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({
        lastModifiedAt: MODIFIED_AT,
        lastModifiedByActorType: RecordActorType.User,
        lastModifiedByUser: null,
      }),
      EVERY_COLUMN,
    );

    expect(activity.lastModified?.by).toEqual({
      type: "User",
      isPersonGone: true,
    });
  });

  test("a person the read did not ask for is not named, and never read as gone", () => {
    const withoutPeople: Record<string, unknown> = { ...EVERY_COLUMN };
    delete withoutPeople["createdByUser"];
    delete withoutPeople["lastModifiedByUser"];

    const activity: RecordActivity = readRecordActivity(
      monitor({
        createdAt: CREATED_AT,
        createdByActorType: RecordActorType.User,
        lastModifiedAt: MODIFIED_AT,
        lastModifiedByActorType: RecordActorType.MasterAdmin,
      }),
      withoutPeople as never,
    );

    // When, but not who: nobody is named who the reader may not read.
    expect(activity.created).toEqual({ at: CREATED_AT, by: null });
    // A server admin's kind is no person's name.
    expect(activity.lastModified?.by).toEqual({ type: "MasterAdmin" });
  });

  test("a record from before these were kept names its creator through the creator alone", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({
        createdAt: CREATED_AT,
        createdByUser: person("Nawaz Dhandala"),
      }),
      EVERY_COLUMN,
    );

    expect(activity.created?.by).toEqual({
      type: "User",
      personName: "Nawaz Dhandala",
    });
    expect(activity.lastModified).toBeNull();
  });

  test("a record from before these were kept, created by an API key, says only when", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({ createdAt: CREATED_AT, createdByUser: null }),
      EVERY_COLUMN,
    );

    expect(activity).toEqual({
      created: { at: CREATED_AT, by: null },
      lastModified: null,
    });
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "a monitor"],
    ["a record with nothing read", new Monitor()],
  ])("%s says nothing", (_name: string, item: unknown) => {
    expect(readRecordActivity(item, EVERY_COLUMN)).toEqual({
      created: null,
      lastModified: null,
    });
  });

  test("a kind that is no kind is read as nobody, and a time that is no time as never", () => {
    const activity: RecordActivity = readRecordActivity(
      monitor({
        createdByActorType: "Robot",
        lastModifiedAt: "not a date",
        lastModifiedByActorType: RecordActorType.ApiKey,
      }),
      EVERY_COLUMN,
    );

    expect(activity).toEqual({ created: null, lastModified: null });
  });

  test("a record read as JSON says the same", () => {
    const activity: RecordActivity = readRecordActivity(
      {
        createdAt: { _type: "DateTime", value: CREATED_AT.toISOString() },
        createdByActorType: "ApiKey",
        createdByActorId: { _type: "ObjectID", value: API_KEY_ID },
        lastModifiedAt: MODIFIED_AT.toISOString(),
        lastModifiedByActorType: "User",
        lastModifiedByUser: { name: "Simon Larsen" },
      },
      EVERY_COLUMN,
    );

    expect(activity.created).toEqual({
      at: CREATED_AT,
      by: { type: "ApiKey", actorId: API_KEY_ID },
    });
    expect(activity.lastModified).toEqual({
      at: MODIFIED_AT,
      by: { type: "User", personName: "Simon Larsen" },
    });
  });
});

describe("the names of the keys and workflows it names", () => {
  const activity: RecordActivity = {
    created: {
      at: CREATED_AT,
      by: { type: RecordActorType.ApiKey, actorId: API_KEY_ID },
    },
    lastModified: {
      at: MODIFIED_AT,
      by: { type: RecordActorType.ApiKey, actorId: API_KEY_ID },
    },
  };

  test("are each asked for once, by kind", () => {
    expect(getNamedActorIds(activity, RecordActorType.ApiKey)).toEqual([
      API_KEY_ID,
    ]);
    expect(getNamedActorIds(activity, RecordActorType.Workflow)).toEqual([]);
    expect(getNamedActorIds(null, RecordActorType.ApiKey)).toEqual([]);
  });

  test("are put beside each id once read, and nowhere else", () => {
    const named: RecordActivity = withActorNames(
      activity,
      new Map([[API_KEY_ID, "Terraform"]]),
    );

    expect(named.created?.by?.actorName).toBe("Terraform");
    expect(named.lastModified?.by?.actorName).toBe("Terraform");
    expect(activity.created?.by?.actorName).toBeUndefined();

    const notNamed: RecordActivity = withActorNames(activity, new Map());
    expect(notNamed.created?.by?.actorName).toBeUndefined();
  });

  test("a model's record line asks the base model's columns of every model", () => {
    const select: Record<string, unknown> = getRecordActivitySelect(
      new DatabaseBaseModel(),
      (): boolean => {
        return true;
      },
    );

    expect(Object.keys(select).sort()).toEqual(
      [
        "createdAt",
        "createdByActorId",
        "createdByActorType",
        "lastModifiedAt",
        "lastModifiedByActorId",
        "lastModifiedByActorType",
        "lastModifiedByUser",
      ].sort(),
    );
  });
});
