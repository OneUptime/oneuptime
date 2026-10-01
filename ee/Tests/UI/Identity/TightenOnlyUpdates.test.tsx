import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import * as TightenOnlyUpdates from "../../../Dashboard/Identity/TightenOnly/TightenOnlyUpdates";
import {
  MIN_SCIM_BEARER_TOKEN_LENGTH,
  RandomValuesSource,
  SCIM_BEARER_TOKEN_BYTES,
  SCIM_BEARER_TOKEN_UNAVAILABLE_MESSAGE,
  buildRotateBearerTokenUpdate,
  generateScimBearerToken,
} from "../../../Dashboard/Identity/TightenOnly/TightenOnlyUpdates";
import ReadOnlyActionsNotice, {
  READ_ONLY_ACTIONS_NOTICE_TEST_ID,
  SCIM_ACTIONS_DESCRIPTION,
  SCIM_ACTIONS_TITLE,
} from "../../../Dashboard/Identity/TightenOnly/ReadOnlyActionsNotice";
import { EnterpriseLicenseMode } from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";

/*
 * The building blocks of the SCIM screens' incident-response action under a
 * read-only (lapsed) Enterprise license: the bearer-token update the server
 * accepts without a license, the token generator, and what the screens say
 * about it. ReadOnlyIncidentActions.test.tsx covers the screens;
 * ee/Tests/Server/Identity/TightenOnlyUiContract.test.ts checks the payload
 * against the server's own rules.
 *
 * Single sign-on has no such action: its configuration is never read-only,
 * so there is nothing to switch off "without a license".
 */

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const HEX_TOKEN: RegExp = /^[0-9a-f]+$/;

/*
 * While the license is lapsed, SCIM requests are already refused; they are
 * accepted again the moment a license is activated. So Reset Bearer Token is
 * about what happens then, and the notice must say that SCIM is off now and
 * comes back with a license.
 */
const SCIM_IS_REFUSED: RegExp = /SCIM requests are refused/;
const SCIM_RESUMES_WITH_A_LICENSE: RegExp =
  /accepted again as soon as a license is activated/;

// Says that SCIM requests are already refused, and are accepted again with a license.
const describesLapsedScim: (text: string) => boolean = (
  text: string,
): boolean => {
  return SCIM_IS_REFUSED.test(text) && SCIM_RESUMES_WITH_A_LICENSE.test(text);
};

// The provider notice, from when single sign-on stopped with the license.
const RETIRED_PROVIDER_ACTIONS_TITLE: string =
  "You can still disable a provider.";

const RETIRED_PROVIDER_ACTIONS_DESCRIPTION: string =
  "Without a valid Enterprise license this configuration is read-only and sign-in through these providers is off, but disabling a provider is always allowed, because it can only tighten security. Sign-in resumes through every enabled provider as soon as a license is activated, so if an identity provider is compromised, use Disable now to keep it off. Turning a provider back on needs a valid license.";

/*
 * What that notice talked about, and the SCIM notice never does. "Your
 * identity provider" is the SCIM client, so it does not count.
 */
const PROVIDER_CLAIMS: Array<RegExp> = [
  /(?<!identity )\bproviders?\b/i,
  /\bDisable\b/,
  /sign-in/i,
  /single sign-on/i,
];

const providerClaimsIn: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return PROVIDER_CLAIMS.filter((claim: RegExp) => {
    return claim.test(text);
  }).map((claim: RegExp) => {
    return claim.source;
  });
};

describe("the tighten-only payloads", () => {
  test("only the bearer-token rotation is left: there is no provider Disable payload", () => {
    const exported: Array<string> = Object.keys(TightenOnlyUpdates);

    expect(exported).toContain("buildRotateBearerTokenUpdate");
    expect(exported).toContain("generateScimBearerToken");
    expect(exported).not.toContain("buildDisableProviderUpdate");
  });
});

describe("generateScimBearerToken", () => {
  test("is 64 hexadecimal characters: 32 random bytes, twice the length the server asks for", () => {
    const token: string = generateScimBearerToken();

    expect(SCIM_BEARER_TOKEN_BYTES).toBe(32);
    expect(token).toHaveLength(SCIM_BEARER_TOKEN_BYTES * 2);
    expect(token).toMatch(HEX_TOKEN);
    expect(token.length).toBeGreaterThanOrEqual(MIN_SCIM_BEARER_TOKEN_LENGTH);
  });

  test("uses the Web Crypto random number generator, never Math.random", () => {
    const getRandomValues: jest.SpyInstance = jest.spyOn(
      globalThis.crypto,
      "getRandomValues",
    );
    const mathRandom: jest.SpyInstance = jest.spyOn(Math, "random");

    generateScimBearerToken();

    const mathRandomCalls: number = mathRandom.mock.calls.length;

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(mathRandomCalls).toBe(0);
  });

  test("encodes exactly the bytes the random source returns", () => {
    const source: RandomValuesSource = {
      getRandomValues: (array: Uint8Array): Uint8Array => {
        for (let i: number = 0; i < array.length; i++) {
          array[i] = i === 0 ? 0x0f : 0xab;
        }
        return array;
      },
    };

    // A leading 0x0f must stay two characters ("0f"), or the token shrinks.
    expect(generateScimBearerToken(source)).toBe(`0f${"ab".repeat(31)}`);
  });

  test("never repeats itself", () => {
    const tokens: Set<string> = new Set<string>();

    for (let i: number = 0; i < 500; i++) {
      tokens.add(generateScimBearerToken());
    }

    expect(tokens.size).toBe(500);
  });

  /*
   * Math.random is counted around the calls only: jest's own error
   * formatting (source maps) calls it while an assertion reads a stack.
   */
  test("without Web Crypto it refuses, instead of falling back to a guessable token (negative control)", () => {
    const captureError: (generate: () => string) => unknown = (
      generate: () => string,
    ): unknown => {
      try {
        generate();
      } catch (err) {
        return err;
      }

      return undefined;
    };

    const originalCrypto: Crypto = globalThis.crypto;
    const mathRandom: jest.SpyInstance = jest.spyOn(Math, "random");
    const errors: Array<unknown> = [];

    errors.push(
      captureError(() => {
        return generateScimBearerToken({} as RandomValuesSource);
      }),
    );
    errors.push(
      captureError(() => {
        return generateScimBearerToken({
          getRandomValues: "no",
        } as unknown as RandomValuesSource);
      }),
    );

    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });

    try {
      errors.push(
        captureError(() => {
          return generateScimBearerToken();
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }

    const mathRandomCalls: number = mathRandom.mock.calls.length;

    expect(mathRandomCalls).toBe(0);
    expect(errors).toHaveLength(3);

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        SCIM_BEARER_TOKEN_UNAVAILABLE_MESSAGE,
      );
    }

    // With Web Crypto back, it works again.
    expect(generateScimBearerToken()).toHaveLength(64);
  });
});

describe("buildRotateBearerTokenUpdate", () => {
  test("is exactly { bearerToken }: one column", () => {
    const token: string = generateScimBearerToken();
    const update: Record<string, unknown> = buildRotateBearerTokenUpdate(token);

    expect(update).toEqual({ bearerToken: token });
    expect(Object.keys(update)).toEqual(["bearerToken"]);
  });

  test("accepts a token of exactly the minimum length", () => {
    const token: string = "a".repeat(MIN_SCIM_BEARER_TOKEN_LENGTH);

    expect(buildRotateBearerTokenUpdate(token)).toEqual({ bearerToken: token });
  });

  test("refuses a token the server would not treat as a rotation (negative control)", () => {
    for (const token of [
      "",
      "short",
      "a".repeat(MIN_SCIM_BEARER_TOKEN_LENGTH - 1),
      // Padding does not count: the server trims before it measures.
      `   ${"a".repeat(MIN_SCIM_BEARER_TOKEN_LENGTH - 1)}   `,
      42 as unknown as string,
    ]) {
      expect(() => {
        return buildRotateBearerTokenUpdate(token);
      }).toThrow(
        `A new bearer token must be at least ${MIN_SCIM_BEARER_TOKEN_LENGTH} characters long.`,
      );
    }
  });
});

describe("ReadOnlyActionsNotice", () => {
  test.each([
    EnterpriseLicenseMode.ReadOnly,
    EnterpriseLicenseMode.NotIncluded,
  ])(
    "%s: says Reset Bearer Token still works, and why",
    (mode: EnterpriseLicenseMode) => {
      render(<ReadOnlyActionsNotice mode={mode} />);

      const notice: HTMLElement = screen.getByTestId(
        READ_ONLY_ACTIONS_NOTICE_TEST_ID,
      );

      expect(notice).toHaveTextContent(SCIM_ACTIONS_TITLE);
      expect(notice).toHaveTextContent(SCIM_ACTIONS_DESCRIPTION);
      expect(SCIM_ACTIONS_DESCRIPTION).toContain("read-only");
      expect(SCIM_ACTIONS_DESCRIPTION).toContain("tighten security");
      expect(SCIM_ACTIONS_DESCRIPTION).toContain("Reset Bearer Token");
      // SCIM is already refused while the license is lapsed; the reset matters before it resumes.
      expect(describesLapsedScim(SCIM_ACTIONS_DESCRIPTION)).toBe(true);
    },
  );

  test("speaks about SCIM only: no provider, no Disable, no single sign-on", () => {
    render(<ReadOnlyActionsNotice mode={EnterpriseLicenseMode.ReadOnly} />);

    const notice: HTMLElement = screen.getByTestId(
      READ_ONLY_ACTIONS_NOTICE_TEST_ID,
    );

    expect(providerClaimsIn(notice.textContent || "")).toEqual([]);
    expect(notice).not.toHaveTextContent(RETIRED_PROVIDER_ACTIONS_TITLE);
  });

  test("the checks reject the copy that treated SCIM as still running, and the retired provider notice (negative controls)", () => {
    expect(
      describesLapsedScim(
        "Without a valid Enterprise license this configuration is read-only, but resetting a bearer token is always allowed, because it can only tighten security. If a token has leaked, use Reset Bearer Token to replace it, then give the new token to your identity provider.",
      ),
    ).toBe(false);
    expect(
      providerClaimsIn(
        `${RETIRED_PROVIDER_ACTIONS_TITLE} ${RETIRED_PROVIDER_ACTIONS_DESCRIPTION}`,
      ),
    ).toEqual(
      PROVIDER_CLAIMS.slice(0, 3).map((claim: RegExp) => {
        return claim.source;
      }),
    );
  });

  test.each([
    EnterpriseLicenseMode.Editable,
    EnterpriseLicenseMode.Grace,
    EnterpriseLicenseMode.Unknown,
  ])(
    "%s: says nothing - the normal forms offer the reset",
    (mode: EnterpriseLicenseMode) => {
      const { container } = render(<ReadOnlyActionsNotice mode={mode} />);

      expect(container).toBeEmptyDOMElement();
    },
  );
});
