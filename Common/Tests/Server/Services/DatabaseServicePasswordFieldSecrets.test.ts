import DatabaseService from "../../../Server/Services/DatabaseService";
import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import DataSourceService from "../../../Server/Services/DataSourceService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Encryption from "../../../Server/Utils/Encryption";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSource from "../../../Models/DatabaseModels/DataSource";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import User from "../../../Models/DatabaseModels/User";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import CryptoJS from "crypto-js";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

// node-postgres's own parameter serializer (an untyped internal module).
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const pgUtils: {
  prepareValue: (value: unknown) => unknown;
} = require("pg/lib/utils");
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

/*
 * github.com/OneUptime/oneuptime/issues/3807 — "ThreatIntel:PollThreatIntelFeeds
 * fails with Malformed UTF-8 data".
 *
 * BasicForm wraps every FormFieldSchemaType.Password value in a HashedString
 * before onSubmit, so ModelForm can post one straight at a hashed column
 * (User.password). The same field type also collects secrets that are
 * STORED rather than hashed: a TAXII feed's API token and basic-auth
 * password, a data source's credentials, a runbook's SSH password, a user
 * webhook's signing secret. Those columns reached the write path still
 * holding the HashedString:
 *
 *   - encrypt() saw an object and walked it like an encrypted JSON column,
 *     encrypting the HashedString's own `_value` field in place;
 *   - the Postgres driver serialized the object through toJSON(), so the
 *     column stored `{"_type":"HashedString","value":"U2FsdGVkX1..."}`
 *     rather than the ciphertext.
 *
 * Decrypting that envelope is not merely wrong, it is random: it carries no
 * OpenSSL salt, so crypto-js derives the key with a fresh random salt on
 * every attempt. Most polls decrypted to "" (and polled anonymously), and
 * roughly one in eight threw "Malformed UTF-8 data" out of findBy — failing
 * the whole job, for every feed in every project. Nothing about the token's
 * characters (the underscore in the report) mattered.
 *
 * No Postgres here. Each test drives the real service write and read paths
 * with the repository stubbed, and runs the captured value through the real
 * `pg` parameter serializer, so what is asserted is what the column holds.
 */

// The browser's JSON.stringify of a request body.
function sendOverTheWire<T>(body: T): T {
  return JSON.parse(JSON.stringify(body)) as T;
}

// What node-postgres binds for a value in the column: exactly what is stored.
function toStoredColumnValue(value: unknown): unknown {
  return pgUtils.prepareValue(value);
}

const OPENSSL_SALTED_PREFIX: string = "U2FsdGVkX1"; // base64("Salted__")

const TOKENS: Array<string> = [
  "opencti_api_token_with_underscores",
  "plain-token-without-an-underscore",
  "0b5f8c3e-8d29-4a57-b1e1-7fd0a1c5e0c2",
  "p@ss:wörd/with+base64=chars==",
];

function passwordFieldValue(value: string): HashedString {
  // Exactly what BasicForm does to a Password field before onSubmit.
  return new HashedString(value, false);
}

type StubbedRepository = {
  save: jest.Mock;
  update: jest.Mock;
  find: jest.Mock;
};

function stubRepository(service: DatabaseService<any>): StubbedRepository {
  const repository: StubbedRepository = {
    save: jest.fn((item: unknown) => {
      return Promise.resolve(item);
    }),
    update: jest.fn(() => {
      return Promise.resolve({ affected: 1 });
    }),
    find: jest.fn(() => {
      return Promise.resolve([]);
    }),
  };

  jest.spyOn(service, "getRepository").mockReturnValue(repository as never);

  return repository;
}

function stubSideEffects(service: DatabaseService<any>): void {
  // Workflow and realtime fan-out need a network; not what is tested here.
  jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(ModelPermission, "checkUpdatePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);
}

function storedSetValue(
  repository: StubbedRepository,
  column: string,
): unknown {
  expect(repository.update).toHaveBeenCalledTimes(1);
  const setClause: JSONObject = repository.update.mock
    .calls[0]![1] as JSONObject;
  return toStoredColumnValue(setClause[column]);
}

async function expectCipherTextOf(
  stored: unknown,
  plain: string,
): Promise<void> {
  expect(typeof stored).toBe("string");
  expect((stored as string).startsWith(OPENSSL_SALTED_PREFIX)).toBe(true);
  expect(await Encryption.decrypt(stored as string)).toBe(plain);
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7c1a3c1e-2c55-4c3e-9d8e-7f3b0a4d5e61",
);

function dashboardCreatedFeed(credentials: {
  apiToken?: HashedString;
  basicAuthUsername?: string;
  basicAuthPassword?: HashedString;
}): ThreatIntelFeed {
  // ModelForm: form values -> model -> serialized request body -> server.
  const formModel: ThreatIntelFeed = new ThreatIntelFeed();
  formModel.name = "Corporate OpenCTI";
  formModel.apiRootUrl = "https://taxii.example.com/api1/";
  formModel.collectionId = "91a7b528-80eb-42ed-a74d-c6fbd5a26116";
  formModel.isEnabled = true;
  formModel.pollIntervalInMinutes = 60;
  formModel.minimumConfidence = 0;
  formModel.shouldCreateAlert = true;
  formModel.shouldCreateIncident = false;
  formModel.shouldWriteDetectionFinding = true;

  if (credentials.apiToken) {
    formModel.apiToken = credentials.apiToken as unknown as string;
  }
  if (credentials.basicAuthUsername) {
    formModel.basicAuthUsername = credentials.basicAuthUsername;
  }
  if (credentials.basicAuthPassword) {
    formModel.basicAuthPassword =
      credentials.basicAuthPassword as unknown as string;
  }

  const requestBody: JSONObject = sendOverTheWire(
    BaseModel.toJSON(formModel, ThreatIntelFeed),
  );

  // BaseAPI.createItem.
  return BaseModel.fromJSON<ThreatIntelFeed>(
    requestBody,
    ThreatIntelFeed,
  ) as ThreatIntelFeed;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Issue #3807 — a Threat Intel feed secret typed into the dashboard reaches the poller intact", () => {
  test("the create request really does deliver the token to the service as a HashedString", () => {
    const feed: ThreatIntelFeed = dashboardCreatedFeed({
      apiToken: passwordFieldValue("opencti_api_token_with_underscores"),
    });

    // The precondition that made every other assertion here necessary.
    expect(feed.apiToken as unknown).toBeInstanceOf(HashedString);
  });

  test.each(TOKENS)(
    "creating a feed with API token %p stores a plain ciphertext of that token",
    async (token: string) => {
      const repository: StubbedRepository = stubRepository(
        ThreatIntelFeedService,
      );
      stubSideEffects(ThreatIntelFeedService);

      await ThreatIntelFeedService.create({
        data: dashboardCreatedFeed({ apiToken: passwordFieldValue(token) }),
        props: { isRoot: true, tenantId: PROJECT_ID },
      });

      expect(repository.save).toHaveBeenCalledTimes(1);
      const saved: ThreatIntelFeed = repository.save.mock
        .calls[0]![0] as ThreatIntelFeed;

      const stored: unknown = toStoredColumnValue(saved.apiToken);

      expect(stored).not.toContain("HashedString");
      await expectCipherTextOf(stored, token);
    },
  );

  test("creating a basic-auth feed stores a plain ciphertext of the password", async () => {
    const repository: StubbedRepository = stubRepository(
      ThreatIntelFeedService,
    );
    stubSideEffects(ThreatIntelFeedService);

    await ThreatIntelFeedService.create({
      data: dashboardCreatedFeed({
        basicAuthUsername: "taxii_reader",
        basicAuthPassword: passwordFieldValue("hunter2_with_underscore"),
      }),
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    const saved: ThreatIntelFeed = repository.save.mock
      .calls[0]![0] as ThreatIntelFeed;

    await expectCipherTextOf(
      toStoredColumnValue(saved.basicAuthPassword),
      "hunter2_with_underscore",
    );
    expect(toStoredColumnValue(saved.basicAuthUsername)).toBe("taxii_reader");
  });

  test("create hooks see the secret as the string the user typed", async () => {
    stubRepository(ThreatIntelFeedService);
    stubSideEffects(ThreatIntelFeedService);

    let tokenSeenByHook: unknown = undefined;

    const originalOnBeforeCreate: (...args: Array<unknown>) => unknown = (
      ThreatIntelFeedService as any
    ).onBeforeCreate.bind(ThreatIntelFeedService);

    jest
      .spyOn(ThreatIntelFeedService as any, "onBeforeCreate")
      .mockImplementation(((createBy: { data: ThreatIntelFeed }) => {
        tokenSeenByHook = createBy.data.apiToken;
        return originalOnBeforeCreate(createBy);
      }) as never);

    await ThreatIntelFeedService.create({
      data: dashboardCreatedFeed({
        apiToken: passwordFieldValue("opencti_api_token_with_underscores"),
      }),
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(tokenSeenByHook).toBe("opencti_api_token_with_underscores");
  });

  test.each(TOKENS)(
    "rotating the token with Update Credentials (%p) stores a plain ciphertext",
    async (token: string) => {
      const feedId: ObjectID = ObjectID.generate();
      const existing: ThreatIntelFeed = new ThreatIntelFeed();
      existing._id = feedId.toString();

      const repository: StubbedRepository = stubRepository(
        ThreatIntelFeedService,
      );
      stubSideEffects(ThreatIntelFeedService);
      jest
        .spyOn(ThreatIntelFeedService as any, "_findBy")
        .mockResolvedValue([existing] as never);

      // ThreatIntel.tsx Update Credentials -> ModelAPI.updateById.
      const requestBody: JSONObject = sendOverTheWire({
        apiToken: passwordFieldValue(token),
        basicAuthUsername: null,
        basicAuthPassword: null,
      } as unknown as JSONObject);

      // BaseAPI.updateItem.
      await ThreatIntelFeedService.updateOneById({
        id: feedId,
        data: JSONFunctions.deserialize(requestBody) as never,
        props: { isRoot: true },
      });

      await expectCipherTextOf(storedSetValue(repository, "apiToken"), token);
      expect(storedSetValue(repository, "basicAuthPassword")).toBeNull();
    },
  );

  test("the stored token decrypts on the poller's read, every time", async () => {
    const writeRepository: StubbedRepository = stubRepository(
      ThreatIntelFeedService,
    );
    stubSideEffects(ThreatIntelFeedService);

    await ThreatIntelFeedService.create({
      data: dashboardCreatedFeed({
        apiToken: passwordFieldValue("opencti_api_token_with_underscores"),
      }),
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    const saved: ThreatIntelFeed = writeRepository.save.mock
      .calls[0]![0] as ThreatIntelFeed;
    const stored: unknown = toStoredColumnValue(saved.apiToken);

    /*
     * The failure was probabilistic, so a single read proves little: the
     * broken envelope decrypted to "" most of the time and threw only
     * sometimes. Read it back repeatedly, through the poller's own select.
     */
    for (let attempt: number = 0; attempt < 25; attempt++) {
      jest.restoreAllMocks();

      const row: ThreatIntelFeed = new ThreatIntelFeed();
      row._id = ObjectID.generate().toString();
      row.apiToken = stored as string;

      const readRepository: StubbedRepository = stubRepository(
        ThreatIntelFeedService,
      );
      readRepository.find.mockResolvedValue([row] as never);

      const feeds: Array<ThreatIntelFeed> = await ThreatIntelFeedService.findBy(
        {
          query: { isEnabled: true },
          select: { _id: true, apiToken: true },
          skip: 0,
          limit: 10,
          props: { isRoot: true },
        },
      );

      expect(feeds[0]!.apiToken).toBe("opencti_api_token_with_underscores");
    }
  });
});

describe("rows stored in the HashedString envelope before the fix still decrypt", () => {
  async function legacyStoredValue(secret: string): Promise<string> {
    /*
     * Reproduces the pre-fix write exactly: encrypt() replaced the
     * HashedString's `_value` with the ciphertext, and the driver
     * serialized the object through toJSON().
     */
    const wrapped: HashedString = new HashedString(
      await Encryption.encrypt(secret),
    );
    return toStoredColumnValue(wrapped) as string;
  }

  async function readApiToken(stored: string): Promise<string | undefined> {
    const row: ThreatIntelFeed = new ThreatIntelFeed();
    row._id = ObjectID.generate().toString();
    row.apiToken = stored;

    const repository: StubbedRepository = stubRepository(
      ThreatIntelFeedService,
    );
    repository.find.mockResolvedValue([row] as never);

    const feeds: Array<ThreatIntelFeed> = await ThreatIntelFeedService.findBy({
      query: {},
      select: { _id: true, apiToken: true },
      skip: 0,
      limit: 10,
      props: { isRoot: true },
    });

    return feeds[0]!.apiToken;
  }

  test("the fixture is the shape the issue's feeds hold", async () => {
    const stored: string = await legacyStoredValue("tok");

    expect(
      stored.startsWith('{"_type":"HashedString","value":"U2FsdGVkX1'),
    ).toBe(true);
  });

  test.each(TOKENS)(
    "an enveloped ciphertext of %p decrypts to the token on every read",
    async (token: string) => {
      const stored: string = await legacyStoredValue(token);

      for (let attempt: number = 0; attempt < 25; attempt++) {
        expect(await readApiToken(stored)).toBe(token);
      }
    },
  );

  test("an ordinary ciphertext is decrypted exactly as before", async () => {
    const stored: string = await Encryption.encrypt("plain_ciphertext_token");

    expect(await readApiToken(stored)).toBe("plain_ciphertext_token");
  });

  test("only the HashedString envelope is unwrapped — other JSON-shaped values go to decrypt untouched", async () => {
    const decryptSpy: jest.SpyInstance = jest.spyOn(CryptoJS.AES, "decrypt");
    decryptSpy.mockReturnValue(CryptoJS.enc.Utf8.parse("stubbed") as never);

    const innerCipherText: string = await Encryption.encrypt("inner");

    const notEnvelopes: Array<string> = [
      JSON.stringify({ _type: "DateTime", value: innerCipherText }),
      JSON.stringify({ value: innerCipherText }),
      JSON.stringify({ _type: "HashedString", value: 42 }),
      '{"_type":"HashedString","value":"not closed',
    ];

    for (const stored of notEnvelopes) {
      decryptSpy.mockClear();
      await readApiToken(stored);
      expect(decryptSpy).toHaveBeenCalledTimes(1);
      expect(decryptSpy.mock.calls[0]![0]).toBe(stored);
    }

    decryptSpy.mockClear();
    await readApiToken(
      JSON.stringify({ _type: "HashedString", value: innerCipherText }),
    );
    expect(decryptSpy.mock.calls[0]![0]).toBe(innerCipherText);
  });
});

describe("the write path unwraps HashedString for every column that is not a hashed column", () => {
  test("a data source's credentials (Update Credentials modal) store plain ciphertexts", async () => {
    const dataSourceId: ObjectID = ObjectID.generate();
    const existing: DataSource = new DataSource();
    existing._id = dataSourceId.toString();

    const repository: StubbedRepository = stubRepository(DataSourceService);
    stubSideEffects(DataSourceService);
    jest
      .spyOn(DataSourceService as any, "_findBy")
      .mockResolvedValue([existing] as never);

    const requestBody: JSONObject = sendOverTheWire({
      password: passwordFieldValue("db_password_1"),
      apiToken: passwordFieldValue("grafana_api_token_2"),
    } as unknown as JSONObject);

    await DataSourceService.updateOneById({
      id: dataSourceId,
      data: JSONFunctions.deserialize(requestBody) as never,
      props: { isRoot: true },
    });

    await expectCipherTextOf(
      storedSetValue(repository, "password"),
      "db_password_1",
    );
    await expectCipherTextOf(
      storedSetValue(repository, "apiToken"),
      "grafana_api_token_2",
    );
  });

  test("an unencrypted column (a webhook signing secret) stores the secret itself, not the envelope", async () => {
    const webhookId: ObjectID = ObjectID.generate();
    const existing: UserWebhook = new UserWebhook();
    existing._id = webhookId.toString();

    const repository: StubbedRepository = stubRepository(UserWebhookService);
    stubSideEffects(UserWebhookService);
    jest
      .spyOn(UserWebhookService as any, "_findBy")
      .mockResolvedValue([existing] as never);

    const requestBody: JSONObject = sendOverTheWire({
      secret: passwordFieldValue("shared_signing_secret"),
    } as unknown as JSONObject);

    await UserWebhookService.updateOneById({
      id: webhookId,
      data: JSONFunctions.deserialize(requestBody) as never,
      props: { isRoot: true },
    });

    // HMAC signatures are computed with this value; the envelope was the wrong key.
    expect(storedSetValue(repository, "secret")).toBe("shared_signing_secret");
  });

  test("every encrypted column in every model stores a plain ciphertext when handed a HashedString", async () => {
    const encryptedColumnsChecked: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();

      for (const column of model.getEncryptedColumns().columns) {
        jest.restoreAllMocks();

        const service: DatabaseService<BaseModel> =
          new DatabaseService<BaseModel>(modelType as never);

        const existing: BaseModel = new modelType();
        existing._id = ObjectID.generate().toString();

        const repository: StubbedRepository = stubRepository(service);
        stubSideEffects(service);
        jest
          .spyOn(service as any, "_findBy")
          .mockResolvedValue([existing] as never);

        await service.updateOneById({
          id: new ObjectID(existing._id),
          data: {
            [column]: passwordFieldValue(`secret_for_${column}`),
          } as never,
          props: { isRoot: true },
        });

        await expectCipherTextOf(
          storedSetValue(repository, column),
          `secret_for_${column}`,
        );

        encryptedColumnsChecked.push(`${modelType.name}.${column}`);
      }
    }

    // Guards the sweep itself against silently checking nothing.
    expect(encryptedColumnsChecked).toEqual(
      expect.arrayContaining([
        "ThreatIntelFeed.apiToken",
        "ThreatIntelFeed.basicAuthPassword",
        "DataSource.password",
        "DataSource.apiToken",
        "RunbookCredential.sshPassword",
        "RunbookCredential.sshPassphrase",
      ]),
    );
  });

  test("a real hashed column (User.password) keeps its HashedString and is still hashed and salted", async () => {
    const userId: ObjectID = ObjectID.generate();
    const existing: User = new User();
    existing._id = userId.toString();

    const service: DatabaseService<User> = new DatabaseService<User>(User);
    const repository: StubbedRepository = stubRepository(service);
    stubSideEffects(service);
    jest
      .spyOn(service as any, "_findBy")
      .mockResolvedValue([existing] as never);

    await service.updateOneById({
      id: userId,
      data: {
        password: passwordFieldValue("correct horse battery staple"),
      } as never,
      props: { isRoot: true },
    });

    const storedPassword: unknown = storedSetValue(repository, "password");

    expect(typeof storedPassword).toBe("string");
    expect(storedPassword).not.toBe("correct horse battery staple");
    expect(storedPassword).not.toContain("HashedString");
    expect(storedSetValue(repository, "passwordSalt")).toEqual(
      expect.any(String),
    );
  });

  test("strings, nulls and absent columns pass through untouched", async () => {
    const feedId: ObjectID = ObjectID.generate();
    const existing: ThreatIntelFeed = new ThreatIntelFeed();
    existing._id = feedId.toString();

    const repository: StubbedRepository = stubRepository(
      ThreatIntelFeedService,
    );
    stubSideEffects(ThreatIntelFeedService);
    jest
      .spyOn(ThreatIntelFeedService as any, "_findBy")
      .mockResolvedValue([existing] as never);

    await ThreatIntelFeedService.updateOneById({
      id: feedId,
      data: {
        apiToken: "already_a_string",
        basicAuthPassword: null,
        name: "Renamed feed",
      } as never,
      props: { isRoot: true },
    });

    await expectCipherTextOf(
      storedSetValue(repository, "apiToken"),
      "already_a_string",
    );
    expect(storedSetValue(repository, "basicAuthPassword")).toBeNull();
    expect(storedSetValue(repository, "name")).toBe("Renamed feed");

    const setClause: JSONObject = repository.update.mock
      .calls[0]![1] as JSONObject;
    expect(Object.keys(setClause)).not.toContain("basicAuthUsername");
  });
});
