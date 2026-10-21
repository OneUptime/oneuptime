/**
 * Redirect URI tests.
 *
 * The redirect URI decides who ends up holding an authorization code, so both
 * of its rules are pinned here case by case: which URIs a client may register
 * at all, and whether the URI on a request is one of the URIs it registered.
 */

import { describe, it, expect } from "@jest/globals";
import RedirectUri, { MAX_REDIRECT_URI_LENGTH } from "../../OAuth/RedirectUri";
import {
  CLAUDE,
  CLAUDE_CODE,
  REAL_WORLD_CLIENTS,
  RealWorldClientFixture,
  VS_CODE,
} from "./RealWorldClientFixtures";

const HTTPS_ONLY_MESSAGE: string =
  "A redirect URI must use https, unless it points at this machine (localhost, 127.0.0.1 or [::1]).";

const CHARACTER_MESSAGE: string =
  "A redirect URI must contain only printable ASCII characters and no spaces.";

describe("RedirectUri", () => {
  describe("getRegistrationProblem", () => {
    it.each([
      ["a hosted callback", "https://claude.ai/api/mcp/auth_callback"],
      ["a port", "https://example.com:8443/callback"],
      ["a query string", "https://example.com/callback?tenant=1&x=y"],
      ["no path", "https://example.com"],
      ["a private address", "https://10.0.0.1/callback"],
      ["loopback over https", "https://localhost/callback"],
      ["a punycode host", "https://xn--exmple-cua.com/callback"],
    ])("accepts https with %s", (_name: string, value: string) => {
      expect(RedirectUri.getRegistrationProblem(value)).toBeNull();
    });

    it.each([
      ["localhost", "http://localhost/callback"],
      ["localhost on a port", "http://localhost:3000/callback"],
      ["127.0.0.1", "http://127.0.0.1/callback"],
      ["127.0.0.1 on a port", "http://127.0.0.1:51234/callback"],
      ["[::1]", "http://[::1]/callback"],
      ["[::1] on a port", "http://[::1]:9000/callback"],
      ["an upper-case localhost", "http://LOCALHOST:8080/callback"],
    ])("accepts plain http to %s", (_name: string, value: string) => {
      expect(RedirectUri.getRegistrationProblem(value)).toBeNull();
    });

    it("judges the host the URL parser resolved, so another spelling of the loopback address is still this machine", () => {
      // Each of these parses to exactly 127.0.0.1 or [::1].
      for (const value of [
        "http://127.1/callback",
        "http://2130706433/callback",
        "http://0x7f.0.0.1/callback",
        "http://[0:0:0:0:0:0:0:1]/callback",
      ]) {
        expect(RedirectUri.getRegistrationProblem(value)).toBeNull();
      }
    });

    it.each([
      ["a public host", "http://example.com/callback"],
      ["localhost with a trailing dot", "http://localhost./callback"],
      ["a host that starts with localhost", "http://localhost.evil.com/cb"],
      ["a host that starts with 127.0.0.1", "http://127.0.0.1.evil.com/cb"],
      ["a host that ends with localhost", "http://evil-localhost/callback"],
      ["0.0.0.0", "http://0.0.0.0/callback"],
      ["another 127/8 address", "http://127.0.0.2/callback"],
      ["a 10/8 address", "http://10.0.0.1/callback"],
      ["a 192.168/16 address", "http://192.168.1.10/callback"],
      ["a 172.16/12 address", "http://172.16.0.1/callback"],
      ["the link-local metadata address", "http://169.254.169.254/callback"],
      ["an IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/callback"],
      ["another IPv6 address", "http://[fe80::1]/callback"],
      [
        "loopback smuggled into the userinfo",
        "http://127.0.0.1:80@evil.com/callback",
      ],
    ])("refuses plain http to %s", (_name: string, value: string) => {
      expect(RedirectUri.getRegistrationProblem(value)).not.toBeNull();
    });

    it("says why plain http is refused", () => {
      expect(
        RedirectUri.getRegistrationProblem("http://example.com/callback"),
      ).toBe(HTTPS_ONLY_MESSAGE);
      expect(
        RedirectUri.getRegistrationProblem("http://localhost.evil.com/cb"),
      ).toBe(HTTPS_ONLY_MESSAGE);
    });

    it.each([
      ["javascript:", "javascript:alert(document.domain)"],
      ["data:", "data:text/html,<script>alert(1)</script>"],
      ["vbscript:", "vbscript:msgbox(1)"],
      ["blob:", "blob:https://example.com/0f8a1c9e"],
      ["about:", "about:blank"],
      ["view-source:", "view-source:https://example.com/"],
      ["file:", "file:///etc/passwd"],
      ["filesystem:", "filesystem:https://example.com/temporary/x"],
      ["jar:", "jar:https://example.com/x.jar!/"],
      ["resource:", "resource://gre/modules/x.js"],
      ["chrome:", "chrome://settings/"],
      ["ftp:", "ftp://example.com/callback"],
      ["ws:", "ws://example.com/callback"],
      ["wss:", "wss://example.com/callback"],
      ["mailto:", "mailto:someone@example.com"],
      ["tel:", "tel:+15555550100"],
      ["sms:", "sms:+15555550100"],
    ])(
      "refuses the %s scheme in any letter case",
      (scheme: string, value: string) => {
        const expected: string = `A redirect URI cannot use the ${scheme} scheme.`;

        expect(RedirectUri.getRegistrationProblem(value)).toBe(expected);

        const colon: number = value.indexOf(":");
        const upper: string = `${value.slice(0, colon).toUpperCase()}${value.slice(colon)}`;
        const mixed: string = `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

        expect(RedirectUri.getRegistrationProblem(upper)).toBe(expected);
        expect(RedirectUri.getRegistrationProblem(mixed)).toBe(expected);
      },
    );

    it.each([
      ["Cursor", "cursor://anysphere.cursor-retrieval/oauth/user-mcp/callback"],
      ["VS Code", "vscode://vscode.github-authentication/did-authenticate"],
      ["VS Code Insiders", "vscode-insiders://example.extension/callback"],
      ["a reverse-domain scheme", "com.example.app:/callback"],
      ["a reverse-domain scheme with an authority", "com.example.app://cb"],
      ["a scheme with a query", "myapp://callback?source=oneuptime"],
    ])(
      "accepts the private-use scheme of %s",
      (_name: string, value: string) => {
        expect(RedirectUri.getRegistrationProblem(value)).toBeNull();
      },
    );

    it.each([
      ["https", "https://example.com/callback#fragment"],
      ["loopback", "http://127.0.0.1/callback#x"],
      ["an empty fragment", "https://example.com/callback#"],
      ["a private-use scheme", "cursor://callback#x"],
    ])("refuses a fragment on %s", (_name: string, value: string) => {
      expect(RedirectUri.getRegistrationProblem(value)).toBe(
        "A redirect URI must not contain a fragment.",
      );
    });

    it.each([
      ["a user and password", "https://user:pass@example.com/callback"],
      ["a user alone", "https://user@example.com/callback"],
      ["a user on loopback", "http://user:pass@localhost/callback"],
    ])("refuses credentials: %s", (_name: string, value: string) => {
      expect(RedirectUri.getRegistrationProblem(value)).toBe(
        "A redirect URI must not contain credentials.",
      );
    });

    it.each([
      ["a trailing space", "https://example.com/callback "],
      ["a leading space", " https://example.com/callback"],
      ["a space in the path", "https://example.com/call back"],
      ["a tab", "https://exam\tple.com/callback"],
      ["a trailing newline", "https://example.com/callback\n"],
      ["a carriage return", "https://example.com/\rcallback"],
      ["a NUL", "https://example.com/callback\x00"],
      ["a DEL", "https://example.com/callback\x7f"],
      ["a non-ASCII host", "https://ex\xe4mple.com/callback"],
      ["a non-ASCII path", "https://example.com/caf\xe9"],
    ])("refuses %s", (_name: string, value: string) => {
      expect(RedirectUri.getRegistrationProblem(value)).toBe(CHARACTER_MESSAGE);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 42],
      ["a boolean", true],
      ["an object", { uri: "https://example.com/callback" }],
      ["an array", ["https://example.com/callback"]],
      ["an empty string", ""],
    ])("refuses %s", (_name: string, value: unknown) => {
      expect(RedirectUri.getRegistrationProblem(value)).toBe(
        "A redirect URI must be a non-empty string.",
      );
    });

    it.each([
      ["a bare word", "callback"],
      ["a path", "/oauth/callback"],
      ["a scheme-relative URL", "//example.com/callback"],
      ["a host without a scheme", "example.com/callback"],
      ["https with no host", "https://"],
    ])("refuses %s as not absolute", (_name: string, value: string) => {
      expect(RedirectUri.getRegistrationProblem(value)).toBe(
        "A redirect URI must be an absolute URI.",
      );
    });

    it("holds the length limit at 1024 characters", () => {
      const prefix: string = "https://example.com/";
      const atLimit: string = `${prefix}${"a".repeat(MAX_REDIRECT_URI_LENGTH - prefix.length)}`;
      const overLimit: string = `${atLimit}a`;

      expect(MAX_REDIRECT_URI_LENGTH).toBe(1024);
      expect(atLimit).toHaveLength(1024);
      expect(RedirectUri.getRegistrationProblem(atLimit)).toBeNull();
      expect(RedirectUri.getRegistrationProblem(overLimit)).toBe(
        "A redirect URI cannot be longer than 1024 characters.",
      );
    });
  });

  describe("matches", () => {
    it("matches an identical URI", () => {
      expect(
        RedirectUri.matches(
          "https://claude.ai/api/mcp/auth_callback",
          "https://claude.ai/api/mcp/auth_callback",
        ),
      ).toBe(true);
      expect(
        RedirectUri.matches(
          "cursor://anysphere.cursor-retrieval/oauth/callback",
          "cursor://anysphere.cursor-retrieval/oauth/callback",
        ),
      ).toBe(true);
    });

    it.each([
      [
        "127.0.0.1",
        "http://127.0.0.1:51234/callback",
        "http://127.0.0.1/callback",
      ],
      [
        "localhost",
        "http://localhost:51234/callback",
        "http://localhost/callback",
      ],
      ["[::1]", "http://[::1]:51234/callback", "http://[::1]/callback"],
    ])(
      "matches a loopback URI on any port: %s",
      (_name: string, requested: string, registered: string) => {
        expect(RedirectUri.matches(requested, registered)).toBe(true);
      },
    );

    it("relaxes the port in both directions", () => {
      // Registered with a port, requested on another.
      expect(
        RedirectUri.matches(
          "http://127.0.0.1:6000/callback",
          "http://127.0.0.1:3000/callback",
        ),
      ).toBe(true);
      // Registered with a port, requested without one.
      expect(
        RedirectUri.matches(
          "http://localhost/callback",
          "http://localhost:3000/callback",
        ),
      ).toBe(true);
    });

    it("keeps the query when it relaxes the port", () => {
      expect(
        RedirectUri.matches(
          "http://localhost:5000/callback?app=1",
          "http://localhost/callback?app=1",
        ),
      ).toBe(true);
    });

    it("does not treat localhost and 127.0.0.1 as the same host", () => {
      expect(
        RedirectUri.matches(
          "http://localhost:51234/callback",
          "http://127.0.0.1/callback",
        ),
      ).toBe(false);
      expect(
        RedirectUri.matches(
          "http://127.0.0.1:51234/callback",
          "http://localhost/callback",
        ),
      ).toBe(false);
      expect(
        RedirectUri.matches(
          "http://[::1]:51234/callback",
          "http://127.0.0.1/callback",
        ),
      ).toBe(false);
    });

    it.each([
      [
        "a different path",
        "http://127.0.0.1:51234/other",
        "http://127.0.0.1/callback",
      ],
      [
        "a longer path",
        "http://127.0.0.1:51234/callback/extra",
        "http://127.0.0.1/callback",
      ],
      [
        "a trailing slash",
        "http://127.0.0.1:51234/callback/",
        "http://127.0.0.1/callback",
      ],
      [
        "an added query",
        "http://127.0.0.1:51234/callback?next=1",
        "http://127.0.0.1/callback",
      ],
      [
        "a different query",
        "http://127.0.0.1:51234/callback?app=2",
        "http://127.0.0.1/callback?app=1",
      ],
      [
        "a missing query",
        "http://127.0.0.1:51234/callback",
        "http://127.0.0.1/callback?app=1",
      ],
      [
        "a different scheme",
        "https://127.0.0.1:51234/callback",
        "http://127.0.0.1/callback",
      ],
    ])(
      "refuses a loopback URI with %s",
      (_name: string, requested: string, registered: string) => {
        expect(RedirectUri.matches(requested, registered)).toBe(false);
      },
    );

    it.each([
      [
        "another port",
        "https://example.com:8443/callback",
        "https://example.com/callback",
      ],
      [
        "an explicit default port",
        "https://example.com:443/callback",
        "https://example.com/callback",
      ],
      [
        "another letter case in the host",
        "https://EXAMPLE.com/callback",
        "https://example.com/callback",
      ],
      [
        "a trailing slash",
        "https://example.com/callback/",
        "https://example.com/callback",
      ],
      [
        "an added query",
        "https://example.com/callback?x=1",
        "https://example.com/callback",
      ],
      [
        "a subdomain",
        "https://evil.example.com/callback",
        "https://example.com/callback",
      ],
      [
        "a longer host",
        "https://example.com.evil.com/callback",
        "https://example.com/callback",
      ],
      [
        "a private-use scheme on another host",
        "cursor://other/oauth/callback",
        "cursor://anysphere.cursor-retrieval/oauth/callback",
      ],
    ])(
      "never relaxes anything outside loopback: %s",
      (_name: string, requested: string, registered: string) => {
        expect(RedirectUri.matches(requested, registered)).toBe(false);
      },
    );

    it("does not match a loopback request against a registered web URI, or the reverse", () => {
      expect(
        RedirectUri.matches(
          "http://localhost:3000/callback",
          "https://example.com/callback",
        ),
      ).toBe(false);
      expect(
        RedirectUri.matches(
          "https://example.com/callback",
          "http://localhost/callback",
        ),
      ).toBe(false);
    });

    it.each([
      ["a trailing space", "http://127.0.0.1:51234/callback "],
      ["a leading space", " http://127.0.0.1:51234/callback"],
      ["a tab the URL parser would strip", "http://127.0.0.1:51234/call\tback"],
      [
        "a newline the URL parser would strip",
        "http://127.0.0.1:51234/callback\n",
      ],
      ["a fragment", "http://127.0.0.1:51234/callback#token"],
      ["a non-ASCII character", "http://127.0.0.1:51234/callback\xe9"],
    ])(
      "never matches a requested URI with %s",
      (_name: string, requested: string) => {
        expect(
          RedirectUri.matches(requested, "http://127.0.0.1/callback"),
        ).toBe(false);
      },
    );

    it("refuses credentials on a loopback request", () => {
      expect(
        RedirectUri.matches(
          "http://user@127.0.0.1:51234/callback",
          "http://127.0.0.1/callback",
        ),
      ).toBe(false);
      expect(
        RedirectUri.matches(
          "http://user:pass@localhost:51234/callback",
          "http://localhost/callback",
        ),
      ).toBe(false);
    });

    it("is not fooled by loopback written into the userinfo of another host", () => {
      expect(
        RedirectUri.matches(
          "http://127.0.0.1:51234@evil.com/callback",
          "http://127.0.0.1/callback",
        ),
      ).toBe(false);
    });

    it("is not fooled by a host that merely starts with a loopback name", () => {
      expect(
        RedirectUri.matches(
          "http://127.0.0.1.evil.com:51234/callback",
          "http://127.0.0.1/callback",
        ),
      ).toBe(false);
      expect(
        RedirectUri.matches(
          "http://localhost.evil.com:51234/callback",
          "http://localhost/callback",
        ),
      ).toBe(false);
    });

    it("is false, without throwing, for a value that is not a URI", () => {
      expect(RedirectUri.matches("callback", "http://127.0.0.1/callback")).toBe(
        false,
      );
      expect(RedirectUri.matches("", "http://127.0.0.1/callback")).toBe(false);
      expect(
        RedirectUri.matches("http://127.0.0.1:1/callback", "nonsense"),
      ).toBe(false);
    });
  });

  describe("matchesAny", () => {
    const REGISTERED: Array<string> = [
      "https://claude.ai/api/mcp/auth_callback",
      "http://localhost/callback",
      "http://127.0.0.1/callback",
    ];

    it("is true when any registered URI matches", () => {
      expect(
        RedirectUri.matchesAny(
          "https://claude.ai/api/mcp/auth_callback",
          REGISTERED,
        ),
      ).toBe(true);
      expect(
        RedirectUri.matchesAny("http://127.0.0.1:40123/callback", REGISTERED),
      ).toBe(true);
      expect(
        RedirectUri.matchesAny("http://localhost:40123/callback", REGISTERED),
      ).toBe(true);
    });

    it("is false when none does", () => {
      expect(
        RedirectUri.matchesAny("https://evil.example/callback", REGISTERED),
      ).toBe(false);
      expect(
        RedirectUri.matchesAny("http://[::1]:40123/callback", REGISTERED),
      ).toBe(false);
    });

    it("is false for a client with no redirect URIs", () => {
      expect(RedirectUri.matchesAny("https://example.com/callback", [])).toBe(
        false,
      );
    });
  });

  describe("the redirect URIs real MCP clients use", () => {
    it.each(REAL_WORLD_CLIENTS)(
      "lets $name register every redirect URI it publishes",
      (fixture: RealWorldClientFixture) => {
        for (const redirectUri of fixture.expected.redirectUris) {
          expect(RedirectUri.getRegistrationProblem(redirectUri)).toBeNull();
        }
      },
    );

    it.each(REAL_WORLD_CLIENTS)(
      "matches every redirect URI $name sends when it starts authorization",
      (fixture: RealWorldClientFixture) => {
        expect(fixture.requestedAtRuntime.length).toBeGreaterThan(0);

        for (const requested of fixture.requestedAtRuntime) {
          expect({
            requested,
            matches: RedirectUri.matchesAny(
              requested,
              fixture.expected.redirectUris,
            ),
          }).toEqual({ requested, matches: true });
        }
      },
    );

    it.each(REAL_WORLD_CLIENTS)(
      "does not match the near misses of $name's redirect URIs",
      (fixture: RealWorldClientFixture) => {
        expect(fixture.neverRequested.length).toBeGreaterThan(0);

        for (const requested of fixture.neverRequested) {
          expect({
            requested,
            matches: RedirectUri.matchesAny(
              requested,
              fixture.expected.redirectUris,
            ),
          }).toEqual({ requested, matches: false });
        }
      },
    );

    it("matches VS Code on the port it registered and on any other, but only on 127.0.0.1", () => {
      const registered: Array<string> = VS_CODE.expected.redirectUris;

      expect(
        RedirectUri.matchesAny("http://127.0.0.1:33418/", registered),
      ).toBe(true);
      expect(
        RedirectUri.matchesAny("http://127.0.0.1:51234/", registered),
      ).toBe(true);
      expect(
        RedirectUri.matchesAny("https://vscode.dev/redirect", registered),
      ).toBe(true);
      expect(
        RedirectUri.matchesAny("http://localhost:33418/", registered),
      ).toBe(false);
      expect(
        RedirectUri.matchesAny("http://127.0.0.1:33418/other", registered),
      ).toBe(false);
    });

    it("matches Claude only on its one hosted callback", () => {
      const registered: Array<string> = CLAUDE.expected.redirectUris;

      expect(
        RedirectUri.matchesAny(
          "https://claude.ai/api/mcp/auth_callback",
          registered,
        ),
      ).toBe(true);
      expect(
        RedirectUri.matchesAny("https://claude.ai/api/mcp/other", registered),
      ).toBe(false);
      expect(
        RedirectUri.matchesAny(
          "https://claude.ai:8443/api/mcp/auth_callback",
          registered,
        ),
      ).toBe(false);
      expect(
        RedirectUri.matchesAny(
          "http://claude.ai/api/mcp/auth_callback",
          registered,
        ),
      ).toBe(false);
    });

    it("matches Claude Code on any port, although it registers none", () => {
      const registered: Array<string> = CLAUDE_CODE.expected.redirectUris;

      // No port in either registered URI: only the loopback rule makes this work.
      for (const redirectUri of registered) {
        expect(new URL(redirectUri).port).toBe("");
      }

      for (const port of [1024, 3000, 49152, 53124, 65535]) {
        expect(
          RedirectUri.matchesAny(
            `http://localhost:${port}/callback`,
            registered,
          ),
        ).toBe(true);
        expect(
          RedirectUri.matchesAny(
            `http://127.0.0.1:${port}/callback`,
            registered,
          ),
        ).toBe(true);
      }

      expect(
        RedirectUri.matchesAny("http://localhost:1234/other", registered),
      ).toBe(false);
      expect(
        RedirectUri.matchesAny("https://localhost:1234/callback", registered),
      ).toBe(false);
    });
  });

  describe("isLoopback", () => {
    it.each([
      "http://localhost/callback",
      "http://localhost:3000/callback",
      "http://127.0.0.1:8080/callback",
      "http://[::1]:8080/callback",
      "https://localhost/callback",
    ])("is true for %s", (value: string) => {
      expect(RedirectUri.isLoopback(value)).toBe(true);
    });

    it.each([
      "https://claude.ai/api/mcp/auth_callback",
      "http://localhost.evil.com/callback",
      "http://127.0.0.2/callback",
      "cursor://localhost/callback",
      "com.example.app:/callback",
      "not a uri",
      "",
    ])("is false for %s", (value: string) => {
      expect(RedirectUri.isLoopback(value)).toBe(false);
    });
  });

  describe("getDisplayTarget", () => {
    it.each([
      ["https://claude.ai/api/mcp/auth_callback", "claude.ai"],
      ["https://example.com:8443/callback?x=1", "example.com:8443"],
      ["http://localhost:3000/callback", "localhost:3000"],
      ["http://127.0.0.1/callback", "127.0.0.1"],
      ["http://[::1]:9000/callback", "[::1]:9000"],
    ])(
      "shows the host of a web address: %s",
      (value: string, expected: string) => {
        expect(RedirectUri.getDisplayTarget(value)).toBe(expected);
      },
    );

    it("never shows the path or query of a web address", () => {
      const target: string = RedirectUri.getDisplayTarget(
        "https://evil.example/claude.ai/oneuptime?host=oneuptime.com",
      );

      expect(target).toBe("evil.example");
    });

    it.each([
      [
        "cursor://anysphere.cursor-retrieval/oauth/callback",
        "cursor://anysphere.cursor-retrieval",
      ],
      [
        "vscode://vscode.github-authentication/did-authenticate",
        "vscode://vscode.github-authentication",
      ],
      ["com.example.app:/callback", "com.example.app:"],
    ])("shows the scheme of an app: %s", (value: string, expected: string) => {
      expect(RedirectUri.getDisplayTarget(value)).toBe(expected);
    });

    it("returns a value it cannot parse unchanged", () => {
      expect(RedirectUri.getDisplayTarget("not a uri")).toBe("not a uri");
    });
  });

  describe("withParameters", () => {
    it("adds response parameters to a URI with no query", () => {
      const result: URL = new URL(
        RedirectUri.withParameters("https://example.com/callback", {
          code: "abc",
          state: "xyz",
        }),
      );

      expect(result.origin).toBe("https://example.com");
      expect(result.pathname).toBe("/callback");
      expect(result.searchParams.get("code")).toBe("abc");
      expect(result.searchParams.get("state")).toBe("xyz");
    });

    it("keeps the query the client registered", () => {
      expect(
        RedirectUri.withParameters("https://example.com/callback?tenant=1", {
          code: "abc",
        }),
      ).toBe("https://example.com/callback?tenant=1&code=abc");
    });

    it("leaves out a parameter that is undefined", () => {
      const result: string = RedirectUri.withParameters(
        "https://example.com/callback",
        { code: "abc", state: undefined },
      );

      expect(result).toBe("https://example.com/callback?code=abc");
      expect(result).not.toContain("state");
    });

    it("keeps a parameter that is an empty string", () => {
      const result: URL = new URL(
        RedirectUri.withParameters("https://example.com/callback", {
          state: "",
        }),
      );

      expect(result.searchParams.has("state")).toBe(true);
      expect(result.searchParams.get("state")).toBe("");
    });

    it("encodes values so one cannot add parameters of its own", () => {
      const state: string = "a b&code=stolen#frag=1?x=%20";
      const raw: string = RedirectUri.withParameters(
        "https://example.com/callback",
        { code: "real", state },
      );
      const result: URL = new URL(raw);

      expect(result.searchParams.getAll("code")).toEqual(["real"]);
      expect(result.searchParams.get("state")).toBe(state);
      expect(result.hash).toBe("");
      expect(raw).not.toContain(" ");
    });

    it("replaces a parameter of the same name rather than repeating it", () => {
      const result: URL = new URL(
        RedirectUri.withParameters(
          "https://example.com/callback?code=old&x=1",
          {
            code: "new",
          },
        ),
      );

      expect(result.searchParams.getAll("code")).toEqual(["new"]);
      expect(result.searchParams.get("x")).toBe("1");
    });

    it("works for loopback and private-use scheme URIs", () => {
      expect(
        RedirectUri.withParameters("http://127.0.0.1:5000/callback", {
          code: "x",
        }),
      ).toBe("http://127.0.0.1:5000/callback?code=x");
      expect(
        RedirectUri.withParameters(
          "cursor://anysphere.cursor-retrieval/oauth/callback",
          { code: "x" },
        ),
      ).toBe("cursor://anysphere.cursor-retrieval/oauth/callback?code=x");
      expect(
        RedirectUri.withParameters("com.example.app:/callback", {
          code: "x",
          state: "s",
        }),
      ).toBe("com.example.app:/callback?code=x&state=s");
    });
  });
});
