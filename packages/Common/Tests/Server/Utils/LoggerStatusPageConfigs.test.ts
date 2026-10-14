import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import { inspect } from "util";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A status page's subscriber SMS read the page's Twilio config through the
 * page, the auth token decrypted - and two debug lines of
 * StatusPageSubscriberService print what was read: the config of a page a
 * new subscriber joined ("Status Page Call SMS Config: <the config as
 * JSON>"), and every page a notification goes to, with its SMTP and Twilio
 * configs. DEBUG is a level operators turn on in production, and a log
 * record goes to stdout, to the recent-log buffer the support bundle reads
 * and to the telemetry exporter.
 *
 * So, written exactly as those lines write them, neither the auth token nor
 * the SMTP password nor its OAuth client secret reaches any of the three
 * (LogRedaction), while the account SID and the names still do.
 */

interface EmittedRecord {
  body: string;
  attributes?: Record<string, unknown> | undefined;
}

const emitted: Array<EmittedRecord> = [];

jest.mock("../../../Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getLogger: (): unknown => {
        return {
          emit: (record: EmittedRecord): void => {
            emitted.push(record);
          },
        };
      },
    },
  };
});

import logger from "../../../Server/Utils/Logger";

const TOKEN: string = "0123456789abcdef0123456789abcdef";
const SMTP_PASSWORD: string = "smtp-password-sentinel-9f8e7d";
const SMTP_CLIENT_SECRET: string = "smtp-client-secret-sentinel-6c5b4a";
const SID: string = "AC0123456789abcdef0123456789abcde";

function twilioConfig(): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.id = ObjectID.generate();
  config.twilioAccountSID = SID;
  config.twilioAuthToken = TOKEN;
  return config;
}

function statusPage(): StatusPage {
  const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
  smtpConfig.id = ObjectID.generate();
  smtpConfig.username = "mailer";
  smtpConfig.password = SMTP_PASSWORD;
  smtpConfig.clientSecret = SMTP_CLIENT_SECRET;

  const page: StatusPage = new StatusPage();
  page.id = ObjectID.generate();
  page.name = "Status";
  page.callSmsConfig = twilioConfig();
  page.smtpConfig = smtpConfig;
  return page;
}

let consoleDebug: { mock: { calls: Array<Array<unknown>> } };

// Everything the debug lines wrote, to every sink.
function writtenEverywhere(): string {
  const parts: Array<string> = [];

  for (const call of consoleDebug.mock.calls) {
    parts.push(
      call
        .map((argument: unknown): string => {
          return typeof argument === "string"
            ? argument
            : inspect(argument, { depth: null });
        })
        .join(" "),
    );
  }

  for (const entry of logger.getRecentLogs()) {
    parts.push(entry.message);
  }

  for (const record of emitted) {
    parts.push(record.body);
  }

  return parts.join("\n");
}

describe("the status page senders' debug lines", () => {
  beforeEach(() => {
    emitted.length = 0;
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.DEBUG);
    consoleDebug = jest
      .spyOn(console, "debug")
      .mockImplementation(() => {}) as unknown as typeof consoleDebug;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("never write a page's Twilio auth token, as the subscribe line prints it", () => {
    const config: ProjectCallSMSConfig = twilioConfig();

    logger.debug(`Status Page Call SMS Config: ${JSON.stringify(config)}`);

    const written: string = writtenEverywhere();

    expect(written).toContain("Status Page Call SMS Config");
    expect(written).toContain(SID);
    expect(written).not.toContain(TOKEN);
  });

  it("never write the Twilio token or the SMTP secrets of the pages a notification goes to", () => {
    logger.debug([statusPage(), statusPage()]);

    const written: string = writtenEverywhere();

    expect(written).toContain("Status");
    expect(written).toContain(SID);
    expect(written).toContain("mailer");
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(SMTP_PASSWORD);
    expect(written).not.toContain(SMTP_CLIENT_SECRET);
  });
});
