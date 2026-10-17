import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import OwnersCell from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnersCell";
import LiveDuration from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/LiveDuration";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import User from "../../../Models/DatabaseModels/User";
import Team from "../../../Models/DatabaseModels/Team";
import Name from "../../../Types/Name";
import Email from "../../../Types/Email";

/*
 * Two cells of the Incidents list of the maintainer's screenshot, drawn as
 * the table redesign (model-table-ui) draws them: Owners ("No owners." on
 * every row; avatars taller than the row's line) and Duration ("10 days,
 * 23 hours, 31 minutes", the widest column of the list).
 */

type MakeUserFunction = (index: number, name: string) => ResourceOwnerEntry;

const makeUser: MakeUserFunction = (
  index: number,
  name: string,
): ResourceOwnerEntry => {
  const user: User = new User();
  user._id = `81000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  user.name = new Name(name);
  user.email = new Email(`person${index}@acme-commerce.example`);
  return { kind: "user", user: user } as ResourceOwnerEntry;
};

type MakeTeamFunction = (index: number, name: string) => ResourceOwnerEntry;

const makeTeam: MakeTeamFunction = (
  index: number,
  name: string,
): ResourceOwnerEntry => {
  const team: Team = new Team();
  team._id = `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  team.name = name;
  return { kind: "team", team: team } as ResourceOwnerEntry;
};

afterEach(() => {
  cleanup();
});

describe("a row's owners", () => {
  test("none: the table's quiet dash, 'No owners.' kept for a screen reader", () => {
    render(<OwnersCell owners={[]} />);

    const value: HTMLElement = screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID);

    expect(value.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      "—",
    );
    expect(value.querySelector(".sr-only")).toHaveTextContent("No owners.");
    // Not a grey sentence of its own on every row.
    expect(screen.queryByText("No owners.", { selector: "p" })).toBeNull();
  });

  test("while they load, the cell says so", () => {
    render(<OwnersCell owners={undefined} isLoading={true} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  test("each avatar is the row's 24px line tall, overlapping the one before it", () => {
    const { container } = render(
      <OwnersCell owners={[makeUser(1, "Ada Lovelace"), makeTeam(2, "SRE")]} />,
    );

    const row: HTMLElement = container.firstElementChild as HTMLElement;

    expect(row).toHaveClass("flex", "h-6", "items-center");
    expect(screen.getByText("AL")).toBeInTheDocument();
    // The chip size: 24px.
    expect(container.querySelector(".h-6.w-6")).not.toBeNull();
    expect(container.querySelector(".h-8.w-8")).toBeNull();
    expect(container.querySelector(".-ml-1\\.5")).not.toBeNull();
  });

  test("more than four: the rest as a '+N' as small as an avatar", () => {
    const owners: Array<ResourceOwnerEntry> = [
      makeUser(1, "Ada Lovelace"),
      makeUser(2, "Grace Hopper"),
      makeUser(3, "Alan Turing"),
      makeUser(4, "Edsger Dijkstra"),
      makeUser(5, "Barbara Liskov"),
      makeUser(6, "Donald Knuth"),
    ];

    render(<OwnersCell owners={owners} />);

    const more: HTMLElement = screen.getByText("+2");

    expect(more).toHaveClass("h-6", "w-6", "text-[10px]");
  });
});

describe("a row's Duration", () => {
  const DECLARED: Date = new Date("2026-10-05T06:04:00.000Z");
  // Ten days, twenty-three hours and thirty-one minutes later.
  const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("in a table: the two largest units, the whole duration under the pointer", () => {
    render(<LiveDuration startDate={DECLARED} isCompact={true} />);

    const duration: HTMLElement = screen.getByTestId("live-duration");

    expect(duration).toHaveTextContent("10 days, 23 hours");
    expect(duration).toHaveAttribute("title", "10 days, 23 hours, 31 minutes");
  });

  test("a duration the two units say whole needs no tooltip", () => {
    render(
      <LiveDuration
        startDate={DECLARED}
        endDate={new Date("2026-10-05T08:04:00.000Z")}
        isCompact={true}
      />,
    );

    const duration: HTMLElement = screen.getByTestId("live-duration");

    expect(duration).toHaveTextContent("2 hours");
    expect(duration).not.toHaveAttribute("title");
  });

  test("on an event's own page: every unit, as before", () => {
    render(<LiveDuration startDate={DECLARED} />);

    expect(
      screen.getByText("10 days, 23 hours, 31 minutes"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("live-duration")).toBeNull();
  });

  test("a live one keeps ticking in its compact form", () => {
    render(<LiveDuration startDate={DECLARED} isCompact={true} />);

    act(() => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });

    // The clock moves on with the timers.
    expect(screen.getByTestId("live-duration")).toHaveTextContent(
      "11 days",
    );
  });
});
