import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Every request's props carry where it came from (CommonAPI.
 * getDatabaseCommonInteractionProps -> props.requestOrigin), so the security
 * emails a write's hooks send - "Your password was changed", from the
 * profile page - can say from which address, roughly where and on which
 * device (RequestOriginUtil). Nothing else reads it: it decides no
 * permission and names no credential.
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
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

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import CommonAPI from "../../../Server/API/CommonAPI";
import {
  ExpressRequest,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const API_KEY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const CHROME_MAC: string =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type PropsForFunction = (
  fields: Partial<OneUptimeRequest> & {
    headers?: Record<string, string> | undefined;
    socket?: { remoteAddress?: string | undefined } | undefined;
  },
) => Promise<DatabaseCommonInteractionProps>;

const propsFor: PropsForFunction = async (
  fields: Partial<OneUptimeRequest> & {
    headers?: Record<string, string> | undefined;
    socket?: { remoteAddress?: string | undefined } | undefined;
  },
): Promise<DatabaseCommonInteractionProps> => {
  return await CommonAPI.getDatabaseCommonInteractionProps({
    headers: {},
    ...fields,
  } as unknown as ExpressRequest);
};

beforeEach(() => {
  setTestBillingEnabled(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CommonAPI.getDatabaseCommonInteractionProps - where the request came from", () => {
  test("a signed-in request carries its address and device", async () => {
    const props: DatabaseCommonInteractionProps = await propsFor({
      userAuthorization: { userId: USER_ID } as never,
      userType: UserType.User,
      headers: { "x-forwarded-for": "203.0.113.7", "user-agent": CHROME_MAC },
      socket: { remoteAddress: "10.0.0.2" },
    });

    expect(props.userId?.toString()).toBe(USER_ID.toString());
    expect(props.requestOrigin).toEqual({
      ipAddress: "203.0.113.7",
      location: undefined,
      device: "Chrome 130 on macOS",
    });
  });

  test("the address is the one the bundled Nginx appended, not the one the caller wrote first", async () => {
    const props: DatabaseCommonInteractionProps = await propsFor({
      userAuthorization: { userId: USER_ID } as never,
      userType: UserType.User,
      headers: { "x-forwarded-for": "198.51.100.66, 203.0.113.7" },
      socket: { remoteAddress: "10.0.0.2" },
    });

    expect(props.requestOrigin?.ipAddress).toBe("203.0.113.7");
  });

  test("an API key's request carries it too", async () => {
    const props: DatabaseCommonInteractionProps = await propsFor({
      apiKeyId: API_KEY_ID,
      apiKeyName: "Terraform",
      userType: UserType.API,
      headers: { "x-forwarded-for": "203.0.113.8", "user-agent": "curl/8.4.0" },
    });

    expect(props.requestOrigin).toEqual({
      ipAddress: "203.0.113.8",
      location: undefined,
      device: "curl",
    });
  });

  test("a request with no headers carries nothing it does not know, and does not throw", async () => {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        {} as unknown as ExpressRequest,
      );

    expect(props.requestOrigin).toEqual({
      ipAddress: undefined,
      location: undefined,
      device: undefined,
    });
  });

  test("a User-Agent of the caller's own words is never carried as written", async () => {
    const props: DatabaseCommonInteractionProps = await propsFor({
      userAuthorization: { userId: USER_ID } as never,
      userType: UserType.User,
      headers: {
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "Call +1 800 555 0100 to keep your account",
      },
    });

    expect(props.requestOrigin?.device).toBeUndefined();
    expect(JSON.stringify(props.requestOrigin)).not.toContain("Call");
  });
});
