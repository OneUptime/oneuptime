/*
 * ---------------------------------------------------------------------------
 * The places of a code repository's settings on its Settings page
 * (Types/CodeRepository/CodeRepositorySetting), and the server's links to
 * them.
 *
 * The GitHub App answers a command in a repository whose commands are off
 * with a link straight to the switch: the repository's Settings page in the
 * Dashboard at "#github-commands", where More settings opens by itself on
 * the GitHub Commands card. That link is built on the server, so it is held
 * here to the Dashboard's own route and to the place the page gives the
 * card - a route or a place renamed on one side only would leave the link
 * pointing at nothing.
 * ---------------------------------------------------------------------------
 */

import {
  CodeRepositorySetting,
  getCodeRepositorySettingsPath,
} from "../../../Types/CodeRepository/CodeRepositorySetting";
import GitHubRunReply from "../../../Server/Utils/CodeRepository/GitHub/GitHubRunReply";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import { CodeRepositorySetting as DashboardCodeRepositorySetting } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositorySettingsCopy";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { isPageAnchorName } from "../../../UI/Utils/PageAnchor";
import { DashboardRoute } from "../../../ServiceRoute";
import { describe, expect, test } from "@jest/globals";

const PROJECT_ID: string = "0b6f2a1e-4a3c-4f7e-9d1b-2c3d4e5f6a7b";
const REPOSITORY_ID: string = "7c1d2e3f-0000-4000-8000-000000000001";

/*
 * Whether a path is one the route pattern draws: the same segments, with
 * a ":param" segment matching any one segment.
 */
function routeDraws(pattern: string, path: string): boolean {
  const patternSegments: Array<string> = pattern.split("/");
  const pathSegments: Array<string> = path.split("/");

  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every((segment: string, index: number): boolean => {
    const pathSegment: string = pathSegments[index] || "";

    return segment.startsWith(":")
      ? pathSegment.length > 0
      : segment === pathSegment;
  });
}

describe("the places of a repository's settings", () => {
  test("each is a plain name a link can name after the page's #", () => {
    for (const setting of Object.values(CodeRepositorySetting)) {
      expect(isPageAnchorName(setting)).toBe(true);
    }
  });

  test("the places, by name", () => {
    expect(Object.values(CodeRepositorySetting)).toEqual([
      "github-commands",
      "production-review",
      "runner",
      "pull-requests",
      "trigger-label",
      "production-review-comment",
      "production-review-llm-provider",
      "commands",
      "branches",
    ]);
  });

  /*
   * One list: the Dashboard's page and links read the same enum the server
   * links with, never a copy that can drift.
   */
  test("the Dashboard's page names its settings with this one list", () => {
    expect(DashboardCodeRepositorySetting).toBe(CodeRepositorySetting);
  });
});

describe("a repository's Settings page, as the server links it", () => {
  test("its path, and its path at a setting", () => {
    expect(
      getCodeRepositorySettingsPath({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
      }),
    ).toBe(`/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`);

    expect(
      getCodeRepositorySettingsPath({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        setting: CodeRepositorySetting.GitHubCommands,
      }),
    ).toBe(
      `/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#github-commands`,
    );
  });

  test("an id is written as one segment of the path, whatever it holds", () => {
    expect(
      getCodeRepositorySettingsPath({
        projectId: "a/b",
        codeRepositoryId: "c#d",
      }),
    ).toBe("/a%2Fb/code/repositories/c%23d/settings");
  });

  /*
   * The Dashboard draws the page at RouteMap's
   * CODE_REPOSITORY_VIEW_SETTINGS, under /dashboard - the path
   * DashboardClientUrl ends in.
   */
  test("is the route the Dashboard draws the page at", () => {
    const pattern: string = (
      RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route
    ).toString();

    const path: string = getCodeRepositorySettingsPath({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
    });

    expect(pattern).toBe(
      "/dashboard/:projectId/code/repositories/:id/settings",
    );
    expect(routeDraws(pattern, `/dashboard${path}`)).toBe(true);
    // And no other page of the repository.
    expect(
      routeDraws(
        (RouteMap[PageMap.CODE_REPOSITORY_VIEW] as Route).toString(),
        `/dashboard${path}`,
      ),
    ).toBe(false);
  });

  test("GitHubRunReply links it under the Dashboard's own address", () => {
    const url: string = GitHubRunReply.buildRepositorySettingsUrl({
      projectId: new ObjectID(PROJECT_ID),
      codeRepositoryId: new ObjectID(REPOSITORY_ID),
      setting: CodeRepositorySetting.GitHubCommands,
    });

    expect(url).toBe(
      `${DashboardClientUrl.toString()}/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#github-commands`,
    );

    const parsed: URL = new URL(url);

    expect(parsed.origin).toBe(new URL(DashboardClientUrl.toString()).origin);
    expect(parsed.hash).toBe("#github-commands");

    // What follows the Dashboard's own address, under the Dashboard's route.
    const afterDashboard: string = url
      .substring(DashboardClientUrl.toString().length)
      .split("#")[0]!;

    expect(DashboardRoute.toString()).toBe("/dashboard");
    expect(
      routeDraws(
        (RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route).toString(),
        `${DashboardRoute.toString()}${afterDashboard}`,
      ),
    ).toBe(true);
  });

  test("with no setting it opens the page at its top", () => {
    const url: string = GitHubRunReply.buildRepositorySettingsUrl({
      projectId: new ObjectID(PROJECT_ID),
      codeRepositoryId: new ObjectID(REPOSITORY_ID),
    });

    expect(new URL(url).hash).toBe("");
    expect(url.endsWith("/settings")).toBe(true);
  });
});
