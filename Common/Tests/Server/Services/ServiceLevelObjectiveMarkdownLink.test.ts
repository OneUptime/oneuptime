/*
 * `jest` is the global (as in ServiceLevelObjectiveService.test.ts), not the
 * @jest/globals export: that export's SpiedFunction type does not accept what
 * jest.spyOn returns with this repo's jest-mock version.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of the service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";

/*
 * Contract under test: ServiceLevelObjectiveService.getSloMarkdownLink, the
 * `[SLO <name>](<link>)` every SLO feed item and notification is built from.
 *
 * SLO names are user-controlled and feeds render without safe mode, so the
 * load-bearing property is that no name - however hostile - can change where
 * the link points, add a second link or image, or break the sentence onto a
 * new line. The rest pins the convenience behaviour: callers that already
 * have the name skip the lookup, and a missing SLO still gets a usable link.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";

const SLO_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`;

/*
 * Strips every backslash escape, then counts the link constructs left - what a
 * markdown renderer would actually turn into links.
 */
type CountLinkOpeningsFunction = (markdown: string) => number;

const countUnescapedLinkBoundaries: CountLinkOpeningsFunction = (
  markdown: string,
): number => {
  const withoutEscapes: string = markdown.replace(/\\[!-/:-@[-`{-~]/g, "");

  return (withoutEscapes.match(/\]\(/g) || []).length;
};

describe("ServiceLevelObjectiveService.getSloMarkdownLink", () => {
  let findOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));

    findOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders [SLO <name>](<dashboard link>) from a name the caller already has", async () => {
    const markdown: string =
      await ServiceLevelObjectiveService.getSloMarkdownLink({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        sloName: "Checkout API",
      });

    expect(markdown).toBe(`[SLO Checkout API](${SLO_LINK})`);
  });

  test("does not query the database when the caller passes the name", async () => {
    await ServiceLevelObjectiveService.getSloMarkdownLink({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      sloName: "Checkout API",
    });

    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  test("links to the same URL as getSloLinkInDashboard", async () => {
    const link: URL = await ServiceLevelObjectiveService.getSloLinkInDashboard(
      PROJECT_ID,
      SLO_ID,
    );

    const markdown: string =
      await ServiceLevelObjectiveService.getSloMarkdownLink({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        sloName: "Checkout API",
      });

    expect(markdown.endsWith(`](${link.toString()})`)).toBe(true);
  });

  describe("user-controlled names", () => {
    test("a name cannot close the link early and re-point it", async () => {
      const markdown: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: PROJECT_ID,
          sloId: SLO_ID,
          sloName: "x](https://evil.example) [click",
        });

      expect(markdown).toBe(
        `[SLO x\\]\\(https://evil.example\\) \\[click](${SLO_LINK})`,
      );
      expect(countUnescapedLinkBoundaries(markdown)).toBe(1);
    });

    test.each([
      "![pixel](https://tracker.example/p.png)",
      "[a](b) [c](d)",
      "<img src=x onerror=alert(1)>",
      "**bold** _it_ `code` | pipe",
      "trailing backslash \\",
    ])(
      "the only link in the output is the SLO link, for %j",
      async (sloName: string) => {
        const markdown: string =
          await ServiceLevelObjectiveService.getSloMarkdownLink({
            projectId: PROJECT_ID,
            sloId: SLO_ID,
            sloName,
          });

        expect(markdown.startsWith("[SLO ")).toBe(true);
        expect(markdown.endsWith(`](${SLO_LINK})`)).toBe(true);
        expect(countUnescapedLinkBoundaries(markdown)).toBe(1);
      },
    );

    test("a multi-line name stays on one line", async () => {
      const markdown: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: PROJECT_ID,
          sloId: SLO_ID,
          sloName: "Checkout\n# injected heading",
        });

      expect(markdown).not.toMatch(/[\r\n]/);
      expect(markdown).toBe(`[SLO Checkout \\# injected heading](${SLO_LINK})`);
    });
  });

  describe("when the caller has only the id", () => {
    test("looks the name up as root, selecting only the name", async () => {
      findOneByIdSpy.mockResolvedValue({
        name: "Looked Up",
      } as unknown as ServiceLevelObjective);

      const markdown: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: PROJECT_ID,
          sloId: SLO_ID,
        });

      expect(markdown).toBe(`[SLO Looked Up](${SLO_LINK})`);
      expect(findOneByIdSpy).toHaveBeenCalledTimes(1);
      expect(findOneByIdSpy).toHaveBeenCalledWith({
        id: SLO_ID,
        select: { name: true },
        props: { isRoot: true },
      });
    });

    test("escapes a looked-up name exactly like a passed one", async () => {
      findOneByIdSpy.mockResolvedValue({
        name: "a](b)",
      } as unknown as ServiceLevelObjective);

      const markdown: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: PROJECT_ID,
          sloId: SLO_ID,
        });

      expect(markdown).toBe(`[SLO a\\]\\(b\\)](${SLO_LINK})`);
    });

    test("still returns a working link when the SLO cannot be found", async () => {
      findOneByIdSpy.mockResolvedValue(null);

      const markdown: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: PROJECT_ID,
          sloId: SLO_ID,
        });

      expect(markdown).toBe(`[SLO](${SLO_LINK})`);
    });
  });

  test.each(["", "   ", "\n"])(
    "a blank name %j renders as a plain SLO link without a dangling space",
    async (sloName: string) => {
      const markdown: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: PROJECT_ID,
          sloId: SLO_ID,
          sloName,
        });

      expect(markdown).toBe(`[SLO](${SLO_LINK})`);
      // An explicit value, even a blank one, means the caller has the name.
      expect(findOneByIdSpy).not.toHaveBeenCalled();
    },
  );
});
