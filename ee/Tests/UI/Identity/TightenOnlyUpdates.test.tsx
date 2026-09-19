import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  MIN_SCIM_BEARER_TOKEN_LENGTH,
  RandomValuesSource,
  SCIM_BEARER_TOKEN_BYTES,
  SCIM_BEARER_TOKEN_UNAVAILABLE_MESSAGE,
  buildDisableProviderUpdate,
  buildRotateBearerTokenUpdate,
  generateScimBearerToken,
} from "../../../Dashboard/SSO/TightenOnly/TightenOnlyUpdates";
import ReadOnlyActionsNotice, {
  PROVIDER_ACTIONS_DESCRIPTION,
  PROVIDER_ACTIONS_TITLE,
  READ_ONLY_ACTIONS_NOTICE_TEST_ID,
  ReadOnlyActionsKind,
  SCIM_ACTIONS_DESCRIPTION,
  SCIM_ACTIONS_TITLE,
} from "../../../Dashboard/SSO/TightenOnly/ReadOnlyActionsNotice";
import DisableProviderCard, {
  DISABLE_PROVIDER_BUTTON_TITLE,
  DISABLE_PROVIDER_CARD_DESCRIPTION,
  DISABLE_PROVIDER_CARD_TEST_ID,
  DISABLE_PROVIDER_CARD_TITLE,
} from "../../../Dashboard/SSO/TightenOnly/DisableProviderCard";
import { EnterpriseLicenseMode } from "../../../Dashboard/SSO/License/EnterpriseLicenseMode";

/*
 * The building blocks of the identity screens' incident-response actions
 * under a read-only (lapsed) Enterprise license: the two update payloads the
 * server accepts without a license, the SCIM bearer-token generator, and what
 * the screens say about them. ReadOnlyIncidentActions.test.tsx covers the
 * screens; ee/Tests/Server/Identity/TightenOnlyUiContract.test.ts checks the
 * payloads against the server's own rules.
 */

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const HEX_TOKEN: RegExp = /^[0-9a-f]+$/;

describe("buildDisableProviderUpdate", () => {
  test("is exactly { isEnabled: false }: one column, the literal false", () => {
    const update: Record<string, unknown> = buildDisableProviderUpdate();

    expect(update).toEqual({ isEnabled: false });
    expect(Object.keys(update)).toEqual(["isEnabled"]);
    expect(update["isEnabled"]).toBe(false);
  });

  test("hands out a new object every time, so a caller cannot add a column to the next one", () => {
    const first: Record<string, unknown> = buildDisableProviderUpdate();
    first["name"] = "changed";

    expect(buildDisableProviderUpdate()).toEqual({ isEnabled: false });
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
  test("read-only, providers: says Disable still works, and why", () => {
    render(
      <ReadOnlyActionsNotice
        mode={EnterpriseLicenseMode.ReadOnly}
        kind={ReadOnlyActionsKind.Provider}
      />,
    );

    const notice: HTMLElement = screen.getByTestId(
      READ_ONLY_ACTIONS_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent(PROVIDER_ACTIONS_TITLE);
    expect(notice).toHaveTextContent(PROVIDER_ACTIONS_DESCRIPTION);
    expect(PROVIDER_ACTIONS_DESCRIPTION).toContain("read-only");
    expect(PROVIDER_ACTIONS_DESCRIPTION).toContain("tighten security");
    expect(PROVIDER_ACTIONS_DESCRIPTION).toContain("Disable");
    expect(notice).not.toHaveTextContent(SCIM_ACTIONS_TITLE);
  });

  test("read-only, SCIM: says Reset Bearer Token still works, and why", () => {
    render(
      <ReadOnlyActionsNotice
        mode={EnterpriseLicenseMode.ReadOnly}
        kind={ReadOnlyActionsKind.Scim}
      />,
    );

    const notice: HTMLElement = screen.getByTestId(
      READ_ONLY_ACTIONS_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent(SCIM_ACTIONS_TITLE);
    expect(notice).toHaveTextContent(SCIM_ACTIONS_DESCRIPTION);
    expect(SCIM_ACTIONS_DESCRIPTION).toContain("read-only");
    expect(SCIM_ACTIONS_DESCRIPTION).toContain("tighten security");
    expect(SCIM_ACTIONS_DESCRIPTION).toContain("Reset Bearer Token");
    expect(notice).not.toHaveTextContent(PROVIDER_ACTIONS_TITLE);
  });

  test.each([
    EnterpriseLicenseMode.Editable,
    EnterpriseLicenseMode.Grace,
    EnterpriseLicenseMode.Unknown,
  ])(
    "%s: says nothing - the normal forms offer these changes",
    (mode: EnterpriseLicenseMode) => {
      for (const kind of [
        ReadOnlyActionsKind.Provider,
        ReadOnlyActionsKind.Scim,
      ]) {
        const { container } = render(
          <ReadOnlyActionsNotice mode={mode} kind={kind} />,
        );

        expect(container).toBeEmptyDOMElement();

        cleanup();
      }
    },
  );
});

describe("DisableProviderCard", () => {
  test("explains the action and runs it from its button", () => {
    const onDisable: jest.Mock = jest.fn();

    render(<DisableProviderCard onDisable={onDisable} />);

    const card: HTMLElement = screen.getByTestId(DISABLE_PROVIDER_CARD_TEST_ID);

    expect(card).toHaveTextContent(DISABLE_PROVIDER_CARD_TITLE);
    expect(card).toHaveTextContent(DISABLE_PROVIDER_CARD_DESCRIPTION);
    expect(onDisable).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: DISABLE_PROVIDER_BUTTON_TITLE }),
    );

    expect(onDisable).toHaveBeenCalledTimes(1);
  });
});
