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

/*
 * ADD TO CASE IN AN EVENT'S PANEL (Security Events > Events, a hunt's page):
 * the event kept on the open case picked, as evidence, naming the hunt the
 * list is - and the line under the button that says what happened: kept
 * now, with a green check and the case's number a link to its Evidence
 * page; kept already, the same line plainly; or why it was not, in red, as
 * an alert. Locked, saying why, for a role that may not add evidence.
 *
 * The dialog that picks the case has its own suite (SecurityHuntsPages):
 * here a stand-in picks CASE-141, as its list and its Add button do.
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/AddToCaseModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        eventCount: number;
        onPick: (picked: { id: string; number: string }) => void;
        onClose: () => void;
      }) => {
        const ReactInMock: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactInMock.createElement(
          "div",
          { role: "dialog", "data-testid": "add-to-case-stand-in" },
          ReactInMock.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                props.onPick({
                  id: "20000000-0000-4000-8000-000000000141",
                  number: "CASE-141",
                });
              },
            },
            `Add ${props.eventCount} Event`,
          ),
        );
      },
    };
  },
);

import AddEventToCaseButton from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/AddEventToCaseButton";
import { HUNTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { SECURITY_CASE_EVENTS_ADD_REASONS } from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HUNT_ID: string = "3b000000-0000-4000-8000-000000000001";
const CASE_ID: string = "20000000-0000-4000-8000-000000000141";
const EVENT_TIME: string = "2026-10-14T07:00:00.000Z";

let allowed: Record<string, boolean>;

function securityEvent(
  values: { eventUid?: string; time?: string } = {},
): SecurityEvent {
  const event: SecurityEvent = new SecurityEvent();

  if (values.eventUid !== "") {
    event.eventUid = values.eventUid || "evt-0001";
  }

  if (values.time !== "") {
    event.time = new Date(values.time || EVENT_TIME);
  }

  event.message = "Encoded PowerShell started by a web worker on web-03";
  return event;
}

function renderButton(event: SecurityEvent = securityEvent()): void {
  render(
    <MemoryRouter>
      <AddEventToCaseButton
        securityEvent={event}
        huntId={new ObjectID(HUNT_ID)}
      />
    </MemoryRouter>,
  );
}

// Add to Case, then CASE-141 in the dialog.
async function addToCase141(): Promise<void> {
  fireEvent.click(screen.getByTestId(HUNTS_TEST_IDS.addToCase));

  const picker: HTMLElement = await screen.findByTestId("add-to-case-stand-in");

  await act(async () => {
    fireEvent.click(within(picker).getByRole("button"));
  });
}

function flat(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  allowed = {};

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionGate, "check").mockImplementation(((
    model: BaseModel,
    action: ModelAction,
  ) => {
    const key: string = `${model.constructor.name}:${action}`;

    return allowed[key] === false
      ? { isAllowed: false, disabledReason: `Your role cannot ${key}.` }
      : { isAllowed: true };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Add to Case in an event's panel", () => {
  test("keeps the event on the case picked, naming the hunt, and says so with a check and the way to the case's Evidence", async () => {
    const addEvents: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseApi, "addEventsToCase")
      .mockResolvedValue({
        added: ["evt-0001"],
        alreadyOnCase: [],
        notFound: [],
      } as never);

    renderButton();

    // Nothing said before anything is kept.
    expect(screen.queryByTestId(HUNTS_TEST_IDS.addToCaseResult)).toBeNull();

    await addToCase141();

    expect(addEvents).toHaveBeenCalledTimes(1);
    expect(addEvents).toHaveBeenCalledWith({
      caseId: new ObjectID(CASE_ID),
      events: [{ eventUid: "evt-0001", time: new Date(EVENT_TIME) }],
      huntId: new ObjectID(HUNT_ID),
    });
    // The dialog closed once the case was picked.
    expect(screen.queryByTestId("add-to-case-stand-in")).toBeNull();

    const result: HTMLElement = await screen.findByTestId(
      HUNTS_TEST_IDS.addToCaseResult,
    );

    expect(flat(result)).toBe("Added to CASE-141.");
    expect(result).toHaveAttribute("data-outcome", "added");
    expect(result).toHaveAttribute("role", "status");
    // A green check: a step done.
    expect(result.querySelector("svg")).not.toBeNull();
    expect(
      within(result).getByRole("link", { name: "CASE-141" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/security-events/cases/${CASE_ID}/evidence`),
    );
    // Its line is a block of its own: never a <div> inside a <p>.
    expect(result.tagName).toBe("DIV");
  });

  test("an event the case keeps already says so, plainly, linked the same way", async () => {
    jest.spyOn(SecurityCaseApi, "addEventsToCase").mockResolvedValue({
      added: [],
      alreadyOnCase: ["evt-0001"],
      notFound: [],
    } as never);

    renderButton();
    await addToCase141();

    const result: HTMLElement = await screen.findByTestId(
      HUNTS_TEST_IDS.addToCaseResult,
    );

    expect(flat(result)).toBe("Already kept on CASE-141.");
    expect(result).toHaveAttribute("data-outcome", "already");
    // Nothing changed: no check.
    expect(result.querySelector("svg")).toBeNull();
    expect(
      within(result).getByRole("link", { name: "CASE-141" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/security-events/cases/${CASE_ID}/evidence`),
    );
  });

  test("an event that could not be read says why, in red, as an alert", async () => {
    jest.spyOn(SecurityCaseApi, "addEventsToCase").mockResolvedValue({
      added: [],
      alreadyOnCase: [],
      notFound: ["evt-0001"],
    } as never);

    renderButton();
    await addToCase141();

    const result: HTMLElement = await screen.findByRole("alert");

    expect(result).toHaveTextContent(
      SECURITY_CASE_EVENTS_ADD_REASONS.notFound.message,
    );
    expect(result).toHaveClass("text-red-600");
    expect(within(result).queryByRole("link")).toBeNull();
  });

  test("a refused request says the server's own words, and the button can be pressed again", async () => {
    jest
      .spyOn(SecurityCaseApi, "addEventsToCase")
      .mockImplementation((async () => {
        throw new Error(
          "You do not have permission to add evidence to this Security Case.",
        );
      }) as never);

    renderButton();
    await addToCase141();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to add evidence to this Security Case.",
    );
    expect(screen.getByTestId(HUNTS_TEST_IDS.addToCase)).not.toBeDisabled();
  });

  test("is locked for a role that may not add evidence to cases, and opens nothing", () => {
    allowed[`SecurityCaseEvidence:${ModelAction.Create}`] = false;

    renderButton();

    const button: HTMLElement = screen.getByTestId(HUNTS_TEST_IDS.addToCase);

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByTestId("add-to-case-stand-in")).toBeNull();
  });

  test("an event with no id or no time cannot be kept: the button is locked", () => {
    renderButton(securityEvent({ eventUid: "" }));
    expect(screen.getByTestId(HUNTS_TEST_IDS.addToCase)).toBeDisabled();
    cleanup();

    renderButton(securityEvent({ time: "" }));
    expect(screen.getByTestId(HUNTS_TEST_IDS.addToCase)).toBeDisabled();
  });
});
