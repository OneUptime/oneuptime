/*
 * `jest` is the global (as in ServiceLevelObjectiveService.test.ts), not the
 * @jest/globals export: that export's SpiedFunction type does not accept what
 * jest.spyOn returns with this repo's jest-mock version.
 */
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of UserService - imports it.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import ServiceLevelObjectiveOwnerUser from "../../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import User from "../../../../Models/DatabaseModels/User";
import UserService from "../../../../Server/Services/UserService";
import SloFeedUtil from "../../../../Server/Utils/Slo/SloFeedUtil";
import URL from "../../../../Types/API/URL";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Contract under test: the server half of the SLO feed.
 *
 *   - The seeding flag is how the burn rate rule service tells OneUptime's two
 *     default rules apart from rules a person adds. It must be set exactly
 *     while seeding runs, for exactly that SLO, and must never stick - a flag
 *     left behind by a failed seed would silently hide every rule a user adds
 *     to that SLO afterwards.
 *
 *   - The acting user's link is built from a name that user controls, so it is
 *     escaped here rather than trusted like UserService.getUserMarkdownString.
 */

const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const USER_LINK: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/settings/users/${USER_ID.toString()}`;

function makeUser(fields: { name?: string; email?: string }): User {
  const user: User = new User(USER_ID);

  if (fields.name !== undefined) {
    user.name = new Name(fields.name);
  }

  if (fields.email !== undefined) {
    user.email = new Email(fields.email);
  }

  return user;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SloFeedUtil - default burn rate rule seeding flag", () => {
  test("is set for the SLO only while its seed runs", async () => {
    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(SLO_ID)).toBe(false);

    let seenDuringSeed: boolean = false;
    let otherSloSeenDuringSeed: boolean = true;

    const result: string =
      await SloFeedUtil.runWhileSeedingDefaultBurnRateRules({
        sloId: SLO_ID,
        seed: (): Promise<string> => {
          seenDuringSeed = SloFeedUtil.isSeedingDefaultBurnRateRules(
            new ObjectID(SLO_ID.toString()),
          );
          otherSloSeenDuringSeed =
            SloFeedUtil.isSeedingDefaultBurnRateRules(OTHER_SLO_ID);
          return Promise.resolve("seeded");
        },
      });

    expect(result).toBe("seeded");
    expect(seenDuringSeed).toBe(true);
    // A rule added to a different SLO at the same moment is still posted.
    expect(otherSloSeenDuringSeed).toBe(false);
    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(SLO_ID)).toBe(false);
  });

  test("never sticks after a seed that throws", async () => {
    await expect(
      SloFeedUtil.runWhileSeedingDefaultBurnRateRules({
        sloId: SLO_ID,
        seed: (): Promise<void> => {
          return Promise.reject(new Error("severity lookup failed"));
        },
      }),
    ).rejects.toThrow("severity lookup failed");

    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(SLO_ID)).toBe(false);
  });

  test("an overlapping seed of the same SLO cannot clear the flag early", async () => {
    let releaseOuter: () => void = (): void => {};
    const outerSeed: Promise<void> =
      SloFeedUtil.runWhileSeedingDefaultBurnRateRules({
        sloId: SLO_ID,
        seed: (): Promise<void> => {
          return new Promise<void>((resolve: () => void) => {
            releaseOuter = resolve;
          });
        },
      });

    await SloFeedUtil.runWhileSeedingDefaultBurnRateRules({
      sloId: SLO_ID,
      seed: (): Promise<void> => {
        return Promise.resolve();
      },
    });

    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(SLO_ID)).toBe(true);

    releaseOuter();
    await outerSeed;

    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(SLO_ID)).toBe(false);
  });

  test("a rule with no SLO id is never treated as seeded", () => {
    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(undefined)).toBe(false);
    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(null)).toBe(false);
  });
});

describe("SloFeedUtil - the acting user", () => {
  test("links the user by name", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(
        makeUser({ name: "Jane Doe", email: "jane@example.com" }),
      );
    jest
      .spyOn(UserService, "getUserLinkInDashboard")
      .mockResolvedValue(URL.fromString(USER_LINK));

    await expect(
      SloFeedUtil.getUserMarkdown({ userId: USER_ID, projectId: PROJECT_ID }),
    ).resolves.toBe(`[Jane Doe](${USER_LINK})`);
  });

  test("falls back to the email for a user who never set a name", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser({ email: "jane_doe@example.com" }));
    jest
      .spyOn(UserService, "getUserLinkInDashboard")
      .mockResolvedValue(URL.fromString(USER_LINK));

    await expect(
      SloFeedUtil.getUserMarkdown({ userId: USER_ID, projectId: PROJECT_ID }),
    ).resolves.toBe(`[jane\\_doe@example.com](${USER_LINK})`);
  });

  test("a user name cannot re-point the link or add an image", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(
      makeUser({
        name: "x](https://evil.example) ![p](https://t.example/p.png)",
      }),
    );
    jest
      .spyOn(UserService, "getUserLinkInDashboard")
      .mockResolvedValue(URL.fromString(USER_LINK));

    await expect(
      SloFeedUtil.getUserMarkdown({ userId: USER_ID, projectId: PROJECT_ID }),
    ).resolves.toBe(
      `[x\\]\\(https://evil.example\\) \\!\\[p\\]\\(https://t.example/p.png\\)](${USER_LINK})`,
    );
  });

  test("no user id means no lookup at all - never a query that matches any user", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(UserService, "findOneById");

    await expect(
      SloFeedUtil.getUserMarkdown({ userId: undefined, projectId: PROJECT_ID }),
    ).resolves.toBeNull();

    expect(findSpy).not.toHaveBeenCalled();
  });

  test("a user who no longer exists is null, so callers fall back to 'no user'", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null);

    await expect(
      SloFeedUtil.getUserMarkdown({ userId: USER_ID, projectId: PROJECT_ID }),
    ).resolves.toBeNull();
  });

  test("the display name is escaped, and empty for no user", () => {
    expect(SloFeedUtil.getUserDisplayName(makeUser({ name: "*Jane*" }))).toBe(
      "\\*Jane\\*",
    );
    expect(SloFeedUtil.getUserDisplayName(null)).toBe("");
    expect(SloFeedUtil.getUserDisplayName(makeUser({}))).toBe("");
  });
});

/*
 * onBeforeUpdate and onBeforeDelete both run before DatabaseService applies
 * the caller's permissions, so what a feed hook reads there - and what it
 * later describes - has to be narrowed by hand.
 */
describe("SloFeedUtil - reads made before permissions are applied", () => {
  const OTHER_PROJECT_ID: ObjectID = new ObjectID(
    "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b",
  );

  test("pins the caller's query to the caller's project, without touching the query itself", () => {
    const query: Record<string, unknown> = { _id: SLO_ID.toString() };

    expect(
      SloFeedUtil.getTenantPinnedQuery({ query: query, tenantId: PROJECT_ID }),
    ).toEqual({ _id: SLO_ID.toString(), projectId: PROJECT_ID });

    // A copy: DatabaseService still receives the caller's query as it came.
    expect(query).toEqual({ _id: SLO_ID.toString() });
  });

  test("a query naming another project is overridden, never trusted", () => {
    expect(
      SloFeedUtil.getTenantPinnedQuery({
        query: { _id: SLO_ID.toString(), projectId: OTHER_PROJECT_ID },
        tenantId: PROJECT_ID,
      }),
    ).toEqual({ _id: SLO_ID.toString(), projectId: PROJECT_ID });
  });

  test("without a tenant - a root automation - the query is used exactly as it is", () => {
    const query: Record<string, unknown> = { _id: SLO_ID.toString() };

    expect(
      SloFeedUtil.getTenantPinnedQuery({ query: query, tenantId: undefined }),
    ).toBe(query);
    expect(
      SloFeedUtil.getTenantPinnedQuery({ query: query, tenantId: null }),
    ).toBe(query);
  });
});

describe("SloFeedUtil - the rows a delete really removed", () => {
  const OWNER_ROW_ID: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );
  const OTHER_OWNER_ROW_ID: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );

  function ownerRow(id?: ObjectID): ServiceLevelObjectiveOwnerUser {
    const row: ServiceLevelObjectiveOwnerUser =
      new ServiceLevelObjectiveOwnerUser(id);
    row.serviceLevelObjectiveId = SLO_ID;
    row.projectId = PROJECT_ID;
    return row;
  }

  test("keeps only the rows whose ids the delete reports, in whatever case the ids arrive", () => {
    const removed: ServiceLevelObjectiveOwnerUser = ownerRow(OWNER_ROW_ID);
    const kept: ServiceLevelObjectiveOwnerUser = ownerRow(OTHER_OWNER_ROW_ID);

    const rows: Array<ServiceLevelObjectiveOwnerUser> =
      SloFeedUtil.getRowsActuallyDeleted({
        rows: [removed, kept],
        deletedIds: [new ObjectID(OWNER_ROW_ID.toString().toUpperCase())],
      });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(removed);
  });

  test("a delete that removed nothing describes nothing - e.g. one naming another project's row", () => {
    expect(
      SloFeedUtil.getRowsActuallyDeleted({
        rows: [ownerRow(OWNER_ROW_ID)],
        deletedIds: [],
      }),
    ).toEqual([]);
  });

  test("a row read without its id is never described", () => {
    expect(
      SloFeedUtil.getRowsActuallyDeleted({
        rows: [ownerRow()],
        deletedIds: [OWNER_ROW_ID],
      }),
    ).toEqual([]);
  });
});

describe("SloFeedUtil - monitor links", () => {
  test("points at the monitor inside its project", () => {
    expect(
      SloFeedUtil.getMonitorLinkInDashboard({
        dashboardUrl: URL.fromString("https://oneuptime.test/dashboard"),
        projectId: PROJECT_ID,
        monitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/monitors/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
  });
});
