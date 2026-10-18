import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Status Pages -> a page -> Branding -> HTML, CSS & JavaScript says that its
 * code runs only on the page's custom domains, with Custom Domains a click
 * away - only while the page has no domain the code runs on.
 *
 * It said so on every visit, to every page, which no page may do
 * (App NoAlwaysOnInfoBannersGuard: a banner is for the case the reader must
 * act on). The case here is a page with no custom domain the status page
 * server serves its code on (canServeStatusPageCustomizations): a CNAME
 * verified for this page, on a verified project domain. Until there is one
 * the code runs nowhere.
 *
 * The page reads that in two steps: its CNAME-verified domains, then
 * whether any of their project domains is verified. Domain.isVerified
 * cannot be read through the relation (App RelationSelectColumnsWiring), so
 * one read selecting it would throw and the notice would never show.
 *
 * The real page is rendered; only the network, the route's id and the
 * permission gate are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import StatusPageCustomCode, {
  CUSTOM_CODE_DOMAINS_READ_LIMIT,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/CustomHtmlCss";
import {
  STATUS_PAGE_CUSTOM_CODE_NOTICE_TEST_ID,
  StatusPageCustomCodeCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageCustomCodeCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Domain from "../../../Models/DatabaseModels/Domain";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STATUS_PAGE_ID: string = "4d4d4d4d-0000-4000-8000-0000000000bb";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

/*
 * The page's CNAME-verified domains as the server holds them: each on a
 * project domain, verified or not.
 */
interface PageDomain {
  id: string;
  projectDomainId: string;
  isProjectDomainVerified: boolean;
}

let pageDomains: Array<PageDomain> = [];

// The page's CNAME-verified domains, one per answer: is its project domain verified?
function onDomains(...isProjectDomainVerified: Array<boolean>): void {
  pageDomains = isProjectDomainVerified.map(
    (isVerified: boolean, index: number): PageDomain => {
      return {
        id: `5e5e5e5e-0000-4000-8000-00000000000${index}`,
        projectDomainId: `6f6f6f6f-0000-4000-8000-00000000000${index}`,
        isProjectDomainVerified: isVerified,
      };
    },
  );
}

interface ListOptions {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

// Answers each read as the API would, from `pageDomains`.
function answer(options: ListOptions): Array<unknown> {
  if (options.modelType === StatusPageDomain) {
    return pageDomains.map((pageDomain: PageDomain): StatusPageDomain => {
      const item: StatusPageDomain = new StatusPageDomain();
      item._id = pageDomain.id;
      item.domainId = new ObjectID(pageDomain.projectDomainId);
      return item;
    });
  }

  if (options.modelType === Domain) {
    const ids: Array<string> = (
      (options.query["_id"] as Includes).values as Array<ObjectID>
    ).map((id: ObjectID): string => {
      return id.toString();
    });

    return pageDomains
      .filter((pageDomain: PageDomain): boolean => {
        return (
          ids.includes(pageDomain.projectDomainId) &&
          pageDomain.isProjectDomainVerified ===
            Boolean(options.query["isVerified"])
        );
      })
      .map((pageDomain: PageDomain): Domain => {
        const item: Domain = new Domain();
        item._id = pageDomain.projectDomainId;
        return item;
      });
  }

  return [];
}

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

beforeEach(() => {
  pageDomains = [];

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    return page;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (options: unknown): Promise<unknown> => {
    const data: Array<unknown> = answer(options as ListOptions);
    return { data: data, count: data.length, skip: 0, limit: 100 };
  });

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
    (): ObjectID => {
      return new ObjectID(STATUS_PAGE_ID);
    },
  );

  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  ) as jest.SpiedFunction<typeof Navigation.navigate>;

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

function readsOf(modelType: unknown): Array<ListOptions> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListOptions => {
      return call[0] as ListOptions;
    })
    .filter((options: ListOptions): boolean => {
      return options.modelType === modelType;
    });
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <StatusPageCustomCode {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
}

function notice(): HTMLElement | null {
  return screen.queryByTestId(STATUS_PAGE_CUSTOM_CODE_NOTICE_TEST_ID);
}

describe("the custom code notice", () => {
  test("a page with no custom domain: the notice, with Custom Domains a click away", async () => {
    onDomains();

    await renderPage();

    expect(notice()).toBeInTheDocument();
    expect(notice()).toHaveTextContent(StatusPageCustomCodeCopy.notice);
    // No project domain to ask about.
    expect(readsOf(Domain)).toHaveLength(0);

    fireEvent.click(screen.getByText(StatusPageCustomCodeCopy.noticeAction));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const route: string = String(navigateSpy.mock.calls[0]![0]);
    expect(route).toContain(`/status-pages/${STATUS_PAGE_ID}/domains`);
  });

  test("REGRESSION: a page with a domain its code runs on is not told on every visit", async () => {
    onDomains(true);

    await renderPage();

    expect(readsOf(StatusPageDomain)).toHaveLength(1);
    expect(readsOf(Domain)).toHaveLength(1);
    expect(notice()).not.toBeInTheDocument();
  });

  test("a CNAME verified on a project domain not verified yet: the code runs nowhere, so the notice shows", async () => {
    onDomains(false);

    await renderPage();

    expect(notice()).toBeInTheDocument();
  });

  test("one domain the code runs on among others is enough", async () => {
    onDomains(false, true, false);

    await renderPage();

    expect(notice()).not.toBeInTheDocument();
  });

  test("no notice on a guess: none while the domains are read, none when a read fails", async () => {
    onDomains();
    let release: () => void = (): void => {};
    getListMock.mockImplementation(
      async (options: unknown): Promise<unknown> => {
        await new Promise<void>((resolve: () => void) => {
          release = resolve;
        });
        const data: Array<unknown> = answer(options as ListOptions);
        return { data: data, count: data.length, skip: 0, limit: 100 };
      },
    );

    await renderPage();
    expect(notice()).not.toBeInTheDocument();

    await act(async () => {
      release();
    });
    await flush();
    // The answer came: no domain, so now it says so.
    expect(notice()).toBeInTheDocument();

    // The first read fails.
    cleanup();
    getListMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The domains could not be read");
    });

    await renderPage();
    expect(notice()).not.toBeInTheDocument();

    // The second read fails.
    cleanup();
    onDomains(false);
    getListMock.mockImplementation(
      async (options: unknown): Promise<unknown> => {
        if ((options as ListOptions).modelType === Domain) {
          throw new Error("The project domains could not be read");
        }
        const data: Array<unknown> = answer(options as ListOptions);
        return { data: data, count: data.length, skip: 0, limit: 100 };
      },
    );

    await renderPage();
    expect(notice()).not.toBeInTheDocument();
  });

  test("it asks what the status page server asks, in reads the API allows", async () => {
    onDomains(false, true);

    await renderPage();

    const pageReads: Array<ListOptions> = readsOf(StatusPageDomain);
    expect(pageReads).toHaveLength(1);
    expect(String(pageReads[0]!.query["statusPageId"])).toBe(STATUS_PAGE_ID);
    expect(pageReads[0]!.query["isCnameVerified"]).toBe(true);
    // Only the page domain's own columns: nothing read through the relation.
    expect(pageReads[0]!.select).toEqual({ _id: true, domainId: true });
    expect(pageReads[0]!.limit).toBe(CUSTOM_CODE_DOMAINS_READ_LIMIT);

    const domainReads: Array<ListOptions> = readsOf(Domain);
    expect(domainReads).toHaveLength(1);
    expect(
      ((domainReads[0]!.query["_id"] as Includes).values as Array<ObjectID>)
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort(),
    ).toEqual(
      pageDomains
        .map((pageDomain: PageDomain): string => {
          return pageDomain.projectDomainId;
        })
        .sort(),
    );
    expect(domainReads[0]!.query["isVerified"]).toBe(true);
    expect(domainReads[0]!.select).toEqual({ _id: true });
  });

  test("the four code cards show either way", async () => {
    onDomains(true);

    await renderPage();

    for (const title of [
      StatusPageCustomCodeCopy.headerTitle,
      StatusPageCustomCodeCopy.footerTitle,
      StatusPageCustomCodeCopy.cssTitle,
      StatusPageCustomCodeCopy.javaScriptTitle,
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});
