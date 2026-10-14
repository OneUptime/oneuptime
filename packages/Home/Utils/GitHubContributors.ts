import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";

/*
 * The contributors the about page shows, read from GitHub a page at a time.
 *
 * The /about route used to walk the pages itself and stop only when a page
 * held fewer than 30 entries. An answer that is not a list has no length -
 * GitHub's error object when the API rate limits this server is exactly
 * that - and `undefined < 30` is false, so the route asked GitHub for the
 * next page forever: the visitor's request never answered, and the server
 * kept calling an API that had already refused it. The walk had no ceiling,
 * and a request that failed outright (a timeout, a DNS failure) threw out of
 * the route and left the visitor waiting with no answer at all.
 *
 * Now the walk ends at the first answer that is not a page of contributors,
 * at the first request that fails, and after MAX_CONTRIBUTOR_PAGES pages
 * whatever happens. It never throws: the page renders with whatever arrived,
 * or with none, which Views/about.ejs already shows as a link to GitHub's
 * own list.
 */

export const GITHUB_CONTRIBUTORS_URL: string =
  "https://api.github.com/repos/oneuptime/oneuptime/contributors";

/*
 * GitHub's largest page. Unauthenticated, this server has 60 requests an hour
 * for everything it asks GitHub, so the fewer pages the list takes the better.
 */
export const CONTRIBUTORS_PER_PAGE: number = 100;

/*
 * GitHub ties at most the first 500 author addresses of a repository to
 * accounts, so ten pages of a hundred is more than this list can hold.
 */
export const MAX_CONTRIBUTOR_PAGES: number = 10;

// Long enough for a slow answer, short enough for a visitor to still be there.
export const CONTRIBUTORS_PAGE_TIMEOUT_IN_MS: number = 10 * 1000;

type IsContributorFunction = (entry: unknown) => entry is JSONObject;

const isContributor: IsContributorFunction = (
  entry: unknown,
): entry is JSONObject => {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry);
};

export type FetchGitHubContributorsFunction = () => Promise<Array<JSONObject>>;

export const fetchGitHubContributors: FetchGitHubContributorsFunction =
  async (): Promise<Array<JSONObject>> => {
    let contributors: Array<JSONObject> = [];

    for (let page: number = 1; page <= MAX_CONTRIBUTOR_PAGES; page++) {
      let response: HTTPResponse<Array<JSONObject>> | HTTPErrorResponse;

      try {
        response = await API.get<Array<JSONObject>>({
          url: URL.fromString(
            `${GITHUB_CONTRIBUTORS_URL}?per_page=${CONTRIBUTORS_PER_PAGE}&page=${page}`,
          ),
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "OneUptime-Home",
          },
          options: {
            timeout: CONTRIBUTORS_PAGE_TIMEOUT_IN_MS,
          },
        });
      } catch (err) {
        logger.warn(
          `About page: could not read page ${page} of GitHub's contributors, showing the ${contributors.length} already read.`,
          { service: "home" },
        );
        logger.debug(err);
        return contributors;
      }

      const entries: unknown = response.data;

      if (response instanceof HTTPErrorResponse || !Array.isArray(entries)) {
        logger.warn(
          `About page: GitHub answered page ${page} of its contributors with status ${response.statusCode} and no list, showing the ${contributors.length} already read.`,
          { service: "home" },
        );
        return contributors;
      }

      contributors = contributors.concat(entries.filter(isContributor));

      // A page short of full is the last one.
      if (entries.length < CONTRIBUTORS_PER_PAGE) {
        return contributors;
      }
    }

    logger.warn(
      `About page: stopped reading GitHub's contributors after ${MAX_CONTRIBUTOR_PAGES} full pages.`,
      { service: "home" },
    );

    return contributors;
  };
