import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A NEW STATUS PAGE NAMES ITSELF ON ITS PUBLIC PAGE (#7467).
 *
 * Create Status Page and the guided setup ask for a page's name; its Page
 * Title, under Branding's More settings, is left empty. The status page app
 * read the Page Title alone from its settings (/master-page), so a new page's
 * tab read "Status Page" and its header named nothing, while the page's own
 * HTML title (/seo) and its subscribers' emails named it by its name.
 *
 * Both answers now name the page as its visitors read it
 * (Types/StatusPage/StatusPagePublicName): its Page Title, else its name.
 * The settings carry that name as pageTitle, the field the app reads; the
 * name itself is never sent, as a page with a Page Title may keep a name its
 * team uses among themselves.
 */

type MasterPageAnswer = {
  page: JSONObject;
  answer: JSONObject;
  select: Record<string, unknown>;
};

describe("a status page's name, as the status page app and its HTML read it", () => {
  let statusPageId: ObjectID;

  beforeEach(() => {
    statusPageId = ObjectID.generate();

    jest
      .spyOn(StatusPageSsoService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const storedPage: (names: {
    name?: string | undefined;
    pageTitle?: string | undefined;
  }) => StatusPage = (names: {
    name?: string | undefined;
    pageTitle?: string | undefined;
  }): StatusPage => {
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.isPublicStatusPage = true;
    statusPage.isArchived = false;

    if (names.name !== undefined) {
      statusPage.name = names.name;
    }

    if (names.pageTitle !== undefined) {
      statusPage.pageTitle = names.pageTitle;
    }

    return statusPage;
  };

  const readMasterPage: (names: {
    name?: string | undefined;
    pageTitle?: string | undefined;
  }) => Promise<MasterPageAnswer> = async (names: {
    name?: string | undefined;
    pageTitle?: string | undefined;
  }): Promise<MasterPageAnswer> => {
    const findOneById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(storedPage(names));

    const answer: JSONObject = await StatusPageAPI.readMasterPage({
      statusPageId: statusPageId,
      allowStatusPageCustomizations: false,
    });

    const call: Array<unknown> = findOneById.mock.calls[0] as Array<unknown>;

    return {
      page: answer["statusPage"] as JSONObject,
      answer: answer,
      select: (call[0] as { select: Record<string, unknown> }).select,
    };
  };

  describe("its settings (/master-page)", () => {
    it("reads the page's name and its Page Title", async () => {
      const { select } = await readMasterPage({ name: "Walk Co Status" });

      expect(select["name"]).toBe(true);
      expect(select["pageTitle"]).toBe(true);
    });

    it("a page made by Create Status Page or the guided setup, with no Page Title, is named by its name", async () => {
      const { page } = await readMasterPage({ name: "Walk Co Status" });

      expect(page["pageTitle"]).toBe("Walk Co Status");
    });

    it("a page with a Page Title is named by it, and its own name is never sent", async () => {
      const { page, answer } = await readMasterPage({
        name: "walk-co-prod (do not share)",
        pageTitle: "Walk Co Status",
      });

      expect(page["pageTitle"]).toBe("Walk Co Status");
      expect(page).not.toHaveProperty("name");
      expect(JSON.stringify(answer)).not.toContain("do not share");
    });

    it("the name is not sent beside the Page Title it stands in for either", async () => {
      const { page } = await readMasterPage({ name: "Walk Co Status" });

      expect(page).not.toHaveProperty("name");
    });

    it("a Page Title of spaces is none: the page is named by its name", async () => {
      const { page } = await readMasterPage({
        name: "Walk Co Status",
        pageTitle: "   ",
      });

      expect(page["pageTitle"]).toBe("Walk Co Status");
    });

    it("both trimmed, as the page draws them", async () => {
      const { page } = await readMasterPage({
        name: "  Walk Co Status  ",
      });

      expect(page["pageTitle"]).toBe("Walk Co Status");
    });
  });

  describe("its HTML (/seo)", () => {
    const readSeo: (names: {
      name?: string | undefined;
      pageTitle?: string | undefined;
    }) => Promise<JSONObject | null> = async (names: {
      name?: string | undefined;
      pageTitle?: string | undefined;
    }): Promise<JSONObject | null> => {
      jest
        .spyOn(StatusPageService, "findOneBy")
        .mockResolvedValue(storedPage(names));

      return StatusPageAPI.readSeo(statusPageId);
    };

    it("is titled by the same name as its settings: the Page Title, else the name", async () => {
      expect((await readSeo({ name: "Walk Co Status" }))?.["title"]).toBe(
        "Walk Co Status",
      );
      expect(
        (
          await readSeo({
            name: "walk-co-prod",
            pageTitle: "Walk Co Status",
          })
        )?.["title"],
      ).toBe("Walk Co Status");
      expect(
        (await readSeo({ name: "Walk Co Status", pageTitle: "  " }))?.["title"],
      ).toBe("Walk Co Status");
    });
  });
});
