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
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * A list of playbook runs - every run of the project, a playbook's latest -
 * drew every step of every run: fifty runs made a page nobody could scan.
 * In a list (isCollapsible), a run is its header and one line of how far it
 * got, or the step it stopped at; its steps are a click away (Show steps,
 * Hide steps). A run waiting for approval opens - its steps are what the
 * approver decides on - and one that comes to wait while folded opens too.
 * A case's own runs (the card left as it was) draw their steps whole.
 */

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

import SecurityPlaybookRunCard, {
  RUN_CARD_STEPS_TOGGLE_TEST_ID,
  RUN_CARD_SUMMARY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunCard";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";

const RUN_ID: string = "25000000-0000-4000-8000-000000000031";
const ME: string = "26000000-0000-4000-8000-000000000002";

function run(data: {
  status: SecurityPlaybookRunStatus;
  stepStatuses: Array<SecurityPlaybookStepStatus>;
  errorMessage?: string | undefined;
}): SecurityPlaybookRun {
  const item: SecurityPlaybookRun = new SecurityPlaybookRun();
  item._id = RUN_ID;
  item.playbookName = "Enrich New Cases";
  item.status = data.status;
  item.currentStepIndex = data.stepStatuses.findIndex(
    (status: SecurityPlaybookStepStatus): boolean => {
      return status === SecurityPlaybookStepStatus.WaitingForApproval;
    },
  );
  item.steps = [
    {
      id: "check",
      action: SecurityPlaybookActionType.CheckThreatIntel,
      config: {},
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
    {
      id: "activity",
      action: SecurityPlaybookActionType.LookUpEntityActivity,
      config: {},
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
    {
      id: "note",
      action: SecurityPlaybookActionType.AddCaseNote,
      config: { note: "Looked." },
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ] as unknown as JSONArray;
  item.stepResults = data.stepStatuses.map(
    (status: SecurityPlaybookStepStatus, index: number) => {
      return {
        stepId: ["check", "activity", "note"][index],
        status,
        message: `Step ${index + 1} said something.`,
      };
    },
  ) as unknown as JSONArray;
  if (data.errorMessage) {
    item.errorMessage = data.errorMessage;
  }
  item.createdAt = new Date(Date.now() - 60 * 60 * 1000);
  item.startedAt = item.createdAt;
  return item;
}

const SUCCEEDED: Array<SecurityPlaybookStepStatus> = [
  SecurityPlaybookStepStatus.Succeeded,
  SecurityPlaybookStepStatus.Succeeded,
  SecurityPlaybookStepStatus.Succeeded,
];

function card(): HTMLElement {
  return screen.getByTestId("security-playbook-run-card");
}

function toggle(): HTMLElement | null {
  return screen.queryByTestId(RUN_CARD_STEPS_TOGGLE_TEST_ID);
}

function stepsShown(): boolean {
  return within(card()).queryByText("Step 1 said something.") !== null;
}

async function renderCard(
  item: SecurityPlaybookRun,
  isCollapsible?: boolean,
): Promise<ReturnType<typeof render>> {
  let view: ReturnType<typeof render> | null = null;

  await act(async () => {
    view = render(
      <SecurityPlaybookRunCard
        run={item}
        onChanged={(): void => {
          // Nothing to read again here.
        }}
        {...(isCollapsible === undefined ? {} : { isCollapsible })}
      />,
    );
  });

  return view!;
}

beforeEach(() => {
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(ME));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a run in a list of runs", () => {
  test("a finished run is its header and a line of how far it got, its steps folded", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Succeeded,
        stepStatuses: SUCCEEDED,
      }),
      true,
    );

    expect(card()).toHaveTextContent("Enrich New Cases");
    expect(screen.getByTestId(RUN_CARD_SUMMARY_TEST_ID)).toHaveTextContent(
      "3 of 3 steps done",
    );
    expect(stepsShown()).toBe(false);
    expect(toggle()).toHaveTextContent("Show steps");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("Show steps opens them, and says Hide steps; Hide steps folds them again", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Succeeded,
        stepStatuses: SUCCEEDED,
      }),
      true,
    );

    await act(async () => {
      fireEvent.click(toggle()!);
    });

    expect(stepsShown()).toBe(true);
    expect(toggle()).toHaveTextContent("Hide steps");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    // The button names what it opens.
    const steps: HTMLElement | null = document.getElementById(
      toggle()!.getAttribute("aria-controls") || "",
    );
    expect(steps).not.toBeNull();
    expect(steps).toHaveTextContent("Step 1 said something.");

    await act(async () => {
      fireEvent.click(toggle()!);
    });

    expect(stepsShown()).toBe(false);
  });

  test("a failed run says the step it stopped at, in red, by its number and its name", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Failed,
        stepStatuses: [
          SecurityPlaybookStepStatus.Succeeded,
          SecurityPlaybookStepStatus.Failed,
          SecurityPlaybookStepStatus.Failed,
        ],
        errorMessage: "Step 2 (Look Up Entity Activity) failed.",
      }),
      true,
    );

    const summary: HTMLElement = screen.getByTestId(RUN_CARD_SUMMARY_TEST_ID);
    expect(summary).toHaveTextContent(
      "Stopped at step 2: Look up entity activity",
    );
    expect(summary.className).toContain("text-red-700");
    // The run's own message waits with its steps.
    expect(card()).not.toHaveTextContent(
      "Step 2 (Look Up Entity Activity) failed.",
    );
  });

  test("a run part way through says how far it got", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Running,
        stepStatuses: [
          SecurityPlaybookStepStatus.Succeeded,
          SecurityPlaybookStepStatus.Running,
        ],
      }),
      true,
    );

    expect(screen.getByTestId(RUN_CARD_SUMMARY_TEST_ID)).toHaveTextContent(
      "1 of 3 steps done",
    );
    // Its Cancel Run is in its header, steps folded or not.
    expect(
      within(card()).getByRole("button", { name: "Cancel Run" }),
    ).toBeInTheDocument();
  });

  test("a run waiting for approval opens: its steps are what the approver decides on", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.WaitingForApproval,
        stepStatuses: [
          SecurityPlaybookStepStatus.Succeeded,
          SecurityPlaybookStepStatus.WaitingForApproval,
        ],
      }),
      true,
    );

    expect(stepsShown()).toBe(true);
    expect(toggle()).toHaveTextContent("Hide steps");
    expect(card()).toHaveTextContent(
      "This run is waiting for someone to approve its next step before it does anything.",
    );
    expect(
      within(card()).getByRole("button", { name: "Approve" }),
    ).toBeInTheDocument();
  });

  test("a folded run that comes to wait for approval opens", async () => {
    const view: ReturnType<typeof render> = await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Running,
        stepStatuses: [SecurityPlaybookStepStatus.Succeeded],
      }),
      true,
    );
    expect(stepsShown()).toBe(false);

    await act(async () => {
      view.rerender(
        <SecurityPlaybookRunCard
          run={run({
            status: SecurityPlaybookRunStatus.WaitingForApproval,
            stepStatuses: [
              SecurityPlaybookStepStatus.Succeeded,
              SecurityPlaybookStepStatus.WaitingForApproval,
            ],
          })}
          onChanged={(): void => {
            // Nothing to read again here.
          }}
          isCollapsible={true}
        />,
      );
    });

    expect(stepsShown()).toBe(true);
  });
});

describe("a case's own runs", () => {
  test("draw their steps whole, with no line and no toggle", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Succeeded,
        stepStatuses: SUCCEEDED,
      }),
    );

    expect(stepsShown()).toBe(true);
    expect(toggle()).toBeNull();
    expect(screen.queryByTestId(RUN_CARD_SUMMARY_TEST_ID)).toBeNull();
  });

  test("draw a failed run's message under its steps, as before", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Failed,
        stepStatuses: [
          SecurityPlaybookStepStatus.Succeeded,
          SecurityPlaybookStepStatus.Failed,
        ],
        errorMessage: "Step 2 (Look Up Entity Activity) failed.",
      }),
      false,
    );

    expect(card()).toHaveTextContent(
      "Step 2 (Look Up Entity Activity) failed.",
    );
  });
});

/*
 * The header of a run: its words take the row and wrap inside it, and its
 * buttons keep the row's top right. A long case title used to push Approve
 * and Reject onto a row of their own under an empty band (Playbook Runs,
 * Waiting for Approval at 1280), and in German Cancel Run fell to the
 * left. jsdom lays nothing out, so these hold the classes that do it; the
 * offline browser suite measures the real page.
 */
describe("a run's header", () => {
  function words(): HTMLElement {
    return within(card())
      .getByText("Enrich New Cases")
      .closest(".basis-64") as HTMLElement;
  }

  test("its words grow to fill the row from a 16rem start, so the buttons stay beside them", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.WaitingForApproval,
        stepStatuses: [
          SecurityPlaybookStepStatus.Succeeded,
          SecurityPlaybookStepStatus.WaitingForApproval,
        ],
      }),
      true,
    );

    expect(words()).not.toBeNull();
    expect(words().className.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "grow", "basis-64"]),
    );
    // The row still wraps: on a phone the buttons drop under the words.
    expect(words().parentElement!.className.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "justify-between"]),
    );
  });

  test("Approve and Reject sit together at the row's right, never squeezed", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.WaitingForApproval,
        stepStatuses: [
          SecurityPlaybookStepStatus.Succeeded,
          SecurityPlaybookStepStatus.WaitingForApproval,
        ],
      }),
      true,
    );

    const approve: HTMLElement = within(card()).getByRole("button", {
      name: "Approve",
    });
    const reject: HTMLElement = within(card()).getByRole("button", {
      name: "Reject",
    });
    const buttons: HTMLElement = approve.closest(".ms-auto") as HTMLElement;

    expect(buttons).not.toBeNull();
    expect(buttons).toContainElement(reject);
    expect(buttons.className.split(" ")).toEqual(
      expect.arrayContaining(["ms-auto", "flex", "flex-shrink-0"]),
    );
    // A sibling of the words, in the header's own row.
    expect(buttons.parentElement).toBe(words().parentElement);
  });

  test("Cancel Run sits where Approve and Reject do, at the row's right", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Running,
        stepStatuses: [SecurityPlaybookStepStatus.Succeeded],
      }),
      true,
    );

    const cancel: HTMLElement = within(card()).getByRole("button", {
      name: "Cancel Run",
    });
    const place: HTMLElement = cancel.closest(".ms-auto") as HTMLElement;

    expect(place).not.toBeNull();
    expect(place.className.split(" ")).toEqual(
      expect.arrayContaining(["ms-auto", "flex", "flex-shrink-0"]),
    );
    expect(place.parentElement).toBe(words().parentElement);
  });

  test("a finished run has no buttons, and its words take the whole row", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Succeeded,
        stepStatuses: SUCCEEDED,
      }),
      true,
    );

    expect(words().parentElement!.children).toHaveLength(1);
    expect(
      within(card()).queryByRole("button", { name: "Cancel Run" }),
    ).toBeNull();
  });
});

/*
 * On a playbook's own page every run is that playbook's: the page names
 * each run by its case instead (heading), and the playbook's name is not
 * repeated on every card.
 */
describe("a run named by its heading", () => {
  test("the heading takes the playbook name's place, before the status", async () => {
    await act(async () => {
      render(
        <SecurityPlaybookRunCard
          run={run({
            status: SecurityPlaybookRunStatus.Succeeded,
            stepStatuses: SUCCEEDED,
          })}
          onChanged={(): void => {
            // Nothing to read again here.
          }}
          isCollapsible={true}
          heading={<a href="/case-142">CASE-142 Password spray</a>}
        />,
      );
    });

    const heading: HTMLElement = within(card()).getByRole("link", {
      name: "CASE-142 Password spray",
    });

    expect(card()).not.toHaveTextContent("Enrich New Cases");
    // First in the header's line, as the playbook's name was.
    expect(heading.parentElement!.firstElementChild).toBe(heading);
    expect(
      within(card()).getByTestId(RUN_CARD_SUMMARY_TEST_ID),
    ).toHaveTextContent("3 of 3 steps done");
  });

  test("without a heading the card names its playbook, as on Playbook Runs", async () => {
    await renderCard(
      run({
        status: SecurityPlaybookRunStatus.Succeeded,
        stepStatuses: SUCCEEDED,
      }),
      true,
    );

    expect(card()).toHaveTextContent("Enrich New Cases");
  });
});
