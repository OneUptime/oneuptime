import MagicLink, {
  MAGIC_LINK_EXPIRY_MINUTES,
  MAGIC_LINK_INVALID_MESSAGE,
  MAGIC_LINK_LOGIN_ROUTE,
  MAGIC_LINK_ROUTE,
  MAGIC_LINK_TOKEN_FIELD,
  MAGIC_LINK_TURNED_OFF_MESSAGE,
} from "../../../Types/Accounts/MagicLink";
import { STATUS_PAGE_MAGIC_LINK_LOGIN_ROUTE } from "../../../Types/StatusPage/StatusPageMagicLink";
import SensitiveUrlToken from "../../../UI/Utils/SensitiveUrlToken";
import { describe, expect, test } from "@jest/globals";

/*
 * Signing in to OneUptime with an emailed link (Types/Accounts/MagicLink):
 * what a sign-in request's token reads as, and the facts the server, the
 * email and the pages share.
 *
 * MagicLink.readToken decides which first factor a sign-in proves itself
 * with. A request that carries no token at all is a password sign-in; one
 * that carries anything under the token's field is a sign-in with a link -
 * and when what it carries is not a link's token, a link that does not work,
 * never a password sign-in.
 */

const TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

describe("MagicLink.readToken", () => {
  test("reads a link's token", () => {
    expect(MagicLink.readToken({ [MAGIC_LINK_TOKEN_FIELD]: TOKEN })).toBe(
      TOKEN,
    );
  });

  test("reads it beside the other fields a second step sends", () => {
    expect(
      MagicLink.readToken({
        email: "ada@example.com",
        code: "123456",
        twoFactorAuthId: "77777777-7777-4777-8777-777777777777",
        [MAGIC_LINK_TOKEN_FIELD]: TOKEN,
      }),
    ).toBe(TOKEN);
  });

  test("reads a token with spaces around it, or in capitals, as the token mailed", () => {
    expect(
      MagicLink.readToken({ [MAGIC_LINK_TOKEN_FIELD]: `  ${TOKEN}\n` }),
    ).toBe(TOKEN);
    expect(
      MagicLink.readToken({ [MAGIC_LINK_TOKEN_FIELD]: TOKEN.toUpperCase() }),
    ).toBe(TOKEN);
  });

  test.each([
    ["no data", undefined],
    ["null data", null],
    ["a list", [TOKEN]],
    ["text", TOKEN],
    ["an email and password", { email: "ada@example.com", password: "x" }],
    ["a token field that is null", { [MAGIC_LINK_TOKEN_FIELD]: null }],
    [
      "a token field that is undefined",
      { [MAGIC_LINK_TOKEN_FIELD]: undefined },
    ],
  ])(
    "is null - a password sign-in - for %s",
    (_name: string, data: unknown) => {
      expect(MagicLink.readToken(data)).toBeNull();
    },
  );

  test.each([
    ["an empty token", ""],
    ["spaces", "   "],
    ["a token that is not a UUID", "not-a-link"],
    ["a UUID with something after it", `${TOKEN}x`],
    ["two tokens", `${TOKEN},${TOKEN}`],
    ["a number", 42],
    ["true", true],
    ["an object", { value: TOKEN }],
    ["a list", [TOKEN]],
  ])(
    'is "" - a link that does not work, never a password sign-in - for %s',
    (_name: string, value: unknown) => {
      expect(MagicLink.readToken({ [MAGIC_LINK_TOKEN_FIELD]: value })).toBe("");
    },
  );

  test("does not read a token off the data's prototype", () => {
    const data: Record<string, unknown> = Object.create({
      [MAGIC_LINK_TOKEN_FIELD]: TOKEN,
    }) as Record<string, unknown>;

    expect(MagicLink.readToken(data)).toBeNull();
  });
});

describe("what the server, the email and the pages share", () => {
  test("a link works for fifteen minutes", () => {
    expect(MAGIC_LINK_EXPIRY_MINUTES).toBe(15);
  });

  test("the page a link opens is a token route, so its token leaves the address bar before anything can read it", () => {
    const path: string = `/accounts/${MAGIC_LINK_LOGIN_ROUTE}/${TOKEN}`;

    expect(SensitiveUrlToken.readFromPath(path)).toBe(TOKEN);
    expect(
      SensitiveUrlToken.isTokenRoute(`/accounts/${MAGIC_LINK_LOGIN_ROUTE}`),
    ).toBe(true);
  });

  test("it is the same route a status page's sign-in link opens, which the bootstrap already knows", () => {
    expect(MAGIC_LINK_LOGIN_ROUTE).toBe(STATUS_PAGE_MAGIC_LINK_LOGIN_ROUTE);
  });

  test("the page that asks for a link carries no token", () => {
    expect(
      SensitiveUrlToken.isTokenRoute(`/accounts/${MAGIC_LINK_ROUTE}`),
    ).toBe(false);
    expect(
      SensitiveUrlToken.readFromPath(`/accounts/${MAGIC_LINK_ROUTE}`),
    ).toBe("");
  });

  test("a link that does not work is told one sentence for every reason, naming none", () => {
    expect(MAGIC_LINK_INVALID_MESSAGE).toBe(
      "This sign-in link has expired or has already been used. Please ask for a new one.",
    );
  });

  test("turned off, the server points at the password", () => {
    expect(MAGIC_LINK_TURNED_OFF_MESSAGE).toContain("turned off");
    expect(MAGIC_LINK_TURNED_OFF_MESSAGE).toContain("password");
  });
});
