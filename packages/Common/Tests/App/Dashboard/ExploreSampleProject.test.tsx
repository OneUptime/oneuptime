import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "EXPLORE SAMPLE PROJECT" (issue #6808): where it is offered, what one
 * click does, and what a failure says.
 *
 *   - offered on the "No projects" page, to someone "Just looking around"
 *     (first, under their goals), and on Home while nothing is done yet -
 *     never once a step is done, and never where the person may not make a
 *     project;
 *   - one click makes the sample (or opens the one they have), records
 *     where it was started from, and opens its Home;
 *   - a refusal or a failure says the server's sentence, and stays.
 */

const navigateMock: MockFunction = getJestMockFunction();
const sendMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SampleProject/SampleProjectApi",
  () => {
    return {
      __esModule: true,
      createSampleProject: (...args: Array<unknown>) => {
        return createMock(...args);
      },
      deleteSampleProject: getJestMockFunction(),
    };
  },
);

import ExploreSampleProject from "../../../../App/FeatureSet/Dashboard/src/Components/SampleProject/ExploreSampleProject";
import {
  SampleProjectOffer,
  getSampleProjectOffer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { SampleProjectEntryPoint } from "../../../Types/SampleProject/SampleProject";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";
import ProjectUtil from "../../../UI/Utils/Project";

const SAMPLE_ID: string = "5a3c0000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  navigateMock.mockReset();
  sendMock.mockReset();
  createMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("where it is offered on Home", () => {
  test("first, to someone just looking around, while nothing is done", () => {
    expect(
      getSampleProjectOffer({ goals: [ProjectGoal.Explore], doneCount: 0 }),
    ).toBe(SampleProjectOffer.Goals);
    expect(
      getSampleProjectOffer({
        goals: [ProjectGoal.Uptime, ProjectGoal.Explore],
        doneCount: 0,
      }),
    ).toBe(SampleProjectOffer.Goals);
  });

  test("at the foot of the card, to a project with nothing in it yet", () => {
    expect(getSampleProjectOffer({ goals: [], doneCount: 0 })).toBe(
      SampleProjectOffer.Home,
    );
    expect(
      getSampleProjectOffer({ goals: [ProjectGoal.Uptime], doneCount: 0 }),
    ).toBe(SampleProjectOffer.Home);
  });

  test("never once a step is done: the project is being set up for real", () => {
    expect(
      getSampleProjectOffer({ goals: [ProjectGoal.Explore], doneCount: 1 }),
    ).toBe(SampleProjectOffer.None);
    expect(getSampleProjectOffer({ goals: [], doneCount: 2 })).toBe(
      SampleProjectOffer.None,
    );
  });
});

describe("the button", () => {
  test("is left out where the person may not make a project", () => {
    const { container } = render(
      <ExploreSampleProject
        from={SampleProjectEntryPoint.Welcome}
        isOffered={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("says what the sample is before the click", () => {
    render(
      <ExploreSampleProject
        from={SampleProjectEntryPoint.Welcome}
        isOffered={true}
      />,
    );

    expect(
      screen.getByText(
        "See OneUptime with data in it: monitors, incidents, on-call, a status page and telemetry. Nothing in it is real, and nobody is notified.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Explore Sample Project/ }),
    ).toBeInTheDocument();
  });

  test("the line can be left to the page that says it already", () => {
    render(
      <ExploreSampleProject
        from={SampleProjectEntryPoint.Home}
        isOffered={true}
        showDescription={false}
      />,
    );

    expect(screen.queryByText(/Nothing in it is real/)).not.toBeInTheDocument();
  });

  test("one click makes the sample, says where it was started from, and opens its Home", async () => {
    const setLastAccessed: SpyInstance<
      typeof ProjectUtil.setLastAccessedProjectId
    > = jest
      .spyOn(ProjectUtil, "setLastAccessedProjectId")
      .mockImplementation(() => {});
    createMock.mockResolvedValue({
      isSuccess: true,
      value: { projectId: SAMPLE_ID, isNew: true },
    } as never);

    render(
      <ExploreSampleProject
        from={SampleProjectEntryPoint.Goals}
        isOffered={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("explore-sample-project-button"));
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.SampleProjectStarted,
      { from: "goals", is_new: true },
    );
    expect(String(setLastAccessed.mock.calls[0]![0])).toBe(SAMPLE_ID);
    expect(String(navigateMock.mock.calls[0]![0])).toContain(
      `/dashboard/${SAMPLE_ID}/home`,
    );
    expect(navigateMock.mock.calls[0]![1]).toEqual({ forceNavigate: true });
  });

  test("a sample the person already has is opened, and said to be so", async () => {
    jest
      .spyOn(ProjectUtil, "setLastAccessedProjectId")
      .mockImplementation(() => {});
    createMock.mockResolvedValue({
      isSuccess: true,
      value: { projectId: SAMPLE_ID, isNew: false },
    } as never);

    render(
      <ExploreSampleProject
        from={SampleProjectEntryPoint.Home}
        isOffered={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("explore-sample-project-button"));
    });

    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.SampleProjectStarted,
      { from: "home", is_new: false },
    );
  });

  test("a refusal says the server's sentence, and stays", async () => {
    createMock.mockResolvedValue({
      isSuccess: false,
      error:
        "Only admins can create projects on this server, and a sample project is a project. Ask your server admin to add you to a project.",
    } as never);

    render(
      <ExploreSampleProject
        from={SampleProjectEntryPoint.Welcome}
        isOffered={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("explore-sample-project-button"));
    });

    expect(
      screen.getByTestId("explore-sample-project-error"),
    ).toHaveTextContent("Ask your server admin to add you to a project.");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
