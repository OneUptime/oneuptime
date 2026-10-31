import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import Headers from "../../../../Types/API/Headers";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import GitHubUtil, { GitHubInstallationToken } from "./GitHub";

/*
 * A GITHUB CHECK RUN THE ONEUPTIME APP WRITES ON A PULL REQUEST'S HEAD.
 *
 * A production review of a GitHub pull request shows as a check beside its
 * comment (ProductionReviewRunner): one check run per head commit, written
 * when the review is done and edited when the same head is reviewed again.
 * Its Details open the review in OneUptime.
 *
 * It needs the App's "Checks: Read and write" permission. An installation
 * whose owner has not accepted it yet - GitHub refuses a token that asks
 * for it (422) - gets no check, and its review is the comment alone. That
 * answer is kept a while, so a busy repository does not ask for a token
 * GitHub refuses on every review.
 */

// GitHub's conclusions a review's check uses: it never fails a pull request.
export enum GitHubCheckConclusion {
  // Production has nothing to say about the change.
  Success = "success",
  // Something in production is worth a look, or the review is elsewhere.
  Neutral = "neutral",
}

export interface GitHubCheckRunContent {
  // The check's name in the pull request's checks list.
  name: string;
  headSha: string;
  conclusion: GitHubCheckConclusion;
  title: string;
  // Markdown, as GitHub draws a check's summary.
  summary: string;
  // Where its Details link goes: the review in OneUptime.
  detailsUrl: string;
  // OneUptime's own id for what the check is of: the review's task.
  externalId: string;
}

export interface GitHubCheckRunWritten {
  checkRunId: number;
  htmlUrl: string;
}

// The longest title and summary GitHub takes, held a little under.
export const CHECK_RUN_TITLE_MAX_LENGTH: number = 200;
export const CHECK_RUN_SUMMARY_MAX_LENGTH: number = 65000;

// How long an installation's refusal of Checks: write is kept.
export const CHECKS_PERMISSION_MISSING_SECONDS: number = 60 * 60;

const PERMISSION_MISSING_NAMESPACE: string = "github-checks-write-missing";

// A text held to a length, cut on a whole character, marked where cut.
export function holdTo(text: string, maxLength: number): string {
  const characters: Array<string> = Array.from(text || "");

  if (characters.length <= maxLength) {
    return text || "";
  }

  return `${characters.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

export default class GitHubCheckRuns {
  /*
   * The check run written: the one named edited in place when it is on the
   * same head - or written anew when there is none, it is gone, or it is of
   * an older head. Null when the installation does not let the App write
   * checks. Throws on anything else; the caller goes on without a check.
   */
  @CaptureSpan()
  public static async write(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    // The check run this review wrote before, on the head it was of.
    checkRunId?: number | undefined;
    checkRunHeadSha?: string | undefined;
    content: GitHubCheckRunContent;
  }): Promise<GitHubCheckRunWritten | null> {
    if (await GitHubCheckRuns.isPermissionKnownMissing(data.installationId)) {
      return null;
    }

    let token: GitHubInstallationToken;

    try {
      token = await GitHubUtil.getRepositoryAccessToken({
        installationId: data.installationId,
        organizationName: data.organizationName,
        repositoryName: data.repositoryName,
        permissions: { checks: "write", metadata: "read" },
      });
    } catch (error) {
      if (
        error instanceof HTTPErrorResponse &&
        (error.statusCode === 422 || error.statusCode === 403)
      ) {
        await GitHubCheckRuns.notePermissionMissing(data.installationId);
        logger.debug(
          `GitHub App installation ${data.installationId} does not grant Checks: write, so the production review writes no check run.`,
        );
        return null;
      }

      throw error;
    }

    const repositoryUrl: string = `https://api.github.com/repos/${encodeURIComponent(
      data.organizationName,
    )}/${encodeURIComponent(data.repositoryName)}`;
    const headers: Headers = {
      Authorization: `Bearer ${token.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const body: JSONObject = GitHubCheckRuns.buildBody(data.content);

    if (
      data.checkRunId &&
      data.checkRunHeadSha &&
      data.checkRunHeadSha === data.content.headSha
    ) {
      const edited: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.patch({
          url: URL.fromString(
            `${repositoryUrl}/check-runs/${Math.floor(data.checkRunId)}`,
          ),
          data: body,
          headers,
        });

      if (!(edited instanceof HTTPErrorResponse)) {
        return GitHubCheckRuns.readWritten(edited.data);
      }

      if (edited.statusCode !== 404) {
        throw edited;
      }

      // Gone: a check of the head is written anew.
    }

    const written: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString(`${repositoryUrl}/check-runs`),
        data: { ...body, head_sha: data.content.headSha },
        headers,
      });

    if (written instanceof HTTPErrorResponse) {
      throw written;
    }

    return GitHubCheckRuns.readWritten(written.data);
  }

  // What GitHub is sent of a check: done, with what it concluded and says.
  public static buildBody(content: GitHubCheckRunContent): JSONObject {
    return {
      name: holdTo(content.name, CHECK_RUN_TITLE_MAX_LENGTH),
      status: "completed",
      conclusion: content.conclusion,
      completed_at: OneUptimeDate.getCurrentDate().toISOString(),
      details_url: content.detailsUrl,
      external_id: content.externalId,
      output: {
        title: holdTo(content.title, CHECK_RUN_TITLE_MAX_LENGTH),
        summary: holdTo(content.summary, CHECK_RUN_SUMMARY_MAX_LENGTH),
      },
    };
  }

  // A check run as GitHub answers it.
  public static readWritten(raw: JSONObject): GitHubCheckRunWritten {
    const id: number = Number(raw["id"]);

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("GitHub did not say which check run it wrote.");
    }

    return {
      checkRunId: id,
      htmlUrl: typeof raw["html_url"] === "string" ? raw["html_url"] : "",
    };
  }

  private static async isPermissionKnownMissing(
    installationId: string,
  ): Promise<boolean> {
    try {
      return Boolean(
        await GlobalCache.getString(
          PERMISSION_MISSING_NAMESPACE,
          installationId,
        ),
      );
    } catch (error) {
      // A cache that is down asks GitHub, as if nothing were kept.
      logger.debug(error);
      return false;
    }
  }

  private static async notePermissionMissing(
    installationId: string,
  ): Promise<void> {
    try {
      await GlobalCache.setString(
        PERMISSION_MISSING_NAMESPACE,
        installationId,
        "1",
        { expiresInSeconds: CHECKS_PERMISSION_MISSING_SECONDS },
      );
    } catch (error) {
      logger.debug(error);
    }
  }
}
