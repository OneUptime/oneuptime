import { EVERY_HOUR, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";

const GITHUB_STATS_NAMESPACE: string = "home";
const GITHUB_CONTRIBUTORS_CACHE_KEY: string = "githubContributors";
const GITHUB_COMMITS_CACHE_KEY: string = "githubCommits";

// Default fallback values (used if API fails)
const DEFAULT_CONTRIBUTORS: number = 80;
const DEFAULT_COMMITS: number = 29000;

export const getGitHubContributorsCount: () => number =
  (): number => {
    if (
      !LocalCache.hasValue(GITHUB_STATS_NAMESPACE, GITHUB_CONTRIBUTORS_CACHE_KEY)
    ) {
      return DEFAULT_CONTRIBUTORS;
    }

    return LocalCache.getNumber(
      GITHUB_STATS_NAMESPACE,
      GITHUB_CONTRIBUTORS_CACHE_KEY,
    ) || DEFAULT_CONTRIBUTORS;
  };

export const getGitHubCommitsCount: () => number = (): number => {
  if (!LocalCache.hasValue(GITHUB_STATS_NAMESPACE, GITHUB_COMMITS_CACHE_KEY)) {
    return DEFAULT_COMMITS;
  }

  return LocalCache.getNumber(GITHUB_STATS_NAMESPACE, GITHUB_COMMITS_CACHE_KEY) || DEFAULT_COMMITS;
};

export const formatCount: (count: number) => string = (
  count: number,
): string => {
  if (count >= 1000) {
    const thousands: number = Math.ceil(count / 1000);
    return `${thousands}k+`;
  }
  return `${count}+`;
};

const fetchGitHubStats: () => Promise<void> = async (): Promise<void> => {
  try {
    // Fetch contributors count
    let contributorsCount: number = 0;
    let hasMoreContributors: boolean = true;
    let pageNumber: number = 1;

    while (hasMoreContributors) {
      const response: HTTPResponse<Array<JSONObject>> | HTTPErrorResponse =
        await API.get<Array<JSONObject>>({
          url: URL.fromString(
            `https://api.github.com/repos/oneuptime/oneuptime/contributors?per_page=100&page=${pageNumber}`,
          ),
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "OneUptime-Home",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("FetchGitHubStats: Failed to fetch contributors");
        break;
      }

      const contributors: Array<JSONObject> =
        response.data as Array<JSONObject>;
      contributorsCount += contributors.length;

      if (contributors.length < 100) {
        hasMoreContributors = false;
      }
      pageNumber++;

      // Safety limit to prevent infinite loops
      if (pageNumber > 50) {
        hasMoreContributors = false;
      }
    }

    if (contributorsCount > 0) {
      LocalCache.setNumber(
        GITHUB_STATS_NAMESPACE,
        GITHUB_CONTRIBUTORS_CACHE_KEY,
        contributorsCount,
      );
      logger.debug(
        `FetchGitHubStats: Updated contributors count to ${contributorsCount}`,
      );
    }

    // Fetch commits count using pagination header
    const commitsResponse: HTTPResponse<Array<JSONObject>> | HTTPErrorResponse =
      await API.get<Array<JSONObject>>({
        url: URL.fromString(
          "https://api.github.com/repos/oneuptime/oneuptime/commits?sha=master&per_page=1&page=1",
        ),
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "OneUptime-Home",
        },
      });

    if (!(commitsResponse instanceof HTTPErrorResponse)) {
      // Parse the Link header to get total commits count
      // Format: '<https://api.github.com/repositories/xxx/commits?sha=master&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/xxx/commits?sha=master&per_page=1&page=22486>; rel="last"'
      const link: string | undefined = commitsResponse.headers["link"];
      if (link) {
        const lastLink: string | undefined = link
          .split(",")
          .find((s: string) => {
            return s.includes('rel="last"');
          });
        if (lastLink) {
          const urlMatch: RegExpMatchArray | null = lastLink.match(/<([^>]+)>/);
          if (urlMatch && urlMatch[1]) {
            const url: URL = URL.fromString(urlMatch[1]);
            const commitsCount: number = Number.parseInt(
              url.getQueryParam("page") as string,
              10,
            );

            if (commitsCount > 0) {
              LocalCache.setNumber(
                GITHUB_STATS_NAMESPACE,
                GITHUB_COMMITS_CACHE_KEY,
                commitsCount,
              );
              logger.debug(
                `FetchGitHubStats: Updated commits count to ${commitsCount}`,
              );
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error("FetchGitHubStats: Error fetching GitHub stats");
    logger.error(error);
  }
};

BasicCron({
  jobName: "Home:FetchGitHubStats",
  options: {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_HOUR,
    runOnStartup: true,
  },
  runFunction: async () => {
    logger.debug("FetchGitHubStats: Start");
    await fetchGitHubStats();
    logger.debug("FetchGitHubStats: End");
  },
});
