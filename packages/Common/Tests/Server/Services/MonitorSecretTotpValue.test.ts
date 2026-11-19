import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import MonitorSecretService from "../../../Server/Services/MonitorSecretService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorSecretAccess from "../../../Types/Monitor/MonitorSecretAccess";
import MonitorSecretType from "../../../Types/Monitor/MonitorSecretType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * A one-time code (TOTP) monitor secret's value, as MonitorSecretService
 * takes it (issue #9703): read as a setup key or an otpauth://totp link
 * when the secret is created and whenever its value is replaced, stored in
 * one canonical form, and refused - with a sentence that says what is
 * wrong - when no code could be made from it. A Text secret's value is
 * stored as written, as it always was, and no secret changes its type.
 */

const PROJECT_ID: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const TOTP_SECRET_ID: string = "70700000-0000-4000-8000-000000000001";
const TEXT_SECRET_ID: string = "7e470000-0000-4000-8000-000000000002";

const SEED: string = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const STORED_SEED: string = `otpauth://totp/OneUptime?secret=${SEED}&algorithm=SHA1&digits=6&period=30`;

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("0ee10000-0000-4000-8000-000000000001"),
  tenantId: new ObjectID(PROJECT_ID),
};

type OnBeforeCreate = (
  createBy: CreateBy<MonitorSecret>,
) => Promise<OnCreate<MonitorSecret>>;

type OnBeforeUpdate = (
  updateBy: UpdateBy<MonitorSecret>,
) => Promise<OnUpdate<MonitorSecret>>;

interface StoredRow {
  id: string;
  secretType: MonitorSecretType | undefined;
}

let storedRows: Array<StoredRow> = [];

/*
 * The ids an `_id` condition names: a plain id, QueryHelper.any's Raw
 * operator (its ids are its parameters), or the And the update's hold
 * wraps such conditions in (the ids every part names).
 */
function readIds(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  const operator: {
    type?: string;
    value?: unknown;
    objectLiteralParameters?: Dictionary<unknown>;
  } = value as never;

  if (operator.type === "and" && Array.isArray(operator.value)) {
    const parts: Array<Array<string>> = (operator.value as Array<unknown>).map(
      readIds,
    );

    return (parts[0] || []).filter((id: string): boolean => {
      return parts.every((part: Array<string>): boolean => {
        return part.includes(id);
      });
    });
  }

  if (operator.objectLiteralParameters) {
    return (
      (Object.values(operator.objectLiteralParameters)[0] as
        | Array<string>
        | undefined) || []
    );
  }

  return [String(value)];
}

beforeEach(() => {
  storedRows = [
    { id: TOTP_SECRET_ID, secretType: MonitorSecretType.TOTP },
    { id: TEXT_SECRET_ID, secretType: MonitorSecretType.Text },
  ];

  stubRowsCallerMayWriteLikeFindBy(
    MonitorSecretService,
    jest.spyOn(MonitorSecretService, "findBy").mockImplementation(((call: {
      query: Dictionary<unknown>;
    }): Promise<Array<MonitorSecret>> => {
      const ids: Array<string> = readIds(call.query["_id"]);

      return Promise.resolve(
        storedRows
          .filter((row: StoredRow): boolean => {
            return ids.length === 0 || ids.includes(row.id);
          })
          .map((row: StoredRow): MonitorSecret => {
            const secret: MonitorSecret = new MonitorSecret(
              new ObjectID(row.id),
            );
            secret.projectId = new ObjectID(PROJECT_ID);
            secret.secretType = row.secretType;
            return secret;
          }),
      );
    }) as never),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function create(data: Dictionary<unknown>): Promise<MonitorSecret> {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = "LoginCode";
  secret.projectId = new ObjectID(PROJECT_ID);
  secret.monitorAccess = MonitorSecretAccess.AllMonitors;

  for (const key of Object.keys(data)) {
    (secret as unknown as Dictionary<unknown>)[key] = data[key];
  }

  const onCreate: OnCreate<MonitorSecret> = await (
    MonitorSecretService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data: secret, props: MEMBER_PROPS });

  return onCreate.createBy.data;
}

async function update(
  data: Dictionary<unknown>,
  ids: Array<string> = [TOTP_SECRET_ID],
): Promise<Dictionary<unknown>> {
  const onUpdate: OnUpdate<MonitorSecret> = await (
    MonitorSecretService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: {
      _id: ids.length === 1 ? ids[0] : (QueryHelper.any(ids) as never),
    },
    data: data as UpdateBy<MonitorSecret>["data"],
    props: MEMBER_PROPS,
    limit: ids.length,
    skip: 0,
  });

  return onUpdate.updateBy.data as unknown as Dictionary<unknown>;
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the write to be refused.");
}

describe("creating a secret", () => {
  test("is Text when no type is given, its value stored as written", async () => {
    const created: MonitorSecret = await create({ secretValue: "sk_live_1" });

    expect(created.secretType).toBe(MonitorSecretType.Text);
    expect(created.secretValue).toBe("sk_live_1");
  });

  test("is Text when the type is null, as a default-valued column reads it", async () => {
    const created: MonitorSecret = await create({
      secretType: null,
      secretValue: "x",
    });

    expect(created.secretType).toBe(MonitorSecretType.Text);
  });

  test("keeps a Text value that looks like a seed exactly as written", async () => {
    const created: MonitorSecret = await create({
      secretType: MonitorSecretType.Text,
      secretValue: " gezd gnbv ",
    });

    expect(created.secretValue).toBe(" gezd gnbv ");
  });

  test("stores a one-time code secret's setup key in the canonical form", async () => {
    const created: MonitorSecret = await create({
      secretType: MonitorSecretType.TOTP,
      secretValue: "gezd gnbv gy3t qojq gezd gnbv gy3t qojq",
    });

    expect(created.secretType).toBe(MonitorSecretType.TOTP);
    expect(created.secretValue).toBe(STORED_SEED);
  });

  test("keeps a link's algorithm, digits and period, and drops its label and issuer", async () => {
    const created: MonitorSecret = await create({
      secretType: MonitorSecretType.TOTP,
      secretValue: `otpauth://totp/ACME:ops@example.com?issuer=ACME&secret=${SEED}&algorithm=SHA512&digits=8&period=60`,
    });

    expect(created.secretValue).toBe(
      `otpauth://totp/OneUptime?secret=${SEED}&algorithm=SHA512&digits=8&period=60`,
    );
    expect(created.secretValue).not.toContain("ACME");
  });

  test("refuses a setup key no code can be made from, saying why", async () => {
    expect(
      await refusal(
        create({
          secretType: MonitorSecretType.TOTP,
          secretValue: "GEZD GNBV GY3T QOJ0 1",
        }),
      ),
    ).toBe(
      "A setup key has only the letters A to Z and the digits 2 to 7, and this one has 0, 1. Check for a 0 that should be an O, or a 1 or 8 that should be an I or a B.",
    );
  });

  test("refuses a link a monitor cannot use, saying why", async () => {
    expect(
      await refusal(
        create({
          secretType: MonitorSecretType.TOTP,
          secretValue: `otpauth://hotp/a?secret=${SEED}&counter=0`,
        }),
      ),
    ).toBe(
      "This link is for counter-based codes (HOTP). A monitor needs a time-based link, which starts with otpauth://totp/.",
    );
    expect(
      await refusal(
        create({
          secretType: MonitorSecretType.TOTP,
          secretValue: `otpauth://totp/a?secret=${SEED}&digits=7`,
        }),
      ),
    ).toBe(
      "This link asks for codes of 7 digits. A monitor can make codes of 6 or 8 digits.",
    );
  });

  test("refuses a one-time code secret with no value", async () => {
    for (const secretValue of [undefined, "", "   "]) {
      expect(
        await refusal(
          create({ secretType: MonitorSecretType.TOTP, secretValue }),
        ),
      ).toBe(
        "Enter the setup key or the otpauth:// link from the site's two-factor setup.",
      );
    }
  });

  test("refuses a type that does not exist", async () => {
    expect(
      await refusal(create({ secretType: "Password", secretValue: "x" })),
    ).toBe("Secret type must be one of: Text, TOTP.");
    expect(
      await refusal(create({ secretType: "totp", secretValue: SEED })),
    ).toBe("Secret type must be one of: Text, TOTP.");
  });

  test("never says the seed in a refusal", async () => {
    const message: string = await refusal(
      create({
        secretType: MonitorSecretType.TOTP,
        secretValue: `otpauth://totp/a?secret=${SEED}&algorithm=MD5`,
      }),
    );

    expect(message).toBe(
      "This link asks for the MD5 algorithm. A monitor can make codes with SHA1, SHA256 or SHA512.",
    );
    expect(message).not.toContain(SEED);
  });
});

describe("replacing a secret's value", () => {
  test("reads a one-time code secret's new value and stores it canonically", async () => {
    const data: Dictionary<unknown> = await update({
      secretValue: `otpauth://totp/x?secret=${SEED.toLowerCase()}`,
    });

    expect(data).toEqual({ secretValue: STORED_SEED });
  });

  test("refuses a one-time code secret's new value that makes no code", async () => {
    expect(await refusal(update({ secretValue: "too-short" }))).toContain(
      "too short",
    );
    expect(await refusal(update({ secretValue: null }))).toBe(
      "Enter the setup key or the otpauth:// link from the site's two-factor setup.",
    );
  });

  test("stores a Text secret's new value as written", async () => {
    expect(
      await update({ secretValue: "rotated value" }, [TEXT_SECRET_ID]),
    ).toEqual({ secretValue: "rotated value" });
  });

  test("treats a secret stored before types existed as Text", async () => {
    storedRows = [{ id: TEXT_SECRET_ID, secretType: undefined }];

    expect(await update({ secretValue: "abc" }, [TEXT_SECRET_ID])).toEqual({
      secretValue: "abc",
    });
  });

  test("refuses one value for one-time code and Text secrets together", async () => {
    expect(
      await refusal(
        update({ secretValue: SEED }, [TOTP_SECRET_ID, TEXT_SECRET_ID]),
      ),
    ).toBe(
      "This update gives one value to one-time code (TOTP) secrets and other secrets together. Update the one-time code secrets on their own.",
    );
  });

  test("leaves the value alone when an update does not set it", async () => {
    expect(await update({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});

describe("a secret's type", () => {
  test("cannot be changed once the secret is created", async () => {
    for (const secretType of [
      MonitorSecretType.Text,
      MonitorSecretType.TOTP,
      null,
    ]) {
      expect(await refusal(update({ secretType }))).toBe(
        "A secret's type is set when the secret is created and cannot be changed. Create a new secret of the type you need instead.",
      );
    }
  });

  test("takes no update on its column, so the API says so too", () => {
    expect(
      new MonitorSecret().getColumnAccessControlFor("secretType")?.update,
    ).toEqual([]);
  });
});
