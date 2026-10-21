import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The identity providers the Create OAuth 2.0 Variable form knows by name:
 * the presets that replaced a paragraph of four providers' token URL
 * templates under the Token URL field. Picking one fills in the token URL
 * (and Google's grant), and adds a line of help, written for that provider,
 * under the fields people most often get wrong for it.
 *
 * Everything is pure except the hint component, which is rendered for real.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import {
  DEFAULT_OAUTH_GRANT_TYPE,
  OAUTH_IDENTITY_PROVIDER_DROPDOWN_OPTIONS,
  OAUTH_IDENTITY_PROVIDER_FIELD_KEY,
  OAUTH_IDENTITY_PROVIDER_PRESETS,
  OAuthIdentityProvider,
  OAuthIdentityProviderPreset,
  OAuthProviderHintField,
  applyOAuthIdentityProviderPreset,
  getOAuthIdentityProviderPreset,
  getOAuthProviderHint,
  getOAuthTokenUrlPlaceholderError,
  isOAuthPresetTokenUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/OAuthIdentityProviders";
import OAuthProviderHint from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/OAuthProviderHint";
import { getOAuthVariableCreateFormFields } from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import { OAuth2GrantType } from "../../../Types/Workflow/WorkflowVariableOAuth";

const ENTRA_TOKEN_URL: string =
  "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token";
const GOOGLE_TOKEN_URL: string = "https://oauth2.googleapis.com/token";
const OKTA_TOKEN_URL: string = "https://{your-domain}/oauth2/default/v1/token";
const AUTH0_TOKEN_URL: string = "https://{your-domain}/oauth/token";

type Values = Record<string, unknown>;

function preset(provider: OAuthIdentityProvider): OAuthIdentityProviderPreset {
  const found: OAuthIdentityProviderPreset | undefined =
    getOAuthIdentityProviderPreset(provider);

  if (!found) {
    throw new Error(`No preset for ${provider}`);
  }

  return found;
}

function pick(values: Values, provider: unknown): Values {
  return applyOAuthIdentityProviderPreset({ values, provider });
}

function hint(values: Values, field: OAuthProviderHintField): string | null {
  return getOAuthProviderHint({ values, field });
}

function withProvider(
  provider: OAuthIdentityProvider,
  extra: Values = {},
): Values {
  return { [OAUTH_IDENTITY_PROVIDER_FIELD_KEY]: provider, ...extra };
}

afterEach(() => {
  cleanup();
});

describe("the presets", () => {
  test("are Microsoft Entra ID, Google, Okta, Auth0 and Other provider, in that order", () => {
    expect(
      OAUTH_IDENTITY_PROVIDER_PRESETS.map(
        (item: OAuthIdentityProviderPreset): string => {
          return item.label;
        },
      ),
    ).toEqual([
      "Microsoft Entra ID",
      "Google",
      "Okta",
      "Auth0",
      "Other provider",
    ]);
  });

  test("cover every provider exactly once", () => {
    expect(
      OAUTH_IDENTITY_PROVIDER_PRESETS.map(
        (item: OAuthIdentityProviderPreset): OAuthIdentityProvider => {
          return item.provider;
        },
      ).sort(),
    ).toEqual(Object.values(OAuthIdentityProvider).sort());
  });

  test("are the provider picker's options", () => {
    expect(OAUTH_IDENTITY_PROVIDER_DROPDOWN_OPTIONS).toEqual(
      OAUTH_IDENTITY_PROVIDER_PRESETS.map(
        (item: OAuthIdentityProviderPreset): DropdownOption => {
          return { value: item.provider, label: item.label };
        },
      ),
    );
  });

  // The templates the old Token URL help listed, one per provider.
  test("fill in each provider's token endpoint", () => {
    expect(preset(OAuthIdentityProvider.MicrosoftEntraId).tokenUrl).toBe(
      ENTRA_TOKEN_URL,
    );
    expect(preset(OAuthIdentityProvider.Google).tokenUrl).toBe(
      GOOGLE_TOKEN_URL,
    );
    expect(preset(OAuthIdentityProvider.Okta).tokenUrl).toBe(OKTA_TOKEN_URL);
    expect(preset(OAuthIdentityProvider.Auth0).tokenUrl).toBe(AUTH0_TOKEN_URL);
    expect(preset(OAuthIdentityProvider.Other).tokenUrl).toBe("");
  });

  test("point every token URL at https", () => {
    for (const item of OAUTH_IDENTITY_PROVIDER_PRESETS) {
      if (item.tokenUrl) {
        expect(item.tokenUrl.startsWith("https://")).toBe(true);
      }
    }
  });

  // Google's OAuth clients have no Client Credentials grant.
  test("set a grant only for Google, which needs Refresh Token", () => {
    expect(preset(OAuthIdentityProvider.Google).grantType).toBe(
      OAuth2GrantType.RefreshToken,
    );

    for (const provider of [
      OAuthIdentityProvider.MicrosoftEntraId,
      OAuthIdentityProvider.Okta,
      OAuthIdentityProvider.Auth0,
      OAuthIdentityProvider.Other,
    ]) {
      expect(preset(provider).grantType).toBeUndefined();
    }
  });

  /*
   * A template's placeholder is the person's own value, so its provider must
   * say what to replace it with - right where the URL is.
   */
  test("explain every placeholder in their token URL", () => {
    for (const item of OAUTH_IDENTITY_PROVIDER_PRESETS) {
      const placeholders: Array<string> =
        item.tokenUrl.match(/\{[^}]*\}/g) || [];

      for (const placeholder of placeholders) {
        expect(hint(withProvider(item.provider), "oauthTokenUrl")).toContain(
          placeholder,
        );
      }
    }
  });

  test("put their hints only on fields the create form has", () => {
    const formKeys: Array<string> = getOAuthVariableCreateFormFields({
      isGlobal: true,
    }).map((field: ModelField<WorkflowVariable>): string => {
      return Object.keys(field.field || {})[0] || "";
    });

    for (const item of OAUTH_IDENTITY_PROVIDER_PRESETS) {
      for (const entry of item.hints) {
        expect(formKeys).toContain(entry.field);
      }
    }
  });

  // One line under a field, not another paragraph.
  test("keep every hint to one or two sentences", () => {
    for (const item of OAUTH_IDENTITY_PROVIDER_PRESETS) {
      for (const entry of item.hints) {
        expect(entry.text.length).toBeLessThanOrEqual(200);
        expect((entry.text.match(/\. /g) || []).length).toBeLessThanOrEqual(1);
      }
    }
  });

  test("give each field at most one hint per grant", () => {
    for (const item of OAUTH_IDENTITY_PROVIDER_PRESETS) {
      const seen: Set<string> = new Set<string>();

      for (const entry of item.hints) {
        const key: string = `${entry.field}:${entry.onlyForGrantType || "any"}`;

        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("getOAuthIdentityProviderPreset", () => {
  test("finds a preset by provider", () => {
    expect(getOAuthIdentityProviderPreset("Okta")?.label).toBe("Okta");
  });

  test("finds nothing for no provider or an unknown one", () => {
    expect(getOAuthIdentityProviderPreset(undefined)).toBeUndefined();
    expect(getOAuthIdentityProviderPreset(null)).toBeUndefined();
    expect(getOAuthIdentityProviderPreset("Keycloak")).toBeUndefined();
  });
});

describe("isOAuthPresetTokenUrl", () => {
  test("knows every preset's template", () => {
    for (const url of [
      ENTRA_TOKEN_URL,
      GOOGLE_TOKEN_URL,
      OKTA_TOKEN_URL,
      AUTH0_TOKEN_URL,
    ]) {
      expect(isOAuthPresetTokenUrl(url)).toBe(true);
    }
  });

  test("does not take a URL the person typed or edited for a template", () => {
    expect(
      isOAuthPresetTokenUrl(
        "https://login.microsoftonline.com/0b1c2d3e/oauth2/v2.0/token",
      ),
    ).toBe(false);
    expect(isOAuthPresetTokenUrl(`${GOOGLE_TOKEN_URL}?x=1`)).toBe(false);
    expect(isOAuthPresetTokenUrl("")).toBe(false);
    expect(isOAuthPresetTokenUrl(undefined)).toBe(false);
    expect(isOAuthPresetTokenUrl(42)).toBe(false);
  });
});

describe("getOAuthTokenUrlPlaceholderError", () => {
  test("names the placeholder still in a template", () => {
    expect(getOAuthTokenUrlPlaceholderError(ENTRA_TOKEN_URL)).toBe(
      "Replace {tenant-id} in the token URL with your own value.",
    );
    expect(getOAuthTokenUrlPlaceholderError(OKTA_TOKEN_URL)).toBe(
      "Replace {your-domain} in the token URL with your own value.",
    );
    expect(getOAuthTokenUrlPlaceholderError(AUTH0_TOKEN_URL)).toBe(
      "Replace {your-domain} in the token URL with your own value.",
    );
  });

  test("names the first placeholder of several", () => {
    expect(
      getOAuthTokenUrlPlaceholderError("https://{domain}/{tenant}/token"),
    ).toBe("Replace {domain} in the token URL with your own value.");
  });

  test("passes a real URL, including one with no placeholder at all", () => {
    expect(getOAuthTokenUrlPlaceholderError(GOOGLE_TOKEN_URL)).toBeNull();
    expect(
      getOAuthTokenUrlPlaceholderError(
        "https://dev-123456.okta.com/oauth2/default/v1/token",
      ),
    ).toBeNull();
  });

  // Nothing typed is the required check's to report, not this one's.
  test("passes nothing typed yet", () => {
    expect(getOAuthTokenUrlPlaceholderError(undefined)).toBeNull();
    expect(getOAuthTokenUrlPlaceholderError(null)).toBeNull();
    expect(getOAuthTokenUrlPlaceholderError("")).toBeNull();
  });
});

describe("applyOAuthIdentityProviderPreset", () => {
  test("fills in an empty token URL", () => {
    expect(
      pick({}, OAuthIdentityProvider.MicrosoftEntraId)["oauthTokenUrl"],
    ).toBe(ENTRA_TOKEN_URL);
    expect(
      pick({ oauthTokenUrl: "" }, OAuthIdentityProvider.Auth0)["oauthTokenUrl"],
    ).toBe(AUTH0_TOKEN_URL);
  });

  test("swaps another preset's untouched template", () => {
    const afterEntra: Values = {
      ...pick({}, OAuthIdentityProvider.MicrosoftEntraId),
      [OAUTH_IDENTITY_PROVIDER_FIELD_KEY]:
        OAuthIdentityProvider.MicrosoftEntraId,
    };

    expect(pick(afterEntra, OAuthIdentityProvider.Okta)["oauthTokenUrl"]).toBe(
      OKTA_TOKEN_URL,
    );
  });

  test("keeps a token URL the person typed or edited", () => {
    for (const typed of [
      "https://sso.example.com/realms/ops/protocol/openid-connect/token",
      "https://login.microsoftonline.com/0b1c2d3e/oauth2/v2.0/token",
    ]) {
      expect(
        pick({ oauthTokenUrl: typed }, OAuthIdentityProvider.Google)[
          "oauthTokenUrl"
        ],
      ).toBe(typed);
    }
  });

  test("Other provider never touches the token URL", () => {
    expect(pick({}, OAuthIdentityProvider.Other)).toEqual({});
    expect(
      pick({ oauthTokenUrl: OKTA_TOKEN_URL }, OAuthIdentityProvider.Other)[
        "oauthTokenUrl"
      ],
    ).toBe(OKTA_TOKEN_URL);
  });

  test("sets Google's Refresh Token grant", () => {
    expect(
      pick(
        { oauthGrantType: OAuth2GrantType.ClientCredentials },
        OAuthIdentityProvider.Google,
      )["oauthGrantType"],
    ).toBe(OAuth2GrantType.RefreshToken);
    expect(pick({}, OAuthIdentityProvider.Google)["oauthGrantType"]).toBe(
      OAuth2GrantType.RefreshToken,
    );
  });

  test("leaves the grant alone for a provider that works with either", () => {
    for (const provider of [
      OAuthIdentityProvider.MicrosoftEntraId,
      OAuthIdentityProvider.Okta,
      OAuthIdentityProvider.Auth0,
      OAuthIdentityProvider.Other,
    ]) {
      expect(
        pick({ oauthGrantType: OAuth2GrantType.RefreshToken }, provider)[
          "oauthGrantType"
        ],
      ).toBe(OAuth2GrantType.RefreshToken);
      expect(pick({}, provider)["oauthGrantType"]).toBeUndefined();
    }
  });

  // Undo what Google did, when nobody changed it since.
  test("puts the grant back to Client Credentials when leaving Google untouched", () => {
    const afterGoogle: Values = withProvider(OAuthIdentityProvider.Google, {
      oauthTokenUrl: GOOGLE_TOKEN_URL,
      oauthGrantType: OAuth2GrantType.RefreshToken,
    });

    const afterOkta: Values = pick(afterGoogle, OAuthIdentityProvider.Okta);

    expect(afterOkta["oauthGrantType"]).toBe(DEFAULT_OAUTH_GRANT_TYPE);
    expect(afterOkta["oauthGrantType"]).toBe(OAuth2GrantType.ClientCredentials);
    expect(afterOkta["oauthTokenUrl"]).toBe(OKTA_TOKEN_URL);
  });

  test("keeps a grant the person changed after picking Google", () => {
    const changedByHand: Values = withProvider(OAuthIdentityProvider.Google, {
      oauthGrantType: OAuth2GrantType.ClientCredentials,
    });

    expect(
      pick(changedByHand, OAuthIdentityProvider.Auth0)["oauthGrantType"],
    ).toBe(OAuth2GrantType.ClientCredentials);
  });

  test("keeps a Refresh Token grant the person picked under another provider", () => {
    const pickedByHand: Values = withProvider(
      OAuthIdentityProvider.MicrosoftEntraId,
      { oauthGrantType: OAuth2GrantType.RefreshToken },
    );

    expect(
      pick(pickedByHand, OAuthIdentityProvider.Okta)["oauthGrantType"],
    ).toBe(OAuth2GrantType.RefreshToken);
  });

  // Re-picking the same provider must not undo what the person typed since.
  test("changes nothing when the provider picked is the one already picked", () => {
    const values: Values = withProvider(OAuthIdentityProvider.Google, {
      oauthTokenUrl: "",
      oauthGrantType: OAuth2GrantType.ClientCredentials,
    });

    expect(pick(values, OAuthIdentityProvider.Google)).toBe(values);
  });

  test("changes nothing for a cleared or unknown provider", () => {
    const values: Values = { oauthTokenUrl: OKTA_TOKEN_URL };

    expect(pick(values, null)).toBe(values);
    expect(pick(values, undefined)).toBe(values);
    expect(pick(values, "Keycloak")).toBe(values);
  });

  test("never sets the provider itself or touches any other value", () => {
    const values: Values = {
      name: "GRAPH_TOKEN",
      description: "Graph",
      oauthClientId: "client-id",
      oauthScope: "openid",
    };

    const next: Values = pick(values, OAuthIdentityProvider.MicrosoftEntraId);

    expect(next).toEqual({ ...values, oauthTokenUrl: ENTRA_TOKEN_URL });
    expect(next[OAUTH_IDENTITY_PROVIDER_FIELD_KEY]).toBeUndefined();
    // A copy: the form's own values object is left as it was.
    expect(values["oauthTokenUrl"]).toBeUndefined();
  });
});

describe("getOAuthProviderHint", () => {
  test("says nothing with no provider picked", () => {
    for (const field of [
      "oauthTokenUrl",
      "oauthGrantType",
      "oauthClientId",
      "oauthClientSecret",
      "oauthScope",
      "oauthAdditionalParameters",
    ] as Array<OAuthProviderHintField>) {
      expect(hint({}, field)).toBeNull();
    }
  });

  test("tells Microsoft Entra ID users where each value lives", () => {
    const entra: Values = withProvider(OAuthIdentityProvider.MicrosoftEntraId);

    expect(hint(entra, "oauthTokenUrl")).toBe(
      "Replace {tenant-id} with your Directory (tenant) ID, shown on your app registration's Overview page.",
    );
    expect(hint(entra, "oauthClientId")).toContain("Application (client) ID");
    expect(hint(entra, "oauthClientSecret")).toBe(
      "Paste the secret's Value from Certificates & secrets - not its Secret ID.",
    );
  });

  test("asks Microsoft Entra ID for a /.default scope only for Client Credentials", () => {
    expect(
      hint(withProvider(OAuthIdentityProvider.MicrosoftEntraId), "oauthScope"),
    ).toContain("/.default");
    expect(
      hint(
        withProvider(OAuthIdentityProvider.MicrosoftEntraId, {
          oauthGrantType: OAuth2GrantType.RefreshToken,
        }),
        "oauthScope",
      ),
    ).toBeNull();
  });

  test("asks Auth0 for an audience only for Client Credentials", () => {
    expect(
      hint(
        withProvider(OAuthIdentityProvider.Auth0, {
          oauthGrantType: OAuth2GrantType.ClientCredentials,
        }),
        "oauthAdditionalParameters",
      ),
    ).toContain("audience");
    expect(
      hint(
        withProvider(OAuthIdentityProvider.Auth0, {
          oauthGrantType: OAuth2GrantType.RefreshToken,
        }),
        "oauthAdditionalParameters",
      ),
    ).toBeNull();
  });

  test("asks Okta for a custom scope only for Client Credentials", () => {
    expect(
      hint(withProvider(OAuthIdentityProvider.Okta), "oauthScope"),
    ).toContain("custom scope");
    expect(
      hint(
        withProvider(OAuthIdentityProvider.Okta, {
          oauthGrantType: OAuth2GrantType.RefreshToken,
        }),
        "oauthScope",
      ),
    ).toBeNull();
  });

  test("tells Google users why the grant is Refresh Token, whichever is picked", () => {
    for (const grant of [
      OAuth2GrantType.RefreshToken,
      OAuth2GrantType.ClientCredentials,
    ]) {
      expect(
        hint(
          withProvider(OAuthIdentityProvider.Google, { oauthGrantType: grant }),
          "oauthGrantType",
        ),
      ).toContain("cannot use Client Credentials");
    }
  });

  // Nothing in Google's token URL is the person's own.
  test("says nothing about Google's token URL", () => {
    expect(
      hint(withProvider(OAuthIdentityProvider.Google), "oauthTokenUrl"),
    ).toBeNull();
  });

  test("says nothing about a field the provider has no advice for", () => {
    expect(
      hint(
        withProvider(OAuthIdentityProvider.Google),
        "oauthAdditionalParameters",
      ),
    ).toBeNull();
    expect(
      hint(withProvider(OAuthIdentityProvider.Other), "oauthClientSecret"),
    ).toBeNull();
  });

  test("reads a form with no grant picked as Client Credentials", () => {
    expect(
      hint(withProvider(OAuthIdentityProvider.MicrosoftEntraId), "oauthScope"),
    ).toBe(
      hint(
        withProvider(OAuthIdentityProvider.MicrosoftEntraId, {
          oauthGrantType: OAuth2GrantType.ClientCredentials,
        }),
        "oauthScope",
      ),
    );
  });
});

describe("the hint under a field", () => {
  test("shows the picked provider's line for that field", () => {
    render(
      <OAuthProviderHint
        values={withProvider(OAuthIdentityProvider.Auth0)}
        field="oauthTokenUrl"
      />,
    );

    expect(
      screen.getByTestId("oauth-provider-hint-oauthTokenUrl"),
    ).toHaveTextContent(
      "Replace {your-domain} with your Auth0 domain, such as your-tenant.us.auth0.com.",
    );
  });

  test("draws nothing when there is nothing to say", () => {
    const { container } = render(
      <OAuthProviderHint values={{}} field="oauthTokenUrl" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("draws nothing for a provider with no line for that field", () => {
    const { container } = render(
      <OAuthProviderHint
        values={withProvider(OAuthIdentityProvider.Google)}
        field="oauthTokenUrl"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
