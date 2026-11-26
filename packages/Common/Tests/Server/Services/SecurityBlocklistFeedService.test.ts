import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import SecurityBlocklistFeed from "../../../Models/DatabaseModels/SecurityBlocklistFeed";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityBlocklistFeedService, {
  MadeSecurityBlocklistFeedSecret,
  SECRET_WRITTEN_HERE_MESSAGE,
  SecurityBlocklistFeedSecretMatch,
} from "../../../Server/Services/SecurityBlocklistFeedService";
import FindBy from "../../../Server/Types/Database/FindBy";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS,
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedFirewall,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";

/*
 * A PROJECT'S BLOCKLIST FEEDS AND THEIR SECRETS (#10345), through the real
 * create and update pipeline and its permission checks, with the table in
 * memory.
 *
 * Pinned: who may make, change, rotate and revoke a feed; that a feed's
 * secret is OneUptime's to make, answered once and kept only as its hash
 * with its hint; that nobody writes or reads a secret's columns through the
 * API; that a rotation keeps the secret it replaced working for a day and a
 * revocation ends both; what a new feed is named and serves when nobody
 * says; and that a source allowlist is kept the way addresses are.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f01",
);
const NOW: Date = new Date("2026-11-21T10:00:00.000Z");

const MANAGERS: Array<[string, Permission]> = [
  ["Project Owner", Permission.ProjectOwner],
  ["Project Admin", Permission.ProjectAdmin],
  ["Security Admin", Permission.SecurityAdmin],
];

const READERS_ONLY: Array<[string, Permission]> = [
  ["Security Member", Permission.SecurityMember],
  ["Security Viewer", Permission.SecurityViewer],
];

let table: InMemoryTable;
let reconcileSpy: ReturnType<typeof jest.spyOn>;

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function makeFeed(
  data: Partial<Record<string, unknown>> = {},
  permission: Permission = Permission.SecurityAdmin,
): Promise<SecurityBlocklistFeed> {
  const feed: SecurityBlocklistFeed = new SecurityBlocklistFeed();
  feed.projectId = PROJECT_ID;
  feed.firewall = SecurityBlocklistFeedFirewall.PaloAlto;
  Object.assign(feed, data);

  return await SecurityBlocklistFeedService.create({
    data: feed,
    props: caller(permission),
  });
}

function stored(id: ObjectID | string): StoredRow {
  return table.get(id)!;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

beforeEach(() => {
  everyServerProductIsOn();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  table = useInMemoryTable(
    SecurityBlocklistFeedService as unknown as DatabaseService<BaseModel>,
    [],
  );

  reconcileSpy = jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("making a feed", () => {
  test.each(MANAGERS)(
    "a %s makes one; its secret is answered once, and kept only as its hash with its hint",
    async (_who: string, permission: Permission) => {
      const created: SecurityBlocklistFeed = await makeFeed({}, permission);

      // The one answer that holds the secret.
      const secret: string = text(created.secret);
      expect(secret).toMatch(/^[0-9a-f]{64}$/);

      const row: StoredRow = stored(created.id!);
      expect(text(row["secret"])).toBe(
        SecurityBlocklistFeedService.hashSecret(secret),
      );
      expect(text(row["secret"])).not.toContain(secret);
      expect(row["secretHint"]).toBe(secret.slice(-4));
      expect(row["secretMadeAt"]).toEqual(NOW);
      expect(row["previousSecret"] ?? null).toBeNull();

      // A new destination: the blocklist is reconciled at once.
      expect(reconcileSpy).toHaveBeenCalledWith(PROJECT_ID);
    },
  );

  test.each(READERS_ONLY)(
    "a %s may not",
    async (_who: string, permission: Permission) => {
      await expect(makeFeed({}, permission)).rejects.toThrow(
        "You do not have permissions to create Blocklist Feed",
      );
      expect(table.rows).toEqual([]);
    },
  );

  test("two feeds never share a secret", async () => {
    const first: SecurityBlocklistFeed = await makeFeed();
    const second: SecurityBlocklistFeed = await makeFeed();

    expect(text(first.secret)).not.toBe(text(second.secret));
  });

  test("nobody chooses a feed's secret: one sent with the create is refused", async () => {
    await expect(
      makeFeed({ secret: new HashedString("a".repeat(64)) }),
    ).rejects.toThrow();
    expect(table.rows).toEqual([]);
  });

  test("a feed nobody names is named after its firewall, and serves what its maker documents", async () => {
    const fortiGate: SecurityBlocklistFeed = await makeFeed({
      firewall: SecurityBlocklistFeedFirewall.FortiGate,
    });
    expect(stored(fortiGate.id!)["name"]).toBe("FortiGate feed");
    expect(stored(fortiGate.id!)["family"]).toBe(
      SecurityBlocklistFeedFamily.Both,
    );

    const checkPoint: SecurityBlocklistFeed = await makeFeed({
      firewall: SecurityBlocklistFeedFirewall.CheckPoint,
      name: "  ",
    });
    expect(stored(checkPoint.id!)["name"]).toBe("Check Point feed");
    expect(stored(checkPoint.id!)["family"]).toBe(
      SecurityBlocklistFeedFamily.IPv4,
    );

    const named: SecurityBlocklistFeed = await makeFeed({
      firewall: SecurityBlocklistFeedFirewall.CheckPoint,
      name: "  Edge gateway ",
      family: SecurityBlocklistFeedFamily.Both,
    });
    expect(stored(named.id!)["name"]).toBe("Edge gateway");
    expect(stored(named.id!)["family"]).toBe(SecurityBlocklistFeedFamily.Both);
  });

  test("a source allowlist is kept the way addresses are, one a line; one that is not addresses is refused", async () => {
    const created: SecurityBlocklistFeed = await makeFeed({
      allowedSourceAddresses: "203.0.113.7, 198.51.100.77/24\n203.0.113.7",
    });

    expect(stored(created.id!)["allowedSourceAddresses"]).toBe(
      "203.0.113.7\n198.51.100.0/24",
    );

    await expect(
      makeFeed({ allowedSourceAddresses: "firewall.example.com" }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("changing a feed", () => {
  test("a Security Admin renames it and changes its allowlist", async () => {
    const created: SecurityBlocklistFeed = await makeFeed();

    await SecurityBlocklistFeedService.updateOneById({
      id: created.id!,
      data: {
        name: " Edge firewall ",
        allowedSourceAddresses: "2001:DB8::1",
      },
      props: caller(Permission.SecurityAdmin),
    });

    expect(stored(created.id!)["name"]).toBe("Edge firewall");
    expect(stored(created.id!)["allowedSourceAddresses"]).toBe("2001:db8::1");
  });

  test.each(MANAGERS)(
    "not even a %s writes a secret's columns through the API",
    async (_who: string, permission: Permission) => {
      const created: SecurityBlocklistFeed = await makeFeed();
      const before: string = text(stored(created.id!)["secret"]);

      for (const data of [
        { secret: new HashedString("b".repeat(64)) },
        { secret: null },
        { previousSecretExpiresAt: new Date(NOW.getTime() + 1000) },
        { secretHint: "abcd" },
        { revokedAt: NOW },
      ]) {
        await expect(
          SecurityBlocklistFeedService.updateOneById({
            id: created.id!,
            data: data as never,
            props: caller(permission),
          }),
        ).rejects.toThrow(SECRET_WRITTEN_HERE_MESSAGE);
      }

      expect(text(stored(created.id!)["secret"])).toBe(before);
    },
  );
});

describe("rotating and revoking a feed's secret", () => {
  test.each(MANAGERS)(
    "a %s rotates it: the new one is answered once, and the old one works for a day",
    async (_who: string, permission: Permission) => {
      const created: SecurityBlocklistFeed = await makeFeed();
      const oldSecret: string = text(created.secret);

      const made: MadeSecurityBlocklistFeedSecret =
        await SecurityBlocklistFeedService.rotateSecret({
          id: created.id!,
          props: caller(permission),
        });

      expect(made.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(made.secret).not.toBe(oldSecret);
      expect(made.secretHint).toBe(made.secret.slice(-4));
      expect(made.previousSecretExpiresAt).toEqual(
        new Date(NOW.getTime() + SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS),
      );

      const row: StoredRow = stored(created.id!);
      expect(text(row["secret"])).toBe(
        SecurityBlocklistFeedService.hashSecret(made.secret),
      );
      expect(text(row["previousSecret"])).toBe(
        SecurityBlocklistFeedService.hashSecret(oldSecret),
      );
      expect(row["secretHint"]).toBe(made.secretHint);

      const feed: Pick<
        SecurityBlocklistFeed,
        "secret" | "previousSecret" | "previousSecretExpiresAt"
      > = {
        secret: row["secret"] as HashedString,
        previousSecret: row["previousSecret"] as HashedString,
        previousSecretExpiresAt: row["previousSecretExpiresAt"] as Date,
      };

      expect(
        SecurityBlocklistFeedService.matchSecret({
          feed,
          presented: made.secret,
          now: NOW,
        }),
      ).toBe(SecurityBlocklistFeedSecretMatch.Current);
      expect(
        SecurityBlocklistFeedService.matchSecret({
          feed,
          presented: oldSecret,
          now: NOW,
        }),
      ).toBe(SecurityBlocklistFeedSecretMatch.Previous);
      expect(
        SecurityBlocklistFeedService.matchSecret({
          feed,
          presented: oldSecret,
          now: made.previousSecretExpiresAt!,
        }),
      ).toBeNull();
    },
  );

  test.each(READERS_ONLY)(
    "a %s may not rotate it, nor revoke it",
    async (_who: string, permission: Permission) => {
      const created: SecurityBlocklistFeed = await makeFeed();
      const before: string = text(stored(created.id!)["secret"]);

      await expect(
        SecurityBlocklistFeedService.rotateSecret({
          id: created.id!,
          props: caller(permission),
        }),
      ).rejects.toThrow();
      await expect(
        SecurityBlocklistFeedService.revokeSecret({
          id: created.id!,
          props: caller(permission),
        }),
      ).rejects.toThrow();

      expect(text(stored(created.id!)["secret"])).toBe(before);
    },
  );

  test("revoking ends the secret and the one before at once; a rotation then makes one with none before it", async () => {
    const created: SecurityBlocklistFeed = await makeFeed();
    const first: string = text(created.secret);
    const rotated: MadeSecurityBlocklistFeedSecret =
      await SecurityBlocklistFeedService.rotateSecret({
        id: created.id!,
        props: caller(Permission.SecurityAdmin),
      });

    await SecurityBlocklistFeedService.revokeSecret({
      id: created.id!,
      props: caller(Permission.SecurityAdmin),
    });

    const row: StoredRow = stored(created.id!);
    expect(row["secret"] ?? null).toBeNull();
    expect(row["previousSecret"] ?? null).toBeNull();
    expect(row["previousSecretExpiresAt"] ?? null).toBeNull();
    expect(row["secretHint"] ?? null).toBeNull();
    expect(row["revokedAt"]).toEqual(NOW);

    for (const presented of [first, rotated.secret]) {
      expect(
        SecurityBlocklistFeedService.matchSecret({
          feed: {
            secret: row["secret"] as HashedString,
            previousSecret: row["previousSecret"] as HashedString,
            previousSecretExpiresAt: row["previousSecretExpiresAt"] as Date,
          },
          presented,
          now: NOW,
        }),
      ).toBeNull();
    }

    const again: MadeSecurityBlocklistFeedSecret =
      await SecurityBlocklistFeedService.rotateSecret({
        id: created.id!,
        props: caller(Permission.SecurityAdmin),
      });

    expect(again.previousSecretExpiresAt).toBeNull();
    expect(stored(created.id!)["previousSecret"] ?? null).toBeNull();
    expect(stored(created.id!)["revokedAt"] ?? null).toBeNull();
  });

  test("a feed of another project is not one to rotate", async () => {
    const created: SecurityBlocklistFeed = await makeFeed();

    await expect(
      SecurityBlocklistFeedService.rotateSecret({
        id: created.id!,
        props: {
          ...customDomainCaller({
            permissions: [Permission.ProjectOwner],
            projectId: ObjectID.generate(),
          }),
          ...ON_HIGHEST_PLAN,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("matching a presented secret", () => {
  const CURRENT: string = "c".repeat(64);
  const PREVIOUS: string = "d".repeat(64);

  function feed(
    expiresAt: Date | null,
  ): Pick<
    SecurityBlocklistFeed,
    "secret" | "previousSecret" | "previousSecretExpiresAt"
  > {
    return {
      secret: new HashedString(
        SecurityBlocklistFeedService.hashSecret(CURRENT),
        true,
      ),
      previousSecret: new HashedString(
        SecurityBlocklistFeedService.hashSecret(PREVIOUS),
        true,
      ),
      previousSecretExpiresAt: expiresAt as Date,
    };
  }

  test("the current secret, the previous one while its day lasts, and nothing else", () => {
    const inGrace: Date = new Date(NOW.getTime() + 1000);

    expect(
      SecurityBlocklistFeedService.matchSecret({
        feed: feed(inGrace),
        presented: CURRENT,
        now: NOW,
      }),
    ).toBe(SecurityBlocklistFeedSecretMatch.Current);
    expect(
      SecurityBlocklistFeedService.matchSecret({
        feed: feed(inGrace),
        presented: ` ${PREVIOUS} `,
        now: NOW,
      }),
    ).toBe(SecurityBlocklistFeedSecretMatch.Previous);
    expect(
      SecurityBlocklistFeedService.matchSecret({
        feed: feed(NOW),
        presented: PREVIOUS,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      SecurityBlocklistFeedService.matchSecret({
        feed: feed(null),
        presented: PREVIOUS,
        now: NOW,
      }),
    ).toBeNull();

    for (const presented of [
      "e".repeat(64),
      CURRENT.toUpperCase(),
      CURRENT.slice(1),
      SecurityBlocklistFeedService.hashSecret(CURRENT),
      "",
      null,
      undefined,
    ]) {
      expect(
        SecurityBlocklistFeedService.matchSecret({
          feed: feed(inGrace),
          presented,
          now: NOW,
        }),
      ).toBeNull();
    }
  });
});

describe("reading a feed", () => {
  test("what only OneUptime reads is dropped from what anyone else selects", () => {
    const findBy: FindBy<SecurityBlocklistFeed> = {
      query: {},
      select: {
        name: true,
        secret: true,
        previousSecret: true,
        servedValues: true,
        servedBodyMd5: true,
        secretHint: true,
      },
      props: caller(Permission.ProjectOwner),
    } as unknown as FindBy<SecurityBlocklistFeed>;

    expect(
      Object.keys(
        SecurityBlocklistFeedService.dropServerOnlyColumns(findBy).select!,
      ),
    ).toEqual(["name", "secretHint"]);

    const asOneUptime: FindBy<SecurityBlocklistFeed> = {
      ...findBy,
      props: { isRoot: true },
    };

    expect(
      SecurityBlocklistFeedService.dropServerOnlyColumns(asOneUptime),
    ).toBe(asOneUptime);
  });

  test("a reader's read never asks the database for its secret's hash, nor the one before", async () => {
    const created: SecurityBlocklistFeed = await makeFeed();
    table.repository.find.mockClear();

    const read: SecurityBlocklistFeed | null =
      await SecurityBlocklistFeedService.findOneById({
        id: created.id!,
        select: { _id: true, name: true, secret: true, previousSecret: true },
        props: caller(Permission.SecurityViewer),
      });

    expect(read?.name).toBe("Palo Alto Networks feed");

    const asked: Array<string> = table.repository.find.mock.calls.flatMap(
      (call: Array<unknown>): Array<string> => {
        const select: unknown = (call[0] as { select?: unknown })?.select;
        return select && typeof select === "object" ? Object.keys(select) : [];
      },
    );

    expect(asked).toContain("name");
    expect(asked).not.toContain("secret");
    expect(asked).not.toContain("previousSecret");
  });
});

describe("deleting a feed", () => {
  test("its URL stops working, and its blocks' rows are told at once", async () => {
    const created: SecurityBlocklistFeed = await makeFeed();
    reconcileSpy.mockClear();

    await SecurityBlocklistFeedService.deleteOneById({
      id: created.id!,
      props: caller(Permission.SecurityAdmin),
    });

    expect(reconcileSpy).toHaveBeenCalledWith(PROJECT_ID);
  });
});
