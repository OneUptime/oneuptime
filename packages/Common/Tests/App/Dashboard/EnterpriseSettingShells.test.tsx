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
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The core shells of the Enterprise settings that live in columns of a
 * status page, a dashboard or a form - the IP allowlist, a status page's
 * reader session limit and subscriber restrictions, and Powered by
 * OneUptime - and of custom roles.
 *
 * Each setting is Enterprise code (ee/Dashboard/...). Its page renders it
 * through a core shell, which renders the plugin where the project may use
 * the feature and the build includes it, and the upsell card otherwise.
 * What a record still holds keeps applying where it cannot be changed, so
 * under the upsell it is shown with Remove:
 *   - on the Community Edition, for the IP allowlist, the session limit, the
 *     subscriber restrictions and custom roles (which the server keeps
 *     enforcing there), never for Powered by OneUptime (which every page
 *     shows there anyway);
 *   - on OneUptime Cloud for a project known to be below the plan, for all
 *     of them;
 *   - never while the plan is loading.
 * Remove writes each column's default - the one write every edition and
 * plan allows.
 *
 * The plugins come from a stand-in for src/Enterprise/Plugins; `null` means
 * "the real module", which in this jest config is the empty Community stub.
 * Billing, edition and plan are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). Nothing here imports ee/.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;
let currentPlanForTest: string | null = null;
let pluginsForTest: Record<string, unknown> | null = null;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins", () => {
  const actual: { getDashboardPlugins: () => Record<string, unknown> } =
    jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Enterprise/Plugins",
    ) as { getDashboardPlugins: () => Record<string, unknown> };

  return {
    __esModule: true,
    getDashboardPlugins: (): Record<string, unknown> => {
      return pluginsForTest === null
        ? actual.getDashboardPlugins()
        : pluginsForTest;
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner", "Public"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import IpAllowlistSettings, {
  IP_ALLOWLIST_UPSELL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IpAllowlist/IpAllowlistSettings";
import StatusPageSessionLengthSettings, {
  STATUS_PAGE_SESSION_LENGTH_LEFTOVER_VALUE_TEST_ID,
  STATUS_PAGE_SESSION_LENGTH_UPSELL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSessionLengthSettings";
import SubscriberRestrictionsSettings, {
  SUBSCRIBER_RESTRICTIONS_LEFTOVER_VALUE_TEST_ID,
  SUBSCRIBER_RESTRICTIONS_UPSELL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberRestrictionsSettings";
import StatusPagePoweredBySettings, {
  STATUS_PAGE_POWERED_BY_UPSELL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPagePoweredBySettings";
import TeamCustomRolesSettings from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamCustomRolesSettings";
import { CustomRolesCardState } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRolesFold";
import { SubscriberRestrictionsState } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberRestrictionsCopy";
import ApiKeyCustomRolesSettings from "../../../../App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyCustomRolesSettings";
import TeamRoles, {
  CUSTOM_ROLES_UPSELL,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Roles";
import TeamRoleView from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/RoleView";
import {
  ENTERPRISE_SETTING_LEFTOVER_SENTENCES,
  EnterpriseSettingLeftoverKind,
  getEnterpriseSettingLeftoverTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import {
  getEnterpriseSettingDefault,
  isEnterpriseSettingSet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EnterpriseEdition/EnterpriseSettingLeftover";
import CustomRoleLeftoverCopy, {
  API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID,
  PROJECT_CUSTOM_ROLES_LEFTOVER_TEST_ID,
  TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleLeftoverCopy";
import { IpAllowlistCardProps } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterprisePlugins";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Form from "../../../Models/DatabaseModels/Form";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RECORD_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("33333333-0000-4000-8000-000000000001");
const API_KEY_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000001",
);

const COMMUNITY_EDITION_CTA: string = "Learn about Enterprise Edition";

// The record ModelAPI.getItem hands the shells' leftovers.
const recordWith: (
  modelType: { new (): StatusPage | Dashboard | Form },
  values: Record<string, unknown>,
) => StatusPage | Dashboard | Form = (
  modelType: { new (): StatusPage | Dashboard | Form },
  values: Record<string, unknown>,
): StatusPage | Dashboard | Form => {
  const record: StatusPage | Dashboard | Form = new modelType();
  record.id = RECORD_ID;

  for (const [column, value] of Object.entries(values)) {
    (record as unknown as Record<string, unknown>)[column] = value;
  }

  return record;
};

const pinCommunityEdition: () => void = (): void => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  currentPlanForTest = null;
  pluginsForTest = null;
};

const pinCloud: (plan: string | null) => void = (plan: string | null): void => {
  billingEnabledForTest = true;
  enterpriseEditionForTest = true;
  currentPlanForTest = plan;
  pluginsForTest = null;
};

// A stand-in plugin that shows it was drawn, and with which props.
const stubPlugin: (testId: string) => {
  component: (props: Record<string, unknown>) => ReactElement;
  calls: Array<Record<string, unknown>>;
} = (
  testId: string,
): {
  component: (props: Record<string, unknown>) => ReactElement;
  calls: Array<Record<string, unknown>>;
} => {
  const calls: Array<Record<string, unknown>> = [];

  return {
    calls,
    component: (props: Record<string, unknown>): ReactElement => {
      calls.push(props);
      return <div data-testid={testId} />;
    },
  };
};

const ipAllowlistProps: (
  modelType: { new (): StatusPage | Dashboard | Form },
  onLoaded?: (allowlist: string) => void,
) => IpAllowlistCardProps = (
  modelType: { new (): StatusPage | Dashboard | Form },
  onLoaded?: (allowlist: string) => void,
): IpAllowlistCardProps => {
  return {
    modelType: modelType,
    modelId: RECORD_ID,
    cardName: "Test > IP Allowlist",
    modelDetailId: "model-detail-test-ip-allowlist",
    title: "IP Allowlist",
    description: "Who may open it, by address.",
    editButtonText: "Edit IP Allowlist",
    fieldDescription: "One a line.",
    emptyText: "Every address",
    noAddressText: "No address",
    entriesTestId: "test-ip-allowlist-entries",
    onLoaded: onLoaded,
  };
};

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/teams/roles"),
} as unknown as PageComponentProps;

const renderInRouter: (element: ReactElement) => void = (
  element: ReactElement,
): void => {
  render(<MemoryRouter>{element}</MemoryRouter>);
};

beforeEach(() => {
  pinCommunityEdition();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  countMock.mockReset();
  getListMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);
  countMock.mockResolvedValue(0 as never);
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 10,
  } as never);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ProjectUtil, "getCurrentPlan").mockImplementation(() => {
    return currentPlanForTest as PlanType | null;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what a leftover reads and writes", () => {
  test("a column back to its default: its declared default, false for a switch, nothing otherwise", () => {
    const statusPage: StatusPage = new StatusPage();

    expect(
      getEnterpriseSettingDefault(
        statusPage.getTableColumnMetadata("hidePoweredByOneUptimeBranding"),
      ),
    ).toBe(false);
    expect(
      getEnterpriseSettingDefault(
        statusPage.getTableColumnMetadata("limitSubscribersToPrivateUsers"),
      ),
    ).toBe(false);
    expect(
      getEnterpriseSettingDefault(
        statusPage.getTableColumnMetadata("ipWhitelist"),
      ),
    ).toBeNull();
    expect(
      getEnterpriseSettingDefault(
        statusPage.getTableColumnMetadata("privateUserSessionLengthInHours"),
      ),
    ).toBeNull();
    expect(getEnterpriseSettingDefault(undefined)).toBeNull();
  });

  test.each([
    ["an allowlist", { ipWhitelist: "10.0.0.1" }, ["ipWhitelist"], true],
    ["no allowlist", { ipWhitelist: null }, ["ipWhitelist"], false],
    ["an empty allowlist", { ipWhitelist: "" }, ["ipWhitelist"], false],
    [
      "a session limit",
      { privateUserSessionLengthInHours: 12 },
      ["privateUserSessionLengthInHours"],
      true,
    ],
    [
      "only the domains",
      {
        limitSubscribersToPrivateUsers: false,
        allowedSubscriberEmailDomains: "acme.com",
      },
      ["limitSubscribersToPrivateUsers", "allowedSubscriberEmailDomains"],
      true,
    ],
    [
      "neither restriction",
      {
        limitSubscribersToPrivateUsers: false,
        allowedSubscriberEmailDomains: null,
      },
      ["limitSubscribersToPrivateUsers", "allowedSubscriberEmailDomains"],
      false,
    ],
  ])(
    "%s: set is %p",
    (
      _label: string,
      values: Record<string, unknown>,
      columns: Array<string>,
      isSet: boolean,
    ) => {
      expect(
        isEnterpriseSettingSet(recordWith(StatusPage, values), columns),
      ).toBe(isSet);
    },
  );
});

describe("the IP allowlist shell", () => {
  test.each([
    ["a status page", StatusPage],
    ["a dashboard", Dashboard],
    ["a form", Form],
  ] as Array<[string, { new (): StatusPage | Dashboard | Form }]>)(
    "Community Edition, %s with no allowlist: the upsell alone",
    async (
      _label: string,
      modelType: { new (): StatusPage | Dashboard | Form },
    ) => {
      const loaded: Array<string> = [];
      getItemMock.mockResolvedValue(
        recordWith(modelType, { ipWhitelist: null }) as never,
      );

      renderInRouter(
        <IpAllowlistSettings
          {...ipAllowlistProps(modelType, (allowlist: string) => {
            loaded.push(allowlist);
          })}
        />,
      );

      expect(
        screen.getByText(IP_ALLOWLIST_UPSELL.featureName),
      ).toBeInTheDocument();
      expect(screen.getAllByText(COMMUNITY_EDITION_CTA).length).toBeGreaterThan(
        0,
      );

      await waitFor(() => {
        expect(loaded).toEqual([""]);
      });

      expect(getItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: modelType,
          id: RECORD_ID,
          select: { ipWhitelist: true },
        }),
      );
      expect(
        screen.queryByTestId(
          getEnterpriseSettingLeftoverTestId(
            EnterpriseSettingLeftoverKind.IpAllowlist,
          ),
        ),
      ).not.toBeInTheDocument();
    },
  );

  test("Community Edition, an allowlist set: it is shown as still in force, and Remove writes nothing back", async () => {
    const loaded: Array<string> = [];
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        ipWhitelist: "203.0.113.7\n\n10.0.0.0/8",
      }) as never,
    );

    renderInRouter(
      <IpAllowlistSettings
        {...ipAllowlistProps(StatusPage, (allowlist: string) => {
          loaded.push(allowlist);
        })}
      />,
    );

    const leftover: HTMLElement = await screen.findByTestId(
      getEnterpriseSettingLeftoverTestId(
        EnterpriseSettingLeftoverKind.IpAllowlist,
      ),
    );

    expect(
      screen.getByText(
        ENTERPRISE_SETTING_LEFTOVER_SENTENCES[
          EnterpriseSettingLeftoverKind.IpAllowlist
        ].title,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        ENTERPRISE_SETTING_LEFTOVER_SENTENCES[
          EnterpriseSettingLeftoverKind.IpAllowlist
        ].editionDescription,
      ),
    ).toBeInTheDocument();
    expect(leftover).toHaveTextContent("203.0.113.7");
    expect(leftover).toHaveTextContent("10.0.0.0/8");
    expect(
      screen.getByTestId("test-ip-allowlist-entries").querySelectorAll("li"),
    ).toHaveLength(2);
    expect(loaded).toEqual(["203.0.113.7\n\n10.0.0.0/8"]);

    fireEvent.click(screen.getAllByText("Remove allowlist")[0] as HTMLElement);

    expect(
      await screen.findByText("Remove the IP allowlist?"),
    ).toBeInTheDocument();

    await act(async () => {
      const buttons: Array<HTMLElement> =
        screen.getAllByText("Remove allowlist");
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith({
        modelType: StatusPage,
        id: RECORD_ID,
        data: { ipWhitelist: null },
      });
    });

    expect(
      await screen.findByTestId(
        `${getEnterpriseSettingLeftoverTestId(
          EnterpriseSettingLeftoverKind.IpAllowlist,
        )}-removed`,
      ),
    ).toHaveTextContent(
      ENTERPRISE_SETTING_LEFTOVER_SENTENCES[
        EnterpriseSettingLeftoverKind.IpAllowlist
      ].removed,
    );
    expect(loaded[loaded.length - 1]).toBe("");
  });

  test("a refused Remove keeps the dialog open, with why", async () => {
    getItemMock.mockResolvedValue(
      recordWith(Dashboard, { ipWhitelist: "10.0.0.1" }) as never,
    );
    updateByIdMock.mockRejectedValue(
      new Error("Refused by the server") as never,
    );

    renderInRouter(<IpAllowlistSettings {...ipAllowlistProps(Dashboard)} />);

    await screen.findByTestId(
      getEnterpriseSettingLeftoverTestId(
        EnterpriseSettingLeftoverKind.IpAllowlist,
      ),
    );

    fireEvent.click(screen.getAllByText("Remove allowlist")[0] as HTMLElement);
    await screen.findByText("Remove the IP allowlist?");

    await act(async () => {
      const buttons: Array<HTMLElement> =
        screen.getAllByText("Remove allowlist");
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("Remove the IP allowlist?")).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        `${getEnterpriseSettingLeftoverTestId(
          EnterpriseSettingLeftoverKind.IpAllowlist,
        )}-removed`,
      ),
    ).not.toBeInTheDocument();
  });

  test("a self-hosted Enterprise Edition with the plugin: the plugin, with the page's own props, and no leftover read", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> = stubPlugin(
      "ip-allowlist-plugin",
    );
    pluginsForTest = { IpAllowlistCard: plugin.component };

    renderInRouter(<IpAllowlistSettings {...ipAllowlistProps(Form)} />);

    expect(
      await screen.findByTestId("ip-allowlist-plugin"),
    ).toBeInTheDocument();
    expect(plugin.calls[0]).toEqual(
      expect.objectContaining({
        modelType: Form,
        modelId: RECORD_ID,
        cardName: "Test > IP Allowlist",
        entriesTestId: "test-ip-allowlist-entries",
      }),
    );
    expect(
      screen.queryByText(IP_ALLOWLIST_UPSELL.featureName),
    ).not.toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("OneUptime Cloud below Scale: the plan upsell, and the allowlist the trial left, with the plan named", async () => {
    pinCloud(PlanType.Growth);
    pluginsForTest = {
      IpAllowlistCard: stubPlugin("ip-allowlist-plugin").component,
    };
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, { ipWhitelist: "10.0.0.1" }) as never,
    );

    renderInRouter(<IpAllowlistSettings {...ipAllowlistProps(StatusPage)} />);

    await screen.findByTestId(
      getEnterpriseSettingLeftoverTestId(
        EnterpriseSettingLeftoverKind.IpAllowlist,
      ),
    );

    expect(screen.queryByTestId("ip-allowlist-plugin")).not.toBeInTheDocument();
    expect(screen.getAllByText("Upgrade to Scale").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Only the addresses below can open this, as before. Changing the allowlist needs the Scale plan. Removing it lets every address in again.",
      ),
    ).toBeInTheDocument();
  });

  test("OneUptime Cloud on Scale: the plugin", async () => {
    pinCloud(PlanType.Scale);
    pluginsForTest = {
      IpAllowlistCard: stubPlugin("ip-allowlist-plugin").component,
    };

    renderInRouter(<IpAllowlistSettings {...ipAllowlistProps(StatusPage)} />);

    expect(
      await screen.findByTestId("ip-allowlist-plugin"),
    ).toBeInTheDocument();
  });

  test("OneUptime Cloud while the plan loads: the upsell alone, and nothing read for a leftover", () => {
    pinCloud(null);
    pluginsForTest = {
      IpAllowlistCard: stubPlugin("ip-allowlist-plugin").component,
    };

    renderInRouter(<IpAllowlistSettings {...ipAllowlistProps(StatusPage)} />);

    expect(getItemMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ip-allowlist-plugin")).not.toBeInTheDocument();
  });
});

describe("the reader session limit shell", () => {
  test("Community Edition, a limit set: it is shown as still in force, and Remove sets no limit", async () => {
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, { privateUserSessionLengthInHours: 12 }) as never,
    );

    renderInRouter(
      <StatusPageSessionLengthSettings statusPageId={RECORD_ID} />,
    );

    expect(
      screen.getByText(STATUS_PAGE_SESSION_LENGTH_UPSELL.featureName),
    ).toBeInTheDocument();

    const value: HTMLElement = await screen.findByTestId(
      STATUS_PAGE_SESSION_LENGTH_LEFTOVER_VALUE_TEST_ID,
    );

    expect(value).toHaveTextContent("Sign readers out after");
    expect(value).toHaveTextContent("12 hours");

    fireEvent.click(screen.getAllByText("Remove limit")[0] as HTMLElement);
    await screen.findByText("Remove the reader session limit?");

    await act(async () => {
      const buttons: Array<HTMLElement> = screen.getAllByText("Remove limit");
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith({
        modelType: StatusPage,
        id: RECORD_ID,
        data: { privateUserSessionLengthInHours: null },
      });
    });
  });

  test("a whole number of days reads as days", async () => {
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, { privateUserSessionLengthInHours: 48 }) as never,
    );

    renderInRouter(
      <StatusPageSessionLengthSettings statusPageId={RECORD_ID} />,
    );

    expect(
      await screen.findByTestId(
        STATUS_PAGE_SESSION_LENGTH_LEFTOVER_VALUE_TEST_ID,
      ),
    ).toHaveTextContent("2 days");
  });

  test("Community Edition, no limit: the upsell alone", async () => {
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        privateUserSessionLengthInHours: null,
      }) as never,
    );

    renderInRouter(
      <StatusPageSessionLengthSettings statusPageId={RECORD_ID} />,
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByTestId(STATUS_PAGE_SESSION_LENGTH_LEFTOVER_VALUE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("Enterprise Edition: the plugin, for this status page", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> = stubPlugin("session-plugin");
    pluginsForTest = { StatusPageSessionLength: plugin.component };

    renderInRouter(
      <StatusPageSessionLengthSettings statusPageId={RECORD_ID} />,
    );

    expect(await screen.findByTestId("session-plugin")).toBeInTheDocument();
    expect(plugin.calls[0]).toEqual({ statusPageId: RECORD_ID });
  });
});

describe("the subscriber restrictions shell", () => {
  test("Community Edition, both set: both are shown, and Remove puts both back", async () => {
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        limitSubscribersToPrivateUsers: true,
        allowedSubscriberEmailDomains: "acme.com\nacme.de",
      }) as never,
    );

    renderInRouter(<SubscriberRestrictionsSettings statusPageId={RECORD_ID} />);

    expect(
      screen.getByText(SUBSCRIBER_RESTRICTIONS_UPSELL.featureName),
    ).toBeInTheDocument();

    const value: HTMLElement = await screen.findByTestId(
      SUBSCRIBER_RESTRICTIONS_LEFTOVER_VALUE_TEST_ID,
    );

    expect(value).toHaveTextContent("Only Private Users Can Subscribe");
    expect(value).toHaveTextContent("Allowed Email Domains");
    expect(value).toHaveTextContent("acme.com");
    expect(value).toHaveTextContent("acme.de");

    fireEvent.click(
      screen.getAllByText("Remove restrictions")[0] as HTMLElement,
    );
    await screen.findByText("Remove the subscriber restrictions?");

    await act(async () => {
      const buttons: Array<HTMLElement> = screen.getAllByText(
        "Remove restrictions",
      );
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith({
        modelType: StatusPage,
        id: RECORD_ID,
        data: {
          limitSubscribersToPrivateUsers: false,
          allowedSubscriberEmailDomains: null,
        },
      });
    });
  });

  test("Community Edition, only the domains: the domains alone", async () => {
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        limitSubscribersToPrivateUsers: false,
        allowedSubscriberEmailDomains: "acme.com",
      }) as never,
    );

    renderInRouter(<SubscriberRestrictionsSettings statusPageId={RECORD_ID} />);

    const value: HTMLElement = await screen.findByTestId(
      SUBSCRIBER_RESTRICTIONS_LEFTOVER_VALUE_TEST_ID,
    );

    expect(value).toHaveTextContent("acme.com");
    expect(value).not.toHaveTextContent("Only Private Users Can Subscribe");
  });

  test("Community Edition, nothing set: the upsell alone", async () => {
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        limitSubscribersToPrivateUsers: false,
        allowedSubscriberEmailDomains: null,
      }) as never,
    );

    renderInRouter(<SubscriberRestrictionsSettings statusPageId={RECORD_ID} />);

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          limitSubscribersToPrivateUsers: true,
          allowedSubscriberEmailDomains: true,
        },
      }),
    );
    expect(
      screen.queryByTestId(SUBSCRIBER_RESTRICTIONS_LEFTOVER_VALUE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("Enterprise Edition: the plugin", async () => {
    enterpriseEditionForTest = true;
    pluginsForTest = {
      StatusPageSubscriberRestrictions: stubPlugin("restrictions-plugin")
        .component,
    };

    renderInRouter(<SubscriberRestrictionsSettings statusPageId={RECORD_ID} />);

    expect(
      await screen.findByTestId("restrictions-plugin"),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
  });
});

describe("the Powered by OneUptime shell", () => {
  test("Community Edition: the upsell alone - every page shows the line there, so nothing is read", () => {
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, { hidePoweredByOneUptimeBranding: true }) as never,
    );

    renderInRouter(<StatusPagePoweredBySettings statusPageId={RECORD_ID} />);

    expect(
      screen.getByText(STATUS_PAGE_POWERED_BY_UPSELL.featureName as string),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("OneUptime Cloud below Scale, the line hidden: it can be shown again", async () => {
    pinCloud(PlanType.Free);
    pluginsForTest = {
      StatusPagePoweredBy: stubPlugin("powered-by-plugin").component,
    };
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, { hidePoweredByOneUptimeBranding: true }) as never,
    );

    renderInRouter(<StatusPagePoweredBySettings statusPageId={RECORD_ID} />);

    await screen.findByTestId(
      getEnterpriseSettingLeftoverTestId(
        EnterpriseSettingLeftoverKind.PoweredBy,
      ),
    );

    fireEvent.click(
      screen.getAllByText("Show Powered by OneUptime")[0] as HTMLElement,
    );
    await screen.findByText("Show Powered by OneUptime again?");

    await act(async () => {
      const buttons: Array<HTMLElement> = screen.getAllByText(
        "Show Powered by OneUptime",
      );
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith({
        modelType: StatusPage,
        id: RECORD_ID,
        data: { hidePoweredByOneUptimeBranding: false },
      });
    });
  });

  test("OneUptime Cloud below Scale, the line shown: the upsell alone", async () => {
    pinCloud(PlanType.Growth);
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        hidePoweredByOneUptimeBranding: false,
      }) as never,
    );

    renderInRouter(<StatusPagePoweredBySettings statusPageId={RECORD_ID} />);

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByTestId(
        getEnterpriseSettingLeftoverTestId(
          EnterpriseSettingLeftoverKind.PoweredBy,
        ),
      ),
    ).not.toBeInTheDocument();
  });

  test("Enterprise Edition: the plugin", async () => {
    enterpriseEditionForTest = true;
    pluginsForTest = {
      StatusPagePoweredBy: stubPlugin("powered-by-plugin").component,
    };

    renderInRouter(<StatusPagePoweredBySettings statusPageId={RECORD_ID} />);

    expect(await screen.findByTestId("powered-by-plugin")).toBeInTheDocument();
  });
});

describe("the custom role shells", () => {
  test("Roles, Community Edition, no custom role: the upsell and the built-in roles", async () => {
    renderInRouter(<TeamRoles {...PAGE_PROPS} />);

    expect(
      screen.getAllByText(CUSTOM_ROLES_UPSELL.featureName).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(COMMUNITY_EDITION_CTA).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Built-in Roles")).toBeInTheDocument();

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByTestId(PROJECT_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("Roles, Community Edition, custom roles left: they are listed, still in force, to delete", async () => {
    countMock.mockResolvedValue(2 as never);

    renderInRouter(<TeamRoles {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId(PROJECT_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CustomRoleLeftoverCopy.projectTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CustomRoleLeftoverCopy.projectEditionDescription),
    ).toBeInTheDocument();
    expect(countMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { projectId: PROJECT_ID } }),
    );
  });

  test("Roles, Enterprise Edition: the Enterprise page, and the built-in roles under it", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> = stubPlugin("roles-plugin");
    pluginsForTest = { TeamRoles: plugin.component };

    renderInRouter(<TeamRoles {...PAGE_PROPS} />);

    expect(await screen.findByTestId("roles-plugin")).toBeInTheDocument();
    expect(screen.getByText("Built-in Roles")).toBeInTheDocument();
    expect(
      screen.queryByText(CUSTOM_ROLES_UPSELL.featureName),
    ).not.toBeInTheDocument();
    expect(countMock).not.toHaveBeenCalled();
  });

  test("Roles, OneUptime Cloud below Scale: the plan upsell, and the roles still in force with the plan named", async () => {
    pinCloud(PlanType.Growth);
    pluginsForTest = { TeamRoles: stubPlugin("roles-plugin").component };
    countMock.mockResolvedValue(1 as never);

    renderInRouter(<TeamRoles {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId(PROJECT_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "These roles keep giving the teams that have them their permissions. Creating and changing custom roles needs the Scale plan. You can still delete them, which takes their permissions from those teams at once.",
      ),
    ).toBeInTheDocument();
  });

  test("a role's page, Community Edition: the upsell", () => {
    renderInRouter(<TeamRoleView {...PAGE_PROPS} />);

    expect(
      screen.getAllByText(CUSTOM_ROLES_UPSELL.featureName).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(COMMUNITY_EDITION_CTA).length).toBeGreaterThan(
      0,
    );
  });

  test("a role's page, Enterprise Edition: the Enterprise page", async () => {
    enterpriseEditionForTest = true;
    pluginsForTest = { TeamRoleView: stubPlugin("role-view-plugin").component };

    renderInRouter(<TeamRoleView {...PAGE_PROPS} />);

    expect(await screen.findByTestId("role-view-plugin")).toBeInTheDocument();
  });

  test("a team's custom roles, Community Edition, with roles: listed to remove, no upsell", async () => {
    countMock.mockResolvedValue(1 as never);

    renderInRouter(<TeamCustomRolesSettings teamId={TEAM_ID} />);

    expect(
      await screen.findByTestId(TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CustomRoleLeftoverCopy.teamEditionDescription),
    ).toBeInTheDocument();
    /*
     * No upsell: the card is titled Custom Roles, as the upsell's feature
     * is named, so the upsell is told by its own words and its button.
     */
    expect(
      screen.queryByText(CUSTOM_ROLES_UPSELL.featureDescription as string),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(COMMUNITY_EDITION_CTA)).not.toBeInTheDocument();
    expect(countMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { teamId: TEAM_ID, projectId: PROJECT_ID },
      }),
    );
  });

  test("a team's custom roles, Community Edition, none: nothing at all", async () => {
    renderInRouter(<TeamCustomRolesSettings teamId={TEAM_ID} />);

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByTestId(TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a team's custom roles, Enterprise Edition: the Enterprise card, for this team", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> =
      stubPlugin("team-roles-plugin");
    pluginsForTest = { TeamCustomRoles: plugin.component };

    renderInRouter(<TeamCustomRolesSettings teamId={TEAM_ID} />);

    expect(await screen.findByTestId("team-roles-plugin")).toBeInTheDocument();
    expect(plugin.calls[0]).toEqual({ teamId: TEAM_ID });
    expect(countMock).not.toHaveBeenCalled();
  });

  test("a team's custom roles, OneUptime Cloud while the plan loads: nothing, and nothing read", () => {
    pinCloud(null);
    pluginsForTest = {
      TeamCustomRoles: stubPlugin("team-roles-plugin").component,
    };

    renderInRouter(<TeamCustomRolesSettings teamId={TEAM_ID} />);

    expect(screen.queryByTestId("team-roles-plugin")).not.toBeInTheDocument();
    expect(countMock).not.toHaveBeenCalled();
  });

  test("a team's custom roles, OneUptime Cloud below Scale: listed with the plan named", async () => {
    pinCloud(PlanType.Free);
    pluginsForTest = {
      TeamCustomRoles: stubPlugin("team-roles-plugin").component,
    };
    countMock.mockResolvedValue(3 as never);

    renderInRouter(<TeamCustomRolesSettings teamId={TEAM_ID} />);

    expect(
      await screen.findByTestId(TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This team keeps the permissions of these roles. Giving custom roles to teams needs the Scale plan. You can still remove them from this team.",
      ),
    ).toBeInTheDocument();
  });
  test("an API key's custom roles, Community Edition, with roles: listed to remove, no upsell", async () => {
    countMock.mockResolvedValue(2 as never);

    renderInRouter(<ApiKeyCustomRolesSettings apiKeyId={API_KEY_ID} />);

    expect(
      await screen.findByTestId(API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CustomRoleLeftoverCopy.apiKeyTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CustomRoleLeftoverCopy.apiKeyEditionDescription),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(CUSTOM_ROLES_UPSELL.featureDescription as string),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(COMMUNITY_EDITION_CTA)).not.toBeInTheDocument();
    expect(countMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { apiKeyId: API_KEY_ID, projectId: PROJECT_ID },
      }),
    );
  });

  test("an API key's custom roles, Community Edition, none: nothing at all", async () => {
    renderInRouter(<ApiKeyCustomRolesSettings apiKeyId={API_KEY_ID} />);

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByTestId(API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("an API key's custom roles, Enterprise Edition: the Enterprise card, for this key", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> = stubPlugin(
      "api-key-roles-plugin",
    );
    pluginsForTest = { ApiKeyCustomRoles: plugin.component };

    renderInRouter(<ApiKeyCustomRolesSettings apiKeyId={API_KEY_ID} />);

    expect(
      await screen.findByTestId("api-key-roles-plugin"),
    ).toBeInTheDocument();
    expect(plugin.calls[0]).toEqual({ apiKeyId: API_KEY_ID });
    expect(countMock).not.toHaveBeenCalled();
  });

  test("an API key's custom roles, Enterprise build on the Community Edition: the roles left, never the card", async () => {
    pluginsForTest = {
      ApiKeyCustomRoles: stubPlugin("api-key-roles-plugin").component,
    };
    countMock.mockResolvedValue(1 as never);

    renderInRouter(<ApiKeyCustomRolesSettings apiKeyId={API_KEY_ID} />);

    expect(
      await screen.findByTestId(API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("api-key-roles-plugin"),
    ).not.toBeInTheDocument();
  });

  test("an API key's custom roles, OneUptime Cloud while the plan loads: nothing, and nothing read", () => {
    pinCloud(null);
    pluginsForTest = {
      ApiKeyCustomRoles: stubPlugin("api-key-roles-plugin").component,
    };

    renderInRouter(<ApiKeyCustomRolesSettings apiKeyId={API_KEY_ID} />);

    expect(
      screen.queryByTestId("api-key-roles-plugin"),
    ).not.toBeInTheDocument();
    expect(countMock).not.toHaveBeenCalled();
  });

  test("an API key's custom roles, OneUptime Cloud below Scale: listed with the plan named", async () => {
    pinCloud(PlanType.Growth);
    pluginsForTest = {
      ApiKeyCustomRoles: stubPlugin("api-key-roles-plugin").component,
    };
    countMock.mockResolvedValue(1 as never);

    renderInRouter(<ApiKeyCustomRolesSettings apiKeyId={API_KEY_ID} />);

    expect(
      await screen.findByTestId(API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This API key keeps the permissions of these roles. Giving custom roles to API keys needs the Scale plan. You can still remove them from this key.",
      ),
    ).toBeInTheDocument();
  });

  test("an API key's custom roles, OneUptime Cloud on Scale: the Enterprise card", async () => {
    pinCloud(PlanType.Scale);
    pluginsForTest = {
      ApiKeyCustomRoles: stubPlugin("api-key-roles-plugin").component,
    };

    renderInRouter(<ApiKeyCustomRolesSettings apiKeyId={API_KEY_ID} />);

    expect(
      await screen.findByTestId("api-key-roles-plugin"),
    ).toBeInTheDocument();
    expect(countMock).not.toHaveBeenCalled();
  });
});

/*
 * Each of these cards waits folded under its page's More settings, and
 * tells the page what it holds - whichever edition draws it - so the folded
 * header can name it with what it is set to: "Reader Sessions: 8 hours",
 * "Who Can Subscribe: Private users", "Powered by OneUptime: Off", "Custom
 * Roles: 2". The shells hand the same callback to the Enterprise card and to what
 * a lower plan or the Community Edition left of the feature.
 */
describe("what the folded cards tell their page", () => {
  test("reader sessions, Community Edition: the limit still in force, and none once removed", async () => {
    const reports: Array<number | null> = [];

    getItemMock.mockResolvedValue(
      recordWith(StatusPage, { privateUserSessionLengthInHours: 12 }) as never,
    );

    renderInRouter(
      <StatusPageSessionLengthSettings
        statusPageId={RECORD_ID}
        onLengthChange={(lengthInHours: number | null) => {
          reports.push(lengthInHours);
        }}
      />,
    );

    await waitFor(() => {
      expect(reports).toEqual([12]);
    });

    /*
     * The card tells its page what it read before it draws it: its button
     * may come a render later.
     */
    fireEvent.click(
      (await screen.findAllByText("Remove limit"))[0] as HTMLElement,
    );
    await screen.findByText("Remove the reader session limit?");

    await act(async () => {
      const buttons: Array<HTMLElement> = screen.getAllByText("Remove limit");
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(reports).toEqual([12, null]);
    });
  });

  test("reader sessions, Community Edition, no limit: none", async () => {
    const reports: Array<number | null> = [];

    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        privateUserSessionLengthInHours: null,
      }) as never,
    );

    renderInRouter(
      <StatusPageSessionLengthSettings
        statusPageId={RECORD_ID}
        onLengthChange={(lengthInHours: number | null) => {
          reports.push(lengthInHours);
        }}
      />,
    );

    await waitFor(() => {
      expect(reports).toEqual([null]);
    });
  });

  test("reader sessions, Enterprise Edition: the card is handed the same way to say so", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> = stubPlugin("session-plugin");
    pluginsForTest = { StatusPageSessionLength: plugin.component };
    const onLengthChange: (lengthInHours: number | null) => void = (): void => {
      // Told by the card.
    };

    renderInRouter(
      <StatusPageSessionLengthSettings
        statusPageId={RECORD_ID}
        onLengthChange={onLengthChange}
      />,
    );

    expect(await screen.findByTestId("session-plugin")).toBeInTheDocument();
    expect(plugin.calls[0]!["onLengthChange"]).toBe(onLengthChange);
  });

  test("who can subscribe, Community Edition: both restrictions still in force, and none once removed", async () => {
    const reports: Array<Record<string, unknown>> = [];

    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        limitSubscribersToPrivateUsers: true,
        allowedSubscriberEmailDomains: "acme.com\nacme.de",
      }) as never,
    );

    renderInRouter(
      <SubscriberRestrictionsSettings
        statusPageId={RECORD_ID}
        onRestrictionsChange={(restrictions: SubscriberRestrictionsState) => {
          reports.push({ ...restrictions });
        }}
      />,
    );

    await waitFor(() => {
      expect(reports).toEqual([
        { limitSubscribersToPrivateUsers: true, allowedEmailDomainCount: 2 },
      ]);
    });

    fireEvent.click(
      (await screen.findAllByText("Remove restrictions"))[0] as HTMLElement,
    );
    await screen.findByText("Remove the subscriber restrictions?");

    await act(async () => {
      const buttons: Array<HTMLElement> = screen.getAllByText(
        "Remove restrictions",
      );
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(reports[reports.length - 1]).toEqual({
        limitSubscribersToPrivateUsers: false,
        allowedEmailDomainCount: 0,
      });
    });
  });

  test("who can subscribe, Enterprise Edition: the card is handed the same way to say so", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> = stubPlugin(
      "restrictions-plugin",
    );
    pluginsForTest = { StatusPageSubscriberRestrictions: plugin.component };
    const onRestrictionsChange: (
      restrictions: SubscriberRestrictionsState,
    ) => void = (): void => {
      // Told by the card.
    };

    renderInRouter(
      <SubscriberRestrictionsSettings
        statusPageId={RECORD_ID}
        onRestrictionsChange={onRestrictionsChange}
      />,
    );

    expect(
      await screen.findByTestId("restrictions-plugin"),
    ).toBeInTheDocument();
    expect(plugin.calls[0]!["onRestrictionsChange"]).toBe(onRestrictionsChange);
  });

  test("Powered by OneUptime, OneUptime Cloud below Scale: the line still hidden, and shown once put back", async () => {
    const reports: Array<boolean> = [];

    pinCloud(PlanType.Free);
    pluginsForTest = {
      StatusPagePoweredBy: stubPlugin("powered-by-plugin").component,
    };
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, { hidePoweredByOneUptimeBranding: true }) as never,
    );

    renderInRouter(
      <StatusPagePoweredBySettings
        statusPageId={RECORD_ID}
        onPoweredByChange={(isShown: boolean) => {
          reports.push(isShown);
        }}
      />,
    );

    await waitFor(() => {
      expect(reports).toEqual([false]);
    });

    fireEvent.click(
      (
        await screen.findAllByText("Show Powered by OneUptime")
      )[0] as HTMLElement,
    );
    await screen.findByText("Show Powered by OneUptime again?");

    await act(async () => {
      const buttons: Array<HTMLElement> = screen.getAllByText(
        "Show Powered by OneUptime",
      );
      fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    });

    await waitFor(() => {
      expect(reports).toEqual([false, true]);
    });
  });

  test("Powered by OneUptime, OneUptime Cloud below Scale, the line shown: shown", async () => {
    const reports: Array<boolean> = [];

    pinCloud(PlanType.Growth);
    getItemMock.mockResolvedValue(
      recordWith(StatusPage, {
        hidePoweredByOneUptimeBranding: false,
      }) as never,
    );

    renderInRouter(
      <StatusPagePoweredBySettings
        statusPageId={RECORD_ID}
        onPoweredByChange={(isShown: boolean) => {
          reports.push(isShown);
        }}
      />,
    );

    await waitFor(() => {
      expect(reports).toEqual([true]);
    });
  });

  test("Powered by OneUptime, Community Edition: nothing to say - every page shows the line there", async () => {
    const reports: Array<boolean> = [];

    renderInRouter(
      <StatusPagePoweredBySettings
        statusPageId={RECORD_ID}
        onPoweredByChange={(isShown: boolean) => {
          reports.push(isShown);
        }}
      />,
    );

    expect(
      screen.getByText(STATUS_PAGE_POWERED_BY_UPSELL.featureName as string),
    ).toBeInTheDocument();
    expect(reports).toEqual([]);
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("Powered by OneUptime, Enterprise Edition: the card is handed the same way to say so", async () => {
    enterpriseEditionForTest = true;
    const plugin: ReturnType<typeof stubPlugin> =
      stubPlugin("powered-by-plugin");
    pluginsForTest = { StatusPagePoweredBy: plugin.component };
    const onPoweredByChange: (isShown: boolean) => void = (): void => {
      // Told by the card.
    };

    renderInRouter(
      <StatusPagePoweredBySettings
        statusPageId={RECORD_ID}
        onPoweredByChange={onPoweredByChange}
      />,
    );

    expect(await screen.findByTestId("powered-by-plugin")).toBeInTheDocument();
    expect(plugin.calls[0]!["onPoweredByChange"]).toBe(onPoweredByChange);
  });

  test.each([
    [3, { isShown: true, count: 3 }],
    [0, { isShown: false, count: 0 }],
  ])(
    "a team's custom roles, Community Edition, %i left: told to the page",
    async (left: number, told: CustomRolesCardState) => {
      const reports: Array<CustomRolesCardState> = [];

      countMock.mockResolvedValue(left as never);

      renderInRouter(
        <TeamCustomRolesSettings
          teamId={TEAM_ID}
          onRolesChange={(state: CustomRolesCardState) => {
            reports.push(state);
          }}
        />,
      );

      await waitFor(() => {
        expect(reports[0]).toEqual(told);
      });
    },
  );

  test.each([
    [2, { isShown: true, count: 2 }],
    [0, { isShown: false, count: 0 }],
  ])(
    "an API key's custom roles, Community Edition, %i left: told to the page",
    async (left: number, told: CustomRolesCardState) => {
      const reports: Array<CustomRolesCardState> = [];

      countMock.mockResolvedValue(left as never);

      renderInRouter(
        <ApiKeyCustomRolesSettings
          apiKeyId={API_KEY_ID}
          onRolesChange={(state: CustomRolesCardState) => {
            reports.push(state);
          }}
        />,
      );

      await waitFor(() => {
        expect(reports[0]).toEqual(told);
      });
    },
  );

  test("custom roles, Enterprise Edition: each card is handed the same way to say so", async () => {
    enterpriseEditionForTest = true;
    const teamPlugin: ReturnType<typeof stubPlugin> =
      stubPlugin("team-roles-plugin");
    const keyPlugin: ReturnType<typeof stubPlugin> = stubPlugin(
      "api-key-roles-plugin",
    );
    pluginsForTest = {
      TeamCustomRoles: teamPlugin.component,
      ApiKeyCustomRoles: keyPlugin.component,
    };
    const onRolesChange: (state: CustomRolesCardState) => void = (): void => {
      // Told by the card.
    };

    renderInRouter(
      <>
        <TeamCustomRolesSettings
          teamId={TEAM_ID}
          onRolesChange={onRolesChange}
        />
        <ApiKeyCustomRolesSettings
          apiKeyId={API_KEY_ID}
          onRolesChange={onRolesChange}
        />
      </>,
    );

    expect(await screen.findByTestId("team-roles-plugin")).toBeInTheDocument();
    expect(teamPlugin.calls[0]).toEqual({
      teamId: TEAM_ID,
      onRolesChange: onRolesChange,
    });
    expect(keyPlugin.calls[0]).toEqual({
      apiKeyId: API_KEY_ID,
      onRolesChange: onRolesChange,
    });
  });
});
