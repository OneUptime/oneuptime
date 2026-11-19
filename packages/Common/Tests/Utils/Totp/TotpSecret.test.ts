import { describe, expect, test } from "@jest/globals";
import {
  TOTP_DEFAULT_PERIOD_IN_SECONDS,
  TOTP_MAX_SECRET_LENGTH,
  TOTP_MIN_SECRET_LENGTH,
  TOTP_SECRET_PROBLEMS,
  TotpAlgorithm,
  TotpCodeWindow,
  TotpParameters,
  TotpSecretReading,
  generateTotpCode,
  getTotpCodeWindow,
  getTotpMinimumValidityInMs,
  getTotpWaitInMs,
  isTotpParameters,
  readTotpSecret,
  writeStoredTotpSecret,
  writeTotpSecretProblem,
} from "../../../Utils/Totp/TotpSecret";

/*
 * A TOTP monitor secret (issue #9703): how a setup key or an otpauth:// link
 * is read, the one form it is stored in, the codes it makes - held to RFC
 * 6238's own test vectors for every algorithm and both code lengths - and
 * when a code about to expire is not handed out.
 */

/*
 * RFC 6238, Appendix B. The seed of each algorithm is the ASCII string
 * "1234567890" repeated to the algorithm's key length (20, 32 and 64
 * bytes), as the RFC's reference implementation uses it; here in base32.
 */
const RFC_SEEDS: Record<TotpAlgorithm, string> = {
  [TotpAlgorithm.SHA1]: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  [TotpAlgorithm.SHA256]:
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
  [TotpAlgorithm.SHA512]:
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
};

// [time in seconds, SHA1, SHA256, SHA512], the table's 8-digit codes.
const RFC_VECTORS: Array<[number, string, string, string]> = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

function parameters(
  algorithm: TotpAlgorithm,
  digits: number,
  periodInSeconds: number = 30,
): TotpParameters {
  return {
    secret: RFC_SEEDS[algorithm],
    algorithm,
    digits,
    periodInSeconds,
  };
}

function readParameters(value: unknown): TotpParameters {
  const reading: TotpSecretReading = readTotpSecret(value);

  expect(reading.problem).toBeUndefined();

  return reading.parameters as TotpParameters;
}

function readProblem(value: unknown): string {
  const reading: TotpSecretReading = readTotpSecret(value);

  expect(reading.parameters).toBeUndefined();

  return writeTotpSecretProblem(reading.problem!);
}

const SHA1_SEED: string = RFC_SEEDS[TotpAlgorithm.SHA1];

describe("the RFC 6238 test vectors", () => {
  const cases: Array<[TotpAlgorithm, number, string]> = [];

  for (const [time, sha1, sha256, sha512] of RFC_VECTORS) {
    cases.push([TotpAlgorithm.SHA1, time, sha1]);
    cases.push([TotpAlgorithm.SHA256, time, sha256]);
    cases.push([TotpAlgorithm.SHA512, time, sha512]);
  }

  test.each(cases)(
    "%s at %i seconds makes the RFC's 8-digit code %s",
    (algorithm: TotpAlgorithm, time: number, code: string) => {
      expect(generateTotpCode(parameters(algorithm, 8), time * 1000)).toBe(
        code,
      );
    },
  );

  /*
   * A 6-digit code is the same truncated number modulo 10^6: the last six
   * digits of the 8-digit one.
   */
  test.each(cases)(
    "%s at %i seconds makes the 6-digit code the 8-digit %s ends in",
    (algorithm: TotpAlgorithm, time: number, code: string) => {
      expect(generateTotpCode(parameters(algorithm, 6), time * 1000)).toBe(
        code.slice(2),
      );
    },
  );

  test("keeps a code's leading zero", () => {
    // 07081804 at 1111111109 s.
    expect(
      generateTotpCode(parameters(TotpAlgorithm.SHA1, 8), 1111111109 * 1000),
    ).toBe("07081804");
  });

  test("makes the same code anywhere in a period, and the next at its end", () => {
    const sha1: TotpParameters = parameters(TotpAlgorithm.SHA1, 8);

    // 1111111109 and 1111111111 straddle a 30-second boundary at ...110.
    expect(generateTotpCode(sha1, 1111111080 * 1000)).toBe("07081804");
    expect(generateTotpCode(sha1, 1111111109999)).toBe("07081804");
    expect(generateTotpCode(sha1, 1111111110000)).toBe("14050471");
  });

  test("honours a period other than 30 seconds", () => {
    // T = floor(59 / 60) = 0, not 1: a different code from the RFC's 59 s.
    const sixty: string = generateTotpCode(
      parameters(TotpAlgorithm.SHA1, 8, 60),
      59 * 1000,
    );

    expect(sixty).not.toBe("94287082");
    expect(sixty).toBe(
      generateTotpCode(parameters(TotpAlgorithm.SHA1, 8, 30), 0),
    );
  });
});

describe("reading a bare setup key", () => {
  test("takes the defaults every authenticator app assumes", () => {
    expect(readParameters(SHA1_SEED)).toEqual({
      secret: SHA1_SEED,
      algorithm: TotpAlgorithm.SHA1,
      digits: 6,
      periodInSeconds: TOTP_DEFAULT_PERIOD_IN_SECONDS,
    });
  });

  test("reads it as the apps do: spaces, hyphens, padding and lower case", () => {
    for (const written of [
      "GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ",
      "gezdgnbvgy3tqojqgezdgnbvgy3tqojq",
      "GEZD-GNBV-GY3T-QOJQ-GEZD-GNBV-GY3T-QOJQ",
      `  ${SHA1_SEED}\n`,
      `${SHA1_SEED}======`,
      "gezd gnbv gy3t qojq\tgezd gnbv gy3t qojq",
    ]) {
      expect({ written, secret: readParameters(written).secret }).toEqual({
        written,
        secret: SHA1_SEED,
      });
    }
  });

  test("names the characters base32 does not use, and what they may be", () => {
    const problem: string = readProblem("JBSW Y3DP EHPK 3PX0 1BC8");

    expect(problem).toBe(
      "A setup key has only the letters A to Z and the digits 2 to 7, and this one has 0, 1, 8. Check for a 0 that should be an O, or a 1 or 8 that should be an I or a B.",
    );
  });

  test("names at most five of them, each once", () => {
    expect(readProblem("JBSWY3DPEHPK3PXP!!@@##$$%%^^&&")).toContain(
      "this one has !, @, #, $, %.",
    );
  });

  test("refuses padding that is not at the end", () => {
    expect(readProblem("JBSWY3DP=EHPK3PXPJBSW")).toContain("this one has =.");
  });

  test("refuses a key too short to have been copied whole", () => {
    expect(readProblem("JBSWY3DPEHPK3PX")).toBe(
      `This setup key is too short: a setup key has at least ${TOTP_MIN_SECRET_LENGTH} characters. Check that you copied all of it.`,
    );
    expect(readParameters("JBSWY3DPEHPK3PXP").secret).toBe("JBSWY3DPEHPK3PXP");
  });

  test("refuses a key longer than any site's", () => {
    const longest: string = "A".repeat(TOTP_MAX_SECRET_LENGTH);

    expect(readParameters(longest).secret).toBe(longest);
    expect(readProblem(`${longest}A`)).toBe(
      `This setup key is longer than ${TOTP_MAX_SECRET_LENGTH} characters, longer than any site's. Check that you pasted only the key.`,
    );
  });

  test("asks for a value when there is none", () => {
    for (const empty of [
      "",
      "   ",
      "\n",
      " - - ",
      "====",
      undefined,
      null,
      42,
    ]) {
      expect(readProblem(empty)).toBe(TOTP_SECRET_PROBLEMS.empty);
    }
  });

  test("refuses a value too long to be any secret", () => {
    expect(
      readProblem(`otpauth://totp/a?secret=${"A".repeat(9000)}`),
    ).toContain("longer than");
  });
});

describe("reading an otpauth:// link (Google's Key URI format)", () => {
  test("reads the secret and takes the defaults for what the link leaves out", () => {
    expect(
      readParameters(
        `otpauth://totp/Example:alice@google.com?secret=${SHA1_SEED}&issuer=Example`,
      ),
    ).toEqual({
      secret: SHA1_SEED,
      algorithm: TotpAlgorithm.SHA1,
      digits: 6,
      periodInSeconds: 30,
    });
  });

  test("honours its algorithm, digits and period", () => {
    expect(
      readParameters(
        `otpauth://totp/ACME%20Co:john.doe@email.com?secret=${RFC_SEEDS[TotpAlgorithm.SHA512]}&issuer=ACME%20Co&algorithm=SHA512&digits=8&period=60`,
      ),
    ).toEqual({
      secret: RFC_SEEDS[TotpAlgorithm.SHA512],
      algorithm: TotpAlgorithm.SHA512,
      digits: 8,
      periodInSeconds: 60,
    });
  });

  test("reads the algorithm however the issuer spelled it", () => {
    for (const [written, algorithm] of [
      ["SHA1", TotpAlgorithm.SHA1],
      ["sha1", TotpAlgorithm.SHA1],
      ["SHA256", TotpAlgorithm.SHA256],
      ["sha-256", TotpAlgorithm.SHA256],
      ["Sha512", TotpAlgorithm.SHA512],
      ["SHA-512", TotpAlgorithm.SHA512],
      ["", TotpAlgorithm.SHA1],
    ] as Array<[string, TotpAlgorithm]>) {
      expect({
        written,
        algorithm: readParameters(
          `otpauth://totp/a?secret=${SHA1_SEED}&algorithm=${written}`,
        ).algorithm,
      }).toEqual({ written, algorithm });
    }
  });

  test("makes the RFC's codes from a link of each algorithm", () => {
    for (const algorithm of [
      TotpAlgorithm.SHA1,
      TotpAlgorithm.SHA256,
      TotpAlgorithm.SHA512,
    ]) {
      const read: TotpParameters = readParameters(
        `otpauth://totp/RFC?secret=${RFC_SEEDS[algorithm]}&algorithm=${algorithm}&digits=8`,
      );
      const column: number =
        algorithm === TotpAlgorithm.SHA1
          ? 1
          : algorithm === TotpAlgorithm.SHA256
            ? 2
            : 3;

      for (const vector of RFC_VECTORS) {
        expect(generateTotpCode(read, vector[0] * 1000)).toBe(vector[column]);
      }
    }
  });

  test("reads the scheme and the type in any case, and ignores a fragment", () => {
    expect(
      readParameters(`OTPAUTH://TOTP/Label?SECRET=x&secret=${SHA1_SEED}#top`)
        .secret,
    ).toBe(SHA1_SEED);
  });

  test("reads a secret written with spaces, encoded or not, and in lower case", () => {
    expect(
      readParameters(
        "otpauth://totp/a?secret=gezd%20gnbv%20gy3t%20qojq+gezd+gnbv+gy3t+qojq",
      ).secret,
    ).toBe(SHA1_SEED);
  });

  test("reads a link with no label", () => {
    expect(readParameters(`otpauth://totp?secret=${SHA1_SEED}`).secret).toBe(
      SHA1_SEED,
    );
    expect(readParameters(`otpauth://totp/?secret=${SHA1_SEED}`).secret).toBe(
      SHA1_SEED,
    );
  });

  test("reads the first secret, and never a parameter that only ends in it", () => {
    expect(
      readParameters(
        `otpauth://totp/a?client_secret=NOTTHISONEXXXXXX&secret=${SHA1_SEED}&secret=JBSWY3DPEHPK3PXP`,
      ).secret,
    ).toBe(SHA1_SEED);
    expect(readProblem("otpauth://totp/a?client_secret=JBSWY3DPEHPK3PXP")).toBe(
      TOTP_SECRET_PROBLEMS.linkWithoutSecret,
    );
  });

  test("ignores the parameters that only name the account", () => {
    expect(
      readParameters(
        `otpauth://totp/Big%20Corp:ops@example.com?issuer=Big%20Corp&image=https%3A%2F%2Fexample.com%2Flogo.png&counter=7&secret=${SHA1_SEED}`,
      ),
    ).toEqual(readParameters(SHA1_SEED));
  });

  test("says a counter-based link is not one a monitor can use", () => {
    expect(readProblem(`otpauth://hotp/a?secret=${SHA1_SEED}&counter=1`)).toBe(
      TOTP_SECRET_PROBLEMS.counterLink,
    );
  });

  test("says an export link of many accounts is not one account's", () => {
    expect(
      readProblem("otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGA"),
    ).toBe(TOTP_SECRET_PROBLEMS.migrationLink);
  });

  test("says what is wrong with a link it cannot read", () => {
    for (const malformed of [
      "otpauth://",
      "otpauth:totp/a?secret=GEZDGNBVGY3TQOJQ",
      "otpauth://steam/a?secret=GEZDGNBVGY3TQOJQ",
      "otpauth:/totp/a?secret=GEZDGNBVGY3TQOJQ",
    ]) {
      expect({ malformed, problem: readProblem(malformed) }).toEqual({
        malformed,
        problem: TOTP_SECRET_PROBLEMS.unreadableLink,
      });
    }
  });

  test("says a link has no secret", () => {
    for (const withoutSecret of [
      "otpauth://totp/a",
      "otpauth://totp/a?issuer=Example",
      "otpauth://totp/a?secret=",
      "otpauth://totp/a?secret=%20%20",
    ]) {
      expect({ withoutSecret, problem: readProblem(withoutSecret) }).toEqual({
        withoutSecret,
        problem: TOTP_SECRET_PROBLEMS.linkWithoutSecret,
      });
    }
  });

  test("says what is wrong with the secret it holds", () => {
    expect(readProblem("otpauth://totp/a?secret=ABC")).toContain("too short");
    expect(readProblem("otpauth://totp/a?secret=GEZDGNBVGY3TQOJ0")).toContain(
      "this one has 0.",
    );
  });

  test("names an algorithm a monitor cannot make codes with", () => {
    expect(
      readProblem(`otpauth://totp/a?secret=${SHA1_SEED}&algorithm=MD5`),
    ).toBe(
      "This link asks for the MD5 algorithm. A monitor can make codes with SHA1, SHA256 or SHA512.",
    );
    expect(
      readProblem(`otpauth://totp/a?secret=${SHA1_SEED}&algorithm=SHA224`),
    ).toContain("the SHA224 algorithm");
  });

  test("names a code length a monitor cannot make", () => {
    for (const digits of ["7", "4", "10", "six", "6.0", "-6"]) {
      expect({
        digits,
        problem: readProblem(
          `otpauth://totp/a?secret=${SHA1_SEED}&digits=${digits}`,
        ),
      }).toEqual({
        digits,
        problem: `This link asks for codes of ${digits} digits. A monitor can make codes of 6 or 8 digits.`,
      });
    }

    expect(
      readParameters(`otpauth://totp/a?secret=${SHA1_SEED}&digits=8`).digits,
    ).toBe(8);
  });

  test("names a period a monitor cannot keep", () => {
    for (const period of ["0", "3601", "-30", "30.5", "thirty", "1e3"]) {
      expect({
        period,
        problem: readProblem(
          `otpauth://totp/a?secret=${SHA1_SEED}&period=${period}`,
        ),
      }).toEqual({
        period,
        problem: `This link asks for a new code every ${period} seconds. The period must be a whole number of seconds from 1 to 3600.`,
      });
    }

    for (const period of [1, 15, 30, 60, 3600]) {
      expect(
        readParameters(`otpauth://totp/a?secret=${SHA1_SEED}&period=${period}`)
          .periodInSeconds,
      ).toBe(period);
    }
  });

  test("takes an empty parameter as left out", () => {
    expect(
      readParameters(
        `otpauth://totp/a?secret=${SHA1_SEED}&algorithm=&digits=&period=`,
      ),
    ).toEqual(readParameters(SHA1_SEED));
  });
});

describe("the stored form", () => {
  test("holds exactly what codes are made from, and reads back the same", () => {
    const read: TotpParameters = readParameters(
      `otpauth://totp/ACME:jo?issuer=ACME&secret=${RFC_SEEDS[TotpAlgorithm.SHA256].toLowerCase()}&algorithm=sha-256&digits=8&period=45`,
    );
    const stored: string = writeStoredTotpSecret(read);

    expect(stored).toBe(
      `otpauth://totp/OneUptime?secret=${RFC_SEEDS[TotpAlgorithm.SHA256]}&algorithm=SHA256&digits=8&period=45`,
    );
    expect(readParameters(stored)).toEqual(read);
  });

  test("is the same whatever form the key was pasted in", () => {
    expect(
      writeStoredTotpSecret(
        readParameters("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"),
      ),
    ).toBe(
      writeStoredTotpSecret(
        readParameters(`otpauth://totp/x?secret=${SHA1_SEED}`),
      ),
    );
  });
});

describe("parameters as they travel to the probe", () => {
  const valid: TotpParameters = parameters(TotpAlgorithm.SHA256, 8, 60);

  test("are recognised when whole", () => {
    expect(isTotpParameters(valid)).toBe(true);
  });

  test("are refused when anything is off", () => {
    for (const broken of [
      null,
      undefined,
      "otpauth://totp/a",
      [],
      { ...valid, secret: "short" },
      { ...valid, secret: valid.secret.toLowerCase() },
      { ...valid, secret: `${valid.secret}=` },
      { ...valid, algorithm: "MD5" },
      { ...valid, digits: 7 },
      { ...valid, digits: "6" },
      { ...valid, periodInSeconds: 0 },
      { ...valid, periodInSeconds: 30.5 },
      { ...valid, periodInSeconds: 3601 },
      { ...valid, periodInSeconds: "30" },
    ]) {
      expect({ broken, valid: isTotpParameters(broken) }).toEqual({
        broken,
        valid: false,
      });
    }
  });
});

describe("a code's period", () => {
  const sha1: TotpParameters = parameters(TotpAlgorithm.SHA1, 6);

  test("runs from the start of its 30-second step to the start of the next", () => {
    const window: TotpCodeWindow = getTotpCodeWindow(sha1, 59 * 1000);

    expect(window).toEqual({
      code: "287082",
      startsAtInMs: 30 * 1000,
      endsAtInMs: 60 * 1000,
    });
  });
});

/*
 * The expiry edge: a code is handed out only with at least five seconds
 * left - a third of the period when the period is shorter than fifteen
 * seconds - and otherwise the next period's code is waited for.
 */
describe("a code about to expire", () => {
  const thirty: TotpParameters = parameters(TotpAlgorithm.SHA1, 6, 30);
  const periodStart: number = 1111111110000;

  test("needs five seconds left, or a third of a short period", () => {
    expect(getTotpMinimumValidityInMs(30)).toBe(5000);
    expect(getTotpMinimumValidityInMs(60)).toBe(5000);
    expect(getTotpMinimumValidityInMs(15)).toBe(5000);
    expect(getTotpMinimumValidityInMs(12)).toBe(4000);
    expect(getTotpMinimumValidityInMs(10)).toBe(3333);
    expect(getTotpMinimumValidityInMs(1)).toBe(333);
  });

  test("is not waited for while it has enough time left", () => {
    expect(getTotpWaitInMs(thirty, periodStart)).toBe(0);
    expect(getTotpWaitInMs(thirty, periodStart + 1)).toBe(0);
    expect(getTotpWaitInMs(thirty, periodStart + 24_999)).toBe(0);
    // Exactly five seconds left is enough.
    expect(getTotpWaitInMs(thirty, periodStart + 25_000)).toBe(0);
  });

  test("waits for the next period when less than five seconds are left", () => {
    expect(getTotpWaitInMs(thirty, periodStart + 25_001)).toBe(4_999);
    expect(getTotpWaitInMs(thirty, periodStart + 27_500)).toBe(2_500);
    expect(getTotpWaitInMs(thirty, periodStart + 29_999)).toBe(1);
  });

  test("never waits as long as five seconds, and lands on the next period", () => {
    for (let elapsed: number = 0; elapsed < 30_000; elapsed += 250) {
      const at: number = periodStart + elapsed;
      const wait: number = getTotpWaitInMs(thirty, at);

      expect(wait).toBeLessThan(5000);

      if (wait > 0) {
        expect((at + wait) % 30_000).toBe(0);
        expect(getTotpWaitInMs(thirty, at + wait)).toBe(0);
        expect(generateTotpCode(thirty, at + wait)).toBe(
          generateTotpCode(thirty, periodStart + 30_000),
        );
      }
    }
  });

  test("scales to a short period", () => {
    const ten: TotpParameters = parameters(TotpAlgorithm.SHA1, 6, 10);
    const start: number = 1_700_000_000_000;

    expect(getTotpWaitInMs(ten, start + 6_667)).toBe(0);
    expect(getTotpWaitInMs(ten, start + 6_668)).toBe(3_332);
  });
});
