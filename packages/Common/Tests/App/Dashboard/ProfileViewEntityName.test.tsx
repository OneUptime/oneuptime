import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The profile page's summary card names the source it came from
 * ---------------------------------------------------------------------------
 *
 * The card used to print `primaryEntityId` verbatim under a label from a
 * local switch that knew six types — a RUM application's profile read
 * "RESOURCE 84858d6c-2222-4222-…". It now resolves the entity with its
 * primaryEntityType as a hint and labels it from the shared vocabulary.
 *
 * The flame graph, function list, diff and focus panel are mocked out: they
 * fetch on mount and are not what is under test.
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileFlamegraph",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileFunctionList",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTypeSelector",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/DiffFlamegraphWithPresets",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/FunctionFocusPanel",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import ProfileViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Profiles/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Profile from "../../../Models/AnalyticsModels/Profile";
import Host from "../../../Models/DatabaseModels/Host";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUM_APP_ID: string = "84858d6c-2222-4222-8222-222222222222";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type ModelType = { new (): unknown };

interface GetListArgs {
  modelType: ModelType;
  query: { _id: Includes };
}

const makeProfile: (
  entityId: string,
  entityType: ServiceType | undefined,
) => Profile = (
  entityId: string,
  entityType: ServiceType | undefined,
): Profile => {
  const profile: Profile = new Profile();
  profile.profileId = "profile-1";
  profile.profileType = "cpu";
  profile.primaryEntityId = new ObjectID(entityId);
  profile.primaryEntityType = entityType;
  return profile;
};

const requestedModels: () => Array<ModelType> = (): Array<ModelType> => {
  return getListMock.mock.calls.map((call: Array<unknown>): ModelType => {
    return (call[0] as GetListArgs).modelType;
  });
};

const renderPage: () => Promise<ReturnType<typeof render>> = async (): Promise<
  ReturnType<typeof render>
> => {
  let view: ReturnType<typeof render> | null = null;
  await act(async (): Promise<void> => {
    view = render(
      <MemoryRouter>
        <ProfileViewPage {...({} as PageComponentProps)} />
      </MemoryRouter>,
    );
  });
  return view!;
};

describe("Profile view — summary card source", () => {
  beforeEach(() => {
    TelemetryEntityNameResolver.clearCache();
    analyticsGetListMock.mockReset();
    getListMock.mockReset();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    window.history.pushState({}, "", "/dashboard/profiles/profile-1");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  test("REGRESSION: a RUM application profile shows its name, not the raw id", async () => {
    analyticsGetListMock.mockResolvedValue({
      data: [makeProfile(RUM_APP_ID, ServiceType.RealUserMonitor)],
    });
    getListMock.mockImplementation((...args: Array<any>) => {
      const request: GetListArgs = args[0] as GetListArgs;
      return Promise.resolve({
        data:
          request.modelType === RumApplication
            ? [{ id: new ObjectID(RUM_APP_ID), name: "checkout-web" }]
            : [],
        count: 0,
      });
    });

    const view: ReturnType<typeof render> = await renderPage();

    await waitFor(() => {
      expect(view.container.textContent).toContain("checkout-web");
    });
    expect(view.container.textContent).toContain("RUM Application");
    expect(view.container.textContent).not.toContain(RUM_APP_ID);
    expect(view.container.textContent).not.toContain("Resource");

    // The id is still available on hover.
    expect(
      view.container.querySelector(`[title="${RUM_APP_ID}"]`),
    ).not.toBeNull();

    // The type hint sent the lookup straight to the RUM table.
    expect(requestedModels()).toEqual([RumApplication]);
  });

  test("an unresolvable source shows the shared type label over the raw id", async () => {
    analyticsGetListMock.mockResolvedValue({
      data: [makeProfile(HOST_ID, ServiceType.Host)],
    });
    getListMock.mockResolvedValue({ data: [], count: 0 });

    const view: ReturnType<typeof render> = await renderPage();

    await waitFor(() => {
      expect(requestedModels()).toContain(Host);
    });
    expect(view.container.textContent).toContain("Host");
    expect(view.container.textContent).toContain(HOST_ID);
  });

  test("unattributed telemetry (projectId under Unknown) reads 'Unknown Service'", async () => {
    analyticsGetListMock.mockResolvedValue({
      data: [makeProfile(PROJECT_ID.toString(), ServiceType.Unknown)],
    });
    getListMock.mockResolvedValue({ data: [], count: 0 });

    const view: ReturnType<typeof render> = await renderPage();

    await waitFor(() => {
      expect(view.container.textContent).toContain("Unknown Service");
    });
    expect(view.container.textContent).not.toContain(PROJECT_ID.toString());
    // No table holds the projectId, so nothing is queried for it.
    expect(getListMock).not.toHaveBeenCalled();
  });
});
