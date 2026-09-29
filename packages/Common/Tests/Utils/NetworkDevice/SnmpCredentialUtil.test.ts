import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import {
  SnmpCredentialCarrier,
  hasUsableCredentials,
} from "../../../Utils/NetworkDevice/SnmpCredentialUtil";

/*
 * hasUsableCredentials is the predicate behind the poller's resolution order:
 * device columns, then the device's profile, then the site's profile, first
 * usable set wins, and with none the device is only pinged. It cannot throw
 * and it cannot look broken - a wrong answer just quietly leaves a device
 * un-walked, or walks it with a set that will never authenticate - so the
 * whole matrix is pinned here: every spelling of every version, crossed with
 * every way a credential can be missing.
 */

const EMPTY_VALUES: ReadonlyArray<string | null | undefined> = [
  undefined,
  null,
  "",
  " ",
  "   ",
  "\t",
  "\n",
];

/*
 * The stored spelling ("V2c"), the probe-contract spelling ("2c"), and the
 * case drift a hand-written row produces. SnmpVersionUtil.parse accepts all
 * of them, and this util must agree with parse rather than compare raw text.
 */
const V1_SPELLINGS: ReadonlyArray<string> = ["V1", "v1", "1"];
const V2C_SPELLINGS: ReadonlyArray<string> = ["V2c", "v2c", "V2C", "2c", "2C"];
const V3_SPELLINGS: ReadonlyArray<string> = ["V3", "v3", "3"];

describe("hasUsableCredentials - v1 and v2c need a community string", () => {
  test.each([...V1_SPELLINGS, ...V2C_SPELLINGS])(
    "version %p with a community string is usable",
    (version: string) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpCommunityString: "public",
        }),
      ).toBe(true);
    },
  );

  test.each([...V1_SPELLINGS, ...V2C_SPELLINGS])(
    "version %p with a whitespace-padded community string is still usable",
    (version: string) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpCommunityString: "  public  ",
        }),
      ).toBe(true);
    },
  );

  const missingCommunity: Array<[string, string | null | undefined]> = [];
  for (const version of [...V1_SPELLINGS, ...V2C_SPELLINGS]) {
    for (const empty of EMPTY_VALUES) {
      missingCommunity.push([version, empty]);
    }
  }

  test.each(missingCommunity)(
    "version %p with community string %p is not usable",
    (version: string, community: string | null | undefined) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpCommunityString: community,
        }),
      ).toBe(false);
    },
  );

  /*
   * A v3 username on a v2c row is a leftover from switching the version in a
   * form, not a credential v2c can send. It must not rescue the row.
   */
  test.each([...V1_SPELLINGS, ...V2C_SPELLINGS])(
    "version %p is not rescued by a v3 username",
    (version: string) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpCommunityString: "",
          snmpV3Username: "monitoring",
        }),
      ).toBe(false);
    },
  );
});

describe("hasUsableCredentials - v3 needs a security name", () => {
  test.each(V3_SPELLINGS)(
    "version %p with a username is usable",
    (version: string) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpV3Username: "monitoring",
        }),
      ).toBe(true);
    },
  );

  /*
   * Auth and privacy keys are legitimately absent at noAuthNoPriv, so the
   * predicate reads neither: a v3 row is usable on its username alone. A key
   * that is missing at a higher security level is the device's error to
   * report, not this function's to predict.
   */
  test.each(V3_SPELLINGS)(
    "version %p is usable on the username alone, with no keys at all",
    (version: string) => {
      const carrier: SnmpCredentialCarrier & {
        snmpV3AuthKey?: string | undefined;
        snmpV3PrivKey?: string | undefined;
      } = {
        snmpVersion: version,
        snmpV3Username: "monitoring",
        snmpV3AuthKey: undefined,
        snmpV3PrivKey: undefined,
      };

      expect(hasUsableCredentials(carrier)).toBe(true);
    },
  );

  const missingUsername: Array<[string, string | null | undefined]> = [];
  for (const version of V3_SPELLINGS) {
    for (const empty of EMPTY_VALUES) {
      missingUsername.push([version, empty]);
    }
  }

  test.each(missingUsername)(
    "version %p with username %p is not usable",
    (version: string, username: string | null | undefined) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpV3Username: username,
        }),
      ).toBe(false);
    },
  );

  /*
   * The mirror of the v2c case above. A community string on a v3 row is what
   * a device that was upgraded from v2c still carries; v3 cannot send it, so
   * it must not make the row usable.
   */
  test.each(V3_SPELLINGS)(
    "version %p is not rescued by a community string",
    (version: string) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpCommunityString: "public",
          snmpV3Username: "",
        }),
      ).toBe(false);
    },
  );
});

describe("hasUsableCredentials - a missing or unrecognised version reads as v2c", () => {
  /*
   * The column default on both the device and the profile is "V2c", and
   * SnmpVersionUtil.parse falls back to v2c for anything it does not
   * recognise. A row with a community string and no version is therefore
   * polled as v2c, and this predicate has to say so, or a freshly created
   * profile that never had its version touched would count as unusable.
   */
  test.each([undefined, null, "", "   ", "V4", "snmp", "2"])(
    "version %p with a community string is usable, as v2c",
    (version: string | null | undefined) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpCommunityString: "public",
        }),
      ).toBe(true);
    },
  );

  test.each([undefined, null, "", "V4"])(
    "version %p with only a v3 username is not usable, because it is not v3",
    (version: string | null | undefined) => {
      expect(
        hasUsableCredentials({
          snmpVersion: version,
          snmpV3Username: "monitoring",
        }),
      ).toBe(false);
    },
  );

  test("an empty object is not usable", () => {
    expect(hasUsableCredentials({})).toBe(false);
  });
});

describe("hasUsableCredentials - accepts any row carrying the three fields", () => {
  /*
   * The resolution order asks this question of a NetworkDevice and then of a
   * NetworkSnmpCredentialProfile, so both model classes have to be
   * assignable to the parameter without a cast. These are compile-time
   * assertions as much as runtime ones: if either model renames one of the
   * three columns, ts-jest refuses to compile this file.
   */
  test("a NetworkDevice row is accepted as-is", () => {
    const device: NetworkDevice = new NetworkDevice();
    device.snmpVersion = "V2c";
    device.snmpCommunityString = "public";

    expect(hasUsableCredentials(device)).toBe(true);

    device.snmpCommunityString = "";

    expect(hasUsableCredentials(device)).toBe(false);
  });

  test("a NetworkSnmpCredentialProfile row is accepted as-is", () => {
    const profile: NetworkSnmpCredentialProfile =
      new NetworkSnmpCredentialProfile();
    profile.snmpVersion = "V3";
    profile.snmpV3Username = "monitoring";

    expect(hasUsableCredentials(profile)).toBe(true);

    profile.snmpV3Username = "";

    expect(hasUsableCredentials(profile)).toBe(false);
  });

  /*
   * A freshly constructed model has every column undefined. That is the
   * state of a device registered with nothing but an address - the exact
   * case profiles exist for - and it must read as "ping only".
   */
  test("a bare model with nothing set is not usable", () => {
    expect(hasUsableCredentials(new NetworkDevice())).toBe(false);
    expect(hasUsableCredentials(new NetworkSnmpCredentialProfile())).toBe(
      false,
    );
  });

  test("it never mutates the row it is asked about", () => {
    const carrier: SnmpCredentialCarrier = {
      snmpVersion: " v3 ",
      snmpCommunityString: "  public ",
      snmpV3Username: "  monitoring ",
    };
    const snapshot: SnmpCredentialCarrier = { ...carrier };

    hasUsableCredentials(carrier);

    expect(carrier).toEqual(snapshot);
  });
});
