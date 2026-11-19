import RumApplicationService, {
  Service,
} from "../../../Server/Services/RumApplicationService";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The replay policy's page rules (#7502) and readable event properties
 * (#7501), as RumApplicationService holds them on every write, the API's
 * as well as the Replay Policy page's: each list is stored as the
 * recorders read it, and an entry that would not do what it says is
 * refused in words that name the setting - a Never record path that can
 * never match would be a page someone meant to keep out, recorded.
 *
 * Server writes only (isRoot), so the hooks run without a database: the
 * reference checks a person's write gets are not what this holds.
 */

interface ServiceHooks {
  onBeforeCreate: (createBy: unknown) => Promise<{ createBy: unknown }>;
  onBeforeUpdate: (updateBy: unknown) => Promise<{ updateBy: unknown }>;
}

const hooks: ServiceHooks = RumApplicationService as unknown as ServiceHooks;

const RECORD_ONLY: string = "sessionReplayRecordOnlyPages";
const NEVER_RECORD: string = "sessionReplayNeverRecordPages";
const READABLE: string = "sessionReplayReadableEventProperties";

function serverUpdate(data: Record<string, unknown>): unknown {
  return {
    query: { _id: ObjectID.generate().toString() },
    data: data,
    props: { isRoot: true },
  };
}

function newApplication(): RumApplication {
  const application: RumApplication = new RumApplication();
  application.name = "Storefront Web";
  application.appIdentifier = "storefront-web";
  application.projectId = ObjectID.generate();
  return application;
}

async function storedAfterUpdate(
  column: string,
  value: unknown,
): Promise<unknown> {
  const data: Record<string, unknown> = { [column]: value };
  await hooks.onBeforeUpdate(serverUpdate(data));
  return data[column];
}

async function refusalOf(column: string, value: unknown): Promise<string> {
  try {
    await storedAfterUpdate(column, value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error(`${column} = ${JSON.stringify(value)} was not refused`);
}

describe("page rules on a write", () => {
  test("are stored trimmed, each path once", async () => {
    expect(
      await storedAfterUpdate(NEVER_RECORD, [" /admin* ", "/admin*", "/a/*"]),
    ).toEqual(["/admin*", "/a/*"]);
    expect(
      await storedAfterUpdate(RECORD_ONLY, ["/checkout*", " /cart"]),
    ).toEqual(["/checkout*", "/cart"]);
  });

  test("cleared, are an empty list again", async () => {
    expect(await storedAfterUpdate(NEVER_RECORD, null)).toEqual([]);
    expect(await storedAfterUpdate(RECORD_ONLY, [])).toEqual([]);
  });

  test("a path that cannot match is refused, naming the setting and the path", async () => {
    expect(await refusalOf(NEVER_RECORD, ["admin"])).toBe(
      'Never record these pages: "admin" is not a page path. A page pattern starts with / (or with * to match the end of any path), such as /checkout/error.',
    );
    expect(await refusalOf(RECORD_ONLY, ["/checkout?step=2"])).toBe(
      'Record only these pages: "/checkout?step=2" is not a page path. Match the page\'s path only, without ? or #.',
    );
    expect(await refusalOf(NEVER_RECORD, "/admin")).toBe(
      'Never record these pages must be a list of page paths, such as ["/checkout*"].',
    );
  });

  test("a write that leaves them alone is not judged on them", async () => {
    const data: Record<string, unknown> = { name: "Renamed" };

    await hooks.onBeforeUpdate(serverUpdate(data));

    expect(data).toEqual({ name: "Renamed" });
  });

  test("are checked on a create too", async () => {
    const application: RumApplication = newApplication();
    application.sessionReplayNeverRecordPages = [" /admin* ", "/admin*"];

    await hooks.onBeforeCreate({
      data: application,
      props: { isRoot: true },
    });

    expect(application.sessionReplayNeverRecordPages).toEqual(["/admin*"]);

    const refused: RumApplication = newApplication();
    refused.sessionReplayRecordOnlyPages = ["checkout"];

    await expect(
      hooks.onBeforeCreate({ data: refused, props: { isRoot: true } }),
    ).rejects.toThrow(
      'Record only these pages: "checkout" is not a page path.',
    );
  });
});

describe("readable event properties on a write", () => {
  test("are stored as the recorders read them", async () => {
    expect(
      await storedAfterUpdate(READABLE, [" step ", "step", "setup", ""]),
    ).toEqual(["step", "setup"]);
  });

  test("cleared, are none again: every value masked under Mask all text", async () => {
    expect(await storedAfterUpdate(READABLE, null)).toEqual([]);
  });

  test("anything but a list of keys, or a key too long, is refused", async () => {
    expect(await refusalOf(READABLE, "step")).toBe(
      'Readable event properties must be a list of property keys, such as ["plan", "step"].',
    );
    expect(await refusalOf(READABLE, ["k".repeat(41)])).toContain(
      "a property key can be at most 40 characters",
    );
  });
});

describe("the check itself", () => {
  test("is the service's, run on every write path", () => {
    const data: Record<string, unknown> = {
      [RECORD_ONLY]: ["/checkout* "],
      [NEVER_RECORD]: undefined,
      [READABLE]: ["plan"],
    };

    Service.canonicalizeSessionReplayPrivacyLists(data);

    expect(data).toEqual({
      [RECORD_ONLY]: ["/checkout*"],
      [NEVER_RECORD]: undefined,
      [READABLE]: ["plan"],
    });
  });
});
