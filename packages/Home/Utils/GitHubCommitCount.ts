import URL from "Common/Types/API/URL";
import { linkHeaderUrls } from "Common/Utils/LinkHeader";

/*
 * How many commits a branch has, counted the way GitHub's API allows: ask
 * for its commits one per page, and the Link header of the answer names the
 * last page (rel="last"), whose number is the count.
 *
 *   <https://api.github.com/repositories/1/commits?sha=master&per_page=1&page=2>; rel="next",
 *   <https://api.github.com/repositories/1/commits?sha=master&per_page=1&page=22486>; rel="last"
 *
 * The header is read with the shared Link header reader, which takes each
 * address whole and finds the link by its relation, not by its position.
 * Null when there is no header (a rate-limited or failed answer has none), no
 * rel="last" link, or no page number in it - never a throw.
 */
export const commitCountFromLinkHeader: (
  link: string | undefined | null,
) => number | null = (link: string | undefined | null): number | null => {
  const last: string | undefined = linkHeaderUrls(link)["last"];

  if (!last) {
    return null;
  }

  let page: string | null = null;

  try {
    page = URL.fromString(last).getQueryParam("page");
  } catch {
    return null;
  }

  const count: number = Number.parseInt(page || "", 10);

  return Number.isFinite(count) && count > 0 ? count : null;
};
