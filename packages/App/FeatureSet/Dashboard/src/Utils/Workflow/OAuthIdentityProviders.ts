/*
 * The identity providers the Create OAuth 2.0 Variable form knows by name.
 *
 * The form used to explain every provider's token endpoint in one paragraph
 * under the Token URL field - four URL templates in a row, to be copied out
 * by hand. Now the person picks their provider and the form fills in its
 * token URL, sets the grant its applications need (Google's OAuth clients
 * cannot use Client Credentials) and shows one line of help, written for that
 * provider, under the fields people most often get wrong for it: which part of
 * the URL is theirs, where the client ID lives, which secret to paste, and the
 * scope or parameter the provider insists on.
 *
 * The provider is never saved. It only fills in the form; once a variable
 * exists, its token URL says which provider it uses, and its own page edits
 * that URL directly.
 *
 * Everything here is pure so it can be tested without rendering the form.
 */

import { OAuth2GrantType } from "Common/Types/Workflow/WorkflowVariableOAuth";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

export enum OAuthIdentityProvider {
  MicrosoftEntraId = "Microsoft Entra ID",
  Google = "Google",
  Okta = "Okta",
  Auth0 = "Auth0",
  Other = "Other",
}

/*
 * The form key the provider is held under. It is not a column: the create
 * form registers it through overrideFieldKey and removes it from the request
 * before the variable is saved.
 */
export const OAUTH_IDENTITY_PROVIDER_FIELD_KEY: string =
  "oauthIdentityProvider";

// The fields a provider can add a line of help to.
export type OAuthProviderHintField =
  | "oauthTokenUrl"
  | "oauthGrantType"
  | "oauthClientId"
  | "oauthClientSecret"
  | "oauthScope"
  | "oauthAdditionalParameters";

export interface OAuthProviderHint {
  field: OAuthProviderHintField;
  text: string;
  // Shown only while this grant is picked; for either grant when left out.
  onlyForGrantType?: OAuth2GrantType | undefined;
}

export interface OAuthIdentityProviderPreset {
  provider: OAuthIdentityProvider;
  label: string;
  /*
   * The provider's token endpoint. A part in braces - {tenant-id} - is the
   * person's own and has to be replaced; the Token URL field refuses a URL
   * that still has one. Empty for Other, whose URL the person types in.
   */
  tokenUrl: string;
  // The grant the provider's applications need, when only one works.
  grantType?: OAuth2GrantType | undefined;
  hints: Array<OAuthProviderHint>;
}

export const OAUTH_IDENTITY_PROVIDER_PRESETS: Array<OAuthIdentityProviderPreset> =
  [
    {
      provider: OAuthIdentityProvider.MicrosoftEntraId,
      label: "Microsoft Entra ID",
      tokenUrl:
        "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
      hints: [
        {
          field: "oauthTokenUrl",
          text: "Replace {tenant-id} with your Directory (tenant) ID, shown on your app registration's Overview page.",
        },
        {
          field: "oauthClientId",
          text: "Use the Application (client) ID from your app registration's Overview page.",
        },
        {
          field: "oauthClientSecret",
          text: "Paste the secret's Value from Certificates & secrets - not its Secret ID.",
        },
        {
          field: "oauthScope",
          onlyForGrantType: OAuth2GrantType.ClientCredentials,
          text: "Microsoft Entra ID needs a scope ending in /.default for Client Credentials, such as https://graph.microsoft.com/.default for Microsoft Graph.",
        },
      ],
    },
    {
      provider: OAuthIdentityProvider.Google,
      label: "Google",
      tokenUrl: "https://oauth2.googleapis.com/token",
      grantType: OAuth2GrantType.RefreshToken,
      hints: [
        {
          field: "oauthGrantType",
          text: "Google's OAuth clients cannot use Client Credentials, so use Refresh Token, with a refresh token from Google's OAuth 2.0 Playground or your own sign-in.",
        },
        {
          field: "oauthClientId",
          text: "Use the OAuth client's ID and secret from Google Cloud console > APIs & Services > Credentials.",
        },
      ],
    },
    {
      provider: OAuthIdentityProvider.Okta,
      label: "Okta",
      tokenUrl: "https://{your-domain}/oauth2/default/v1/token",
      hints: [
        {
          field: "oauthTokenUrl",
          text: "Replace {your-domain} with your Okta domain, such as dev-123456.okta.com. If you use an authorization server of your own, replace default with its ID.",
        },
        {
          field: "oauthClientId",
          text: "Use the Client ID and client secret from your app integration's General tab.",
        },
        {
          field: "oauthScope",
          onlyForGrantType: OAuth2GrantType.ClientCredentials,
          text: "Okta needs at least one custom scope for Client Credentials. Add one to your authorization server and enter it here.",
        },
      ],
    },
    {
      provider: OAuthIdentityProvider.Auth0,
      label: "Auth0",
      tokenUrl: "https://{your-domain}/oauth/token",
      hints: [
        {
          field: "oauthTokenUrl",
          text: "Replace {your-domain} with your Auth0 domain, such as your-tenant.us.auth0.com.",
        },
        {
          field: "oauthClientId",
          text: "Use the Client ID and Client Secret from your application's Settings tab.",
        },
        {
          field: "oauthAdditionalParameters",
          onlyForGrantType: OAuth2GrantType.ClientCredentials,
          text: "Auth0 needs an audience for Client Credentials: add a parameter named audience whose value is your API's identifier.",
        },
      ],
    },
    {
      provider: OAuthIdentityProvider.Other,
      label: "Other provider",
      tokenUrl: "",
      hints: [
        {
          field: "oauthTokenUrl",
          text: "Your provider's documentation lists its token endpoint, often ending in /token or /oauth2/token.",
        },
      ],
    },
  ];

export const OAUTH_IDENTITY_PROVIDER_DROPDOWN_OPTIONS: Array<DropdownOption> =
  OAUTH_IDENTITY_PROVIDER_PRESETS.map(
    (preset: OAuthIdentityProviderPreset): DropdownOption => {
      return {
        value: preset.provider,
        label: preset.label,
      };
    },
  );

// The grant a form holds before anybody picks one.
export const DEFAULT_OAUTH_GRANT_TYPE: OAuth2GrantType =
  OAuth2GrantType.ClientCredentials;

export function getOAuthIdentityProviderPreset(
  provider: unknown,
): OAuthIdentityProviderPreset | undefined {
  return OAUTH_IDENTITY_PROVIDER_PRESETS.find(
    (preset: OAuthIdentityProviderPreset): boolean => {
      return preset.provider === provider;
    },
  );
}

/*
 * Whether a token URL is one of the presets' templates, exactly as a preset
 * filled it in. Such a URL is the form's, not the person's, so picking
 * another provider may replace it; anything else was typed or edited by the
 * person and is kept.
 */
export function isOAuthPresetTokenUrl(tokenUrl: unknown): boolean {
  if (typeof tokenUrl !== "string" || !tokenUrl) {
    return false;
  }

  return OAUTH_IDENTITY_PROVIDER_PRESETS.some(
    (preset: OAuthIdentityProviderPreset): boolean => {
      return Boolean(preset.tokenUrl) && preset.tokenUrl === tokenUrl;
    },
  );
}

const TOKEN_URL_PLACEHOLDER: RegExp = /\{[^{}]*\}/;

/*
 * Why a token URL cannot be saved yet, or null when it can. A preset's URL
 * keeps the part that is the person's own in braces; saved like that, every
 * token request would go to a host named "{your-domain}".
 */
export function getOAuthTokenUrlPlaceholderError(
  tokenUrl: unknown,
): string | null {
  if (typeof tokenUrl !== "string") {
    return null;
  }

  const placeholder: RegExpMatchArray | null = tokenUrl.match(
    TOKEN_URL_PLACEHOLDER,
  );

  if (!placeholder) {
    return null;
  }

  return `Replace ${placeholder[0]} in the token URL with your own value.`;
}

/*
 * The form's values once a provider is picked:
 *  - the token URL becomes the provider's, unless the person has typed one of
 *    their own (an empty URL, or another preset's untouched template, is
 *    replaced). Other never touches it.
 *  - the grant becomes the one the provider needs, and goes back to Client
 *    Credentials when the previous provider had set it and nobody changed it
 *    since.
 * Picking the provider already picked changes nothing.
 */
export function applyOAuthIdentityProviderPreset(data: {
  values: Record<string, unknown>;
  provider: unknown;
}): Record<string, unknown> {
  const previousProvider: unknown =
    data.values[OAUTH_IDENTITY_PROVIDER_FIELD_KEY];

  if (previousProvider === data.provider) {
    return data.values;
  }

  const preset: OAuthIdentityProviderPreset | undefined =
    getOAuthIdentityProviderPreset(data.provider);

  if (!preset) {
    return data.values;
  }

  const previousPreset: OAuthIdentityProviderPreset | undefined =
    getOAuthIdentityProviderPreset(previousProvider);

  const next: Record<string, unknown> = { ...data.values };

  const currentTokenUrl: unknown = data.values["oauthTokenUrl"];

  if (
    preset.tokenUrl &&
    (!currentTokenUrl || isOAuthPresetTokenUrl(currentTokenUrl))
  ) {
    next["oauthTokenUrl"] = preset.tokenUrl;
  }

  if (preset.grantType) {
    next["oauthGrantType"] = preset.grantType;
  } else if (
    previousPreset?.grantType &&
    data.values["oauthGrantType"] === previousPreset.grantType
  ) {
    next["oauthGrantType"] = DEFAULT_OAUTH_GRANT_TYPE;
  }

  return next;
}

/*
 * The line of help the picked provider adds under a field, or null. A hint
 * tied to a grant shows only while that grant is picked, and a form that has
 * not picked one yet holds the default.
 */
export function getOAuthProviderHint(data: {
  values: Record<string, unknown>;
  field: OAuthProviderHintField;
}): string | null {
  const preset: OAuthIdentityProviderPreset | undefined =
    getOAuthIdentityProviderPreset(
      data.values[OAUTH_IDENTITY_PROVIDER_FIELD_KEY],
    );

  if (!preset) {
    return null;
  }

  const grantType: unknown =
    data.values["oauthGrantType"] || DEFAULT_OAUTH_GRANT_TYPE;

  const hint: OAuthProviderHint | undefined = preset.hints.find(
    (candidate: OAuthProviderHint): boolean => {
      return (
        candidate.field === data.field &&
        (!candidate.onlyForGrantType ||
          candidate.onlyForGrantType === grantType)
      );
    },
  );

  return hint ? hint.text : null;
}
