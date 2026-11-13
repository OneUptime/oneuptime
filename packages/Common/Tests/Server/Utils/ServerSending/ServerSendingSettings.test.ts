import ServerSendingSettings, {
  ServerSendingSettingsRow,
} from "../../../../Server/Utils/ServerSending/ServerSendingSettings";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import { CallAndSmsProvider } from "../../../../Types/CallAndSMS/CallAndSmsProvider";
import {
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ServerTwilioEnvironmentVariable,
} from "../../../../Types/CallAndSMS/ServerTwilioEnvironment";
import { TwilioConfigUse } from "../../../../Types/CallAndSMS/TwilioConfigUse";
import Phone from "../../../../Types/Phone";
import {
  SERVER_SENDING_CHANNELS,
  ServerSendingChannel,
  ServerSendingSettingsFingerprints,
} from "../../../../Types/ServerSending/ServerSendingStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHICH ROUTE THE SERVER'S OWN SMS AND CALLS TAKE, AS FINGERPRINTS (#7736).
 *
 * What the server remembers of its own SMS and calls is marked with the
 * route it was learned with, so that the Twilio account changing without a
 * save - the GLOBAL_TWILIO_ environment variables set (#7515), changed or
 * unset - starts SMS and calls again at untested. The route is read as the
 * senders take it: the gateway when one is chosen with an address, else the
 * account the variables set once GLOBAL_TWILIO_ACCOUNT_SID is, else the
 * saved account. `unmarked` is always the saved route: what an entry from
 * before there were fingerprints was learned with.
 */

const SAVED_SID: string = "AC11111111111111111111111111111111";
const SAVED_TOKEN: string = "saved-auth-token-sentinel-1111";
const SAVED_NUMBER: string = "+15550001111";

const ENV_SID: string = "AC22222222222222222222222222222222";
const ENV_TOKEN: string = "environment-auth-token-sentinel-2222";
const ENV_NUMBER: string = "+14155550100";

const UK: string = "+447700900123";
const SG: string = "+6581234567";

const HEX_DIGEST: RegExp = /^[0-9a-f]{64}$/;

function savedRow(
  values: Partial<Record<keyof ServerSendingSettingsRow, unknown>> = {},
): GlobalConfig {
  return Object.assign(
    new GlobalConfig(),
    {
      twilioAccountSID: SAVED_SID,
      twilioAuthToken: SAVED_TOKEN,
      twilioPrimaryPhoneNumber: new Phone(SAVED_NUMBER),
    },
    values,
  );
}

const before: Record<string, string | undefined> = {};

function setEnvironment(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>>,
): void {
  for (const [variable, value] of Object.entries(values)) {
    process.env[variable] = value;
  }
}

function setEnvironmentAccount(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>> = {},
): void {
  setEnvironment({
    [ServerTwilioEnvironmentVariable.AccountSid]: ENV_SID,
    [ServerTwilioEnvironmentVariable.AuthToken]: ENV_TOKEN,
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: ENV_NUMBER,
    ...values,
  });
}

function fingerprintsOf(
  row: GlobalConfig | null,
  channel: ServerSendingChannel = ServerSendingChannel.SMS,
): ServerSendingSettingsFingerprints {
  const fingerprints: ServerSendingSettingsFingerprints | null =
    ServerSendingSettings.getFingerprints(channel, row);

  expect(fingerprints).not.toBeNull();

  return fingerprints!;
}

beforeEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }
});

afterEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  jest.restoreAllMocks();
});

describe("which channels carry fingerprints", () => {
  test("email, SMS and calls, whose settings can change without a save (#7803 for email); not push", () => {
    expect(
      SERVER_SENDING_CHANNELS.filter((channel: ServerSendingChannel) => {
        return ServerSendingSettings.hasFingerprints(channel);
      }),
    ).toEqual([
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
    ]);

    setEnvironmentAccount();

    expect(
      ServerSendingSettings.getFingerprints(
        ServerSendingChannel.Email,
        savedRow(),
      ),
    ).not.toBeNull();
    expect(
      ServerSendingSettings.getFingerprints(
        ServerSendingChannel.Push,
        savedRow(),
      ),
    ).toBeNull();
  });

  test("SMS and calls share one route, so one fingerprint", () => {
    setEnvironmentAccount();

    expect(fingerprintsOf(savedRow(), ServerSendingChannel.SMS)).toEqual(
      fingerprintsOf(savedRow(), ServerSendingChannel.Call),
    );
  });
});

describe("the route the saved settings give", () => {
  test("without the variables, the saved account is the route sending now", () => {
    const fingerprints: ServerSendingSettingsFingerprints =
      fingerprintsOf(savedRow());

    expect(fingerprints.current).toMatch(HEX_DIGEST);
    expect(fingerprints.current).toBe(fingerprints.unmarked);
  });

  test("the same saved account gives the same fingerprint every time", () => {
    expect(fingerprintsOf(savedRow()).current).toBe(
      fingerprintsOf(savedRow()).current,
    );
  });

  test.each([
    [
      "the account SID",
      { twilioAccountSID: "AC99999999999999999999999999999999" },
    ],
    ["the auth token", { twilioAuthToken: "another-auth-token" }],
    ["what it is used for", { twilioUsedFor: TwilioConfigUse.CallsOnly }],
    ["the primary number", { twilioPrimaryPhoneNumber: new Phone(UK) }],
    ["the secondary numbers", { twilioSecondaryPhoneNumbers: UK }],
    ["the SMS numbers", { twilioSmsPhoneNumbers: SG }],
  ])(
    "a saved account with another %s is another route",
    (_label: string, change: Partial<Record<string, unknown>>) => {
      expect(fingerprintsOf(savedRow(change)).current).not.toBe(
        fingerprintsOf(savedRow()).current,
      );
    },
  );

  test("no saved account, a null row and an empty row are one route: nothing set up", () => {
    const empty: string = fingerprintsOf(new GlobalConfig()).current;

    expect(fingerprintsOf(null).current).toBe(empty);
    expect(empty).not.toBe(fingerprintsOf(savedRow()).current);
  });

  test("a use left empty is calls and SMS, as the senders read it", () => {
    expect(
      fingerprintsOf(savedRow({ twilioUsedFor: TwilioConfigUse.CallsAndSms }))
        .current,
    ).toBe(fingerprintsOf(savedRow({ twilioUsedFor: null })).current);
  });

  test("a list of numbers is the same list however it is spaced", () => {
    expect(
      fingerprintsOf(savedRow({ twilioSecondaryPhoneNumbers: `${UK},${SG}` }))
        .current,
    ).toBe(
      fingerprintsOf(
        savedRow({ twilioSecondaryPhoneNumbers: ` ${UK} , ${SG} ,` }),
      ).current,
    );
  });

  test("a list of numbers kept from before lists were checked is still read, never thrown on", () => {
    const row: GlobalConfig = savedRow({
      twilioSecondaryPhoneNumbers: "not a number, +1 415 555 CALL",
    });

    expect(() => {
      return fingerprintsOf(row);
    }).not.toThrow();
    expect(fingerprintsOf(row).current).not.toBe(
      fingerprintsOf(savedRow()).current,
    );
  });
});

describe("the route the GLOBAL_TWILIO_ variables give", () => {
  test("once GLOBAL_TWILIO_ACCOUNT_SID is set, their account is the route; the saved one stays unmarked", () => {
    const saved: ServerSendingSettingsFingerprints = fingerprintsOf(savedRow());

    setEnvironmentAccount();

    const underVariables: ServerSendingSettingsFingerprints =
      fingerprintsOf(savedRow());

    expect(underVariables.current).toMatch(HEX_DIGEST);
    expect(underVariables.current).not.toBe(saved.current);
    expect(underVariables.unmarked).toBe(saved.current);
  });

  test("whatever the row holds: an empty row under the same variables is the same route", () => {
    setEnvironmentAccount();

    expect(fingerprintsOf(new GlobalConfig()).current).toBe(
      fingerprintsOf(savedRow()).current,
    );
    expect(fingerprintsOf(null).current).toBe(
      fingerprintsOf(savedRow()).current,
    );
  });

  test.each([
    [
      ServerTwilioEnvironmentVariable.AccountSid,
      "AC33333333333333333333333333333333",
    ],
    [ServerTwilioEnvironmentVariable.AuthToken, "a-fixed-auth-token"],
    [ServerTwilioEnvironmentVariable.UsedFor, "calls-only"],
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber, UK],
    [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers, UK],
    [ServerTwilioEnvironmentVariable.SmsPhoneNumbers, SG],
  ])(
    "changing %s is another route",
    (variable: ServerTwilioEnvironmentVariable, value: string) => {
      setEnvironmentAccount();

      const first: string = fingerprintsOf(savedRow()).current;

      setEnvironment({ [variable]: value });

      expect(fingerprintsOf(savedRow()).current).not.toBe(first);
    },
  );

  test("variables that repeat the saved account are the same route: what was learned with it stays", () => {
    setEnvironment({
      [ServerTwilioEnvironmentVariable.AccountSid]: SAVED_SID,
      [ServerTwilioEnvironmentVariable.AuthToken]: SAVED_TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: SAVED_NUMBER,
      [ServerTwilioEnvironmentVariable.UsedFor]: "Calls and SMS",
    });

    const fingerprints: ServerSendingSettingsFingerprints =
      fingerprintsOf(savedRow());

    expect(fingerprints.current).toBe(fingerprints.unmarked);
  });

  test("variables set without GLOBAL_TWILIO_ACCOUNT_SID are read by nothing: the saved route stays", () => {
    const saved: string = fingerprintsOf(savedRow()).current;

    setEnvironment({
      [ServerTwilioEnvironmentVariable.AuthToken]: ENV_TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: ENV_NUMBER,
    });

    expect(fingerprintsOf(savedRow())).toEqual({
      current: saved,
      unmarked: saved,
    });
  });

  test("an account with a problem is still a route of its own, never the saved one", () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.AuthToken]: "",
    });

    const fingerprints: ServerSendingSettingsFingerprints =
      fingerprintsOf(savedRow());

    expect(fingerprints.current).not.toBe(fingerprints.unmarked);
  });

  test("the variables are read again on every call", () => {
    const saved: string = fingerprintsOf(savedRow()).current;

    setEnvironmentAccount();

    expect(fingerprintsOf(savedRow()).current).not.toBe(saved);

    delete process.env[ServerTwilioEnvironmentVariable.AccountSid];

    expect(fingerprintsOf(savedRow()).current).toBe(saved);
  });
});

describe("the gateway", () => {
  const gateway: Partial<Record<keyof ServerSendingSettingsRow, unknown>> = {
    callAndSmsProvider: CallAndSmsProvider.Gateway,
    callAndSmsGatewayUrl: "https://gateway.example.com/send",
    callAndSmsGatewaySecret: "gateway-secret-sentinel",
  };

  test("a gateway with an address carries SMS and calls whatever the variables say: no route change", () => {
    const withGateway: string = fingerprintsOf(savedRow(gateway)).current;

    setEnvironmentAccount();

    expect(fingerprintsOf(savedRow(gateway))).toEqual({
      current: withGateway,
      unmarked: withGateway,
    });
  });

  test("the gateway's own route is not the saved Twilio account's", () => {
    expect(fingerprintsOf(savedRow(gateway)).current).not.toBe(
      fingerprintsOf(savedRow()).current,
    );
  });

  test.each([
    ["address", { callAndSmsGatewayUrl: "https://other.example.com/send" }],
    ["secret", { callAndSmsGatewaySecret: "another-secret" }],
  ])(
    "another gateway %s is another route",
    (_label: string, change: Partial<Record<string, unknown>>) => {
      expect(
        fingerprintsOf(savedRow({ ...gateway, ...change })).current,
      ).not.toBe(fingerprintsOf(savedRow(gateway)).current);
    },
  );

  test("a gateway chosen without an address sends nothing through it: the Twilio account is the route", () => {
    expect(
      fingerprintsOf(savedRow({ ...gateway, callAndSmsGatewayUrl: "  " }))
        .current,
    ).toBe(fingerprintsOf(savedRow()).current);
  });
});

describe("what a fingerprint holds", () => {
  test("a hex digest: no SID, token, number or gateway secret in it", () => {
    setEnvironmentAccount();

    const fingerprints: ServerSendingSettingsFingerprints = fingerprintsOf(
      savedRow({
        callAndSmsGatewaySecret: "gateway-secret-sentinel",
      }),
    );

    for (const fingerprint of [fingerprints.current, fingerprints.unmarked]) {
      expect(fingerprint).toMatch(HEX_DIGEST);

      for (const secret of [
        SAVED_SID,
        SAVED_TOKEN,
        ENV_SID,
        ENV_TOKEN,
        ENV_NUMBER,
        "gateway-secret-sentinel",
      ]) {
        expect(fingerprint).not.toContain(secret);
      }
    }
  });

  test("parts are told apart by their lengths: moving text between two parts is another route", () => {
    expect(ServerSendingSettings.fingerprint(["ab", "c"])).not.toBe(
      ServerSendingSettings.fingerprint(["a", "bc"]),
    );
    expect(ServerSendingSettings.fingerprint(["abc"])).not.toBe(
      ServerSendingSettings.fingerprint(["ab", "c"]),
    );
  });

  test("keyed by the server's ENCRYPTION_SECRET: another server's fingerprint of the same account differs", () => {
    const here: string = ServerSendingSettings.fingerprint([
      "twilio",
      SAVED_SID,
      SAVED_TOKEN,
    ]);

    const previousSecret: string | undefined = process.env["ENCRYPTION_SECRET"];

    let elsewhere: string = "";

    try {
      process.env["ENCRYPTION_SECRET"] = "another-installations-secret";

      jest.isolateModules(() => {
        // A fresh module registry: EnvironmentConfig reads the secret anew.
        const isolatedModule: { default: typeof ServerSendingSettings } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("../../../../Server/Utils/ServerSending/ServerSendingSettings");

        elsewhere = isolatedModule.default.fingerprint([
          "twilio",
          SAVED_SID,
          SAVED_TOKEN,
        ]);
      });
    } finally {
      if (previousSecret === undefined) {
        delete process.env["ENCRYPTION_SECRET"];
      } else {
        process.env["ENCRYPTION_SECRET"] = previousSecret;
      }
    }

    expect(elsewhere).toMatch(HEX_DIGEST);
    expect(elsewhere).not.toBe(here);
  });
});
