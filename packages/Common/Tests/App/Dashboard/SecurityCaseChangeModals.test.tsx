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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The dialogs a case is worked with from a list's row, Bulk Actions and the
 * case's own header (SecurityCaseChangeModals): Assign to Someone Else,
 * Change Status and Change Priority, drawn for real - the people picker,
 * the dropdowns, the verdict cards - and driven as a person drives them.
 *
 * Pinned: what each asks, for one case and for several; what it hands over
 * once submitted; that Change Status asks what Close Case asks when the
 * status closes the case (the verdict, OneUptime AI's read over it, the
 * closing note) and its button says Close Case; that a case's own status
 * and priority are listed as Current and never picked again; and that a
 * save that fails says why in the dialog, keeping what was picked.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

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

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../UI/Utils/ModelAPI/ModelAPI",
  ) as { default: Record<string, unknown> };

  return {
    __esModule: true,
    default: {
      ...actual.default,
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import {
  AssignSecurityCaseModal,
  ChangeSecurityCasePriorityModal,
  ChangeSecurityCaseStatusModal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseChangeModals";
import {
  SecurityCaseAssigneePick,
  SecurityCaseStatusPick,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseChanges";
import { SecurityCaseValueLists } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseValues";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestStatus,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const WHITESPACE: RegExp = /\s+/g;
const DIEGO: string = "80000000-0000-4000-8000-000000000002";
const PRIYA: string = "80000000-0000-4000-8000-000000000003";
const SOC_TEAM: string = "81000000-0000-4000-8000-000000000001";
const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";

const VALUES: SecurityCaseValueLists = {
  priorities: buildDefaultTestPriorities(),
  statuses: buildDefaultTestStatuses(),
};

function buildCase(
  number: number,
  fields: Partial<SecurityCase> = {},
): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = `20000000-0000-4000-8000-000000000${number}`;
  securityCase.caseNumberWithPrefix = `CASE-${number}`;
  securityCase.title = `Case number ${number}`;
  securityCase.securityCaseStatusId = testStatusId(
    SecurityCaseStage.Acknowledged,
  );
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.High,
  );
  Object.assign(securityCase, fields);
  return securityCase;
}

function person(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

// The project's members and teams, as the people picker reads them.
function serveDirectory(): void {
  getListMock.mockImplementation(async (request: unknown): Promise<unknown> => {
    const { modelType, query } = request as {
      modelType: unknown;
      query: Record<string, unknown>;
    };

    if (modelType === TeamMember) {
      const members: Array<TeamMember> = [
        person(DIEGO, "Diego Alvarez", "diego.alvarez@example.com"),
        person(PRIYA, "Priya Nair", "priya.nair@example.com"),
      ]
        .filter((user: User): boolean => {
          const ids: unknown = query["userId"];

          return (
            !(ids instanceof Includes) ||
            (ids.values as Array<string>).includes(user._id!.toString())
          );
        })
        .map((user: User): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        });

      return { data: members, count: members.length, skip: 0, limit: 50 };
    }

    if (modelType === Team) {
      const team: Team = new Team();
      team._id = SOC_TEAM;
      team.name = "SOC Tier 2";

      return { data: [team], count: 1, skip: 0, limit: 50 };
    }

    return { data: [], count: 0, skip: 0, limit: 50 };
  });
}

function dialog(): HTMLElement {
  return screen.getAllByRole("dialog")[0]!;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
}

// Picks one person or team in the assign dialog's people picker.
async function pickAssignee(name: string): Promise<void> {
  const button: HTMLElement = within(dialog()).getByRole("button", {
    name: /Choose someone or a team|Change/,
  });

  await act(async () => {
    fireEvent.click(button);
  });

  const search: HTMLElement = await screen.findByRole("dialog", {
    name: "Choose someone or a team",
  });
  const options: Array<HTMLElement> =
    await within(search).findAllByRole("option");
  const option: HTMLElement | undefined = options.find(
    (candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(name);
    },
  );

  expect(option).toBeDefined();

  await act(async () => {
    fireEvent.click(option!);
  });
}

// The dropdown's options as listed: their text, and whether each can be picked.
function openDropdown(): Array<{ text: string; isDisabled: boolean }> {
  fireEvent.keyDown(within(dialog()).getByRole("combobox"), {
    key: "ArrowDown",
  });

  return screen
    .getAllByRole("option")
    .map((option: HTMLElement): { text: string; isDisabled: boolean } => {
      return {
        text: (option.textContent || "").trim(),
        isDisabled: option.getAttribute("aria-disabled") === "true",
      };
    });
}

async function choose(optionText: string): Promise<void> {
  fireEvent.keyDown(within(dialog()).getByRole("combobox"), {
    key: "ArrowDown",
  });

  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim().startsWith(optionText);
    });

  expect(option).toBeDefined();

  await act(async () => {
    fireEvent.mouseDown(option!);
    fireEvent.click(option!);
  });
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
  await settle();
}

function submitText(): string {
  return (
    within(dialog()).getByTestId("modal-footer-submit-button").textContent || ""
  ).trim();
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/security-events/cases`,
  );
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  serveDirectory();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  getListMock.mockReset();
});

describe("Assign to Someone Else", () => {
  function draw(
    securityCases: Array<SecurityCase>,
    onSubmit: (pick: SecurityCaseAssigneePick) => Promise<void>,
  ): MockFunction {
    const onClose: MockFunction = getJestMockFunction();

    render(
      <AssignSecurityCaseModal
        securityCases={securityCases}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    return onClose;
  }

  test("for one case: names it by number, and asks for one person or one team in a single picker - people, then teams", async () => {
    draw([buildCase(141)], async () => {});

    expect(
      within(dialog()).getByRole("heading", { name: "Assign to Someone Else" }),
    ).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(
      "Pick a person to work CASE-141, or a team to pick it up.",
    );
    /*
     * The field is its name and the picker, nothing more: the sentence over
     * it already says what a team pick does.
     */
    expect(
      (within(dialog()).getByTestId("modal-content").textContent || "")
        .replace(WHITESPACE, " ")
        .trim(),
    ).toBe("Person or Team Choose someone or a team");

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("button", {
          name: "Choose someone or a team",
        }),
      );
    });

    const search: HTMLElement = await screen.findByRole("dialog", {
      name: "Choose someone or a team",
    });

    await within(search).findAllByRole("option");

    // People first, then teams, each under a heading of its own.
    expect(within(search).getByText("People")).toBeInTheDocument();
    expect(within(search).getByText("Teams")).toBeInTheDocument();
    expect(
      within(search)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return (option.textContent || "").split("@")[0]!;
        }),
    ).toEqual([
      expect.stringContaining("Diego Alvarez"),
      expect.stringContaining("Priya Nair"),
      expect.stringContaining("SOC Tier 2"),
    ]);
    expect(
      within(search).getByPlaceholderText("Search people or teams..."),
    ).toBeInTheDocument();
  });

  test("a person picked: hands the case to that person", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);
    draw([buildCase(141)], onSubmit as never);

    await pickAssignee("Diego Alvarez");
    await submit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      userId: DIEGO,
      teamId: undefined,
    });
  });

  test("a team picked: hands the case to the team", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);
    draw([buildCase(141)], onSubmit as never);

    await pickAssignee("SOC Tier 2");
    await submit();

    expect(onSubmit.mock.calls[0]![0]).toEqual({
      userId: undefined,
      teamId: SOC_TEAM,
    });
  });

  test("one pick at most: a team picked after a person takes their place", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);
    draw([buildCase(141)], onSubmit as never);

    await pickAssignee("Diego Alvarez");
    await pickAssignee("SOC Tier 2");

    expect(within(dialog()).getAllByTestId("people-chip")).toHaveLength(1);

    await submit();

    expect(onSubmit.mock.calls[0]![0]).toEqual({
      userId: undefined,
      teamId: SOC_TEAM,
    });
  });

  test("nobody picked: the dialog says what is missing and hands nothing over", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    draw([buildCase(141)], onSubmit as never);

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog()).toHaveTextContent(/Person or Team is required/);
  });

  test("a save that fails says why in the dialog, with the pick still picked, and can be tried again", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit
      .mockImplementationOnce((async (): Promise<void> => {
        throw new Error(
          "You do not have permission to update this Security Case.",
        );
      }) as never)
      .mockImplementationOnce((async (): Promise<void> => {}) as never);
    const onClose: MockFunction = draw([buildCase(141)], onSubmit as never);

    await pickAssignee("Priya Nair");
    await submit();

    await waitFor(() => {
      expect(dialog()).toHaveTextContent(
        "You do not have permission to update this Security Case.",
      );
    });
    // Still open, the person picked still picked.
    expect(within(dialog()).getByTestId("people-chip")).toHaveTextContent(
      "Priya Nair",
    );
    expect(onClose).not.toHaveBeenCalled();

    await submit();

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]![0]).toEqual({
      userId: PRIYA,
      teamId: undefined,
    });
  });

  test("for several cases: counts them", () => {
    draw([buildCase(141), buildCase(138), buildCase(137)], async () => {});

    expect(dialog()).toHaveTextContent(
      "Pick a person to work the 3 selected cases, or a team to pick them up.",
    );
  });

  test("Cancel closes it, handing nothing over", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const onClose: MockFunction = draw([buildCase(141)], onSubmit as never);

    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Change Status", () => {
  function draw(
    securityCases: Array<SecurityCase>,
    onSubmit: (pick: SecurityCaseStatusPick) => Promise<void>,
    values: SecurityCaseValueLists = VALUES,
  ): void {
    render(
      <ChangeSecurityCaseStatusModal
        securityCases={securityCases}
        values={values}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
  }

  test("for one case: the project's statuses in order, its own marked Current and not picked again", () => {
    draw([buildCase(141)], async () => {});

    expect(dialog()).toHaveTextContent("Pick the new status for CASE-141.");
    expect(openDropdown()).toEqual([
      { text: "New", isDisabled: false },
      { text: "InvestigatingCurrent", isDisabled: true },
      { text: "Contained", isDisabled: false },
      { text: "Closed", isDisabled: false },
    ]);
  });

  test("a status between open ones moves the case there, and nothing is asked about a verdict", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);
    draw([buildCase(141)], onSubmit as never);

    await choose("Contained");

    expect(within(dialog()).queryByText("Verdict")).toBeNull();
    expect(within(dialog()).queryByText("Closing Note")).toBeNull();
    expect(submitText()).toBe("Change Status");

    await submit();

    expect(onSubmit.mock.calls[0]![0]).toEqual({
      statusId: TEST_STATUS_IDS[SecurityCaseStage.Contained],
    });
  });

  test("a status that closes the case asks what Close Case asks, starts on OneUptime AI's suggestion, and the button says Close Case", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);
    draw(
      [buildCase(137, { aiVerdict: SecurityCaseAiVerdict.LikelyBenign })],
      onSubmit as never,
    );

    expect(submitText()).toBe("Change Status");

    await choose("Closed");

    expect(within(dialog()).getByText("Verdict")).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(
      "OneUptime AI read this case as Likely Benign. Pick what you found.",
    );
    // One case: nothing of the several-cases sentences.
    expect(dialog()).not.toHaveTextContent("Each case this closes");
    expect(dialog()).toHaveTextContent(
      "What was found and what was done, for whoever reads this case next.",
    );
    expect(within(dialog()).getAllByRole("radio")).toHaveLength(4);
    // OneUptime AI's read suggests Benign Positive; a person still picks.
    expect(
      within(dialog()).getByRole("radio", { name: /Benign Positive/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(dialog()).toHaveTextContent("Closing Note");
    expect(submitText()).toBe("Close Case");

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("radio", { name: /False Positive/ }),
      );
    });
    await act(async () => {
      fireEvent.change(within(dialog()).getByRole("textbox"), {
        target: { value: "The rule matched our own scanner." },
      });
    });
    await submit();

    expect(onSubmit.mock.calls[0]![0]).toEqual({
      statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
      verdict: SecurityCaseVerdict.FalsePositive,
      closingNote: "The rule matched our own scanner.",
    });
  });

  test("picking an open status again after a closing one takes the verdict away, and the button says Change Status", async () => {
    draw([buildCase(141)], async () => {});

    await choose("Closed");
    expect(submitText()).toBe("Close Case");

    await choose("Contained");

    expect(within(dialog()).queryByText("Verdict")).toBeNull();
    expect(submitText()).toBe("Change Status");
  });

  test("with the project's AI off, nothing of OneUptime AI's read: the verdict starts on True Positive", async () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue({ enableAi: false } as never);
    draw(
      [buildCase(137, { aiVerdict: SecurityCaseAiVerdict.LikelyBenign })],
      async () => {},
    );

    await choose("Closed");

    expect(dialog()).not.toHaveTextContent("OneUptime AI");
    expect(
      within(dialog()).getByRole("radio", { name: /True Positive/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("a closed case moving to another closing status keeps its verdict: nothing is asked", async () => {
    const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
    statuses[3]!.order = 5;
    statuses.push(
      buildTestStatus({
        id: DUPLICATE_ID,
        name: "Closed - Duplicate",
        order: 6,
        color: "#6b7280",
      }),
    );
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);

    draw(
      [
        buildCase(136, {
          securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
          verdict: SecurityCaseVerdict.TruePositive,
        }),
      ],
      onSubmit as never,
      { priorities: VALUES.priorities, statuses },
    );

    await choose("Closed - Duplicate");

    expect(within(dialog()).queryByText("Verdict")).toBeNull();
    expect(submitText()).toBe("Change Status");

    await submit();

    expect(onSubmit.mock.calls[0]![0]).toEqual({ statusId: DUPLICATE_ID });
  });

  test("for several cases: counts them, marks none Current, and asks a verdict nobody picked for them", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);
    draw(
      [
        buildCase(141),
        buildCase(138, {
          securityCaseStatusId: testStatusId(SecurityCaseStage.New),
        }),
      ],
      onSubmit as never,
    );

    // What to pick, as Change Priority says it; the verdict says what closing does.
    expect(
      within(dialog()).getByTestId("modal-description"),
    ).toHaveTextContent(/^Pick the new status for the 2 selected cases\.$/);
    expect(dialog()).not.toHaveTextContent("Each case this closes");
    expect(
      openDropdown().map((option: { text: string; isDisabled: boolean }) => {
        return option;
      }),
    ).toEqual([
      { text: "New", isDisabled: false },
      { text: "Investigating", isDisabled: false },
      { text: "Contained", isDisabled: false },
      { text: "Closed", isDisabled: false },
    ]);

    await choose("Closed");

    // Several keep Change Status: the verdict field says they close.
    expect(submitText()).toBe("Change Status");
    expect(
      within(dialog())
        .getAllByRole("radio")
        .filter((radio: HTMLElement): boolean => {
          return radio.getAttribute("aria-checked") === "true";
        }),
    ).toHaveLength(0);
    // Over the verdict: the one pick, and the one note, go on every case it closes.
    expect(dialog()).toHaveTextContent(
      "Each case this closes gets this verdict and closing note.",
    );
    expect(dialog()).toHaveTextContent("What was found and what was done.");
    expect(dialog()).not.toHaveTextContent("for whoever reads this case next");

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("radio", { name: /Undetermined/ }),
      );
    });
    await submit();

    expect(onSubmit.mock.calls[0]![0]).toEqual({
      statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
      verdict: SecurityCaseVerdict.Undetermined,
      closingNote: undefined,
    });
  });

  test("a save that fails says why in the dialog, the status still picked", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockImplementation((async (): Promise<void> => {
      throw new Error("The case was deleted.");
    }) as never);
    draw([buildCase(141)], onSubmit as never);

    await choose("Contained");
    await submit();

    await waitFor(() => {
      expect(dialog()).toHaveTextContent("The case was deleted.");
    });
    expect(
      within(dialog()).getByTestId("dropdown-value-label"),
    ).toHaveTextContent("Contained");
  });
});

describe("Change Priority", () => {
  function draw(
    securityCases: Array<SecurityCase>,
    onSubmit: (priorityId: string) => Promise<void>,
  ): void {
    render(
      <ChangeSecurityCasePriorityModal
        securityCases={securityCases}
        values={VALUES}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
  }

  test("for one case: most urgent first, its own marked Current and not picked again", () => {
    draw([buildCase(141)], async () => {});

    expect(dialog()).toHaveTextContent("Pick the new priority for CASE-141.");
    expect(openDropdown()).toEqual([
      { text: "Critical", isDisabled: false },
      { text: "HighCurrent", isDisabled: true },
      { text: "Medium", isDisabled: false },
      { text: "Low", isDisabled: false },
      { text: "Informational", isDisabled: false },
    ]);
  });

  test("a priority picked: hands it over", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    onSubmit.mockResolvedValue(undefined as never);
    draw([buildCase(141)], onSubmit as never);

    await choose("Critical");
    await submit();

    expect(onSubmit.mock.calls[0]![0]).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    );
  });

  test("for several cases: counts them, and needs a priority picked", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    draw([buildCase(141), buildCase(138)], onSubmit as never);

    expect(dialog()).toHaveTextContent(
      "Pick the new priority for the 2 selected cases.",
    );

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog()).toHaveTextContent(/Priority is required/);
  });
});
