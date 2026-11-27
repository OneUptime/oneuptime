/*
 * AN SMS MOVES FROM SENT TO DELIVERED - OR UNDELIVERED, OR FAILED - AS
 * TWILIO TELLS IT, END TO END, AGAINST POSTGRES (#11138).
 *
 * "Is Sent or Delivered the last status of an SMS?" Delivered - when the
 * carrier sends Twilio its receipt, and Twilio's status callback reaches
 * OneUptime, signed. This is the whole of that path, nothing stood in for
 * but Twilio itself and what needs another server:
 *
 *   - the real SmsService sends an SMS on a project's own Twilio account,
 *     whose config is read from Postgres; Twilio's client, stood in for,
 *     keeps what it was asked - the status callback URL above all - and
 *     answers as Twilio does: queued;
 *   - Twilio then calls that URL as Twilio does: a POST of its documented
 *     callback parameters (TwilioDocumentedSignature), form-encoded, without
 *     the URL's fragment, signed by the algorithm its security page writes
 *     out - never its SDK - with the auth token of the account the SMS went
 *     out on, through the ingress: /notification rewritten to
 *     /api/notification, the public scheme and host forwarded;
 *   - the request reaches the App's own Express app - StartServer's real
 *     middleware and body parsers - on a real socket, and the real SMS
 *     router, which checks the token and the signature against the project's
 *     config in Postgres and writes the SMS's log there.
 *
 * Read back from Postgres each time: Sending, then Sent, then Delivered -
 * or Undelivered or Failed, with Twilio's error code. A callback late or
 * sent again changes nothing and is counted once; one unsigned, signed by
 * another account, changed on the way, or carrying another SMS's token is
 * refused (403) and leaves the log as it was.
 *
 * Opt in with RUN_POSTGRES_SMS_DELIVERY_CALLBACK_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check
 * (.github/workflows/postgres-schema-drift.yaml runs it). The tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from SMS_DELIVERY_CALLBACK_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from SMS_DELIVERY_CALLBACK_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */

interface RecordedDelivery {
  value: number;
  attributes: Record<string, string>;
}

const deliveries: Array<RecordedDelivery> = [];

// The platform's delivery metrics, kept as they are given.
jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  const recorder: () => {
    add: (value: number, attributes: Record<string, string>) => void;
    record: () => void;
  } = () => {
    return {
      add: (value: number, attributes: Record<string, string>): void => {
        deliveries.push({ value, attributes });
      },
      record: (): void => {
        return;
      },
    };
  };

  return {
    __esModule: true,
    default: new Proxy(
      {},
      {
        get: (_target: Record<string, unknown>, name: string | symbol) => {
          if (name === "getNotificationDeliveryCounter") {
            return recorder;
          }

          return () => {
            return {
              add: (): void => {
                return;
              },
              record: (): void => {
                return;
              },
            };
          };
        },
      },
    ),
  };
});

// The public host Twilio calls back on, over HTTPS.
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    Host: "oneuptime.example.com",
    HttpProtocol: "https://",
    IsBillingEnabled: false,
  };
});

// Twilio's client (the App's copy): it keeps what it was asked, and answers queued.
jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import SmsAPI from "../../FeatureSet/Notification/API/SMS";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import Encryption from "Common/Server/Utils/Encryption";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import WorkflowListeners from "Common/Server/Utils/Workflow/WorkflowListeners";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import {
  getTwilioDocumentedCallback,
  getTwilioDocumentedSignature,
} from "Common/Tests/Server/TestingUtils/TwilioDocumentedSignature";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "Common/node_modules/typeorm";
import http from "http";
import { AddressInfo } from "net";
import Twilio from "twilio";

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SMS_DELIVERY_CALLBACK_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: ReadonlyArray<string> = [
  "Project",
  "ProjectCallSMSConfig",
  "SmsLog",
  "GlobalConfig",
];

const DASHES: RegExp = /-/g;

// A status callback URL's SMS log id and token.
const STATUS_CALLBACK_PATH: RegExp =
  /\/notification\/sms\/status-callback\/([^/?#]+)\/([^/?#]+)/;

const PUBLIC_ORIGIN: string = "https://oneuptime.example.com";

// The project's own Twilio account, as Twilio knows it.
const PROJECT_ACCOUNT: {
  accountSid: string;
  authToken: string;
  from: string;
} = {
  accountSid: "AC1113800000000000000000000000000a",
  authToken: "the-project-account-auth-token-1",
  from: "+15017250604",
};

// Another Twilio account, which sent none of this project's SMS.
const STRANGER_AUTH_TOKEN: string = "a-stranger-account-auth-token-02";

const TO: string = "+15558675310";

interface RowRead {
  status: string | null;
  statusMessage: string | null;
  errorCode: string | null;
  statusCallbackToken: string | null;
}

interface SentSms {
  logId: string;
  token: string;
  messageSid: string;
  // The status callback URL Twilio was given, fragment and all.
  statusCallback: string;
}

interface Answer {
  status: number;
  text: string;
}

describePostgres("an SMS's delivery, as Twilio reports it (Postgres)", () => {
  const schema: string = `sms_delivery_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  let database: DataSource;
  let server: http.Server;
  let port: number = 0;

  const projectId: ObjectID = ObjectID.generate();
  let twilioConfig: TwilioConfig;

  // What each messages.create was asked, and the id it answered with.
  const created: Array<Record<string, unknown>> = [];
  let messageCount: number = 0;

  async function readLog(logId: string): Promise<RowRead> {
    const rows: Array<RowRead> = await database.query(
      `SELECT "status", "statusMessage", "errorCode", "statusCallbackToken" FROM "${schema}"."SmsLog" WHERE "_id" = $1`,
      [logId],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  async function sendSms(): Promise<SentSms> {
    const before: number = created.length;

    await SmsService.sendSms(new Phone(TO), "Incident Checkout down.", {
      projectId: projectId,
      customTwilioConfig: twilioConfig,
    });

    expect(created).toHaveLength(before + 1);

    const statusCallback: string = String(
      created[created.length - 1]!["statusCallback"],
    );
    const match: RegExpExecArray | null =
      STATUS_CALLBACK_PATH.exec(statusCallback);

    expect(match).not.toBeNull();

    return {
      logId: match![1]!,
      token: match![2]!,
      messageSid: `SM1113800000000000000000000000${String(messageCount).padStart(4, "0")}`,
      statusCallback: statusCallback,
    };
  }

  /*
   * Twilio calling the status callback URL it was given: without the
   * fragment, through the ingress (rewritten to /api/notification, the
   * public scheme and host forwarded), form-encoded, signed with `signWith`
   * over the public URL and every parameter - or not signed at all.
   */
  async function twilioCallsBack(data: {
    url: string;
    parameters: Record<string, string>;
    signWith: string | null;
    // What reaches the app, when something on the way changed it.
    postedParameters?: Record<string, string> | undefined;
    // The URL the signature was made over, when it is not the one called.
    signedUrl?: string | undefined;
  }): Promise<Answer> {
    const publicUrl: string = data.url.split("#")[0]!;
    const requested: globalThis.URL = new globalThis.URL(publicUrl);
    const internalPath: string = `/api${requested.pathname}${requested.search}`;
    const body: string = new URLSearchParams(
      data.postedParameters || data.parameters,
    ).toString();

    const headers: Record<string, string> = {
      host: requested.host,
      "x-forwarded-proto": requested.protocol.replace(":", ""),
      "x-forwarded-host": requested.host,
      "x-forwarded-for": "3.89.51.10",
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
      "user-agent": "TwilioProxy/1.1",
      ...(data.signWith !== null
        ? {
            "x-twilio-signature": getTwilioDocumentedSignature({
              authToken: data.signWith,
              url: data.signedUrl || publicUrl,
              parameters: data.parameters,
            }),
          }
        : {}),
    };

    return await new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: "POST",
            path: internalPath,
            headers: headers,
          },
          (response: http.IncomingMessage) => {
            let text: string = "";

            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              text += chunk;
            });
            response.on("end", () => {
              resolve({ status: response.statusCode || 0, text: text });
            });
          },
        );

        request.on("error", reject);
        request.write(body);
        request.end();
      },
    );
  }

  // A callback of the SMS's own, as Twilio's guide shows one, on its account.
  function callbackOf(
    sms: SentSms,
    status: "sent" | "delivered" | "undelivered" | "failed",
  ): Record<string, string> {
    return {
      ...getTwilioDocumentedCallback({
        status: status,
        accountSid: PROJECT_ACCOUNT.accountSid,
        to: TO,
      }),
      From: PROJECT_ACCOUNT.from,
      MessageSid: sms.messageSid,
      SmsSid: sms.messageSid,
    };
  }

  function deliveriesCounted(): Array<RecordedDelivery> {
    return deliveries.filter((delivery: RecordedDelivery): boolean => {
      return delivery.attributes["notification.channel"] === "sms";
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SMS_DELIVERY_CALLBACK_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SMS_DELIVERY_CALLBACK_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SMS_DELIVERY_CALLBACK_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what the path reads; keys stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT c.table_name, c.column_name FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.is_nullable = 'NO'
           AND NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints t
             JOIN information_schema.key_column_usage k
               ON k.constraint_name = t.constraint_name
              AND k.table_schema = t.table_schema
             WHERE t.constraint_type = 'PRIMARY KEY'
               AND t.table_schema = c.table_schema
               AND k.table_name = c.table_name
               AND k.column_name = c.column_name
           )`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // A project that sends SMS, on its own Twilio account, its auth token stored encrypted.
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "enableSmsNotifications", "createdAt", "updatedAt", "version")
       VALUES ($1, 'Payments', 'payments', true, now(), now(), 1)`,
      [projectId.toString()],
    );

    const configId: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."ProjectCallSMSConfig" ("_id", "projectId", "name", "slug", "twilioAccountSID", "twilioAuthToken", "twilioPrimaryPhoneNumber", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, 'Payments Twilio', 'payments-twilio', $3, $4, $5, now(), now(), 1)`,
      [
        configId.toString(),
        projectId.toString(),
        PROJECT_ACCOUNT.accountSid,
        await Encryption.encrypt(PROJECT_ACCOUNT.authToken),
        PROJECT_ACCOUNT.from,
      ],
    );

    // Read as the senders read it: decrypted, as a TwilioConfig.
    const config: ProjectCallSMSConfig | null =
      await ProjectCallSMSConfigService.findOneById({
        id: configId,
        select: {
          _id: true,
          projectId: true,
          twilioAccountSID: true,
          twilioAuthToken: true,
          twilioPrimaryPhoneNumber: true,
          twilioSmsPhoneNumbers: true,
          usedFor: true,
        },
        props: { isRoot: true },
      });

    expect(config?.twilioAuthToken).toBe(PROJECT_ACCOUNT.authToken);
    twilioConfig = ProjectCallSMSConfigService.toTwilioConfig(config!)!;
    expect(twilioConfig.accountSid).toBe(PROJECT_ACCOUNT.accountSid);

    // The App's own express app: importing StartServer mounted its middleware.
    const app: ExpressApplication = Express.getExpressApp();
    // Mounted where the Notification feature set mounts it (FeatureSet/Notification/Index.ts).
    app.use(["/api/notification/sms", "/sms"], SmsAPI);
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  }, 240000);

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    }

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    // No workflow of the project listens to its SMS logs.
    jest.spyOn(WorkflowListeners, "isAnyListening").mockResolvedValue(false);

    (Twilio as unknown as jest.Mock).mockImplementation((() => {
      return {
        messages: {
          create: async (
            params: Record<string, unknown>,
          ): Promise<Record<string, unknown>> => {
            created.push(params);
            messageCount++;

            return {
              sid: `SM1113800000000000000000000000${String(messageCount).padStart(4, "0")}`,
              // As Twilio answers a new message: queued, not yet at the carrier.
              status: "queued",
            };
          },
        },
      };
    }) as never);
  });

  test("the SMS is logged Sending, and Twilio is given a callback URL on the public host, with its retry fragment", async () => {
    const sms: SentSms = await sendSms();

    expect(sms.statusCallback).toBe(
      `${PUBLIC_ORIGIN}/notification/sms/status-callback/${sms.logId}/${sms.token}?providerConfig=project#rc=3&rp=ct,5xx`,
    );

    expect(await readLog(sms.logId)).toEqual({
      status: SmsStatus.Sending,
      statusMessage: `Message ID: ${sms.messageSid}`,
      errorCode: null,
      statusCallbackToken: sms.token,
    });
  });

  test("Sending, then Sent, then Delivered: each of Twilio's signed callbacks moves the log on, and the delivery is counted once", async () => {
    const sms: SentSms = await sendSms();
    const countedBefore: number = deliveriesCounted().length;

    const sent: Answer = await twilioCallsBack({
      url: sms.statusCallback,
      parameters: callbackOf(sms, "sent"),
      signWith: PROJECT_ACCOUNT.authToken,
    });

    expect(sent.status).toBe(200);
    expect(await readLog(sms.logId)).toMatchObject({
      status: SmsStatus.Sent,
      statusMessage: `Delivery status: Sent. Message ID: ${sms.messageSid}.`,
    });
    // On its way: not counted yet.
    expect(deliveriesCounted()).toHaveLength(countedBefore);

    const delivered: Answer = await twilioCallsBack({
      url: sms.statusCallback,
      parameters: callbackOf(sms, "delivered"),
      signWith: PROJECT_ACCOUNT.authToken,
    });

    expect(delivered.status).toBe(200);
    expect(await readLog(sms.logId)).toMatchObject({
      status: SmsStatus.Delivered,
      statusMessage: `Delivery status: Delivered. Message ID: ${sms.messageSid}.`,
      errorCode: null,
    });

    const counted: Array<RecordedDelivery> =
      deliveriesCounted().slice(countedBefore);

    expect(counted).toHaveLength(1);
    expect(counted[0]!.attributes).toMatchObject({
      "notification.channel": "sms",
      "notification.provider": "twilio",
      "notification.provider.config": "project",
      outcome: "delivered",
    });

    // A sent that arrives late, and the delivered Twilio sends again: nothing moves, nothing more is counted.
    for (const late of ["sent", "delivered"] as const) {
      const again: Answer = await twilioCallsBack({
        url: sms.statusCallback,
        parameters: callbackOf(sms, late),
        signWith: PROJECT_ACCOUNT.authToken,
      });

      expect(again.status).toBe(200);
      expect((await readLog(sms.logId)).status).toBe(SmsStatus.Delivered);
    }

    expect(deliveriesCounted().slice(countedBefore)).toHaveLength(1);
  });

  test("the carrier could not deliver it: Undelivered, with Twilio's error code", async () => {
    const sms: SentSms = await sendSms();

    await twilioCallsBack({
      url: sms.statusCallback,
      parameters: callbackOf(sms, "sent"),
      signWith: PROJECT_ACCOUNT.authToken,
    });

    const answer: Answer = await twilioCallsBack({
      url: sms.statusCallback,
      parameters: callbackOf(sms, "undelivered"),
      signWith: PROJECT_ACCOUNT.authToken,
    });

    expect(answer.status).toBe(200);
    expect(await readLog(sms.logId)).toMatchObject({
      status: SmsStatus.Undelivered,
      statusMessage: `Delivery status: Undelivered. Message ID: ${sms.messageSid}. Provider error code: 30003.`,
      errorCode: "30003",
    });
  });

  test("Twilio could not send it: Failed, with Twilio's error code - straight from Sending", async () => {
    const sms: SentSms = await sendSms();

    const answer: Answer = await twilioCallsBack({
      url: sms.statusCallback,
      parameters: callbackOf(sms, "failed"),
      signWith: PROJECT_ACCOUNT.authToken,
    });

    expect(answer.status).toBe(200);
    expect(await readLog(sms.logId)).toMatchObject({
      status: SmsStatus.Failed,
      errorCode: "30008",
    });
  });

  test("delivered before sent - callbacks out of order - ends Delivered", async () => {
    const sms: SentSms = await sendSms();

    for (const status of ["delivered", "sent"] as const) {
      expect(
        (
          await twilioCallsBack({
            url: sms.statusCallback,
            parameters: callbackOf(sms, status),
            signWith: PROJECT_ACCOUNT.authToken,
          })
        ).status,
      ).toBe(200);
    }

    expect((await readLog(sms.logId)).status).toBe(SmsStatus.Delivered);
  });

  describe("a callback that is not Twilio's, for this SMS, is refused and changes nothing", () => {
    test("unsigned", async () => {
      const sms: SentSms = await sendSms();

      const answer: Answer = await twilioCallsBack({
        url: sms.statusCallback,
        parameters: callbackOf(sms, "delivered"),
        signWith: null,
      });

      expect(answer).toEqual({ status: 403, text: "Forbidden" });
      expect((await readLog(sms.logId)).status).toBe(SmsStatus.Sending);
    });

    test("signed by an account that sent none of this project's SMS", async () => {
      const sms: SentSms = await sendSms();

      const answer: Answer = await twilioCallsBack({
        url: sms.statusCallback,
        parameters: callbackOf(sms, "delivered"),
        signWith: STRANGER_AUTH_TOKEN,
      });

      expect(answer.status).toBe(403);
      expect((await readLog(sms.logId)).status).toBe(SmsStatus.Sending);
    });

    test("signed by Twilio, then changed on the way - undelivered made delivered", async () => {
      const sms: SentSms = await sendSms();
      const undelivered: Record<string, string> = callbackOf(
        sms,
        "undelivered",
      );

      const answer: Answer = await twilioCallsBack({
        url: sms.statusCallback,
        parameters: undelivered,
        signWith: PROJECT_ACCOUNT.authToken,
        postedParameters: {
          ...undelivered,
          MessageStatus: "delivered",
          SmsStatus: "delivered",
        },
      });

      expect(answer.status).toBe(403);
      expect((await readLog(sms.logId)).status).toBe(SmsStatus.Sending);
    });

    test("signed by Twilio, for another SMS's URL: its token is not this SMS's", async () => {
      const sms: SentSms = await sendSms();
      const other: SentSms = await sendSms();

      // Another SMS's token on this SMS's log id, signed over that very URL.
      const answer: Answer = await twilioCallsBack({
        url: `${PUBLIC_ORIGIN}/notification/sms/status-callback/${sms.logId}/${other.token}?providerConfig=project`,
        parameters: callbackOf(sms, "delivered"),
        signWith: PROJECT_ACCOUNT.authToken,
      });

      expect(answer.status).toBe(403);
      expect((await readLog(sms.logId)).status).toBe(SmsStatus.Sending);
      expect((await readLog(other.logId)).status).toBe(SmsStatus.Sending);
    });

    test("signed over the URL without its providerConfig: the query is part of what Twilio signs", async () => {
      const sms: SentSms = await sendSms();

      const answer: Answer = await twilioCallsBack({
        url: sms.statusCallback,
        parameters: callbackOf(sms, "delivered"),
        signWith: PROJECT_ACCOUNT.authToken,
        signedUrl: sms.statusCallback
          .split("#")[0]!
          .replace("?providerConfig=project", ""),
      });

      expect(answer.status).toBe(403);
      expect((await readLog(sms.logId)).status).toBe(SmsStatus.Sending);
    });

    test("the very same callback, signed by Twilio, is then taken: what was refused was the request, never the SMS", async () => {
      const sms: SentSms = await sendSms();

      expect(
        (
          await twilioCallsBack({
            url: sms.statusCallback,
            parameters: callbackOf(sms, "delivered"),
            signWith: null,
          })
        ).status,
      ).toBe(403);

      expect(
        (
          await twilioCallsBack({
            url: sms.statusCallback,
            parameters: callbackOf(sms, "delivered"),
            signWith: PROJECT_ACCOUNT.authToken,
          })
        ).status,
      ).toBe(200);
      expect((await readLog(sms.logId)).status).toBe(SmsStatus.Delivered);
    });
  });
});
