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

// A domain of the page as the read returns it: CNAME-verified ones only.
function cnameVerifiedDomain(
  isProjectDomainVerified: boolean,
): StatusPageDomain {
  const statusPageDomain: StatusPageDomain = new StatusPageDomain();
  statusPageDomain._id = ObjectID.generate().toString();
  const domain: Domain = new Domain();
  domain.isVerified = isProjectDomainVerified;
  statusPageDomain.domain = domain;
  return statusPageDomain;
}

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

beforeEach(() => {
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    return page;
  });

  getListMock.mockReset();

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

// The page's domains read answers with `domains`; every other list is empty.
function domainsRead(domains: Array<StatusPageDomain>): void {
  getListMock.mockImplementation(async (options: unknown): Promise<unknown> => {
    const modelType: unknown = (options as { modelType: unknown }).modelType;
    const data: Array<unknown> = modelType === StatusPageDomain ? domains : [];
    return { data: data, count: data.length, skip: 0, limit: 100 };
  });
}

interface ListOptions {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

function domainReads(): Array<ListOptions> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListOptions => {
      return call[0] as ListOptions;
    })
    .filter((options: ListOptions): boolean => {
      return options.modelType === StatusPageDomain;
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
    domainsRead([]);

    await renderPage();

    expect(notice()).toBeInTheDocument();
    expect(notice()).toHaveTextContent(StatusPageCustomCodeCopy.notice);

    fireEvent.click(screen.getByText(StatusPageCustomCodeCopy.noticeAction));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const route: string = String(navigateSpy.mock.calls[0]![0]);
    expect(route).toContain(`/status-pages/${STATUS_PAGE_ID}/domains`);
  });

  test("REGRESSION: a page with a domain its code runs on is not told on every visit", async () => {
    domainsRead([cnameVerifiedDomain(true)]);

    await renderPage();

    expect(domainReads()).toHaveLength(1);
    expect(notice()).not.toBeInTheDocument();
  });

  test("a CNAME verified on a project domain not verified yet: the code runs nowhere, so the notice shows", async () => {
    domainsRead([cnameVerifiedDomain(false)]);

    await renderPage();

    expect(notice()).toBeInTheDocument();
  });

  test("one domain the code runs on among others is enough", async () => {
    domainsRead([
      cnameVerifiedDomain(false),
      cnameVerifiedDomain(true),
      cnameVerifiedDomain(false),
    ]);

    await renderPage();

    expect(notice()).not.toBeInTheDocument();
  });

  test("no notice on a guess: none while the domains are read, none when the read fails", async () => {
    let answer: (value: unknown) => void = (): void => {};
    getListMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        answer = resolve;
      });
    });

    await renderPage();
    expect(notice()).not.toBeInTheDocument();

    await act(async () => {
      answer({ data: [], count: 0, skip: 0, limit: 100 });
    });
    await flush();
    // The answer came: no domain, so now it says so.
    expect(notice()).toBeInTheDocument();

    cleanup();
    getListMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The domains could not be read");
    });

    await renderPage();
    expect(notice()).not.toBeInTheDocument();
  });

  test("it asks what the status page server asks: this page's CNAME-verified domains, with their project domain's verification", async () => {
    domainsRead([]);

    await renderPage();

    const reads: Array<ListOptions> = domainReads();
    expect(reads).toHaveLength(1);
    expect(String(reads[0]!.query["statusPageId"])).toBe(STATUS_PAGE_ID);
    expect(reads[0]!.query["isCnameVerified"]).toBe(true);
    expect(reads[0]!.select).toEqual({
      _id: true,
      domain: { isVerified: true },
    });
    expect(reads[0]!.limit).toBe(CUSTOM_CODE_DOMAINS_READ_LIMIT);
  });

  test("the four code cards show either way", async () => {
    domainsRead([cnameVerifiedDomain(true)]);

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
