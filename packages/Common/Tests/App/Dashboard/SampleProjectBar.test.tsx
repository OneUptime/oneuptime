// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A SAMPLE PROJECT SAYS WHAT IT IS ON EVERY PAGE (issue #6808,
 * Docs/ux/README.md "A sample project says what it is on every page").
 *
 * The bar is the one banner a project shows on every page, so it is held
 * here to drawing nothing for any other project, and to what it is for when
 * it does draw: the sentence, the way back to the person's own project (or
 * to make one), How OneUptime works, and Delete Sample Project behind a
 * confirmation that names the sample. Dark, never an info tint.
 */

const navigateMock: MockFunction = getJestMockFunction();
const sendMock: MockFunction = getJestMockFunction();
const deleteMock: MockFunction = getJestMockFunction();
const openHowItWorksMock: MockFunction = getJestMockFunction();

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
      createSampleProject: getJestMockFunction(),
      deleteSampleProject: (...args: Array<unknown>) => {
        return deleteMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      openHowOneUptimeWorks: (...args: Array<unknown>) => {
        return openHowItWorksMock(...args);
      },
    };
  },
);

import SampleProjectBar, {
  SAMPLE_PROJECT_BAR_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SampleProject/SampleProjectBar";
import { HowOneUptimeWorksOpenedFrom } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import Project from "../../../Models/DatabaseModels/Project";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import ObjectID from "../../../Types/ObjectID";

const SAMPLE_ID: string = "5a3c0000-0000-4000-8000-0000000000a1";
const OWN_ID: string = "5a3c0000-0000-4000-8000-0000000000b1";

const project: (data: Partial<Project>) => Project = (
  data: Partial<Project>,
): Project => {
  const row: Project = new Project();
  Object.assign(row, data);
  return row;
};

const sample: Project = project({
  _id: SAMPLE_ID,
  name: "Sample: Acme Shop",
  isSampleProject: true,
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 60_000),
});
const own: Project = project({
  _id: OWN_ID,
  name: "Northwind",
  isSampleProject: false,
});

const SENTENCE: string =
  "This is a sample project. Nothing here is real, and nobody is notified.";

beforeEach(() => {
  navigateMock.mockReset();
  sendMock.mockReset();
  deleteMock.mockReset();
  openHowItWorksMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("drawn for a sample project alone", () => {
  test("draws nothing for any other project", () => {
    const { container } = render(
      <SampleProjectBar
        project={own}
        projects={[own, sample]}
        onCreateProject={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  test("says what the sample is, as a landmark of the page", () => {
    render(
      <SampleProjectBar
        project={sample}
        projects={[own, sample]}
        onCreateProject={() => {}}
      />,
    );

    const bar: HTMLElement = screen.getByTestId(SAMPLE_PROJECT_BAR_TEST_ID);

    expect(within(bar).getByText(SENTENCE)).toBeInTheDocument();
    expect(bar).toHaveAttribute("role", "region");
    expect(bar).toHaveAttribute("aria-label", SENTENCE);
  });

  test("is the frame of the page, not an info message: dark, with no info tint", () => {
    render(
      <SampleProjectBar
        project={sample}
        projects={[own, sample]}
        onCreateProject={() => {}}
      />,
    );

    const bar: HTMLElement = screen.getByTestId(SAMPLE_PROJECT_BAR_TEST_ID);

    expect(bar.className).toContain("bg-gray-900");
    expect(bar.className).not.toMatch(/bg-(blue|sky|indigo|cyan)-50/);
  });

  test("is valid markup on every page it frames: no block inside a paragraph", () => {
    render(
      <SampleProjectBar
        project={sample}
        projects={[own, sample]}
        onCreateProject={() => {}}
      />,
    );

    const bar: HTMLElement = screen.getByTestId(SAMPLE_PROJECT_BAR_TEST_ID);

    // The Beaker icon draws a div: a paragraph around it is invalid HTML.
    expect(bar.querySelector("svg")).not.toBeNull();
    expect(bar.querySelectorAll("p div, p p, p ul, p section")).toHaveLength(0);
  });
});

describe("the ways out", () => {
  test("back to the person's own project, by name, loading the app again", () => {
    render(
      <SampleProjectBar
        project={sample}
        projects={[sample, own]}
        onCreateProject={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("sample-project-back"));

    expect(screen.getByTestId("sample-project-back")).toHaveTextContent(
      "Back to Northwind",
    );
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toContain(
      `/dashboard/${OWN_ID}/home`,
    );
    expect(navigateMock.mock.calls[0]![1]).toEqual({ forceNavigate: true });
  });

  test("with no project of their own, to make one", () => {
    const onCreateProject: MockFunction = getJestMockFunction();

    render(
      <SampleProjectBar
        project={sample}
        projects={[sample]}
        onCreateProject={onCreateProject as unknown as () => void}
      />,
    );

    expect(screen.queryByTestId("sample-project-back")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sample-project-create-own"));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });

  test("How OneUptime works, the story the sample tells", () => {
    render(
      <SampleProjectBar
        project={sample}
        projects={[sample, own]}
        onCreateProject={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("sample-project-how-it-works"));

    expect(openHowItWorksMock).toHaveBeenCalledWith(
      HowOneUptimeWorksOpenedFrom.SampleProject,
    );
  });
});

describe("Delete Sample Project", () => {
  // The dialog's own button: the bar's opens the dialog.
  const confirmButton: () => HTMLElement = (): HTMLElement => {
    const buttons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Delete Sample Project",
    });

    return buttons[buttons.length - 1]!;
  };

  const openConfirmation: () => void = (): void => {
    render(
      <SampleProjectBar
        project={sample}
        projects={[sample, own]}
        onCreateProject={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("sample-project-delete"));
  };

  test("asks first, naming the sample", () => {
    openConfirmation();

    expect(
      screen.getByText(
        "Are you sure you want to delete Sample: Acme Shop? All its made-up data is deleted for good. You can explore a new sample at any time.",
      ),
    ).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test("deletes it, says so to analytics, and goes back to the person's own project", async () => {
    deleteMock.mockResolvedValue({ isSuccess: true, value: true } as never);
    openConfirmation();

    await act(async () => {
      fireEvent.click(confirmButton());
    });

    const deletedId: ObjectID = deleteMock.mock.calls[0]![0] as ObjectID;

    expect(deletedId.toString()).toBe(SAMPLE_ID);
    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.SampleProjectDeleted,
      { days_kept: 3 },
    );
    expect(String(navigateMock.mock.calls[0]![0])).toContain(
      `/dashboard/${OWN_ID}/home`,
    );
  });

  test("a delete that fails says why, and stays", async () => {
    deleteMock.mockResolvedValue({
      isSuccess: false,
      error: "The server did not answer. Try again in a minute.",
    } as never);
    openConfirmation();

    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(
      screen.getByText("The server did not answer. Try again in a minute."),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
