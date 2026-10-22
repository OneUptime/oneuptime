import { ExpressRequest } from "./Express";

/*
 * A redirect's target, with the query string the request arrived with -
 * taken as the raw bytes of the original URL, so a campaign's parameters
 * reach the page exactly as they were sent. The docs and the API reference
 * redirect their old addresses with it.
 */
export const withQueryOf: (req: ExpressRequest, target: string) => string = (
  req: ExpressRequest,
  target: string,
): string => {
  const originalUrl: string = req.originalUrl || "";
  const separator: number = originalUrl.indexOf("?");
  const query: string =
    separator === -1 ? "" : originalUrl.slice(separator + 1);

  if (!query) {
    return target;
  }

  return `${target}${target.includes("?") ? "&" : "?"}${query}`;
};
