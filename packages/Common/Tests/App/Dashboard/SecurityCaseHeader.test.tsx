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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A case's header, on its own: what it says and offers, in full on the
 * case's Overview and compact on its other pages, for each kind of case and
 * reader. Its layout's classes are pinned in App's
 * SecurityCaseHeaderLayout.test.ts; what its actions do on the page, in
 * SecurityCaseViewLayout.test.tsx.
 */

let permissionsForTest: Array<string> = ["ProjectOwner"];

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "case-description" },
        props.text,
      );
    },
  };
});

import SecurityCaseHeader, {
  ComponentProps as HeaderProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseHeader";
import {
  SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
  SECURITY_CASE_HEADER_CLASS_NAME,
  SECURITY_CASE_HEADER_COMPACT_TITLE_CLASS_NAME,
  SECURITY_CASE_HEADER_FACTS_CLASS_NAME,
  SECURITY_CASE_HEADER_TITLE_CLASS_NAME,
  SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseHeaderLayout";
import { SECURITY_CASE_STEPS_CONTAINER_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseStatusStepper";
import {
  DETAIL_LABELS_TEST_ID,
  TABLE_LABELS_TEST_ID,
} from "../../../UI/Components/Label/Labels";
import Label from "../../../Models/DatabaseModels/Label";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import User from "../../../UI/Utils/User";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestPriority,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const ME: string = "80000000-0000-4000-8000-000000000001";
const SOMEONE_ELSE: string = "80000000-0000-4000-8000-000000000002";

function buildCase(fields: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = "20000000-0000-4000-8000-000000000142";
  securityCase.caseNumberWithPrefix = "CASE-142";
  securityCase.title = "Password spray against Okta from 203.0.113.47";
  securityCase.description = "A burst of failed Okta sign-ins.";
  securityCase.securityCaseStatusId = testStatusId(
    SecurityCaseStage.Acknowledged,
  );
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  securityCase.createdAt = new Date("2026-10-14T08:48:00.000Z");
  Object.assign(securityCase, fields);
  return securityCase;
}

interface Handlers {
  onAssignToMe: MockFunction;
  onAssignToSomeoneElse: MockFunction;
  onChangeStatus: MockFunction;
  onPickStatus: MockFunction;
  onChangePriority: MockFunction;
  onRunPlaybook: MockFunction;
  onDeclareIncident: MockFunction;
  onEdit: MockFunction;
  onDelete: MockFunction;
}

let handlers: Handlers;

function draw(
  props: Partial<HeaderProps> & { securityCase: SecurityCase },
  values: {
    priorities?: Array<SecurityCasePriority>;
    statuses?: Array<SecurityCaseStatus>;
  } = {},
): void {
  render(
    <MemoryRouter>
      <SecurityCaseHeader
        values={{
          priorities: values.priorities || buildDefaultTestPriorities(),
          statuses: values.statuses || buildDefaultTestStatuses(),
        }}
        isWorking={false}
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  );
}

async function openMore(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("security-case-more"));
  });

  return screen.getByRole("menu");
}

beforeEach(() => {
  permissionsForTest = ["ProjectOwner"];
  handlers = {
    onAssignToMe: getJestMockFunction(),
    onAssignToSomeoneElse: getJestMockFunction(),
    onChangeStatus: getJestMockFunction(),
    onPickStatus: getJestMockFunction(),
    onChangePriority: getJestMockFunction(),
    onRunPlaybook: getJestMockFunction(),
    onDeclareIncident: getJestMockFunction(),
    onEdit: getJestMockFunction(),
    onDelete: getJestMockFunction(),
  };
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(ME));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("in full, on the case's Overview", () => {
  test("says what the case is, how urgent, where it stands, who has it - and draws the status steps", () => {
    const label: Label = new Label();
    label._id = "60000000-0000-4000-8000-000000000001";
    label.name = "okta";
    label.color = new Color("#4f46e5");

    draw({ securityCase: buildCase({ labels: [label] }), layout: "full" });

    const header: HTMLElement = screen.getByTestId("security-case-header");

    expect(header).toHaveAttribute("data-layout", "full");
    expect(within(header).getByText("CASE-142")).toBeInTheDocument();
    expect(within(header).getByText("Critical")).toBeInTheDocument();
    // Its status pill, and its step among the status steps.
    expect(within(header).getAllByText("Investigating")).toHaveLength(2);
    expect(
      within(header).getByRole("heading", {
        level: 1,
        name: "Password spray against Okta from 203.0.113.47",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("case-description")).toHaveTextContent(
      "A burst of failed Okta sign-ins.",
    );
    expect(within(header).getByText("okta")).toBeInTheDocument();
    expect(
      screen.getByTestId("security-case-status-steps"),
    ).toBeInTheDocument();

    for (const fact of [
      "Assignee",
      "Team",
      "Opened By",
      "Opened",
      "Last Detection",
    ]) {
      expect(within(header).getByText(fact)).toBeInTheDocument();
    }
  });

  test("the pills, the title and the actions are one row's children, in that order in the page: the title is read before the actions", () => {
    draw({ securityCase: buildCase(), layout: "full" });

    const title: HTMLElement = screen.getByTestId("security-case-title");
    const actions: HTMLElement = screen.getByTestId("security-case-actions");
    const row: HTMLElement = title.parentElement as HTMLElement;
    const chips: HTMLElement = within(row)
      .getByText("CASE-142")
      .closest("div") as HTMLElement;

    expect(row.className).toBe(SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME);
    expect(Array.from(row.children)).toEqual([chips, title, actions]);
    expect(chips.className).toBe(SECURITY_CASE_HEADER_CHIPS_CLASS_NAME);
    expect(actions.className).toBe(SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME);
  });

  test("the title in full, never cut short, on a line of its own", () => {
    const longTitle: string =
      "Password spray against Okta from 203.0.113.47, followed by a successful sign-in as k.morgan@acme-commerce.example and a new MFA device enrolled";

    draw({ securityCase: buildCase({ title: longTitle }), layout: "full" });

    const title: HTMLElement = screen.getByTestId("security-case-title");

    expect(title).toHaveTextContent(longTitle);
    expect(title.className).toBe(SECURITY_CASE_HEADER_TITLE_CLASS_NAME);
    expect(title).not.toHaveClass(
      SECURITY_CASE_HEADER_COMPACT_TITLE_CLASS_NAME,
    );
    // No hover needed for what the line already says.
    expect(title).not.toHaveAttribute("title");
  });

  test("the labels side by side, wrapping, as the page about a record draws them - not one to a line as a table's row lists them", () => {
    const labels: Array<Label> = [
      "okta",
      "credential access",
      "customer data",
    ].map((name: string, index: number): Label => {
      const label: Label = new Label();
      label._id = `60000000-0000-4000-8000-00000000000${index + 1}`;
      label.name = name;
      label.color = new Color("#4f46e5");
      return label;
    });

    draw({ securityCase: buildCase({ labels }), layout: "full" });

    const header: HTMLElement = screen.getByTestId("security-case-header");
    const drawn: HTMLElement = within(header).getByTestId(
      DETAIL_LABELS_TEST_ID,
    );

    expect(within(header).queryByTestId(TABLE_LABELS_TEST_ID)).toBeNull();
    expect(drawn).toHaveClass("flex", "flex-wrap");
    for (const name of ["okta", "credential access", "customer data"]) {
      expect(within(drawn).getByText(name)).toBeInTheDocument();
    }
    // Every one shown: no "N more labels" fold in a header.
    expect(within(header).queryByText(/more label/)).toBeNull();
  });

  test("the facts and the status steps are laid out by the width the header has, not the window's", () => {
    draw({ securityCase: buildCase(), layout: "full" });

    const header: HTMLElement = screen.getByTestId("security-case-header");
    const facts: HTMLElement = within(header)
      .getByText("Assignee")
      .closest("dl") as HTMLElement;

    expect(facts.className).toBe(SECURITY_CASE_HEADER_FACTS_CLASS_NAME);
    expect(
      (
        screen.getByTestId("security-case-status-steps")
          .parentElement as HTMLElement
      ).className,
    ).toBe(SECURITY_CASE_STEPS_CONTAINER_CLASS_NAME);
  });

  test("is the full header when no layout is asked for", () => {
    draw({ securityCase: buildCase() });

    expect(screen.getByTestId("security-case-header")).toHaveAttribute(
      "data-layout",
      "full",
    );
  });

  test("a status step moves the case there", async () => {
    draw({ securityCase: buildCase(), layout: "full" });

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-step-2"));
    });

    expect(handlers.onChangeStatus).toHaveBeenCalledTimes(1);
    expect(
      (handlers.onChangeStatus.mock.calls[0]![0] as SecurityCaseStatus).name,
    ).toBe("Contained");
  });
});

describe("compact, on the case's other pages", () => {
  test("keeps the number, the pills, the title and every action, and leaves the rest to the Overview", () => {
    draw({ securityCase: buildCase(), layout: "compact" });

    const header: HTMLElement = screen.getByTestId("security-case-header");

    expect(header).toHaveAttribute("data-layout", "compact");
    expect(header.className).toBe(SECURITY_CASE_HEADER_CLASS_NAME);
    expect(within(header).getByText("CASE-142")).toBeInTheDocument();
    expect(within(header).getByText("Critical")).toBeInTheDocument();
    expect(within(header).getByText("Investigating")).toBeInTheDocument();
    expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Password spray against Okta from 203.0.113.47",
    );

    expect(
      within(screen.getByTestId("security-case-actions"))
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return (
            button.getAttribute("aria-label") ||
            button.textContent ||
            ""
          ).trim();
        }),
    ).toEqual([
      "Assign to Me",
      "Run Playbook",
      "Declare Incident",
      "Close Case",
      "More case actions",
    ]);

    expect(screen.queryByTestId("case-description")).toBeNull();
    expect(screen.queryByTestId("security-case-status-steps")).toBeNull();
    expect(within(header).queryByText("Assignee")).toBeNull();
  });

  test("the title is two lines at most, the whole of it on hover", () => {
    const longTitle: string =
      "Password spray against Okta from 203.0.113.47, followed by a successful sign-in as k.morgan@acme-commerce.example and a new MFA device enrolled";

    draw({ securityCase: buildCase({ title: longTitle }), layout: "compact" });

    const title: HTMLElement = screen.getByTestId("security-case-title");

    expect(title.className).toBe(
      `${SECURITY_CASE_HEADER_TITLE_CLASS_NAME} ${SECURITY_CASE_HEADER_COMPACT_TITLE_CLASS_NAME}`,
    );
    expect(title).toHaveAttribute("title", longTitle);
    // Still the page's one heading, its whole text there for a screen reader.
    expect(screen.getByRole("heading", { level: 1, name: longTitle })).toBe(
      title,
    );
  });

  test("the actions are one group a screen reader names", () => {
    draw({ securityCase: buildCase(), layout: "compact" });

    expect(screen.getByRole("group", { name: "Case actions" })).toBe(
      screen.getByTestId("security-case-actions"),
    );
  });
});

describe("what each case offers", () => {
  test("a case assigned to the reader offers no Assign to Me", () => {
    draw({
      securityCase: buildCase({ assignedToUserId: new ObjectID(ME) }),
      layout: "compact",
    });

    expect(screen.queryByTestId("security-case-assign-to-me")).toBeNull();
  });

  test("a case assigned to someone else still offers Assign to Me", () => {
    draw({
      securityCase: buildCase({
        assignedToUserId: new ObjectID(SOMEONE_ELSE),
      }),
      layout: "compact",
    });

    expect(
      screen.getByTestId("security-case-assign-to-me"),
    ).toBeInTheDocument();
  });

  test("a case declared as an incident links to it, and offers no second declaration", () => {
    draw({
      securityCase: buildCase({
        incidentId: new ObjectID("30000000-0000-4000-8000-000000000001"),
      }),
      layout: "compact",
    });

    expect(screen.queryByTestId("security-case-declare-incident")).toBeNull();
    expect(screen.getByRole("link", { name: "View Incident" })).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/incidents/30000000-0000-4000-8000-000000000001",
      ),
    );
  });

  test("a closed case says its verdict and offers Reopen, never Close Case or Assign to Me", async () => {
    draw({
      securityCase: buildCase({
        securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
        verdict: SecurityCaseVerdict.TruePositive,
      }),
      layout: "compact",
    });

    expect(screen.getByText("True Positive")).toBeInTheDocument();
    expect(screen.queryByTestId("security-case-close")).toBeNull();
    expect(screen.queryByTestId("security-case-assign-to-me")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-reopen"));
    });

    expect(
      (handlers.onChangeStatus.mock.calls[0]![0] as SecurityCaseStatus).name,
    ).toBe("Investigating");
  });

  test("an open case's verdict, if it had one, is not shown", () => {
    draw({
      securityCase: buildCase({ verdict: SecurityCaseVerdict.FalsePositive }),
      layout: "compact",
    });

    expect(screen.queryByText("False Positive")).toBeNull();
  });

  test("each button calls what it says", async () => {
    draw({ securityCase: buildCase(), layout: "compact" });

    for (const [testId, handler] of [
      ["security-case-assign-to-me", handlers.onAssignToMe],
      ["security-case-run-playbook", handlers.onRunPlaybook],
      ["security-case-declare-incident", handlers.onDeclareIncident],
    ] as Array<[string, MockFunction]>) {
      await act(async () => {
        fireEvent.click(screen.getByTestId(testId));
      });

      expect({ testId, calls: handler.mock.calls.length }).toEqual({
        testId,
        calls: 1,
      });
    }

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-close"));
    });

    expect(
      (handlers.onChangeStatus.mock.calls[0]![0] as SecurityCaseStatus).name,
    ).toBe("Closed");
  });

  test("while a change is saved, nothing can be pressed twice", () => {
    draw({ securityCase: buildCase(), layout: "compact", isWorking: true });

    for (const testId of [
      "security-case-assign-to-me",
      "security-case-run-playbook",
      "security-case-declare-incident",
      "security-case-close",
    ]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
  });
});

describe("the ⋯", () => {
  test("sets the priority from a section of its own - every one nobody archived, the case's ticked - then Assign to Someone Else, Change Status, Edit Case and Delete Case", async () => {
    const priorities: Array<SecurityCasePriority> = [
      buildTestPriority({
        id: "c1000000-0000-4000-8000-000000000009",
        name: "Emergency - wake the CISO",
        order: 0,
        color: "#7f1d1d",
      }),
      ...buildDefaultTestPriorities(),
      buildTestPriority({
        id: "c1000000-0000-4000-8000-000000000010",
        name: "Retired",
        order: 9,
        isArchived: true,
      }),
    ];

    draw({ securityCase: buildCase(), layout: "compact" }, { priorities });

    const menu: HTMLElement = await openMore();

    expect(within(menu).getByText("SET PRIORITY")).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item: HTMLElement): [string, string | null] => {
          return [
            (item.textContent || "").trim(),
            item.getAttribute("aria-checked"),
          ];
        }),
    ).toEqual([
      ["Emergency - wake the CISO", "false"],
      ["Critical", "true"],
      ["High", "false"],
      ["Medium", "false"],
      ["Low", "false"],
      ["Informational", "false"],
    ]);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual([
      "Assign to Someone Else",
      "Change Status",
      "Edit Case",
      "Delete Case",
    ]);

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitemradio", {
          name: "Emergency - wake the CISO",
        }),
      );
    });

    expect(handlers.onChangePriority).toHaveBeenCalledTimes(1);
    expect(
      (handlers.onChangePriority.mock.calls[0]![0] as SecurityCasePriority)
        .name,
    ).toBe("Emergency - wake the CISO");
  });

  test("picking the case's own priority changes nothing", async () => {
    draw({ securityCase: buildCase(), layout: "compact" });

    const menu: HTMLElement = await openMore();

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitemradio", { name: "Critical" }),
      );
    });

    expect(handlers.onChangePriority).not.toHaveBeenCalled();
  });

  test("a case at an archived priority keeps it in its pill, and the menu ticks none", async () => {
    const retired: SecurityCasePriority = buildTestPriority({
      id: "c1000000-0000-4000-8000-000000000010",
      name: "Retired",
      order: 9,
      isArchived: true,
    });

    draw(
      {
        securityCase: buildCase({
          securityCasePriorityId: new ObjectID(retired.id!.toString()),
        }),
        layout: "compact",
      },
      { priorities: [...buildDefaultTestPriorities(), retired] },
    );

    expect(
      within(screen.getByTestId("security-case-header")).getByText("Retired"),
    ).toBeInTheDocument();

    const menu: HTMLElement = await openMore();

    expect(within(menu).queryByText("Retired")).toBeNull();
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .filter((item: HTMLElement): boolean => {
          return item.getAttribute("aria-checked") === "true";
        }),
    ).toHaveLength(0);
  });

  test("Assign to Someone Else and Change Status open their dialogs, on the Overview and every other page of the case", async () => {
    for (const layout of ["full", "compact"] as const) {
      draw({ securityCase: buildCase(), layout: layout });

      await openMore();
      await act(async () => {
        fireEvent.click(
          screen.getByTestId("security-case-assign-to-someone-else"),
        );
      });

      await openMore();
      await act(async () => {
        fireEvent.click(screen.getByTestId("security-case-change-status"));
      });

      cleanup();
    }

    expect(handlers.onAssignToSomeoneElse).toHaveBeenCalledTimes(2);
    expect(handlers.onPickStatus).toHaveBeenCalledTimes(2);
    // Opening the dialog changes nothing yet.
    expect(handlers.onChangeStatus).not.toHaveBeenCalled();
  });

  test("the case's own moves are the reader's too: Assign to Someone Else on a case that is theirs", async () => {
    draw({
      securityCase: buildCase({ assignedToUserId: new ObjectID(ME) }),
      layout: "compact",
    });

    // Theirs already: no Assign to Me button, but they can hand it on.
    expect(screen.queryByTestId("security-case-assign-to-me")).toBeNull();

    await openMore();

    expect(
      screen.getByTestId("security-case-assign-to-someone-else"),
    ).toHaveAttribute("aria-disabled", "false");
  });

  test("nobody takes a closed case: its ⋯ has no Assign to Someone Else, and Change Status is how it is reopened", async () => {
    draw({
      securityCase: buildCase({
        securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
        verdict: SecurityCaseVerdict.TruePositive,
      }),
      layout: "compact",
    });

    const menu: HTMLElement = await openMore();

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(["Change Status", "Edit Case", "Delete Case"]);
    expect(
      screen.queryByTestId("security-case-assign-to-someone-else"),
    ).toBeNull();
  });

  test("while a change is being saved, the ⋯'s moves wait for it", async () => {
    draw({ securityCase: buildCase(), layout: "compact", isWorking: true });

    await openMore();

    for (const testId of [
      "security-case-assign-to-someone-else",
      "security-case-change-status",
    ]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
  });

  test("Edit Case and Delete Case call what they say", async () => {
    draw({ securityCase: buildCase(), layout: "compact" });

    await openMore();
    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-edit"));
    });

    expect(handlers.onEdit).toHaveBeenCalledTimes(1);

    await openMore();
    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-delete"));
    });

    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("who may do what", () => {
  test("a Security Viewer sees every change locked, each saying why", async () => {
    permissionsForTest = ["SecurityViewer"];
    draw({ securityCase: buildCase(), layout: "compact" });

    for (const testId of [
      "security-case-assign-to-me",
      // A viewer may read the case's runs, not start one.
      "security-case-run-playbook",
      "security-case-declare-incident",
      "security-case-close",
    ]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
      expect(
        screen.getByTestId(`${testId}-disabled-wrapper`),
      ).toBeInTheDocument();
    }

    const menu: HTMLElement = await openMore();

    for (const item of within(menu).getAllByRole("menuitemradio")) {
      expect(item).toHaveAttribute("aria-disabled", "true");
    }

    for (const testId of [
      "security-case-assign-to-someone-else",
      "security-case-change-status",
      "security-case-edit",
      "security-case-delete",
    ]) {
      const item: HTMLElement = screen.getByTestId(testId);

      expect(item).toHaveAttribute("aria-disabled", "true");
      // Locked with the reason read with it, not skipped as if absent.
      expect(item.getAttribute("aria-describedby")).toBeTruthy();
    }

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("security-case-assign-to-someone-else"),
      );
    });

    expect(handlers.onAssignToSomeoneElse).not.toHaveBeenCalled();
  });

  test("a Security Member works the case but may not delete it", async () => {
    permissionsForTest = ["SecurityMember"];
    draw({ securityCase: buildCase(), layout: "compact" });

    expect(screen.getByTestId("security-case-close")).toBeEnabled();
    // A member starts runs.
    expect(screen.getByTestId("security-case-run-playbook")).toBeEnabled();

    await openMore();

    expect(screen.getByTestId("security-case-edit")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    for (const testId of [
      "security-case-assign-to-someone-else",
      "security-case-change-status",
    ]) {
      expect(screen.getByTestId(testId)).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    }
    expect(screen.getByTestId("security-case-delete")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
