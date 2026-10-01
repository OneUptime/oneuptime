import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import McpAuthorizeUtil, {
  FALLBACK_DISPLAY_ERROR_CODE,
  KNOWN_DISPLAY_ERROR_CODES,
  McpConsentDetails,
  McpConsentProject,
} from "../../FeatureSet/Accounts/src/Utils/McpAuthorize";

/*
 * The decisions the MCP consent screen makes, without the screen.
 *
 * The page at /accounts/mcp-authorize is where a person hands an MCP client
 * their access to a project, so each decision here is one somebody could try
 * to bend from outside:
 *
 *  - WHICH ERROR IS SHOWN. `?error=` is written by whoever made the link. Only
 *    the codes the authorization endpoint sends are shown, each with fixed
 *    wording; anything else - a sentence, markup, a code from some other
 *    place - becomes the generic error, so the page can never be made to say
 *    something OneUptime did not.
 *  - WHICH PROJECT IS PRESELECTED. Only when there is exactly one the client
 *    can be connected to. A guess among several is a client connected to the
 *    wrong project by somebody pressing Enter.
 *  - WHERE THE BROWSER IS SENT. The page navigates to whatever the server
 *    answers with. The server only ever answers with a registered redirect
 *    URI, and the page still refuses the schemes that would run script in
 *    OneUptime's own origin, because this is the line that navigates.
 *  - WHAT THE SERVER'S ANSWER IS TAKEN TO MEAN. A project is selectable only
 *    when the answer says so in so many words (`isEligible === true`), and a
 *    client gets write only when the answer says "write".
 *
 * The module has no imports, so it is loaded for real in this plain-node
 * suite. The page that renders these decisions is tested, rendered, in
 * Common/Tests/App/Accounts/McpAuthorizePage.test.tsx.
 */

const MCP_OAUTH_SRC: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "MCP",
  "OAuth",
);

type EnumValuesFunction = (fileName: string, enumName: string) => Array<string>;

/*
 * The string values of an enum, read out of the server source. The server
 * modules cannot be imported here without their whole graph (services, the
 * database layer), and what is being compared is a wire contract: the
 * strings, not the symbols.
 */
const enumValues: EnumValuesFunction = (
  fileName: string,
  enumName: string,
): Array<string> => {
  const source: string = fs.readFileSync(
    nodePath.join(MCP_OAUTH_SRC, fileName),
    "utf8",
  );
  const start: number = source.indexOf(`export enum ${enumName} {`);

  if (start === -1) {
    throw new Error(`${fileName} no longer declares enum ${enumName}`);
  }

  const body: string = source.slice(start, source.indexOf("\n}", start));
  const values: Array<string> = [];
  const pattern: RegExp = /[=]\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = pattern.exec(body);

  while (match) {
    values.push(match[1]!);
    match = pattern.exec(body);
  }

  return values;
};

type ProjectFunction = (
  overrides?: Partial<McpConsentProject>,
) => McpConsentProject;

const project: ProjectFunction = (
  overrides: Partial<McpConsentProject> = {},
): McpConsentProject => {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Acme Production",
    isEligible: true,
    refusal: null,
    ...overrides,
  };
};

type DetailsFunction = (
  projects: Array<McpConsentProject>,
) => McpConsentDetails;

const detailsWith: DetailsFunction = (
  projects: Array<McpConsentProject>,
): McpConsentDetails => {
  return {
    client: {
      name: "Claude Code",
      verifiedHost: null,
      uri: null,
      redirectTarget: "localhost:33418",
      isLoopbackRedirect: true,
    },
    requestedAccess: "write",
    user: { email: "ada@example.com", name: "Ada Lovelace" },
    projects,
  };
};

const SERVER_ANSWER: Record<string, unknown> = {
  client: {
    name: "Claude",
    verifiedHost: "claude.ai",
    uri: "https://claude.ai/",
    redirectTarget: "claude.ai",
    isLoopbackRedirect: false,
  },
  requestedAccess: "write",
  user: { email: "ada@example.com", name: "Ada Lovelace" },
  projects: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Acme Production",
      isEligible: true,
      refusal: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Acme Staging",
      isEligible: false,
      refusal: "sso",
    },
  ],
};

type AnswerWithFunction = (
  overrides: Record<string, unknown>,
) => Record<string, unknown>;

const answerWith: AnswerWithFunction = (
  overrides: Record<string, unknown>,
): Record<string, unknown> => {
  return { ...SERVER_ANSWER, ...overrides };
};

describe("which error the consent screen shows", () => {
  test("the page knows exactly the codes the authorization endpoint can send", () => {
    /*
     * Both directions matter. A code the server sends and the page does not
     * know is shown as "something went wrong on our side" - true of none of
     * them. A code the page knows and the server never sends is wording that
     * can only be reached by a hand-made link.
     */
    expect([...KNOWN_DISPLAY_ERROR_CODES].sort()).toEqual(
      enumValues(
        "AuthorizationRequest.ts",
        "AuthorizationDisplayErrorCode",
      ).sort(),
    );

    expect(KNOWN_DISPLAY_ERROR_CODES).toEqual([
      "oauth_disabled",
      "missing_client_id",
      "unknown_client",
      "client_metadata_unavailable",
      "client_metadata_invalid",
      "missing_redirect_uri",
      "redirect_uri_mismatch",
      "request_too_large",
      "server_error",
    ]);
  });

  test.each(KNOWN_DISPLAY_ERROR_CODES)(
    "%s is shown as itself",
    (code: string) => {
      expect(McpAuthorizeUtil.toDisplayErrorCode(code)).toBe(code);
    },
  );

  test("the fallback is itself a code the page has wording for", () => {
    expect(FALLBACK_DISPLAY_ERROR_CODE).toBe("server_error");
    expect(KNOWN_DISPLAY_ERROR_CODES).toContain(FALLBACK_DISPLAY_ERROR_CODE);
  });

  test.each([
    ["markup", "<script>alert(document.cookie)</script>"],
    ["an image tag", '<img src=x onerror="alert(1)">'],
    [
      "a sentence somebody wants the page to say",
      "Your account is locked. Call +1 555 0100 to unlock it.",
    ],
    ["a code in the wrong case", "UNKNOWN_CLIENT"],
    ["a code with a space before it", " unknown_client"],
    ["a code with a space after it", "unknown_client "],
    ["two codes", "unknown_client,server_error"],
    ["an OAuth error that is not a display error", "access_denied"],
    ["the page's own missing-request code", "missing_request"],
    ["an object property name", "constructor"],
    ["a prototype key", "__proto__"],
    ["a locale path", "errors.unknown_client"],
    ["a path into another section", "../login.title"],
    ["the empty string", ""],
  ])("%s becomes the generic error", (_label: string, code: string) => {
    expect(McpAuthorizeUtil.toDisplayErrorCode(code)).toBe("server_error");
  });

  test("no code at all becomes the generic error", () => {
    expect(McpAuthorizeUtil.toDisplayErrorCode(null)).toBe("server_error");
    expect(McpAuthorizeUtil.toDisplayErrorCode(undefined)).toBe("server_error");
  });
});

describe("why a project cannot be chosen", () => {
  test("the page has wording for exactly the reasons the server gives", () => {
    const serverReasons: Array<string> = enumValues(
      "ConsentEndpoint.ts",
      "ConsentProjectRefusal",
    );

    expect([...serverReasons].sort()).toEqual([
      "blocked",
      "not-a-member",
      "plan",
      "sso",
    ]);

    for (const reason of serverReasons) {
      expect(McpAuthorizeUtil.toProjectRefusalKey(reason)).toBe(reason);
    }
  });

  test.each([
    ["no reason", null],
    ["an unknown reason", "quota"],
    ["a reason in the wrong case", "SSO"],
    ["markup", "<b>plan</b>"],
    ["the empty string", ""],
    ["an object property name", "constructor"],
  ] as Array<[string, string | null]>)(
    "%s reads as the plainest refusal there is",
    (_label: string, refusal: string | null) => {
      /*
       * The result is the suffix of a locale key. Passing the server's value
       * straight through would let an unexpected one render a raw dotted path
       * inside the project list.
       */
      expect(McpAuthorizeUtil.toProjectRefusalKey(refusal)).toBe(
        "not-a-member",
      );
    },
  );
});

describe("which project is preselected", () => {
  const eligibleA: McpConsentProject = project({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Acme Production",
  });
  const eligibleB: McpConsentProject = project({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Acme Staging",
  });
  const needsSso: McpConsentProject = project({
    id: "33333333-3333-4333-8333-333333333333",
    name: "Acme Finance",
    isEligible: false,
    refusal: "sso",
  });
  const onFreePlan: McpConsentProject = project({
    id: "44444444-4444-4444-8444-444444444444",
    name: "Side Project",
    isEligible: false,
    refusal: "plan",
  });

  test("only the projects a client can be connected to are eligible, in the server's order", () => {
    expect(
      McpAuthorizeUtil.getEligibleProjects(
        detailsWith([needsSso, eligibleB, onFreePlan, eligibleA]),
      ),
    ).toEqual([eligibleB, eligibleA]);

    expect(
      McpAuthorizeUtil.getEligibleProjects(detailsWith([needsSso, onFreePlan])),
    ).toEqual([]);
    expect(McpAuthorizeUtil.getEligibleProjects(detailsWith([]))).toEqual([]);
  });

  test("the only eligible project is preselected", () => {
    expect(McpAuthorizeUtil.getInitialProjectId(detailsWith([eligibleA]))).toBe(
      eligibleA.id,
    );
  });

  test("the only eligible project is preselected wherever it sits among ineligible ones", () => {
    expect(
      McpAuthorizeUtil.getInitialProjectId(
        detailsWith([needsSso, onFreePlan, eligibleB]),
      ),
    ).toBe(eligibleB.id);
    expect(
      McpAuthorizeUtil.getInitialProjectId(
        detailsWith([eligibleB, needsSso, onFreePlan]),
      ),
    ).toBe(eligibleB.id);
  });

  test("with several eligible projects nothing is preselected", () => {
    /*
     * Not the first, not the alphabetically first, not the most recent: the
     * member chooses. A default here is a client quietly connected to
     * production because it sorted ahead of staging.
     */
    expect(
      McpAuthorizeUtil.getInitialProjectId(detailsWith([eligibleA, eligibleB])),
    ).toBe("");
    expect(
      McpAuthorizeUtil.getInitialProjectId(
        detailsWith([eligibleB, needsSso, eligibleA]),
      ),
    ).toBe("");
  });

  test("with no eligible project nothing is preselected", () => {
    expect(
      McpAuthorizeUtil.getInitialProjectId(detailsWith([needsSso, onFreePlan])),
    ).toBe("");
    expect(McpAuthorizeUtil.getInitialProjectId(detailsWith([]))).toBe("");
  });

  test("an ineligible project is never the preselection, even when it is the only project", () => {
    expect(McpAuthorizeUtil.getInitialProjectId(detailsWith([needsSso]))).toBe(
      "",
    );
  });
});

describe("where the browser may be sent after a decision", () => {
  test.each([
    [
      "a hosted client's https callback",
      "https://claude.ai/api/mcp/auth_callback?code=oumcp_ac_x&state=s&iss=https%3A%2F%2Foneuptime.com%2Fmcp",
    ],
    ["a loopback callback by name", "http://localhost:33418/callback?code=x"],
    ["a loopback callback by address", "http://127.0.0.1:8080/cb?code=x"],
    ["an IPv6 loopback callback", "http://[::1]:9000/cb?code=x"],
    [
      "an editor's own scheme",
      "cursor://anysphere.cursor-retrieval/oauth/user-mcp/callback?code=x",
    ],
    [
      "another editor's own scheme",
      "vscode://vscode.github-authentication/did-authenticate?code=x",
    ],
    [
      "a reverse-domain app scheme",
      "com.example.app:/oauth2redirect?code=x&state=s",
    ],
    [
      "a denial sent back to the client",
      "https://client.example.com/cb?error=access_denied&error_description=The+request+was+denied.&state=s",
    ],
  ])("%s is followed", (_label: string, url: string) => {
    expect(McpAuthorizeUtil.isSafeRedirectUrl(url)).toBe(true);
  });

  test.each([
    ["javascript:", "javascript:alert(document.cookie)"],
    ["javascript: in capitals", "JAVASCRIPT:alert(1)"],
    ["javascript: in mixed case", "JaVaScRiPt:alert(1)"],
    ["javascript: behind leading spaces", "   javascript:alert(1)"],
    ["javascript: behind a leading newline", "\njavascript:alert(1)"],
    ["javascript: behind a leading tab", "\tjavascript:alert(1)"],
    ["javascript: split by a tab", "java\tscript:alert(1)"],
    ["javascript: split by a newline", "java\nscript:alert(1)"],
    ["javascript: behind a control character", "\x01javascript:alert(1)"],
    ["javascript: with a comment-style body", "javascript://%0aalert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    [
      "data: in capitals",
      "DATA:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    ],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["vbscript: in mixed case", "VbScript:msgbox(1)"],
    [
      "blob:",
      "blob:https://oneuptime.com/0b2f8c0e-7c1f-4c62-9b3a-0d6f4a3d2e11",
    ],
    ["file:", "file:///etc/passwd"],
    ["file: in capitals", "FILE:///C:/Windows/win.ini"],
    ["about:", "about:blank"],
    // The rest of the list the server refuses to register (RedirectUri).
    ["view-source:", "view-source:https://oneuptime.com/"],
    ["filesystem:", "filesystem:https://oneuptime.com/temporary/x.html"],
    ["jar:", "jar:https://client.example.com/a.jar!/index.html"],
    ["resource:", "resource://gre/modules/x.jsm"],
    ["chrome:", "chrome://settings/"],
    ["ftp:", "ftp://client.example.com/cb"],
    ["ws:", "ws://client.example.com/cb"],
    ["wss:", "wss://client.example.com/cb"],
    ["mailto:", "mailto:someone@example.com?subject=code"],
    ["tel:", "tel:+15551234567"],
    ["sms:", "sms:+15551234567?body=code"],
  ])("%s is never followed", (_label: string, url: string) => {
    expect(McpAuthorizeUtil.isSafeRedirectUrl(url)).toBe(false);
  });

  test("the page refuses every scheme the server refuses to register", () => {
    /*
     * Two lists, one rule. The server's decides what a client may register;
     * the page's is the same rule held at the line that navigates. A scheme
     * added to one and not the other is a gap.
     */
    const serverSource: string = fs.readFileSync(
      nodePath.join(MCP_OAUTH_SRC, "RedirectUri.ts"),
      "utf8",
    );
    const listPattern: RegExp =
      /const FORBIDDEN_SCHEMES: Set<string> = new Set<string>\(\[([\s\S]*?)\]\)/;
    const schemePattern: RegExp = /"([a-z-]+:)"/g;

    const serverList: string = (serverSource.match(listPattern) || [])[1] || "";
    const serverSchemes: Array<string> = Array.from(
      serverList.matchAll(schemePattern),
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(serverSchemes.length).toBeGreaterThanOrEqual(17);

    for (const scheme of serverSchemes) {
      expect([
        scheme,
        McpAuthorizeUtil.isSafeRedirectUrl(`${scheme}//x.example/cb`),
      ]).toEqual([scheme, false]);
    }
  });

  test.each([
    ["a path", "/dashboard"],
    ["a protocol-relative address", "//evil.example/cb"],
    ["a bare host", "client.example.com/cb"],
    ["words", "not a url"],
    ["the empty string", ""],
    ["only whitespace", "   "],
  ])("%s is not an address at all", (_label: string, value: string) => {
    expect(McpAuthorizeUtil.isSafeRedirectUrl(value)).toBe(false);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a number", 42],
    ["true", true],
    ["an object", { href: "https://client.example.com/cb" }],
    ["a list of addresses", ["https://client.example.com/cb"]],
  ] as Array<[string, unknown]>)(
    "%s is not followed",
    (_label: string, value: unknown) => {
      expect(McpAuthorizeUtil.isSafeRedirectUrl(value)).toBe(false);
    },
  );
});

describe("reading the server's answer", () => {
  test("a complete answer is read as it was sent", () => {
    expect(McpAuthorizeUtil.parseDetails(SERVER_ANSWER)).toEqual({
      client: {
        name: "Claude",
        verifiedHost: "claude.ai",
        uri: "https://claude.ai/",
        redirectTarget: "claude.ai",
        isLoopbackRedirect: false,
      },
      requestedAccess: "write",
      user: { email: "ada@example.com", name: "Ada Lovelace" },
      projects: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Acme Production",
          isEligible: true,
          refusal: null,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Acme Staging",
          isEligible: false,
          refusal: "sso",
        },
      ],
    });
  });

  test("fields the page does not know are dropped", () => {
    const parsed: McpConsentDetails | null = McpAuthorizeUtil.parseDetails(
      answerWith({
        grantedAccess: "write",
        client: {
          ...(SERVER_ANSWER["client"] as Record<string, unknown>),
          clientSecret: "oumcp_cs_should-never-be-here",
        },
      }),
    );

    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!).sort()).toEqual([
      "client",
      "projects",
      "requestedAccess",
      "user",
    ]);
    expect(Object.keys(parsed!.client).sort()).toEqual([
      "isLoopbackRedirect",
      "name",
      "redirectTarget",
      "uri",
      "verifiedHost",
    ]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "ok"],
    ["a number", 200],
    ["true", true],
    ["an empty object", {}],
    ["a list", [SERVER_ANSWER]],
    ["an answer with no client", answerWith({ client: undefined })],
    ["an answer whose client is null", answerWith({ client: null })],
    ["an answer whose client is a name", answerWith({ client: "Claude" })],
    ["an answer with no user", answerWith({ user: undefined })],
    ["an answer whose user is null", answerWith({ user: null })],
    [
      "an answer whose user is an address",
      answerWith({ user: "ada@example.com" }),
    ],
    ["an answer with no projects", answerWith({ projects: undefined })],
    ["an answer whose projects are null", answerWith({ projects: null })],
    [
      "an answer whose projects are keyed by id",
      answerWith({ projects: { "1": { id: "1", isEligible: true } } }),
    ],
    ["an answer whose projects are a count", answerWith({ projects: 2 })],
  ] as Array<[string, unknown]>)(
    "%s is no answer at all",
    (_label: string, data: unknown) => {
      expect(McpAuthorizeUtil.parseDetails(data)).toBeNull();
    },
  );

  describe("the access the client asked for", () => {
    test('is write only when the answer says "write"', () => {
      expect(
        McpAuthorizeUtil.parseDetails(answerWith({ requestedAccess: "write" }))!
          .requestedAccess,
      ).toBe("write");
    });

    test.each([
      ["read", "read"],
      ["nothing", undefined],
      ["null", null],
      ["write in capitals", "WRITE"],
      ["write with a trailing space", "write "],
      ["a wider word", "admin"],
      ["both", "read write"],
      ["a scope name", "mcp:write"],
      ["true", true],
      ["a list containing write", ["write"]],
      ["an object", { level: "write" }],
    ] as Array<[string, unknown]>)(
      "%s reads as read",
      (_label: string, requestedAccess: unknown) => {
        /*
         * This value decides whether the "Read and write" choice is offered.
         * Anything short of the exact word must fall to the narrower side.
         */
        expect(
          McpAuthorizeUtil.parseDetails(answerWith({ requestedAccess }))!
            .requestedAccess,
        ).toBe("read");
      },
    );
  });

  describe("the client", () => {
    type ClientWithFunction = (
      overrides: Record<string, unknown>,
    ) => McpConsentDetails["client"];

    const clientWith: ClientWithFunction = (
      overrides: Record<string, unknown>,
    ): McpConsentDetails["client"] => {
      return McpAuthorizeUtil.parseDetails(
        answerWith({
          client: {
            ...(SERVER_ANSWER["client"] as Record<string, unknown>),
            ...overrides,
          },
        }),
      )!.client;
    };

    test("a verified host is kept only when it is text", () => {
      expect(clientWith({ verifiedHost: "claude.ai" }).verifiedHost).toBe(
        "claude.ai",
      );
      expect(clientWith({ verifiedHost: null }).verifiedHost).toBeNull();
      expect(clientWith({ verifiedHost: undefined }).verifiedHost).toBeNull();
      expect(clientWith({ verifiedHost: true }).verifiedHost).toBeNull();
      expect(clientWith({ verifiedHost: 1 }).verifiedHost).toBeNull();
      expect(
        clientWith({ verifiedHost: { host: "claude.ai" } }).verifiedHost,
      ).toBeNull();
    });

    test("the redirect is to this device only when the answer says exactly true", () => {
      /*
       * It switches the loopback warning on. Truthy is not enough in either
       * direction: "false" is a truthy string.
       */
      expect(clientWith({ isLoopbackRedirect: true }).isLoopbackRedirect).toBe(
        true,
      );
      expect(clientWith({ isLoopbackRedirect: false }).isLoopbackRedirect).toBe(
        false,
      );
      expect(
        clientWith({ isLoopbackRedirect: "true" }).isLoopbackRedirect,
      ).toBe(false);
      expect(
        clientWith({ isLoopbackRedirect: "false" }).isLoopbackRedirect,
      ).toBe(false);
      expect(clientWith({ isLoopbackRedirect: 1 }).isLoopbackRedirect).toBe(
        false,
      );
      expect(
        clientWith({ isLoopbackRedirect: undefined }).isLoopbackRedirect,
      ).toBe(false);
    });

    test("a missing name or redirect target is empty text, never the word undefined", () => {
      const client: McpConsentDetails["client"] = clientWith({
        name: undefined,
        redirectTarget: null,
        uri: 42,
      });

      expect(client.name).toBe("");
      expect(client.redirectTarget).toBe("");
      expect(client.uri).toBeNull();
    });

    test("a name is kept exactly as sent, markup and all", () => {
      /*
       * Escaping is the renderer's job (React does it). Rewriting the name
       * here would only make two places responsible for it.
       */
      const name: string = '<img src=x onerror="alert(1)"> Claude';

      expect(clientWith({ name }).name).toBe(name);
    });
  });

  describe("the signed-in member", () => {
    test("missing fields are empty text", () => {
      const parsed: McpConsentDetails = McpAuthorizeUtil.parseDetails(
        answerWith({ user: {} }),
      )!;

      expect(parsed.user).toEqual({ email: "", name: "" });
    });
  });

  describe("the projects", () => {
    type ProjectsFromFunction = (
      projects: Array<unknown>,
    ) => Array<McpConsentProject>;

    const projectsFrom: ProjectsFromFunction = (
      projects: Array<unknown>,
    ): Array<McpConsentProject> => {
      return McpAuthorizeUtil.parseDetails(answerWith({ projects }))!.projects;
    };

    test("an empty list is an answer: the member has no projects", () => {
      expect(projectsFrom([])).toEqual([]);
    });

    test("entries that are not objects are dropped, and the rest keep their order", () => {
      expect(
        projectsFrom([
          null,
          { id: "a", name: "First", isEligible: true, refusal: null },
          "Acme",
          42,
          undefined,
          false,
          { id: "b", name: "Second", isEligible: false, refusal: "plan" },
        ]),
      ).toEqual([
        { id: "a", name: "First", isEligible: true, refusal: null },
        { id: "b", name: "Second", isEligible: false, refusal: "plan" },
      ]);
    });

    test.each([
      ["the text true", "true"],
      ["one", 1],
      ["yes", "yes"],
      ["an object", {}],
      ["a list", [true]],
      ["nothing", undefined],
      ["null", null],
      ["false", false],
    ] as Array<[string, unknown]>)(
      "a project whose eligibility is %s cannot be chosen",
      (_label: string, isEligible: unknown) => {
        /*
         * The one field that makes a project selectable. A server that
         * answered with anything but the boolean must not be read as a yes.
         */
        expect(
          projectsFrom([{ id: "a", name: "Acme", isEligible }])[0]!.isEligible,
        ).toBe(false);
      },
    );

    test("a project is eligible when the answer says exactly true", () => {
      expect(
        projectsFrom([{ id: "a", name: "Acme", isEligible: true }])[0]!
          .isEligible,
      ).toBe(true);
    });

    test("a refusal is kept only when it is text", () => {
      expect(
        projectsFrom([
          { id: "a", name: "A", isEligible: false, refusal: "sso" },
          { id: "b", name: "B", isEligible: false, refusal: 3 },
          { id: "c", name: "C", isEligible: false, refusal: { code: "sso" } },
          { id: "d", name: "D", isEligible: false },
        ]).map((item: McpConsentProject): string | null => {
          return item.refusal;
        }),
      ).toEqual(["sso", null, null, null]);
    });

    test("a missing id or name is empty text", () => {
      expect(projectsFrom([{ isEligible: true }])).toEqual([
        { id: "", name: "", isEligible: true, refusal: null },
      ]);
      expect(
        projectsFrom([{ id: null, name: null, isEligible: false }]),
      ).toEqual([{ id: "", name: "", isEligible: false, refusal: null }]);
    });

    test("a project with no id is never the preselection's way in", () => {
      /*
       * An eligible entry that lost its id parses to id "". Preselecting it
       * sets the project to "", which is the same thing as nothing chosen -
       * and the page keeps Authorize disabled for that.
       */
      const parsed: McpConsentDetails = McpAuthorizeUtil.parseDetails(
        answerWith({ projects: [{ name: "Acme", isEligible: true }] }),
      )!;

      expect(McpAuthorizeUtil.getInitialProjectId(parsed)).toBe("");
    });
  });
});

describe("whether the page is inside a frame", () => {
  /*
   * This suite runs in plain node, where there is no window at all. Each case
   * supplies the two properties the check compares and takes them away again.
   */
  type WindowLike = { top?: unknown; self?: unknown };

  const holder: { window?: WindowLike } = globalThis as unknown as {
    window?: WindowLike;
  };

  type WithWindowFunction = (
    fake: WindowLike | undefined,
    run: () => boolean,
  ) => boolean;

  const withWindow: WithWindowFunction = (
    fake: WindowLike | undefined,
    run: () => boolean,
  ): boolean => {
    const original: WindowLike | undefined = holder.window;

    if (fake === undefined) {
      delete holder.window;
    } else {
      holder.window = fake;
    }

    try {
      return run();
    } finally {
      if (original === undefined) {
        delete holder.window;
      } else {
        holder.window = original;
      }
    }
  };

  const isFramed: () => boolean = (): boolean => {
    return McpAuthorizeUtil.isFramed();
  };

  test("a page that is its own top window is not framed", () => {
    const own: WindowLike = {};
    own.top = own;
    own.self = own;

    expect(withWindow(own, isFramed)).toBe(false);
  });

  test("a page whose top window is another window is framed", () => {
    const frame: WindowLike = { top: { name: "the embedding page" } };
    frame.self = frame;

    expect(withWindow(frame, isFramed)).toBe(true);
  });

  test("a top window that cannot even be read counts as a frame", () => {
    const frame: WindowLike = {};
    frame.self = frame;

    Object.defineProperty(frame, "top", {
      get: (): unknown => {
        throw new Error("Blocked a frame with origin from accessing a frame");
      },
    });

    expect(withWindow(frame, isFramed)).toBe(true);
  });

  test("with no window to ask, the cautious answer is given", () => {
    expect(withWindow(undefined, isFramed)).toBe(true);
  });
});

describe("setting a value apart inside a right-to-left sentence", () => {
  const LEFT_TO_RIGHT_ISOLATE: string = String.fromCodePoint(0x2066);
  const FIRST_STRONG_ISOLATE: string = String.fromCodePoint(0x2068);
  const POP_DIRECTIONAL_ISOLATE: string = String.fromCodePoint(0x2069);

  test("a name is wrapped in a first-strong isolate, and is otherwise unchanged", () => {
    const wrapped: string = McpAuthorizeUtil.isolate("Claude Code", "rtl");

    expect(wrapped).toBe(
      `${FIRST_STRONG_ISOLATE}Claude Code${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(wrapped.slice(1, -1)).toBe("Claude Code");
    expect(wrapped).toHaveLength("Claude Code".length + 2);
  });

  test("an address is wrapped in a LEFT-TO-RIGHT isolate: it has no letters to take a direction from", () => {
    const wrapped: string = McpAuthorizeUtil.isolateLeftToRight(
      "[::1]:33418",
      "rtl",
    );

    expect(wrapped).toBe(
      `${LEFT_TO_RIGHT_ISOLATE}[::1]:33418${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(wrapped.slice(1, -1)).toBe("[::1]:33418");
    // Not the first-strong one, which would leave the order to the page.
    expect(wrapped).not.toContain(FIRST_STRONG_ISOLATE);
  });

  test.each([["ltr"], [""], ["auto"], ["RTL"]])(
    "a page whose direction is %j gets both kinds of value back untouched",
    (direction: string) => {
      expect(McpAuthorizeUtil.isolate("Claude", direction)).toBe("Claude");
      expect(
        McpAuthorizeUtil.isolateLeftToRight("127.0.0.1:33418", direction),
      ).toBe("127.0.0.1:33418");
    },
  );

  test("nothing is wrapped around nothing", () => {
    expect(McpAuthorizeUtil.isolate("", "rtl")).toBe("");
    expect(McpAuthorizeUtil.isolateLeftToRight("", "rtl")).toBe("");
  });

  test("the marks are built from code points: no invisible character sits in the source", () => {
    const source: string = fs.readFileSync(
      nodePath.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Accounts",
        "src",
        "Utils",
        "McpAuthorize.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain(LEFT_TO_RIGHT_ISOLATE);
    expect(source).not.toContain(FIRST_STRONG_ISOLATE);
    expect(source).not.toContain(POP_DIRECTIONAL_ISOLATE);
    expect(source).toContain("String.fromCodePoint(0x2066)");
    expect(source).toContain("String.fromCodePoint(0x2068)");
    expect(source).toContain("String.fromCodePoint(0x2069)");
  });
});
