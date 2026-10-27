import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import CallAndSmsGatewayConfig from "../../../Server/Utils/CallAndSmsGatewayConfig";
import { GLOBAL_CALL_AND_SMS_GATEWAY_SELECT } from "../../../Server/Utils/TwilioConfigSelect";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import {
  CallAndSmsGateway,
  CallAndSmsProvider,
} from "../../../Types/CallAndSMS/CallAndSmsProvider";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * THE GATEWAY THE SERVER SENDS ITS SMS AND CALLS THROUGH, AS THE
 * NOTIFICATION SERVICE AND THE READINESS CHECKS READ IT.
 *
 * One read of the one settings row, as OneUptime, with the gateway's three
 * columns: the gateway when the server is set to it and has a URL, else
 * none - so the senders go through Twilio. A read that fails is not taken
 * for "no gateway": it throws, and the message fails rather than going out
 * through Twilio after all.
 */

const URL_TEXT: string = "https://sms-gateway.internal.example.com/oneuptime";
const SECRET: string = "c".repeat(64);

let globalConfig: GlobalConfig | null;
let findOneBy: jest.SpyInstance;

function config(values: Partial<GlobalConfig>): GlobalConfig {
  return Object.assign(new GlobalConfig(), values);
}

beforeEach(() => {
  globalConfig = null;

  findOneBy = jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return globalConfig;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GLOBAL_CALL_AND_SMS_GATEWAY_SELECT", () => {
  test("names what carries the server's SMS and calls, and the gateway's URL and secret", () => {
    expect(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT).toEqual({
      callAndSmsProvider: true,
      callAndSmsGatewayUrl: true,
      callAndSmsGatewaySecret: true,
    });
  });

  test("names every gateway column GlobalConfig has, so one added later is read too", () => {
    const columns: Array<string> = Object.keys(
      getTableColumns(new GlobalConfig()),
    )
      .filter((column: string): boolean => {
        return column.startsWith("callAndSms");
      })
      .sort();

    expect(Object.keys(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT).sort()).toEqual(
      columns,
    );
  });

  test("names no Twilio credential", () => {
    expect(
      Object.keys(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT).filter(
        (column: string): boolean => {
          return column.startsWith("twilio");
        },
      ),
    ).toEqual([]);
  });
});

describe("CallAndSmsGatewayConfig.getGateway", () => {
  test("reads the one settings row, as OneUptime, with the gateway's columns", async () => {
    await CallAndSmsGatewayConfig.getGateway();

    expect(findOneBy).toHaveBeenCalledTimes(1);

    const call: {
      query: { _id: string };
      props: { isRoot: boolean };
      select: Record<string, unknown>;
    } = findOneBy.mock.calls[0]![0] as unknown as {
      query: { _id: string };
      props: { isRoot: boolean };
      select: Record<string, unknown>;
    };

    expect(call.query).toEqual({
      _id: ObjectID.getZeroObjectID().toString(),
    });
    expect(call.props).toEqual({ isRoot: true });
    expect(call.select).toBe(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT);
  });

  test("the gateway, on a server set to it with a URL", async () => {
    globalConfig = config({
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewayUrl: URL_TEXT,
      callAndSmsGatewaySecret: SECRET,
    });

    expect(await CallAndSmsGatewayConfig.getGateway()).toEqual({
      url: URL_TEXT,
      secret: SECRET,
    });
  });

  test("none on a server that sends through Twilio, though it keeps a URL and secret for next time", async () => {
    globalConfig = config({
      callAndSmsProvider: CallAndSmsProvider.Twilio,
      callAndSmsGatewayUrl: URL_TEXT,
      callAndSmsGatewaySecret: SECRET,
    });

    expect(await CallAndSmsGatewayConfig.getGateway()).toBeNull();
  });

  test("none on a server that has never chosen", async () => {
    globalConfig = config({});

    expect(await CallAndSmsGatewayConfig.getGateway()).toBeNull();
  });

  test("none on a server with no settings row", async () => {
    globalConfig = null;

    expect(await CallAndSmsGatewayConfig.getGateway()).toBeNull();
  });

  test("none on a server set to the gateway with no URL - a row edited by hand", async () => {
    globalConfig = config({
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewaySecret: SECRET,
    });

    expect(await CallAndSmsGatewayConfig.getGateway()).toBeNull();
  });

  test("a gateway whose secret was never made is signed with an empty one", async () => {
    globalConfig = config({
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewayUrl: ` ${URL_TEXT} `,
    });

    const gateway: CallAndSmsGateway | null =
      await CallAndSmsGatewayConfig.getGateway();

    expect(gateway).toEqual({ url: URL_TEXT, secret: "" });
  });

  test("a read that fails throws, rather than being taken for a server with no gateway", async () => {
    findOneBy.mockRejectedValue(new Error("connection terminated"));

    await expect(CallAndSmsGatewayConfig.getGateway()).rejects.toThrow(
      "connection terminated",
    );
  });

  test("is read again every time: a change an admin saves is used by the next message", async () => {
    globalConfig = config({
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewayUrl: URL_TEXT,
      callAndSmsGatewaySecret: SECRET,
    });

    expect(await CallAndSmsGatewayConfig.getGateway()).not.toBeNull();

    globalConfig = config({
      callAndSmsProvider: CallAndSmsProvider.Twilio,
    });

    expect(await CallAndSmsGatewayConfig.getGateway()).toBeNull();
    expect(findOneBy).toHaveBeenCalledTimes(2);
  });
});
