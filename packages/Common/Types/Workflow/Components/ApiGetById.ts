/*
 * API GET BY ID: one item, read from an API by an ID that came from
 * somewhere else.
 *
 * A template that a webhook starts - a Jira comment, a Dynamics 365 case -
 * reads the item the event names back from the other tool before it acts,
 * so a request to the workflow's URL can only make it look at a real item.
 * The ID it reads by is text from outside, and put into an address as it is
 * it could turn the request into another one: "x/../../users" climbs out of
 * the path, "x?$expand=" adds to the query, and the request carries the
 * workflow's token. So the templates read it in a script first, check it is
 * an ID, and only then make the request: two steps, and an If / Else between
 * them.
 *
 * This step does both. Its URL has {id} where the ID goes, and the ID is put
 * there only when it is a plain ID - letters, digits, dashes and
 * underscores, which is what a Jira issue key, a GUID, a Zabbix event ID or
 * a number is - and then percent-encoded all the same. Anything else stops
 * the step before any request is sent, by its Error output.
 */

/** Where the ID goes in the URL. */
export const API_GET_BY_ID_PLACEHOLDER: string = "{id}";

/** The longest ID the step puts into an address. */
export const MAX_API_GET_BY_ID_LENGTH: number = 200;

/*
 * A plain ID: one character class repeated, anchored at both ends, so it
 * reads any text in time in line with its length.
 */
const PLAIN_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]+$/;

export type ApiGetByIdUrl =
  | { url: string; error?: undefined }
  | { url?: undefined; error: string };

export type BuildApiGetByIdUrlFunction = (data: {
  url: unknown;
  id: unknown;
}) => ApiGetByIdUrl;

/*
 * The address to read, with the ID in place of every {id} - or why there is
 * none to read.
 */
export const buildApiGetByIdUrl: BuildApiGetByIdUrlFunction = (data: {
  url: unknown;
  id: unknown;
}): ApiGetByIdUrl => {
  const url: string = typeof data.url === "string" ? data.url.trim() : "";

  if (!url) {
    return { error: "URL is empty, so nothing was read." };
  }

  if (url.indexOf(API_GET_BY_ID_PLACEHOLDER) === -1) {
    return {
      error: `URL has no ${API_GET_BY_ID_PLACEHOLDER} for the ID to go in, so nothing was read. Put ${API_GET_BY_ID_PLACEHOLDER} where the ID belongs, such as https://example.com/items/${API_GET_BY_ID_PLACEHOLDER}.`,
    };
  }

  const id: string =
    typeof data.id === "string"
      ? data.id.trim()
      : typeof data.id === "number" && Number.isFinite(data.id)
        ? String(data.id)
        : "";

  if (!id) {
    return { error: "ID is empty, so nothing was read." };
  }

  if (id.length > MAX_API_GET_BY_ID_LENGTH) {
    return {
      error: `ID is longer than ${MAX_API_GET_BY_ID_LENGTH} characters, so it is not an ID and nothing was read.`,
    };
  }

  if (!PLAIN_ID_PATTERN.test(id)) {
    return {
      error:
        "ID is not a plain ID - only letters, digits, dashes and underscores - so nothing was read.",
    };
  }

  return {
    url: url.split(API_GET_BY_ID_PLACEHOLDER).join(encodeURIComponent(id)),
  };
};
