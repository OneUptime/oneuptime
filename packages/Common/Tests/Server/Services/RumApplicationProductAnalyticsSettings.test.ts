import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS } from "../../../Types/Rum/ProductAnalyticsEvents";
import { describe, expect, test } from "@jest/globals";

/*
 * The two RumApplication settings product analytics events add (#6444,
 * part two), as RumApplicationService holds them on every write:
 *
 *  - isProductAnalyticsEnabled starts on for an application created from
 *    now on, unless the create says otherwise. The column default stays
 *    off, so every application that exists keeps sending nothing new
 *    (AddRumApplicationProductAnalyticsEventsMigration.test.ts).
 *  - productAnalyticsUserPropertyKeys is stored as the recorders read it:
 *    trimmed, no repeats, at most the trait cap. A value that is not a
 *    list is refused rather than stored and read as none.
 *
 * Server writes only (isRoot), so the hooks run without a database: the
 * reference checks a person's write gets are not what this holds.
 */

interface ServiceHooks {
  onBeforeCreate: (createBy: unknown) => Promise<{ createBy: unknown }>;
  onBeforeUpdate: (updateBy: unknown) => Promise<{ updateBy: unknown }>;
}

const hooks: ServiceHooks = RumApplicationService as unknown as ServiceHooks;

const KEYS: string = "productAnalyticsUserPropertyKeys";

function serverCreate(application: RumApplication): unknown {
  return {
    data: application,
    props: { isRoot: true },
  };
}

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

async function storedKeysAfterUpdate(value: unknown): Promise<unknown> {
  const data: Record<string, unknown> = { [KEYS]: value };
  await hooks.onBeforeUpdate(serverUpdate(data));
  return data[KEYS];
}

describe("a new RUM application's product analytics events", () => {
  test("start on when the create leaves them out", async () => {
    const application: RumApplication = newApplication();
    expect(application.isProductAnalyticsEnabled).toBeUndefined();

    await hooks.onBeforeCreate(serverCreate(application));

    expect(application.isProductAnalyticsEnabled).toBe(true);
  });

  test("stay off when the create turns them off", async () => {
    const application: RumApplication = newApplication();
    application.isProductAnalyticsEnabled = false;

    await hooks.onBeforeCreate(serverCreate(application));

    expect(application.isProductAnalyticsEnabled).toBe(false);
  });

  test("stay on when the create turns them on", async () => {
    const application: RumApplication = newApplication();
    application.isProductAnalyticsEnabled = true;

    await hooks.onBeforeCreate(serverCreate(application));

    expect(application.isProductAnalyticsEnabled).toBe(true);
  });

  test("are never turned on by an update: an application that exists keeps what it has", async () => {
    const data: Record<string, unknown> = { name: "Checkout" };

    await hooks.onBeforeUpdate(serverUpdate(data));

    expect(data).toEqual({ name: "Checkout" });
    expect(data).not.toHaveProperty("isProductAnalyticsEnabled");
  });

  test("a create that names no traits keeps none, and is not judged on them", async () => {
    const application: RumApplication = newApplication();

    await hooks.onBeforeCreate(serverCreate(application));

    expect(application.productAnalyticsUserPropertyKeys).toBeUndefined();
  });
});

describe("the identify() traits product analytics keeps", () => {
  test("a write that leaves them out is not judged on them", async () => {
    const data: Record<string, unknown> = { name: "Checkout" };

    await hooks.onBeforeUpdate(serverUpdate(data));

    expect(data).toEqual({ name: "Checkout" });
  });

  test("are stored trimmed, without repeats in any case, and without empty or non-text keys", async () => {
    expect(
      await storedKeysAfterUpdate([
        " plan ",
        "Plan",
        "company",
        "",
        "   ",
        7,
        null,
        { key: "role" },
        "role",
        "__proto__",
        "PLAN",
      ]),
    ).toEqual(["plan", "company", "role"]);
  });

  test("keep the case they were written in: a trait is matched as written", async () => {
    expect(await storedKeysAfterUpdate(["companySize", "Region"])).toEqual([
      "companySize",
      "Region",
    ]);
  });

  test("are cut to the trait key length", async () => {
    const maxKeyLength: number =
      PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeyLength;

    expect(await storedKeysAfterUpdate(["k".repeat(maxKeyLength + 5)])).toEqual(
      ["k".repeat(maxKeyLength)],
    );
  });

  test("keep at most the trait cap of 20, the first ones listed", async () => {
    expect(PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys).toBe(20);

    const listed: Array<string> = Array.from(
      { length: 25 },
      (_value: unknown, index: number): string => {
        return `trait${index}`;
      },
    );

    const stored: unknown = await storedKeysAfterUpdate(listed);

    expect(stored).toEqual(listed.slice(0, 20));
  });

  test("an empty list stays an empty list", async () => {
    expect(await storedKeysAfterUpdate([])).toEqual([]);
  });

  test("cleared (null) are stored as an empty list, which the column requires", async () => {
    expect(await storedKeysAfterUpdate(null)).toEqual([]);
  });

  test.each([
    ["a word", "plan"],
    ["an object", { plan: true }],
    ["a number", 5],
    ["a switch", true],
  ])(
    "are refused when they are %s rather than a list, with words that say so",
    async (_label: string, value: unknown) => {
      const refusal: unknown = await hooks
        .onBeforeUpdate(serverUpdate({ [KEYS]: value }))
        .then(
          (): unknown => {
            return null;
          },
          (error: unknown): unknown => {
            return error;
          },
        );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        "Product analytics user properties must be a list of trait keys.",
      );
    },
  );

  test("are judged the same way on a create", async () => {
    const application: RumApplication = newApplication();
    application.productAnalyticsUserPropertyKeys = [" plan ", "Plan", "role"];

    await hooks.onBeforeCreate(serverCreate(application));

    expect(application.productAnalyticsUserPropertyKeys).toEqual([
      "plan",
      "role",
    ]);
  });

  test("a create that sends them as something other than a list is refused", async () => {
    const application: RumApplication = newApplication();
    (application as unknown as Record<string, unknown>)[KEYS] = "plan";

    await expect(
      hooks.onBeforeCreate(serverCreate(application)),
    ).rejects.toThrow(
      "Product analytics user properties must be a list of trait keys.",
    );
  });
});

/*
 * How long product analytics keeps the application (issue #6626): one of
 * the choices the page offers, refused otherwise - stored as the default,
 * a value nobody chose would keep data longer, or shorter, than meant.
 */
describe("how long product analytics keeps an application", () => {
  const RETENTION: string = "productAnalyticsRetentionInMonths";

  async function storedRetentionAfterUpdate(value: unknown): Promise<unknown> {
    const data: Record<string, unknown> = { [RETENTION]: value };
    await hooks.onBeforeUpdate(serverUpdate(data));
    return data[RETENTION];
  }

  test("each of the choices is kept as it is", async () => {
    for (const months of [3, 6, 13, 25]) {
      expect(await storedRetentionAfterUpdate(months)).toBe(months);
    }
  });

  test("a write that leaves it out is not judged on it", async () => {
    const data: Record<string, unknown> = { name: "Storefront" };

    await hooks.onBeforeUpdate(serverUpdate(data));

    expect(RETENTION in data).toBe(false);
  });

  test("cleared (null), it goes back to the default 13 months", async () => {
    expect(await storedRetentionAfterUpdate(null)).toBe(13);
  });

  test("any other value is refused, with the choices named", async () => {
    for (const value of [0, 1, 12, 24, 26, 120, -6, 6.5, "6", true, [6]]) {
      await expect(storedRetentionAfterUpdate(value)).rejects.toThrow(
        BadDataException,
      );
    }

    await expect(storedRetentionAfterUpdate(12)).rejects.toThrow(
      "Product analytics can be kept for 3, 6, 13 or 25 months. Choose one of these.",
    );
  });

  test("is judged the same way on a create, and left to the column's default when unset", async () => {
    const chosen: RumApplication = newApplication();
    chosen.productAnalyticsRetentionInMonths = 6;
    await hooks.onBeforeCreate(serverCreate(chosen));
    expect(chosen.productAnalyticsRetentionInMonths).toBe(6);

    const unset: RumApplication = newApplication();
    await hooks.onBeforeCreate(serverCreate(unset));
    expect(unset.productAnalyticsRetentionInMonths).toBeUndefined();

    const wrong: RumApplication = newApplication();
    wrong.productAnalyticsRetentionInMonths = 7;
    await expect(hooks.onBeforeCreate(serverCreate(wrong))).rejects.toThrow(
      "Product analytics can be kept for 3, 6, 13 or 25 months.",
    );
  });

  test("the column defaults to 13 months, what every application kept before it could choose", () => {
    const column: {
      defaultValue?: unknown;
      type?: unknown;
      required?: boolean;
    } = new RumApplication().getTableColumnMetadata(RETENTION) as never;

    expect(column.defaultValue).toBe(13);
    expect(column.required).toBe(true);
  });
});
