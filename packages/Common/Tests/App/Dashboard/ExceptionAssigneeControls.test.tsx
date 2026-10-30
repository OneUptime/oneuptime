import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import ExceptionAssignee from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAssignee";
import ExceptionAssignModal from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAssignModal";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import { ExceptionAssignmentWrite } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionAssignment";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * Who owns an exception, on screen: the header's Assignee (one person or one
 * team, saved as it is picked, locked for someone who may not update
 * exceptions), Bulk Actions' Assign to… dialog, and the row's chip.
 *
 * The people picker loads the project's people and teams from the server;
 * here it is a stub that shows what it was handed and picks on a click, so
 * what is pinned is how these controls use it.
 */

interface PickerStubProps {
  value: Record<string, Array<string>>;
  isSinglePick?: boolean;
  disabled?: boolean;
  addButtonText?: string;
  whenNobodyPicked?: { text: string };
  dataTestId?: string;
  onChange: (value: Record<string, Array<string>>) => void;
}

const PICKED_USER: string = "33333333-3333-4333-8333-333333333333";
const PICKED_TEAM: string = "44444444-4444-4444-8444-444444444444";

jest.mock("../../../UI/Components/PeoplePicker/PeoplePicker", () => {
  return {
    __esModule: true,
    default: (props: PickerStubProps) => {
      return (
        <div
          data-testid={props.dataTestId}
          data-value={JSON.stringify(props.value)}
          data-single={String(props.isSinglePick)}
          data-disabled={String(Boolean(props.disabled))}
          data-nobody={props.whenNobodyPicked?.text || ""}
        >
          <button
            type="button"
            onClick={() => {
              props.onChange({ user: [PICKED_USER] });
            }}
          >
            pick-user
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange({ team: [PICKED_TEAM] });
            }}
          >
            pick-team
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange({});
            }}
          >
            pick-nobody
          </button>
        </div>
      );
    },
  };
});

let permissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissions;
      },
      getProjectPermissions: (): null => {
        return null;
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

const onAssign: Mock<(write: ExceptionAssignmentWrite) => void> =
  jest.fn<(write: ExceptionAssignmentWrite) => void>();

function exceptionWith(
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = "70000000-0000-4000-8000-000000000009";
  exception.exceptionType = "TypeError";
  exception.message = "x is undefined";
  Object.assign(exception, values);
  return exception;
}

beforeEach(() => {
  permissions = [Permission.ProjectOwner];
  onAssign.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the header's Assignee", () => {
  test("holds the exception's person, one pick at a time, and says when nobody is", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
        })}
        onAssign={onAssign}
      />,
    );

    const picker: HTMLElement = screen.getByTestId("exception-assignee-picker");
    expect(JSON.parse(picker.getAttribute("data-value")!)).toEqual({
      user: [PICKED_USER],
    });
    expect(picker).toHaveAttribute("data-single", "true");
    expect(picker).toHaveAttribute("data-nobody", "Unassigned");
  });

  test("a pick writes the person or team, with the other cleared", () => {
    render(
      <ExceptionAssignee exception={exceptionWith()} onAssign={onAssign} />,
    );

    fireEvent.click(screen.getByText("pick-team"));

    expect(onAssign).toHaveBeenCalledTimes(1);
    const write: ExceptionAssignmentWrite = onAssign.mock.calls[0]![0];
    expect(write.assignToUserId).toBeNull();
    expect(write.assignToTeamId?.toString()).toBe(PICKED_TEAM);
  });

  test("removing the pick unassigns; picking what it holds writes nothing", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
        })}
        onAssign={onAssign}
      />,
    );

    fireEvent.click(screen.getByText("pick-user"));
    expect(onAssign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("pick-nobody"));
    expect(onAssign.mock.calls[0]![0]).toEqual({
      assignToUserId: null,
      assignToTeamId: null,
    });
  });

  test("someone who may not update exceptions finds it locked", () => {
    permissions = [Permission.ReadTelemetryException];

    render(
      <ExceptionAssignee exception={exceptionWith()} onAssign={onAssign} />,
    );

    expect(screen.getByTestId("exception-assignee-picker")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  test("while an assignment saves, the picker waits", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith()}
        isSaving={true}
        onAssign={onAssign}
      />,
    );

    expect(screen.getByTestId("exception-assignee-picker")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });
});

describe("Assign to…, for a selection", () => {
  test("names how many, and assigns whoever is picked", () => {
    const onSubmit: Mock<(write: ExceptionAssignmentWrite) => void> =
      jest.fn<(write: ExceptionAssignmentWrite) => void>();

    render(
      <ExceptionAssignModal count={3} onClose={() => {}} onSubmit={onSubmit} />,
    );

    expect(screen.getByText("Assign 3 exceptions")).toBeInTheDocument();
    // Nothing picked yet: the dialog unassigns.
    expect(
      screen.getByRole("button", { name: "Unassign" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("pick-user"));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].assignToUserId?.toString()).toBe(
      PICKED_USER,
    );
    expect(onSubmit.mock.calls[0]![0].assignToTeamId).toBeNull();
  });

  test("one exception reads as one", () => {
    render(
      <ExceptionAssignModal count={1} onClose={() => {}} onSubmit={() => {}} />,
    );

    expect(screen.getByText("Assign 1 exception")).toBeInTheDocument();
  });
});

describe("the row's chip", () => {
  test("shows the person who owns it", () => {
    const user: User = new User();
    user.name = new Name("Priya Raman");

    render(
      <ExceptionRow
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
          assignToUser: user,
        })}
      />,
    );

    const chip: HTMLElement = screen.getByTestId("exception-row-assignee");
    expect(chip).toHaveTextContent("Priya Raman");
    expect(chip).toHaveAttribute("title", "Assigned to Priya Raman");
  });

  test("shows the team that owns it", () => {
    const team: Team = new Team();
    team.name = "Payments";

    render(
      <ExceptionRow
        exception={exceptionWith({
          assignToTeamId: new ObjectID(PICKED_TEAM),
          assignToTeam: team,
        })}
      />,
    );

    expect(screen.getByTestId("exception-row-assignee")).toHaveTextContent(
      "Payments",
    );
  });

  test("shows nothing when nobody owns it", () => {
    render(<ExceptionRow exception={exceptionWith()} />);

    expect(screen.queryByTestId("exception-row-assignee")).toBeNull();
  });
});
