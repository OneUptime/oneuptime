import DatabaseConfig from "../../../Server/DatabaseConfig";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import {
  getSloAffectedResourceMarkdownLines,
  getSloDashboardUrl,
} from "../../../Utils/Slo/SloAffectedResourceMarkdown";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * IncidentService and AlertService cannot import ServiceLevelObjectiveService
 * (it reaches them through ServiceLevelObjectiveBurnRateRuleService), so the
 * SLO links in their "created" feed items are built by a dependency-free
 * helper instead. This pins that helper to the service's canonical link and
 * wording, so the incident feed, the alert feed and the SLO's own feed can
 * never drift apart - a moved SLO route has to move all of them.
 *
 * Kept apart from the feed tests on purpose: this is the one suite that loads
 * ServiceLevelObjectiveService.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const SLO_ID: ObjectID = new ObjectID("0193c0de-cccc-4aaa-8bbb-0000000000c1");

beforeEach(() => {
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation(async (): Promise<URL> => {
      return URL.fromString(DASHBOARD);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("inline SLO links match ServiceLevelObjectiveService", () => {
  test("the URL is the service's SLO dashboard link", async () => {
    const canonical: URL =
      await ServiceLevelObjectiveService.getSloLinkInDashboard(
        PROJECT_ID,
        SLO_ID,
      );

    expect(
      getSloDashboardUrl({
        dashboardUrl: URL.fromString(DASHBOARD),
        projectId: PROJECT_ID,
        sloId: SLO_ID,
      }).toString(),
    ).toBe(canonical.toString());
  });

  test.each([
    ["a plain name", "Checkout availability"],
    [
      "a hostile name",
      "Checkout](https://evil.example) ![x](https://t.example) *b*",
    ],
  ])(
    "the bullet for %s is the service's markdown link",
    async (_label: string, sloName: string) => {
      const canonical: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: PROJECT_ID,
          sloId: SLO_ID,
          sloName: sloName,
        });

      expect(
        getSloAffectedResourceMarkdownLines({
          dashboardUrl: URL.fromString(DASHBOARD),
          projectId: PROJECT_ID,
          serviceLevelObjectives: [{ _id: SLO_ID.toString(), name: sloName }],
        }),
      ).toEqual([`- ${canonical}`]);
    },
  );
});
