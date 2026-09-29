import {
  OAUTH2_TOKEN_REFRESH_SKEW_IN_MS,
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  OAuth2TokenStatus,
  OAuth2TokenStatusSummary,
  RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS,
  WorkflowVariableReference,
  WorkflowVariableScope,
  WorkflowVariableType,
  getOAuth2AdditionalParametersError,
  getOAuth2TokenStatus,
  getWorkflowVariableReferences,
  isOAuth2AccessTokenUsable,
  isOAuth2ClientAuthenticationMethod,
  isOAuth2GrantType,
  isOAuth2WorkflowVariable,
  normalizeOAuth2AdditionalParameters,
  toDateOrNull,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import { describe, expect, test } from "@jest/globals";

/*
 * The rules both the runner and the dashboard read: when a cached OAuth access
 * token may be handed to a component, what the dashboard says about it, and
 * which variables a component argument refers to (which decides what gets
 * refreshed before a step runs).
 */

const NOW: Date = new Date("2026-09-22T12:00:00.000Z");

function secondsFromNow(seconds: number): Date {
  return new Date(NOW.getTime() + seconds * 1000);
}

describe("isOAuth2AccessTokenUsable", () => {
  test("is false when there is no cached token, whatever the expiry says", () => {
    expect(
      isOAuth2AccessTokenUsable({
        state: {
          hasAccessToken: false,
          accessTokenExpiresAt: secondsFromNow(3600),
          lastRefreshedAt: NOW,
        },
        now: NOW,
      }),
    ).toBe(false);
  });

  test("is true for a token that expires well after the refresh margin", () => {
    expect(
      isOAuth2AccessTokenUsable({
        state: {
          hasAccessToken: true,
          accessTokenExpiresAt: secondsFromNow(3600),
        },
        now: NOW,
      }),
    ).toBe(true);
  });

  test("is false for a token that has already expired", () => {
    expect(
      isOAuth2AccessTokenUsable({
        state: {
          hasAccessToken: true,
          accessTokenExpiresAt: secondsFromNow(-1),
        },
        now: NOW,
      }),
    ).toBe(false);
  });

  /*
   * A token handed to a component a few seconds before it expires can expire
   * in flight, and the API answers 401 exactly as if nothing had been done. The
   * margin is what prevents that.
   */
  test("treats a token inside the refresh margin as expired", () => {
    const marginInSeconds: number = OAUTH2_TOKEN_REFRESH_SKEW_IN_MS / 1000;

    expect(
      isOAuth2AccessTokenUsable({
        state: {
          hasAccessToken: true,
          accessTokenExpiresAt: secondsFromNow(marginInSeconds),
        },
        now: NOW,
      }),
    ).toBe(false);

    expect(
      isOAuth2AccessTokenUsable({
        state: {
          hasAccessToken: true,
          accessTokenExpiresAt: secondsFromNow(marginInSeconds - 1),
        },
        now: NOW,
      }),
    ).toBe(false);

    expect(
      isOAuth2AccessTokenUsable({
        state: {
          hasAccessToken: true,
          accessTokenExpiresAt: secondsFromNow(marginInSeconds + 1),
        },
        now: NOW,
      }),
    ).toBe(true);
  });

  test("reads an ISO string expiry the way the API serialises dates", () => {
    expect(
      isOAuth2AccessTokenUsable({
        state: {
          hasAccessToken: true,
          accessTokenExpiresAt: secondsFromNow(3600).toISOString(),
        },
        now: NOW,
      }),
    ).toBe(true);
  });

  describe("a token whose expiry is unknown", () => {
    /*
     * The provider sent no expires_in and the token is not a JWT. Trusting it
     * forever would bring back exactly the failure this feature removes: a
     * workflow that starts failing with 401 at some unknowable moment.
     */
    test("is not usable without a cut-off", () => {
      expect(
        isOAuth2AccessTokenUsable({
          state: {
            hasAccessToken: true,
            accessTokenExpiresAt: null,
            lastRefreshedAt: NOW,
          },
          now: NOW,
        }),
      ).toBe(false);
    });

    test("is usable when it was fetched at or after the cut-off", () => {
      expect(
        isOAuth2AccessTokenUsable({
          state: {
            hasAccessToken: true,
            accessTokenExpiresAt: null,
            lastRefreshedAt: NOW,
          },
          now: secondsFromNow(30),
          acceptTokenRefreshedAtOrAfter: NOW,
        }),
      ).toBe(true);
    });

    test("is not usable when it was fetched before the cut-off", () => {
      expect(
        isOAuth2AccessTokenUsable({
          state: {
            hasAccessToken: true,
            accessTokenExpiresAt: null,
            lastRefreshedAt: secondsFromNow(-1),
          },
          now: NOW,
          acceptTokenRefreshedAtOrAfter: NOW,
        }),
      ).toBe(false);
    });

    test("is not usable when nobody recorded when it was fetched", () => {
      expect(
        isOAuth2AccessTokenUsable({
          state: {
            hasAccessToken: true,
            accessTokenExpiresAt: null,
            lastRefreshedAt: null,
          },
          now: NOW,
          acceptTokenRefreshedAtOrAfter: NOW,
        }),
      ).toBe(false);
    });
  });
});

describe("getOAuth2TokenStatus", () => {
  test("a variable nobody has fetched a token for is Not fetched yet", () => {
    const summary: OAuth2TokenStatusSummary = getOAuth2TokenStatus({
      now: NOW,
    });

    expect(summary.status).toBe(OAuth2TokenStatus.NotFetched);
  });

  test("a cached token that has not expired is Valid, with its expiry", () => {
    const expiresAt: Date = secondsFromNow(1800);

    const summary: OAuth2TokenStatusSummary = getOAuth2TokenStatus({
      accessTokenExpiresAt: expiresAt,
      lastRefreshedAt: secondsFromNow(-1800),
      now: NOW,
    });

    expect(summary.status).toBe(OAuth2TokenStatus.Valid);
    expect(summary.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
  });

  test("a cached token past its expiry is Expired", () => {
    const summary: OAuth2TokenStatusSummary = getOAuth2TokenStatus({
      accessTokenExpiresAt: secondsFromNow(-60),
      lastRefreshedAt: secondsFromNow(-3660),
      now: NOW,
    });

    expect(summary.status).toBe(OAuth2TokenStatus.Expired);
  });

  test("a token expiring exactly now is Expired", () => {
    expect(
      getOAuth2TokenStatus({
        accessTokenExpiresAt: NOW,
        lastRefreshedAt: secondsFromNow(-3600),
        now: NOW,
      }).status,
    ).toBe(OAuth2TokenStatus.Expired);
  });

  test("a cached token with no reported expiry says so", () => {
    expect(
      getOAuth2TokenStatus({
        accessTokenExpiresAt: null,
        lastRefreshedAt: secondsFromNow(-5),
        now: NOW,
      }).status,
    ).toBe(OAuth2TokenStatus.NoExpiry);
  });

  /*
   * A failed refresh is the one state somebody has to act on, so it wins even
   * over a cached token that still looks valid.
   */
  test("a recorded failure wins over everything else", () => {
    const summary: OAuth2TokenStatusSummary = getOAuth2TokenStatus({
      accessTokenExpiresAt: secondsFromNow(1800),
      lastRefreshedAt: secondsFromNow(-1800),
      lastRefreshError: "invalid_client",
      lastRefreshErrorAt: secondsFromNow(-10),
      now: NOW,
    });

    expect(summary.status).toBe(OAuth2TokenStatus.RefreshFailed);
    expect(summary.lastRefreshError).toBe("invalid_client");
    expect(summary.lastRefreshErrorAt?.toISOString()).toBe(
      secondsFromNow(-10).toISOString(),
    );
  });

  test("an empty error string is not a failure", () => {
    expect(
      getOAuth2TokenStatus({
        accessTokenExpiresAt: secondsFromNow(1800),
        lastRefreshedAt: NOW,
        lastRefreshError: "",
        now: NOW,
      }).status,
    ).toBe(OAuth2TokenStatus.Valid);
  });

  test("reads serialised dates from the API", () => {
    expect(
      getOAuth2TokenStatus({
        accessTokenExpiresAt: secondsFromNow(1800).toISOString(),
        lastRefreshedAt: NOW.toISOString(),
        now: NOW,
      }).status,
    ).toBe(OAuth2TokenStatus.Valid);
  });
});

describe("getWorkflowVariableReferences", () => {
  function refs(value: unknown): Array<WorkflowVariableReference> {
    return getWorkflowVariableReferences(value as never);
  }

  test("finds a global variable reference", () => {
    expect(refs("Bearer {{global.variables.API_TOKEN}}")).toEqual([
      { scope: WorkflowVariableScope.Global, name: "API_TOKEN" },
    ]);
  });

  test("finds a local variable reference", () => {
    expect(refs("{{local.variables.token}}")).toEqual([
      { scope: WorkflowVariableScope.Local, name: "token" },
    ]);
  });

  test("keeps local and global variables of the same name apart", () => {
    expect(
      refs("{{local.variables.TOKEN}} and {{global.variables.TOKEN}}"),
    ).toEqual([
      { scope: WorkflowVariableScope.Local, name: "TOKEN" },
      { scope: WorkflowVariableScope.Global, name: "TOKEN" },
    ]);
  });

  test("reports each variable once, in first-seen order", () => {
    expect(
      refs(
        "{{global.variables.B}} {{global.variables.A}} {{global.variables.B}}",
      ),
    ).toEqual([
      { scope: WorkflowVariableScope.Global, name: "B" },
      { scope: WorkflowVariableScope.Global, name: "A" },
    ]);
  });

  test("ignores component outputs and anything that is not a variable", () => {
    expect(
      refs(
        "{{local.components.api-1.returnValues.response-body}} {{@index}} {{this}} {{global.variables}} {{other.variables.X}}",
      ),
    ).toEqual([]);
  });

  /*
   * A JSON argument (request headers, a body) can arrive as an object. The
   * runtime stringifies it before substituting, so references inside keys and
   * values both count.
   */
  test("finds references inside an object argument, keys included", () => {
    expect(
      refs({
        Authorization: "Bearer {{global.variables.API_TOKEN}}",
        "{{local.variables.HEADER_NAME}}": "x",
        nested: { deeper: ["{{global.variables.OTHER}}"] },
      }),
    ).toEqual([
      { scope: WorkflowVariableScope.Global, name: "API_TOKEN" },
      { scope: WorkflowVariableScope.Local, name: "HEADER_NAME" },
      { scope: WorkflowVariableScope.Global, name: "OTHER" },
    ]);
  });

  /*
   * Over-detection costs at most one token request; under-detection hands an
   * expired token to a component. So padded names count even though the
   * top-level runtime does not resolve them, and loop bodies count.
   */
  test("errs towards finding too much: padded names and loop bodies count", () => {
    expect(
      refs(
        "{{ global.variables.PADDED }} {{#each local.components.x.returnValues.items}}{{global.variables.IN_LOOP}}{{/each}}",
      ),
    ).toEqual([
      { scope: WorkflowVariableScope.Global, name: "PADDED" },
      { scope: WorkflowVariableScope.Global, name: "IN_LOOP" },
    ]);
  });

  test("finds the array a loop iterates when it is a variable", () => {
    expect(refs("{{#each global.variables.LIST}}{{this}}{{/each}}")).toEqual([
      { scope: WorkflowVariableScope.Global, name: "LIST" },
    ]);
  });

  test("takes only the variable name from a deeper path", () => {
    expect(refs("{{global.variables.CONFIG.nested}}")).toEqual([
      { scope: WorkflowVariableScope.Global, name: "CONFIG" },
    ]);
  });

  test("returns nothing for values with no references", () => {
    expect(refs("plain text")).toEqual([]);
    expect(refs("")).toEqual([]);
    expect(refs(undefined)).toEqual([]);
    expect(refs(null)).toEqual([]);
    expect(refs(42)).toEqual([]);
    expect(refs(true)).toEqual([]);
    expect(refs({ a: 1 })).toEqual([]);
  });
});

describe("additional token request parameters", () => {
  test("normalises values to strings and drops what cannot be a form field", () => {
    expect(
      normalizeOAuth2AdditionalParameters({
        audience: "https://api.example.com",
        max_age: 300,
        prompt: false,
        nested: { no: "thanks" },
        list: ["a"],
        missing: null,
      }),
    ).toEqual({
      audience: "https://api.example.com",
      max_age: "300",
      prompt: "false",
    });
  });

  test("drops reserved names whatever their casing, and blank names", () => {
    expect(
      normalizeOAuth2AdditionalParameters({
        GRANT_TYPE: "password",
        Client_Secret: "stolen",
        refresh_token: "x",
        scope: "admin",
        client_id: "other",
        "  ": "blank",
        resource: "https://graph.windows.net",
      }),
    ).toEqual({ resource: "https://graph.windows.net" });
  });

  test("trims names", () => {
    expect(normalizeOAuth2AdditionalParameters({ " audience ": "x" })).toEqual({
      audience: "x",
    });
  });

  test("yields nothing for anything that is not a plain object", () => {
    expect(normalizeOAuth2AdditionalParameters(null)).toEqual({});
    expect(normalizeOAuth2AdditionalParameters("audience=x")).toEqual({});
    expect(normalizeOAuth2AdditionalParameters(["audience"])).toEqual({});
  });

  test("accepts no parameters at all", () => {
    expect(getOAuth2AdditionalParametersError(undefined)).toBeNull();
    expect(getOAuth2AdditionalParametersError(null)).toBeNull();
    expect(getOAuth2AdditionalParametersError({})).toBeNull();
  });

  test("accepts text, numbers and booleans", () => {
    expect(
      getOAuth2AdditionalParametersError({
        audience: "https://api.example.com",
        max_age: 300,
        offline: true,
      }),
    ).toBeNull();
  });

  test.each(
    RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS.map((name: string) => {
      return [name];
    }),
  )("refuses the reserved name %s", (name: string) => {
    expect(getOAuth2AdditionalParametersError({ [name]: "x" })).toContain(
      `"${name}" cannot be set as an additional parameter`,
    );
    expect(
      getOAuth2AdditionalParametersError({ [name.toUpperCase()]: "x" }),
    ).not.toBeNull();
  });

  test("refuses a blank name, a nested value and a non-object", () => {
    expect(getOAuth2AdditionalParametersError({ " ": "x" })).toBe(
      "Every additional parameter needs a name.",
    );
    expect(
      getOAuth2AdditionalParametersError({ audience: { a: 1 } }),
    ).toContain("must be text, a number or true/false");
    expect(getOAuth2AdditionalParametersError("audience=x")).toBe(
      "Additional parameters must be a set of names and values.",
    );
    expect(getOAuth2AdditionalParametersError(["audience"])).toBe(
      "Additional parameters must be a set of names and values.",
    );
  });
});

describe("type guards", () => {
  test("isOAuth2WorkflowVariable only matches the OAuth type", () => {
    expect(isOAuth2WorkflowVariable(WorkflowVariableType.OAuth2)).toBe(true);
    expect(isOAuth2WorkflowVariable(WorkflowVariableType.Static)).toBe(false);
    expect(isOAuth2WorkflowVariable(undefined)).toBe(false);
    expect(isOAuth2WorkflowVariable("oauth")).toBe(false);
  });

  test("isOAuth2GrantType matches the supported grants only", () => {
    expect(isOAuth2GrantType(OAuth2GrantType.ClientCredentials)).toBe(true);
    expect(isOAuth2GrantType(OAuth2GrantType.RefreshToken)).toBe(true);
    expect(isOAuth2GrantType("client_credentials")).toBe(false);
    expect(isOAuth2GrantType("Password")).toBe(false);
    expect(isOAuth2GrantType(undefined)).toBe(false);
  });

  test("isOAuth2ClientAuthenticationMethod matches the two methods only", () => {
    expect(
      isOAuth2ClientAuthenticationMethod(
        OAuth2ClientAuthenticationMethod.BasicAuthHeader,
      ),
    ).toBe(true);
    expect(
      isOAuth2ClientAuthenticationMethod(
        OAuth2ClientAuthenticationMethod.RequestBody,
      ),
    ).toBe(true);
    expect(isOAuth2ClientAuthenticationMethod("client_secret_jwt")).toBe(false);
  });
});

describe("toDateOrNull", () => {
  test("passes dates through and parses strings and epoch numbers", () => {
    expect(toDateOrNull(NOW)?.toISOString()).toBe(NOW.toISOString());
    expect(toDateOrNull(NOW.toISOString())?.toISOString()).toBe(
      NOW.toISOString(),
    );
    expect(toDateOrNull(NOW.getTime())?.toISOString()).toBe(NOW.toISOString());
  });

  test("treats absent and unparseable values as no date rather than the epoch", () => {
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull(undefined)).toBeNull();
    expect(toDateOrNull("")).toBeNull();
    expect(toDateOrNull("not a date")).toBeNull();
  });
});
