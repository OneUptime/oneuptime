/*
 * What a single sign-on provider is described as when nobody describes it.
 *
 * A provider's description is shown under its name wherever people pick a
 * provider to sign in with: the Accounts "Sign in with SSO" list and a
 * private status page's sign-in page. Every provider form asked for one, as
 * a required field, although almost everyone wrote the same thing. A
 * provider created without one is now described as "Sign in with <name>"
 * (the services fill it in before the required-field check, so the column
 * stays required and the API and Terraform keep their contract), and the
 * forms fill the same text in as the name is typed, so what the form shows is
 * what is saved.
 *
 * Shared by SAML and OpenID Connect providers, for projects, status pages and
 * the whole instance. React-free and server-safe: the API, the Dashboard, the
 * Admin Dashboard and their tests all read it.
 */

const DESCRIPTION_PREFIX: string = "Sign in with";

type IsBlankFunction = (value: unknown) => boolean;

/*
 * Nothing written: undefined, null, or text that is only spaces. Anything
 * else (a URL object, say) is read through its text.
 */
export const isBlankSsoValue: IsBlankFunction = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  return String(value).trim().length === 0;
};

/**
 * The description a provider gets from its name: "Sign in with Okta". Empty
 * while the name is.
 */
export const getDefaultSsoProviderDescription: (
  name: string | null | undefined,
) => string = (name: string | null | undefined): string => {
  const trimmed: string = typeof name === "string" ? name.trim() : "";

  if (!trimmed) {
    return "";
  }

  return `${DESCRIPTION_PREFIX} ${trimmed}`;
};

/**
 * Whether a description is the one the name gives (or none at all): it then
 * follows the name when the name changes, on a create form and an edit form
 * alike. A description somebody wrote is theirs and stays.
 */
export const isDefaultSsoProviderDescription: (data: {
  description: string | null | undefined;
  name: string | null | undefined;
}) => boolean = (data: {
  description: string | null | undefined;
  name: string | null | undefined;
}): boolean => {
  if (isBlankSsoValue(data.description)) {
    return true;
  }

  return (
    String(data.description).trim() ===
    getDefaultSsoProviderDescription(data.name)
  );
};

/*
 * A provider about to be created: the columns every provider has that this
 * file fills in. The models (ProjectSSO, ProjectOIDC, StatusPageOIDC,
 * GlobalOIDC...) all fit it.
 */
export interface SsoProviderDescriptionFields {
  name?: string | undefined;
  description?: string | undefined;
}

/**
 * Gives a provider about to be created the description its name gives, when
 * it was created without one. Changes nothing else, and nothing when the
 * provider has no name either (the required-field check then says the name
 * is missing).
 */
export const fillSsoProviderDescription: (
  provider: SsoProviderDescriptionFields,
) => void = (provider: SsoProviderDescriptionFields): void => {
  if (!isBlankSsoValue(provider.description)) {
    return;
  }

  const description: string = getDefaultSsoProviderDescription(provider.name);

  if (description) {
    provider.description = description;
  }
};
