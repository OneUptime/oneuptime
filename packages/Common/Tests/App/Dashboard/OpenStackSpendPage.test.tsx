import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import * as React from "react";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getOpenStackUsageTotals } from "../../../Types/OpenStack/OpenStackProjectUsage";
import { getEmptyOpenStackUsageQuantities } from "../../../Types/OpenStack/OpenStackProjectUsage";
import { OpenStackSpendSnapshot } from "../../../Types/OpenStack/OpenStackSpendSnapshot";
import {
  OPENSTACK_WASTE_RULES,
  OpenStackWasteFinding,
  OpenStackWasteRuleId,
} from "../../../Types/OpenStack/OpenStackWaste";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import OpenStackWasteCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackWasteCard";
import OpenStackCloudSpend from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Spend";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CLOUD_ID,
  renderPage,
  resetServer,
  server,
} from "./OpenStackPartHarness";

jest.mock("react-i18next", () => {
  return {
    initReactI18next: { type: "3rdParty", init: (): void => {} },
    useTranslation: () => {
      return {
        t: (key: string, values?: Record<string, unknown>): string => {
          return Object.keys(values || {}).reduce(
            (text: string, name: string): string => {
              return text.split(`{{${name}}}`).join(String(values![name]));
            },
            key,
          );
        },
        i18n: { language: "en", changeLanguage: async (): Promise<void> => {} },
      };
    },
  };
});

/*
 * The Spend page, drawn for real from a snapshot in its own shape. What each number should be is
 * OpenStackProjectUsage.test.ts's and OpenStackSpendSnapshot.test.ts's. This is what it says, where
 * it says it, and that nothing on it reads as an invoice.
 */

const USAGE: OpenStackSpendSnapshot["usage"] = {
  ...getOpenStackUsageTotals(getEmptyOpenStackUsageQuantities()),
  vcpuHours: 1234.5,
  memoryGbHours: 99,
  volumeGbHours: 88,
};

const FREES: OpenStackWasteFinding["frees"] = {
  storageGb: 0,
  floatingIps: 0,
  vcpus: 0,
  memoryGb: 0,
  diskGb: 0,
  hosts: 0,
};

function snapshot(
  overrides: Partial<OpenStackSpendSnapshot> = {},
): OpenStackSpendSnapshot {
  return {
    readAt: new Date().toISOString(),
    month: new Date().toISOString().slice(0, 7),
    currency: null,
    source: "usage-only",
    projectCount: 2,
    projectsRatedByCloudKitty: 0,
    cloudKittyReadAt: null,
    projectsPartlyPriced: 0,
    thisMonth: null,
    lastMonth: null,
    onCourseFor: null,
    usage: USAGE,
    lastMonthUsage: null,
    comparison: null,
    coverage: { firstReadAt: null, countedHours: 10, notCountedHours: 0 },
    lastMonthCoverage: null,
    byFlavor: [],
    flavorCount: 0,
    byVolumeType: [],
    volumeTypeCount: 0,
    domains: [],
    domainCount: 0,
    growers: [],
    days: [],
    months: [],
    monthAtLastMidnight: null,
    waste: null,
    wasteReadAt: null,
    ...overrides,
  };
}

async function renderSpend(
  value: OpenStackSpendSnapshot | null,
  priceList?: JSONObject,
): Promise<void> {
  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return Object.assign(new OpenStackCloud(), {
      spendSnapshot: value as unknown as JSONObject,
      priceList: priceList || null,
    });
  }) as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return { data: [], count: 0, skip: 0, limit: 10 };
  }) as never);

  await renderPage(
    OpenStackCloudSpend as React.FunctionComponent<PageComponentProps>,
    "/spend",
  );
}

describe("the Spend page", () => {
  beforeEach(() => {
    resetServer();
    server.cloud = null;
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("says when it hasn't read the cloud yet", async () => {
    await renderSpend(null);

    expect(screen.getByTestId("openstack-spend-not-yet")).toHaveTextContent(
      "every quarter of an hour",
    );
  });

  test("with no prices, what was used, and that no prices are set", async () => {
    await renderSpend(snapshot());

    const strip: HTMLElement = screen.getByTestId("openstack-spend-strip");

    expect(strip).toHaveTextContent("vCPU-Hours This Month");
    expect(strip).toHaveTextContent("1,234.5");
    expect(screen.getByTestId("openstack-spend-source")).toHaveTextContent(
      "No prices are set",
    );
    expect(screen.getByTestId("openstack-spend-source")).toHaveTextContent(
      "doesn't invoice anyone",
    );
    expect(strip).not.toHaveTextContent("$");
  });

  test("priced, an estimate in the operator's currency, against last month", async () => {
    await renderSpend(
      snapshot({
        source: "price-list",
        currency: "EUR",
        thisMonth: 1500,
        lastMonth: 2000,
        onCourseFor: 3000,
      }),
      { currency: "EUR", vcpuHour: 0.01 },
    );

    const strip: HTMLElement = screen.getByTestId("openstack-spend-strip");

    expect(strip).toHaveTextContent("This Month So Far");
    expect(strip).toHaveTextContent("€1,500.00");
    expect(strip).toHaveTextContent("€3,000.00");
    expect(strip).toHaveTextContent("€2,000.00");
  });

  test("something with no price is said to have none, and a total isn't passed off as all of it", async () => {
    await renderSpend(
      snapshot({
        source: "price-list",
        currency: "EUR",
        thisMonth: 10,
        projectsPartlyPriced: 3,
      }),
    );

    expect(
      screen.getByTestId("openstack-spend-partly-priced"),
    ).toHaveTextContent("3 projects used something with no price set");
  });

  test("hours nobody was reading are said", async () => {
    await renderSpend(
      snapshot({
        coverage: { firstReadAt: null, countedHours: 1, notCountedHours: 42 },
      }),
    );

    expect(screen.getByTestId("openstack-spend-coverage")).toHaveTextContent(
      "42 hours",
    );
  });

  test("CloudKitty's figures say whose they are, and with no currency there's no sign", async () => {
    await renderSpend(
      snapshot({
        source: "cloudkitty",
        thisMonth: 321.5,
        cloudKittyReadAt: new Date().toISOString(),
      }),
    );

    expect(screen.getByTestId("openstack-spend-source")).toHaveTextContent(
      "CloudKitty's own rated figures",
    );
    expect(screen.getByTestId("openstack-spend-source")).toHaveTextContent(
      "CloudKitty was last read",
    );
    expect(screen.getByTestId("openstack-spend-strip")).toHaveTextContent(
      "321.50",
    );
    expect(screen.getByTestId("openstack-spend-strip")).not.toHaveTextContent(
      "$",
    );
  });

  test("names its top growers, and each leads to its project", async () => {
    await renderSpend(
      snapshot({
        source: "price-list",
        currency: "EUR",
        thisMonth: 10,
        growers: [
          {
            openStackProjectId: "p1",
            name: "Payments",
            domainId: null,
            domainName: null,
            thisMonth: 10,
            lastMonth: 5,
            onCourseFor: 30,
            source: null,
            vcpuHours: 1,
            lastMonthVcpuHours: 1,
            vcpuHoursOnCourseFor: 1,
            growth: 25,
          },
        ],
      }),
    );

    expect(screen.getByTestId("openstack-spend-grower")).toHaveTextContent(
      "Payments",
    );
    expect(screen.getByTestId("openstack-spend-grower")).toHaveTextContent(
      "€25.00 more",
    );
  });

  test("a single domain isn't a table of one", async () => {
    await renderSpend(snapshot({ domainCount: 1 }));

    expect(screen.queryByTestId("openstack-spend-domain")).toBeNull();
  });

  test("several domains are listed, with how many there are when it's only the largest", async () => {
    await renderSpend(
      snapshot({
        domainCount: 3,
        domains: [
          {
            domainId: "d1",
            name: "Default",
            projectCount: 4,
            thisMonth: null,
            lastMonth: null,
            onCourseFor: null,
            vcpuHours: 10,
            memoryGbHours: 1,
            volumeGbHours: 1,
            floatingIpHours: 1,
          },
        ],
      }),
    );

    expect(screen.getByTestId("openstack-spend-domain")).toHaveTextContent(
      "Default",
    );
    expect(document.body).toHaveTextContent("The largest 1 of 3.");
  });
});

describe("what could be reclaimed", () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  function finding(
    overrides: Partial<OpenStackWasteFinding> & { rule: OpenStackWasteRuleId },
  ): OpenStackWasteFinding {
    return {
      cannotTell: null,
      count: 0,
      isPartial: false,
      frees: FREES,
      monthlyAmount: null,
      items: [],
      ...overrides,
    };
  }

  async function renderWaste(
    waste: Array<OpenStackWasteFinding> | null,
    currency: string | null = null,
  ): Promise<void> {
    const Wrapped: React.FunctionComponent<
      PageComponentProps
    > = (): React.ReactElement => {
      return (
        <OpenStackWasteCard
          openStackCloudId={new ObjectID(CLOUD_ID)}
          snapshot={snapshot({ waste, currency })}
        />
      );
    };

    resetServer();
    await renderPage(Wrapped, "/recommendations");
  }

  function ruleOf(rule: OpenStackWasteRuleId): HTMLElement {
    return screen
      .getAllByTestId("openstack-waste-rule")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-rule") === rule;
      }) as HTMLElement;
  }

  test("says when it hasn't looked yet", async () => {
    await renderWaste(null);

    expect(screen.getByTestId("openstack-waste-not-yet")).toBeInTheDocument();
  });

  test("says what a rule found, what it would free, what that comes to and the command that lists it", async () => {
    await renderWaste(
      [
        finding({
          rule: OpenStackWasteRuleId.UnattachedVolume,
          count: 2,
          frees: { ...FREES, storageGb: 150 },
          monthlyAmount: 73,
          items: [
            {
              id: "v1",
              name: "old-data",
              regionName: "R",
              openStackProjectId: "p",
              since: "2026-01-01T00:00:00.000Z",
              frees: { ...FREES, storageGb: 150 },
            },
          ],
        }),
      ],
      "EUR",
    );

    const rule: HTMLElement = ruleOf(OpenStackWasteRuleId.UnattachedVolume);

    expect(rule).toHaveTextContent(
      OPENSTACK_WASTE_RULES[OpenStackWasteRuleId.UnattachedVolume].title,
    );
    expect(within(rule).getByTestId("openstack-waste-count")).toHaveTextContent(
      "2 found",
    );
    expect(within(rule).getByTestId("openstack-waste-frees")).toHaveTextContent(
      "Would free 150 GB of storage. About €73.00 a month at your prices.",
    );
    expect(
      within(rule).getByTestId("openstack-waste-command"),
    ).toHaveTextContent(
      "openstack volume list --all-projects --status available --long",
    );

    // What it found is folded until it's asked for, and then names it.
    expect(within(rule).queryByTestId("openstack-waste-item")).toBeNull();
    fireEvent.click(within(rule).getByTestId("openstack-waste-toggle"));
    expect(within(rule).getByTestId("openstack-waste-item")).toHaveTextContent(
      "old-data",
    );
    // One of two is named, and the rest is said.
    expect(rule).toHaveTextContent("And 1 more.");
  });

  test("says nothing was found when nothing was", async () => {
    await renderWaste([
      finding({ rule: OpenStackWasteRuleId.ShutOffInstance }),
    ]);

    expect(
      within(ruleOf(OpenStackWasteRuleId.ShutOffInstance)).getByTestId(
        "openstack-waste-nothing",
      ),
    ).toBeInTheDocument();
  });

  test("a rule that can't be sure says so, and names nothing", async () => {
    await renderWaste([
      finding({
        rule: OpenStackWasteRuleId.UnusedImage,
        cannotTell: "images-in-use-not-reported",
      }),
    ]);

    const rule: HTMLElement = ruleOf(OpenStackWasteRuleId.UnusedImage);

    expect(
      within(rule).getByTestId("openstack-waste-cannot-tell"),
    ).toHaveTextContent("an image in use would look unused");
    expect(within(rule).queryByTestId("openstack-waste-nothing")).toBeNull();
    expect(within(rule).queryByTestId("openstack-waste-command")).toBeNull();
  });

  test("offers nothing that does anything", async () => {
    await renderWaste([
      finding({
        rule: OpenStackWasteRuleId.ShutOffInstance,
        count: 1,
        items: [
          {
            id: "i",
            name: "n",
            regionName: "R",
            openStackProjectId: "p",
            since: null,
            frees: FREES,
          },
        ],
      }),
    ]);

    const rule: HTMLElement = ruleOf(OpenStackWasteRuleId.ShutOffInstance);

    fireEvent.click(within(rule).getByTestId("openstack-waste-toggle"));

    // One button: the one that unfolds what it found.
    expect(within(rule).getAllByRole("button").length).toBe(1);
  });
});
