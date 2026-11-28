import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import {
  TwilioSignatureCheck,
  findTwilioAccountThatSigned,
  isSignedWithAuthToken,
} from "../../../Server/Utils/TwilioWebhookSignature";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import { WebhookRequest } from "../../../Types/Call/CallProvider";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { serverTwilioRow } from "../TestingUtils/TwilioSignedRequests";
import {
  TWILIO_DOCUMENTED_EXAMPLE,
  TWILIO_DOCUMENTED_SENT_CALLBACK,
  getTwilioDocumentedCallback,
  getTwilioDocumentedSignature,
} from "../TestingUtils/TwilioDocumentedSignature";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import { getExpectedTwilioSignature } from "twilio";

/*
 * ONEUPTIME CHECKS TWILIO'S SIGNATURE AS TWILIO DOCUMENTS IT (#11138).
 *
 * Every SMS's delivery status reaches OneUptime as a callback Twilio signs
 * (X-Twilio-Signature), and OneUptime writes it only when the signature is
 * the account's: an SMS stays Sent - never Delivered, Undelivered or
 * Failed - if it refuses callbacks Twilio really sent. The other signature
 * tests sign with Twilio's own SDK, which OneUptime checks with too. These
 * hold the check to what Twilio's documentation says instead, from requests
 * recorded off its pages:
 *
 *   - the worked example of its security page - auth token 12345, its URL,
 *     its five parameters, and the signature it says they make;
 *   - the status callback its outbound message status guide shows for an
 *     SMS that moved to sent, and the same message's later callbacks;
 *   - its connection overrides page: the fragment OneUptime puts on every
 *     status callback URL (#rc=3&rp=ct,5xx) is left out of the signature.
 *
 * Signed here by the algorithm as the security page writes it out
 * (TwilioDocumentedSignature), never by the SDK. The database is stood in
 * for: the project's Twilio configs and the server's own account.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    Host: "",
    HttpProtocol: "https://",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11138000-0000-4000-8000-000000000001",
);
const LOG_ID: string = "11138000-0000-4000-8000-0000000000a1";
const TOKEN: string = "11138000-0000-4000-8000-0000000000f1";

const PUBLIC_HOST: string = "oneuptime.example.com";

// The status callback URL SmsService gives Twilio for an SMS on a project's own account.
const STATUS_CALLBACK_PATH: string = `/notification/sms/status-callback/${LOG_ID}/${TOKEN}`;
const STATUS_CALLBACK_URL: string = `https://${PUBLIC_HOST}${STATUS_CALLBACK_PATH}?providerConfig=project#rc=3&rp=ct,5xx`;

// The account of the guide's example: its SID is the guide's placeholder.
const PROJECT_ACCOUNT: TwilioConfig = {
  accountSid: TWILIO_DOCUMENTED_SENT_CALLBACK["AccountSid"]!,
  authToken: "the-project-config-auth-token-01",
  primaryPhoneNumber: new Phone("+15017250604"),
  secondaryPhoneNumbers: [],
};

const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "the-server-account-auth-token-02",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

let projectConfigs: Array<ProjectCallSMSConfig>;

/*
 * A request as the route receives it: Twilio posted it to `url` - its
 * fragment never sent - with these headers, and the ingress rewrote the
 * public /notification to /api/notification and forwarded the public scheme
 * and host to the app, which it reaches at a host of its own.
 */
function receivedRequest(data: {
  url: string;
  parameters: Record<string, string>;
  signature?: string | null | undefined;
}): WebhookRequest {
  const requested: globalThis.URL = new globalThis.URL(data.url.split("#")[0]!);
  const path: string = `${requested.pathname}${requested.search}`;
  const headers: Record<string, string> = {
    host: "app:3002",
    "x-forwarded-proto": requested.protocol.replace(":", ""),
    "x-forwarded-host": requested.host,
    ...(data.signature ? { "x-twilio-signature": data.signature } : {}),
  };

  return {
    headers: headers,
    body: data.parameters,
    protocol: "http",
    originalUrl: path.startsWith("/notification/") ? `/api${path}` : path,
    url: path,
    get: (name: string): string | undefined => {
      return headers[name.toLowerCase()];
    },
  } as unknown as WebhookRequest;
}

// A callback Twilio signed, as its documentation says it signs one.
function signedCallback(data: {
  parameters: Record<string, string>;
  authToken: string;
  url?: string | undefined;
}): WebhookRequest {
  const url: string = data.url || STATUS_CALLBACK_URL;

  return receivedRequest({
    url: url,
    parameters: data.parameters,
    signature: getTwilioDocumentedSignature({
      authToken: data.authToken,
      url: url,
      parameters: data.parameters,
    }),
  });
}

async function accountThatSigned(
  request: WebhookRequest,
): Promise<TwilioSignatureCheck> {
  return await findTwilioAccountThatSigned({
    request: request,
    projectId: PROJECT_ID,
    urlSecrets: [TOKEN],
  });
}

beforeEach(() => {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.id = ObjectID.generate();
  config.projectId = PROJECT_ID;
  config.twilioAccountSID = PROJECT_ACCOUNT.accountSid;
  config.twilioAuthToken = PROJECT_ACCOUNT.authToken;
  config.twilioPrimaryPhoneNumber = PROJECT_ACCOUNT.primaryPhoneNumber!;
  projectConfigs = [config];

  jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return serverTwilioRow(SERVER_ACCOUNT);
    });
  jest
    .spyOn(ProjectCallSMSConfigService, "findBy")
    .mockImplementation(async (): Promise<Array<ProjectCallSMSConfig>> => {
      return projectConfigs;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Twilio's worked example, from its security page", () => {
  test("the algorithm as the page writes it out makes the signature the page gives", () => {
    const sortedConcatenation: string = Object.keys(
      TWILIO_DOCUMENTED_EXAMPLE.parameters,
    )
      .sort()
      .reduce((text: string, name: string): string => {
        return `${text}${name}${TWILIO_DOCUMENTED_EXAMPLE.parameters[name]}`;
      }, TWILIO_DOCUMENTED_EXAMPLE.url);

    expect(sortedConcatenation).toBe(TWILIO_DOCUMENTED_EXAMPLE.concatenated);
    expect(getTwilioDocumentedSignature(TWILIO_DOCUMENTED_EXAMPLE)).toBe(
      TWILIO_DOCUMENTED_EXAMPLE.signature,
    );
  });

  test("Twilio's SDK, which the other tests sign with, makes the same one", () => {
    expect(
      getExpectedTwilioSignature(
        TWILIO_DOCUMENTED_EXAMPLE.authToken,
        TWILIO_DOCUMENTED_EXAMPLE.url,
        TWILIO_DOCUMENTED_EXAMPLE.parameters,
      ),
    ).toBe(TWILIO_DOCUMENTED_EXAMPLE.signature);
  });

  test("OneUptime takes the documented request, with the documented signature, as signed by that auth token", () => {
    expect(
      isSignedWithAuthToken({
        request: receivedRequest({
          url: TWILIO_DOCUMENTED_EXAMPLE.url,
          parameters: TWILIO_DOCUMENTED_EXAMPLE.parameters,
          signature: TWILIO_DOCUMENTED_EXAMPLE.signature,
        }),
        authToken: TWILIO_DOCUMENTED_EXAMPLE.authToken,
      }),
    ).toBe(true);
  });

  test("unsigned, the same request is nobody's", () => {
    expect(
      isSignedWithAuthToken({
        request: receivedRequest({
          url: TWILIO_DOCUMENTED_EXAMPLE.url,
          parameters: TWILIO_DOCUMENTED_EXAMPLE.parameters,
          signature: null,
        }),
        authToken: TWILIO_DOCUMENTED_EXAMPLE.authToken,
      }),
    ).toBe(false);
  });

  test("another auth token did not make the documented signature", () => {
    expect(
      isSignedWithAuthToken({
        request: receivedRequest({
          url: TWILIO_DOCUMENTED_EXAMPLE.url,
          parameters: TWILIO_DOCUMENTED_EXAMPLE.parameters,
          signature: TWILIO_DOCUMENTED_EXAMPLE.signature,
        }),
        authToken: "54321",
      }),
    ).toBe(false);
  });

  test.each([
    [
      "a parameter's value changed",
      { ...TWILIO_DOCUMENTED_EXAMPLE.parameters, Digits: "1235" },
    ],
    [
      "a parameter added",
      { ...TWILIO_DOCUMENTED_EXAMPLE.parameters, Extra: "1" },
    ],
    [
      "a parameter left out",
      (({ Digits: _digits, ...rest }: Record<string, string>) => {
        return rest;
      })(TWILIO_DOCUMENTED_EXAMPLE.parameters),
    ],
    [
      "a parameter's name in another case",
      (({ Caller, ...rest }: Record<string, string>) => {
        return { ...rest, caller: Caller! };
      })(TWILIO_DOCUMENTED_EXAMPLE.parameters),
    ],
  ])(
    "the documented signature no longer matches: %s",
    (_name: string, parameters: Record<string, string>) => {
      expect(
        isSignedWithAuthToken({
          request: receivedRequest({
            url: TWILIO_DOCUMENTED_EXAMPLE.url,
            parameters: parameters,
            signature: TWILIO_DOCUMENTED_EXAMPLE.signature,
          }),
          authToken: TWILIO_DOCUMENTED_EXAMPLE.authToken,
        }),
      ).toBe(false);
    },
  );

  test.each([
    ["its query changed", "https://example.com/myapp.php?foo=2&bar=2"],
    ["its query left out", "https://example.com/myapp.php"],
    ["its path changed", "https://example.com/yourapp.php?foo=1&bar=2"],
    ["its host changed", "https://example.org/myapp.php?foo=1&bar=2"],
    ["its scheme changed", "http://example.com/myapp.php?foo=1&bar=2"],
  ])(
    "the documented signature no longer matches the URL with %s",
    (_name: string, url: string) => {
      expect(
        isSignedWithAuthToken({
          request: receivedRequest({
            url: url,
            parameters: TWILIO_DOCUMENTED_EXAMPLE.parameters,
            signature: TWILIO_DOCUMENTED_EXAMPLE.signature,
          }),
          authToken: TWILIO_DOCUMENTED_EXAMPLE.authToken,
        }),
      ).toBe(false);
    },
  );
});

describe("an SMS's delivery status callbacks, as Twilio's guide shows them", () => {
  test("the guide's sent callback, signed as Twilio signs, is the project's own account's", async () => {
    const result: TwilioSignatureCheck = await accountThatSigned(
      signedCallback({
        parameters: TWILIO_DOCUMENTED_SENT_CALLBACK,
        authToken: PROJECT_ACCOUNT.authToken,
      }),
    );

    expect(result.refusalReason).toBeNull();
    expect(result.account?.accountSid).toBe(PROJECT_ACCOUNT.accountSid);
  });

  test.each(["sent", "delivered", "undelivered", "failed"] as const)(
    "%s, with what that callback carries - a receipt's done date, an error code - is taken too",
    async (status: "sent" | "delivered" | "undelivered" | "failed") => {
      const result: TwilioSignatureCheck = await accountThatSigned(
        signedCallback({
          parameters: getTwilioDocumentedCallback({ status: status }),
          authToken: PROJECT_ACCOUNT.authToken,
        }),
      );

      expect(result.refusalReason).toBeNull();
      expect(result.account?.accountSid).toBe(PROJECT_ACCOUNT.accountSid);
    },
  );

  test("on the server's own account - no providerConfig in its URL - it is the server's", async () => {
    const result: TwilioSignatureCheck = await accountThatSigned(
      signedCallback({
        parameters: getTwilioDocumentedCallback({
          status: "delivered",
          accountSid: SERVER_ACCOUNT.accountSid,
        }),
        authToken: SERVER_ACCOUNT.authToken,
        url: `https://${PUBLIC_HOST}${STATUS_CALLBACK_PATH}#rc=3&rp=ct,5xx`,
      }),
    );

    expect(result.account?.accountSid).toBe(SERVER_ACCOUNT.accountSid);
  });

  test("Twilio leaves the URL's fragment out of its signature: one signed with it kept is no callback of Twilio's", async () => {
    const parameters: Record<string, string> = getTwilioDocumentedCallback({
      status: "delivered",
    });

    // Not as Twilio signs: over the URL with its #rc=3&rp=ct,5xx still on it.
    const signedWithFragmentKept: string = crypto
      .createHmac("sha1", PROJECT_ACCOUNT.authToken)
      .update(
        Buffer.from(
          Object.keys(parameters)
            .sort()
            .reduce((text: string, name: string): string => {
              return `${text}${name}${parameters[name]}`;
            }, STATUS_CALLBACK_URL),
          "utf-8",
        ),
      )
      .digest("base64");

    const result: TwilioSignatureCheck = await accountThatSigned(
      receivedRequest({
        url: STATUS_CALLBACK_URL,
        parameters: parameters,
        signature: signedWithFragmentKept,
      }),
    );

    expect(result.account).toBeNull();
    expect(result.refusalReason).toContain("does not match");
  });

  test("unsigned, the guide's callback is refused before any account is tried, and says so", async () => {
    const result: TwilioSignatureCheck = await accountThatSigned(
      receivedRequest({
        url: STATUS_CALLBACK_URL,
        parameters: TWILIO_DOCUMENTED_SENT_CALLBACK,
        signature: null,
      }),
    );

    expect(result.account).toBeNull();
    expect(result.refusalReason).toBe(
      "It carries no X-Twilio-Signature header: it is not Twilio's, or a proxy on the way dropped the header.",
    );
  });

  test("signed with another account's auth token, it is refused", async () => {
    const result: TwilioSignatureCheck = await accountThatSigned(
      signedCallback({
        parameters: TWILIO_DOCUMENTED_SENT_CALLBACK,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    );

    expect(result.account).toBeNull();
    expect(result.refusalReason).toContain("does not match");
  });

  test("a delivered callback changed on the way to undelivered no longer matches its signature", async () => {
    const delivered: Record<string, string> = getTwilioDocumentedCallback({
      status: "delivered",
    });
    const signed: WebhookRequest = signedCallback({
      parameters: delivered,
      authToken: PROJECT_ACCOUNT.authToken,
    });

    (signed as unknown as { body: Record<string, string> }).body = {
      ...delivered,
      MessageStatus: "undelivered",
      SmsStatus: "undelivered",
    };

    const result: TwilioSignatureCheck = await accountThatSigned(signed);

    expect(result.account).toBeNull();
  });

  test("its URL's providerConfig is signed: one added on the way no longer matches", async () => {
    const parameters: Record<string, string> = getTwilioDocumentedCallback({
      status: "delivered",
      accountSid: SERVER_ACCOUNT.accountSid,
    });
    const signature: string = getTwilioDocumentedSignature({
      authToken: SERVER_ACCOUNT.authToken,
      url: `https://${PUBLIC_HOST}${STATUS_CALLBACK_PATH}`,
      parameters: parameters,
    });

    const result: TwilioSignatureCheck = await accountThatSigned(
      receivedRequest({
        url: STATUS_CALLBACK_URL,
        parameters: parameters,
        signature: signature,
      }),
    );

    expect(result.account).toBeNull();
  });
});
