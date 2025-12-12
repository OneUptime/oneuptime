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

const GITHUB_STARS_CACHE_KEY: string = "githubStars";
const GITHUB_STARS_NAMESPACE: string = "home";

export const getGitHubStarsCount: () => number | null = (): number | null => {
  if (!LocalCache.hasValue(GITHUB_STARS_NAMESPACE, GITHUB_STARS_CACHE_KEY)) {
    return null;
  }

  return LocalCache.getNumber(GITHUB_STARS_NAMESPACE, GITHUB_STARS_CACHE_KEY);
};

export const formatStarCount: (count: number | null) => string | null = (
  count: number | null,
): string | null => {
  if (count === null) {
    return null;
  }

  if (count >= 1000) {
    const thousands: number = Math.floor(count / 100) / 10;
    return `${thousands.toLocaleString("en-US", { minimumFractionDigits: thousands % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 })}k+`;
  }
  return `${count}+`;
};

const fetchGitHubStars: () => Promise<void> = async (): Promise<void> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString("https://api.github.com/repos/oneuptime/oneuptime"),
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "OneUptime-Home",
        },
      });

    if (response instanceof HTTPErrorResponse) {
      logger.error("FetchGitHubStars: Failed to fetch GitHub stars");
      logger.error(response);
      return;
    }

    const starCount: number = response.data["stargazers_count"] as number;

    if (typeof starCount === "number" && starCount > 0) {
      LocalCache.setNumber(
        GITHUB_STARS_NAMESPACE,
        GITHUB_STARS_CACHE_KEY,
        starCount,
      );
      logger.debug(`FetchGitHubStars: Updated star count to ${starCount}`);
    }
  } catch (error) {
    logger.error("FetchGitHubStars: Error fetching GitHub stars");
    logger.error(error);
  }
};

BasicCron({
  jobName: "Home:FetchGitHubStars",
  options: {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_HOUR,
    runOnStartup: true,
  },
  runFunction: async () => {
    logger.debug("FetchGitHubStars: Start");
    await fetchGitHubStars();
    logger.debug("FetchGitHubStars: End");
  },
});
