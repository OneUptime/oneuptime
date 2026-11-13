import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
import ExceptionAssignee, {
  EXCEPTION_ASSIGNEE_TEST_IDS,
  getExceptionAssigneePick,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAssignee";
import ExceptionAssignModal from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAssignModal";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import { ExceptionAssignmentWrite } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionAssignment";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { AnchoredFieldPopup } from "../../../UI/Types/UseAnchoredFieldPopup";

/*
 * Who owns an exception, on screen: the header's Assignee fact (one person
 * or one team, drawn as an avatar and a name, changed from a list of people
 * and teams, saved as it is picked, read-only for someone who may not
 * update exceptions), Bulk Actions' Assign to… dialog, and the row's chip.
 *
 * The people picker and the search list load the project's people and
 * teams from the server; here they are stubs that show what they were
 * handed and pick on a click, and names come from a fixed lookup, so what
 * is pinned is how these controls use them.
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
// A person whose name is still being read, and one who left the project.
const LOADING_USER: string = "55555555-5555-4555-8555-555555555555";
const GONE_USER: string = "66666666-6666-4666-8666-666666666666";

const USER_OPTION: PeoplePickerOption = {
  kind: PeoplePickerKind.User,
  id: PICKED_USER,
  name: "Priya Raman",
  userId: PICKED_USER,
};

const TEAM_OPTION: PeoplePickerOption = {
  kind: PeoplePickerKind.Team,
  id: PICKED_TEAM,
  name: "Payments",
};

const KNOWN_OPTIONS: Record<string, PeoplePickerOption> = {
  [`user:${PICKED_USER}`]: USER_OPTION,
  [`team:${PICKED_TEAM}`]: TEAM_OPTION,
  [`user:${GONE_USER}`]: {
    kind: PeoplePickerKind.User,
    id: GONE_USER,
    name: "Unknown user",
    isUnknown: true,
  },
};

const remember: Mock<(options: Array<PeoplePickerOption>) => void> =
  jest.fn<(options: Array<PeoplePickerOption>) => void>();

interface PopupStubProps {
  popup: AnchoredFieldPopup;
  kinds: Array<string>;
  selectedKeys: Set<string>;
  selectionMode: string;
  searchPlaceholder?: string;
  ariaLabel: string;
  onPick: (
    option: PeoplePickerOption,
    isPicked: boolean,
  ) => void | Promise<unknown>;
}

// The search list: open while its popup is, picking a person or a team.
jest.mock("../../../UI/Components/PeoplePicker/PeopleSearchPopup", () => {
  return {
    __esModule: true,
    PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX: 360,
    PEOPLE_SEARCH_POPUP_WIDTH_PX: 320,
    default: (props: PopupStubProps) => {
      if (!props.popup.isPopupOpen) {
        return null;
      }

      const pick: (option: PeoplePickerOption) => void = (
        option: PeoplePickerOption,
      ): void => {
        void props.onPick(
          option,
          props.selectedKeys.has(`${option.kind}:${option.id}`),
        );
      };

      return (
        <div
          data-testid="people-search-popup"
          role="dialog"
          aria-label={props.ariaLabel}
          data-mode={props.selectionMode}
          data-kinds={props.kinds.join(",")}
          data-placeholder={props.searchPlaceholder}
          data-selected={JSON.stringify(Array.from(props.selectedKeys))}
        >
          <button
            type="button"
            onClick={() => {
              pick(USER_OPTION);
            }}
          >
            pick-user-row
          </button>
          <button
            type="button"
            onClick={() => {
              pick(TEAM_OPTION);
            }}
          >
            pick-team-row
          </button>
        </div>
      );
    },
  };
});

// Names, by kind and id, from the lookup above; LOADING_USER is not in yet.
jest.mock("../../../UI/Components/PeoplePicker/usePeopleOptions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        getOption: (
          kind: string,
          id: string,
        ): PeoplePickerOption | undefined => {
          return KNOWN_OPTIONS[`${kind}:${id.toLowerCase()}`];
        },
        remember: remember,
        isLoading: false,
        error: "",
      };
    },
  };
});

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
  remember.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the header's Assignee", () => {
  test("with nobody on it, offers the empty place and Assign, which opens one list of people and teams", () => {
    render(
      <ExceptionAssignee exception={exceptionWith()} onAssign={onAssign} />,
    );

    const assign: HTMLElement = screen.getByTestId(
      EXCEPTION_ASSIGNEE_TEST_IDS.assign,
    );

    expect(assign).toHaveTextContent("Assign");
    expect(assign).toHaveAttribute("aria-haspopup", "dialog");
    expect(assign).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("people-search-popup")).toBeNull();
    expect(screen.queryByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.change)).toBeNull();
    expect(
      screen.queryByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.unassign),
    ).toBeNull();

    fireEvent.click(assign);

    const popup: HTMLElement = screen.getByTestId("people-search-popup");

    expect(assign).toHaveAttribute("aria-expanded", "true");
    expect(popup).toHaveAttribute("aria-label", "Assign");
    expect(popup).toHaveAttribute("data-mode", "single");
    expect(popup).toHaveAttribute("data-kinds", "user,team");
    expect(popup).toHaveAttribute(
      "data-placeholder",
      "Search people and teams",
    );
    expect(JSON.parse(popup.getAttribute("data-selected")!)).toEqual([]);
  });

  test("a pick writes the person or the team, with the other cleared, and closes the list", async () => {
    render(
      <ExceptionAssignee exception={exceptionWith()} onAssign={onAssign} />,
    );

    fireEvent.click(screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.assign));

    await act(async () => {
      fireEvent.click(screen.getByText("pick-team-row"));
    });

    expect(onAssign).toHaveBeenCalledTimes(1);
    const write: ExceptionAssignmentWrite = onAssign.mock.calls[0]![0];
    expect(write.assignToUserId).toBeNull();
    expect(write.assignToTeamId?.toString()).toBe(PICKED_TEAM);
    // Its name is known from the pick: no "Loading..." once it is saved.
    expect(remember).toHaveBeenCalledWith([TEAM_OPTION]);
    expect(screen.queryByTestId("people-search-popup")).toBeNull();
  });

  test("names the person who owns it, with their avatar, and the list marks them picked", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
        })}
        onAssign={onAssign}
      />,
    );

    const name: HTMLElement = screen.getByTestId(
      EXCEPTION_ASSIGNEE_TEST_IDS.name,
    );

    expect(name).toHaveTextContent("Priya Raman");
    expect(name).toHaveAttribute("data-kind", "user");
    expect(name.className).not.toContain("italic");
    expect(screen.queryByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.assign)).toBeNull();

    const change: HTMLElement = screen.getByTestId(
      EXCEPTION_ASSIGNEE_TEST_IDS.change,
    );

    // "Priya Raman Change": the button says what it does to a screen reader.
    expect(change).toHaveTextContent("Change");
    // Her avatar, her initials without a picture, beside her name.
    expect(change).toContainElement(name);
    expect(change.textContent).toContain("PR");
    expect(change).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(change);

    expect(
      JSON.parse(
        screen
          .getByTestId("people-search-popup")
          .getAttribute("data-selected")!,
      ),
    ).toEqual([`user:${PICKED_USER}`]);
  });

  test("names the team that owns it", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToTeamId: new ObjectID(PICKED_TEAM),
        })}
        onAssign={onAssign}
      />,
    );

    const name: HTMLElement = screen.getByTestId(
      EXCEPTION_ASSIGNEE_TEST_IDS.name,
    );

    expect(name).toHaveTextContent("Payments");
    expect(name).toHaveAttribute("data-kind", "team");
  });

  test("picking whoever holds it writes nothing; picking another hands it over", async () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
        })}
        onAssign={onAssign}
      />,
    );

    fireEvent.click(screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.change));

    await act(async () => {
      fireEvent.click(screen.getByText("pick-user-row"));
    });

    expect(onAssign).not.toHaveBeenCalled();
    expect(screen.queryByTestId("people-search-popup")).toBeNull();

    fireEvent.click(screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.change));

    await act(async () => {
      fireEvent.click(screen.getByText("pick-team-row"));
    });

    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign.mock.calls[0]![0].assignToUserId).toBeNull();
    expect(onAssign.mock.calls[0]![0].assignToTeamId?.toString()).toBe(
      PICKED_TEAM,
    );
  });

  test("the × beside the name unassigns", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
        })}
        onAssign={onAssign}
      />,
    );

    const unassign: HTMLElement = screen.getByRole("button", {
      name: "Unassign",
    });

    expect(unassign).toHaveAttribute(
      "data-testid",
      EXCEPTION_ASSIGNEE_TEST_IDS.unassign,
    );

    fireEvent.click(unassign);

    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign.mock.calls[0]![0]).toEqual({
      assignToUserId: null,
      assignToTeamId: null,
    });
  });

  test("while its name is being read it says so, and a person who left reads as unknown", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(LOADING_USER),
        })}
        onAssign={onAssign}
      />,
    );

    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.name),
    ).toHaveTextContent("Loading...");

    cleanup();

    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(GONE_USER),
        })}
        onAssign={onAssign}
      />,
    );

    const gone: HTMLElement = screen.getByTestId(
      EXCEPTION_ASSIGNEE_TEST_IDS.name,
    );

    expect(gone).toHaveTextContent("Unknown user");
    expect(gone).toHaveClass("italic");
    // Still removable.
    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.unassign),
    ).toBeInTheDocument();
  });

  test("someone who may not update exceptions reads who owns it, and is offered nothing", () => {
    permissions = [Permission.ReadTelemetryException];

    render(
      <ExceptionAssignee exception={exceptionWith()} onAssign={onAssign} />,
    );

    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.assignee),
    ).toHaveTextContent("Unassigned");
    expect(screen.queryByRole("button")).toBeNull();

    cleanup();

    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
        })}
        onAssign={onAssign}
      />,
    );

    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.name),
    ).toHaveTextContent("Priya Raman");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("while an assignment saves, its controls wait", () => {
    render(
      <ExceptionAssignee
        exception={exceptionWith({
          assignToUserId: new ObjectID(PICKED_USER),
        })}
        isSaving={true}
        onAssign={onAssign}
      />,
    );

    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.assignee),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.change),
    ).toBeDisabled();
    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.unassign),
    ).toBeDisabled();

    cleanup();

    render(
      <ExceptionAssignee
        exception={exceptionWith()}
        isSaving={true}
        onAssign={onAssign}
      />,
    );

    expect(
      screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.assign),
    ).toBeDisabled();
  });

  test("a save that takes a while keeps the list open until it is done", async () => {
    let finish: () => void = (): void => {};
    const slowAssign: Mock<(write: ExceptionAssignmentWrite) => Promise<void>> =
      jest.fn<(write: ExceptionAssignmentWrite) => Promise<void>>(() => {
        return new Promise<void>((resolve: () => void) => {
          finish = resolve;
        });
      });

    render(
      <ExceptionAssignee exception={exceptionWith()} onAssign={slowAssign} />,
    );

    fireEvent.click(screen.getByTestId(EXCEPTION_ASSIGNEE_TEST_IDS.assign));

    await act(async () => {
      fireEvent.click(screen.getByText("pick-user-row"));
    });

    expect(slowAssign).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("people-search-popup")).toBeInTheDocument();

    await act(async () => {
      finish();
    });

    expect(screen.queryByTestId("people-search-popup")).toBeNull();
  });

  test("its one pick is the person, else the team, else nobody", () => {
    expect(getExceptionAssigneePick(exceptionWith())).toBeNull();
    expect(
      getExceptionAssigneePick(
        exceptionWith({ assignToTeamId: new ObjectID(PICKED_TEAM) }),
      ),
    ).toEqual({ kind: "team", id: PICKED_TEAM });
    expect(
      getExceptionAssigneePick(
        exceptionWith({ assignToUserId: new ObjectID(PICKED_USER) }),
      ),
    ).toEqual({ kind: "user", id: PICKED_USER });
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
