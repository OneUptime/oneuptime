import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Status Pages -> a page -> Advanced -> Embedded Status: where the badge's
 * Markdown links to.
 *
 * It took only a custom domain whose free certificate was in place
 * (isSslProvisioned), so a domain served with a certificate its owner
 * uploaded - live, and listed first on the page's Status Page Link card -
 * was passed over for the OneUptime address; and on an installation that
 * issues no free certificates, so was every verified domain. It now links to
 * the page's first live address, as the Status Page Link card lists them,
 * the way the server picks where its emails link
 * (StatusPageService.getUsableCustomDomain).
 *
 * The real page is rendered; the network, the route's id, the permission
 * gate and the installation's settings are stubbed.
 */

let issuesFreeCertificates: boolean = true;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "CUSTOM_DOMAIN_FREE_CERTIFICATES", {
    get: (): boolean => {
      return issuesFreeCertificates;
    },
  });

  return mocked;
});

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

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
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import StatusPageEmbeddedStatus, {
  EMBEDDED_STATUS_BADGE_EMBED_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmbeddedStatus";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { HTTP_PROTOCOL, STATUS_PAGE_URL } from "../../../UI/Config";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STATUS_PAGE_ID: string = "3c3c3c3c-0000-4000-8000-0000000000ab";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

const ONEUPTIME_ADDRESS: string = `${STATUS_PAGE_URL.toString()}/${STATUS_PAGE_ID}`;

interface DomainRow {
  fullDomain: string;
  isCnameVerified?: boolean;
  isCustomCertificate?: boolean;
  isSslOrdered?: boolean;
  isSslProvisioned?: boolean;
}

let domains: Array<DomainRow> | Error = [];

const toDomain: (row: DomainRow, index: number) => StatusPageDomain = (
  row: DomainRow,
  index: number,
): StatusPageDomain => {
  const domain: StatusPageDomain = new StatusPageDomain();
  domain._id = `4d4d4d4d-0000-4000-8000-${String(index).padStart(12, "0")}`;
  Object.assign(domain, row);
  return domain;
};

beforeEach(() => {
  issuesFreeCertificates = true;
  domains = [];

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    page.enableEmbeddedOverallStatus = true;
    page.embeddedOverallStatusToken = "badge-token";
    return page;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    if (domains instanceof Error) {
      throw domains;
    }

    const rows: Array<StatusPageDomain> = domains.map(toDomain);

    return { data: rows, count: rows.length, skip: 0, limit: 100 };
  });

  updateByIdMock.mockReset();

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
    (): ObjectID => {
      return new ObjectID(STATUS_PAGE_ID);
    },
  );

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
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// Where the badge's Markdown links to, as the page draws it.
async function linkedAddress(): Promise<string> {
  render(
    <MemoryRouter>
      <StatusPageEmbeddedStatus {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();

  const embed: HTMLElement = await screen.findByTestId(
    EMBEDDED_STATUS_BADGE_EMBED_TEST_ID,
  );
  await flush();

  const text: string = embed.textContent || "";
  const start: string = "?token=badge-token)](";
  const at: number = text.indexOf(start);

  expect(at).toBeGreaterThan(-1);

  return text.slice(at + start.length, text.indexOf(")", at + start.length));
}

describe("the embedded badge links to the page's first live address", () => {
  test("with no custom domain: the address on OneUptime", async () => {
    expect(await linkedAddress()).toBe(ONEUPTIME_ADDRESS);
  });

  test("a domain on its free certificate", async () => {
    domains = [
      {
        fullDomain: "status.acme.com",
        isCnameVerified: true,
        isSslOrdered: true,
        isSslProvisioned: true,
      },
    ];

    expect(await linkedAddress()).toBe("https://status.acme.com");
  });

  test("a domain on a certificate its owner uploaded: it used to be passed over", async () => {
    domains = [
      {
        fullDomain: "uploaded.acme.com",
        isCnameVerified: true,
        isCustomCertificate: true,
      },
    ];

    expect(await linkedAddress()).toBe("https://uploaded.acme.com");
  });

  test("an uploaded certificate on a domain whose record is not found yet is not live", async () => {
    domains = [
      {
        fullDomain: "uploaded.acme.com",
        isCnameVerified: false,
        isCustomCertificate: true,
      },
    ];

    expect(await linkedAddress()).toBe(ONEUPTIME_ADDRESS);
  });

  test("a verified domain still waiting for its free certificate is not live yet", async () => {
    domains = [{ fullDomain: "status.acme.com", isCnameVerified: true }];

    expect(await linkedAddress()).toBe(ONEUPTIME_ADDRESS);
  });

  test("on an installation that issues no free certificates, a verified domain is live, on the installation's protocol", async () => {
    issuesFreeCertificates = false;
    domains = [{ fullDomain: "status.acme.com", isCnameVerified: true }];

    expect(await linkedAddress()).toBe(`${HTTP_PROTOCOL}status.acme.com`);
  });

  test("of several live domains, the one the Status Page Link card lists first", async () => {
    domains = [
      { fullDomain: "waiting.acme.com" },
      {
        fullDomain: "zeta.acme.com",
        isCnameVerified: true,
        isSslProvisioned: true,
      },
      {
        fullDomain: "alpha.acme.com",
        isCnameVerified: true,
        isCustomCertificate: true,
      },
    ];

    expect(await linkedAddress()).toBe("https://alpha.acme.com");
  });

  test("a read that fails links the address on OneUptime", async () => {
    domains = new Error("The domains could not be read.");

    expect(await linkedAddress()).toBe(ONEUPTIME_ADDRESS);
  });

  test("it reads every domain of the page, with what the rule reads of each", async () => {
    await linkedAddress();

    const read: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = getListMock.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          modelType: unknown;
          query: Record<string, unknown>;
          select: Record<string, unknown>;
        };
      })
      .find((options: { modelType: unknown }) => {
        return options.modelType === StatusPageDomain;
      })!;

    expect(read).toBeDefined();
    expect(Object.keys(read.query)).toEqual(["statusPageId"]);
    expect(read.select).toEqual({
      fullDomain: true,
      isCnameVerified: true,
      isCustomCertificate: true,
      isSslOrdered: true,
      isSslProvisioned: true,
    });
  });
});
