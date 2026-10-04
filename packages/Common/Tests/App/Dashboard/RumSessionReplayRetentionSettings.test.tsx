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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpyInstance } from "jest-mock";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import RumSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings";
import { getEffectiveSessionReplayRetentionDays } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayRetention";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Session Replay retention on a RUM application's Settings page, rendered on
 * its real route. Only transport, permissions and the unrelated archive card
 * are replaced.
 *
 * Replay retention is edited in one place: the application's Replay Policy
 * page (Edit Policy > Limits; its form is rendered in
 * Common/Tests/UI/Rum/SessionReplaySettingsPolicyLoading.test.tsx). The
 * Settings page used to be a second editor for the same column. It now says
 * how long recordings are kept and its one button opens the Replay Policy.
 *
 * Session Replay retention is part of every edition, so this runs on the
 * Community Edition (the jest config resolves the Enterprise plugin to the
 * empty Community stub, and billing is pinned off). The page's retention
 * overrides are Enterprise: their shell is pinned in
 * TelemetryRetentionShells.test.tsx, and the cards themselves in
 * ee/Tests/UI/TelemetryRetention/TelemetryRetentionSettingsPages.test.tsx.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return false;
    },
  });

  return mocked;
});

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [Permission.ProjectOwner] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
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

/* Archiving has its own real-page suite; it is deliberately outside scope. */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="archive-resource-card" />;
      },
    };
  },
);

const MODEL_ID: ObjectID = new ObjectID("22222222-0000-4000-8000-000000000001");
const WAIT_TIMEOUT: number = 20000;

const SETTINGS_ROUTE: Route = RouteMap[
  PageMap.RUM_APPLICATION_VIEW_SETTINGS
] as Route;

let storedModel: RumApplication;

function applicationWith(data?: Partial<RumApplication>): RumApplication {
  const model: RumApplication = new RumApplication();
  model.id = MODEL_ID;
  Object.assign(model, data || {});
  return model;
}

function retentionCard(): HTMLElement {
  return screen.getByTestId("session-replay-retention");
}

async function renderSettings(model: RumApplication): Promise<UserEvent> {
  storedModel = model;

  render(
    <MemoryRouter
      initialEntries={[
        RouteUtil.populateRouteParams(SETTINGS_ROUTE, {
          modelId: MODEL_ID,
        }).toString(),
      ]}
    >
      <Routes>
        <PageRoute
          path={String(SETTINGS_ROUTE)}
          element={
            <RumSettings
              pageRoute={SETTINGS_ROUTE}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole(
    "heading",
    { name: "Session Replay Retention" },
    { timeout: WAIT_TIMEOUT },
  );

  return userEvent.setup({ delay: null });
}

async function expectLine(text: string): Promise<void> {
  await waitFor(
    () => {
      expect(
        within(retentionCard()).getByTestId("session-replay-retention-line"),
      ).toHaveTextContent(text);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function callsSelecting(field: string): Array<Array<unknown>> {
  return getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
    const request: {
      select?: Record<string, unknown> | undefined;
    } = call[0] as { select?: Record<string, unknown> | undefined };
    return request.select?.[field] === true;
  });
}

beforeEach(() => {
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  updateByIdMock.mockReset();

  getItemMock.mockImplementation(async (): Promise<BaseModel> => {
    return storedModel;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("RUM application Settings: session replay retention", () => {
  test("is on the Community Edition page, next to the retention overrides upsell", async () => {
    await renderSettings(applicationWith({ sessionReplayRetentionInDays: 7 }));
    await expectLine("Session replays are kept for 7 days.");

    expect(
      screen.getByRole("heading", { name: "Retention Overrides", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Retention by Telemetry Type" }),
    ).not.toBeInTheDocument();
    expect(callsSelecting("telemetryRetentionConfig")).toHaveLength(0);
    expect(callsSelecting("retainTelemetryDataForDays")).toHaveLength(0);
    // Before the archive card.
    expect(
      retentionCard().compareDocumentPosition(
        screen.getByTestId("archive-resource-card"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("reads only the retention column, of the routed application", async () => {
    await renderSettings(applicationWith({ sessionReplayRetentionInDays: 14 }));
    await expectLine("Session replays are kept for 14 days.");

    const reads: Array<Array<unknown>> = callsSelecting(
      "sessionReplayRetentionInDays",
    );

    expect(reads).toHaveLength(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = reads[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };

    expect(request.modelType).toBe(RumApplication);
    expect(request.id.toString()).toBe(MODEL_ID.toString());
    expect(request.select).toEqual({ sessionReplayRetentionInDays: true });
  });

  test.each([
    [1, "Session replays are kept for 1 day."],
    [7, "Session replays are kept for 7 days."],
    [30, "Session replays are kept for 30 days."],
    [90, "Session replays are kept for 90 days."],
  ])(
    "a retention of %d reads as one sentence: %s",
    async (days: number, sentence: string) => {
      await renderSettings(
        applicationWith({ sessionReplayRetentionInDays: days }),
      );

      await expectLine(sentence);
    },
  );

  test("a row read without a value says the seven-day default the server keeps", async () => {
    await renderSettings(applicationWith());

    await expectLine("Session replays are kept for 7 days.");
  });

  test("is read-only: no edit dialog, no form and no write", async () => {
    await renderSettings(applicationWith({ sessionReplayRetentionInDays: 7 }));
    await expectLine("Session replays are kept for 7 days.");

    expect(
      screen.queryByRole("button", { name: "Edit Replay Retention" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Retain Session Replays For"),
    ).not.toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("its one button opens this application's Replay Policy, where retention is edited", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    const user: UserEvent = await renderSettings(
      applicationWith({ sessionReplayRetentionInDays: 7 }),
    );
    await expectLine("Session replays are kept for 7 days.");

    await user.click(
      screen.getByRole("button", { name: "Edit on Replay Policy" }),
    );

    expect(navigate).toHaveBeenCalledTimes(1);

    const target: Route | URL = navigate.mock.calls[0]![0];

    expect(target.toString()).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS] as Route,
        { modelId: MODEL_ID },
      ).toString(),
    );
    expect(target.toString()).toContain(
      `/rum/${MODEL_ID.toString()}/session-replay-settings`,
    );
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a failed read says why instead of a retention", async () => {
    getItemMock.mockImplementation(async (): Promise<BaseModel> => {
      throw new Error("You do not have permission to read this application.");
    });

    await renderSettings(applicationWith({ sessionReplayRetentionInDays: 7 }));

    await waitFor(
      () => {
        expect(retentionCard()).toHaveTextContent(
          "You do not have permission to read this application.",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      screen.queryByTestId("session-replay-retention-line"),
    ).not.toBeInTheDocument();
  });

  test("an application the read cannot find says so", async () => {
    getItemMock.mockImplementation(async (): Promise<null> => {
      return null;
    });

    await renderSettings(applicationWith({ sessionReplayRetentionInDays: 7 }));

    await waitFor(
      () => {
        expect(retentionCard()).toHaveTextContent("RUM application not found.");
      },
      { timeout: WAIT_TIMEOUT },
    );
  });
});

describe("getEffectiveSessionReplayRetentionDays", () => {
  test("a stored value is the retention", () => {
    expect(getEffectiveSessionReplayRetentionDays(1)).toBe(1);
    expect(getEffectiveSessionReplayRetentionDays(90)).toBe(90);
  });

  test("no value is the seven-day default", () => {
    expect(getEffectiveSessionReplayRetentionDays(undefined)).toBe(7);
    expect(getEffectiveSessionReplayRetentionDays(null)).toBe(7);
    expect(getEffectiveSessionReplayRetentionDays(0)).toBe(7);
  });
});
