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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A monitor rule's incident and alert name their owners with the one owners
 * picker - people and teams together - in place of an "Owner Teams" and an
 * "Owner Users" dropdown. What the rule saves is unchanged: ownerUserIds and
 * ownerTeamIds, as ObjectIDs. And the rule's read-only view lists them as
 * one Owners row.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import MonitorCriteriaAlertForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaAlertForm";
import MonitorCriteriaIncidentForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm";
import MonitorCriteriaAlertView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteriaAlert";
import MonitorCriteriaIncidentView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteriaIncident";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

function ada(): User {
  const user: User = new User();
  user._id = ADA;
  user.name = new Name("Ada Lovelace");
  user.email = new Email("ada@example.com");
  return user;
}

function platform(): Team {
  const team: Team = new Team();
  team._id = PLATFORM;
  team.name = "Platform";
  return team;
}

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const member: TeamMember = new TeamMember();
      member.user = ada();

      const wanted: boolean =
        !(request.query.userId instanceof Includes) ||
        (request.query.userId.values as Array<string>).includes(ADA);

      const rows: Array<TeamMember> = wanted ? [member] : [];

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    }

    return { data: [platform()], count: 1, skip: 0, limit: 1 };
  });
}

async function pick(name: string): Promise<void> {
  const button: HTMLElement = screen.getByRole("button", { name: "Add owner" });

  if (button.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(button);
  }

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owner",
  });

  const options: Array<HTMLElement> = await within(dialog).findAllByRole(
    "option",
  );

  fireEvent.click(
    options.find((option: HTMLElement): boolean => {
      return option.textContent?.includes(name) || false;
    })!,
  );
}

function ids(values: Array<ObjectID> | undefined): Array<string> {
  return (values || []).map((value: ObjectID): string => {
    expect(value).toBeInstanceOf(ObjectID);
    return value.toString();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/monitors`);
  serveDirectory();
});

afterEach(() => {
  cleanup();
});

describe("a monitor rule's incident", () => {
  test("names its owners with one picker of people and teams, kept as ObjectIDs", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <MonitorCriteriaIncidentForm
        initialValue={{
          id: "incident-1",
          title: "Storefront is offline",
          description: "",
          incidentSeverityId: undefined,
          ownerUserIds: [new ObjectID(ADA)],
        }}
        incidentSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        onChange={(value: CriteriaIncident) => {
          onChange(value);
        }}
      />,
    );

    // Configured, so the section is open and the owner is named.
    const owners: HTMLElement = await screen.findByRole("group", {
      name: /Owners/,
    });

    await waitFor(() => {
      expect(within(owners).getByTestId("people-chip")).toHaveTextContent(
        "Ada Lovelace",
      );
    });

    expect(screen.queryByText("Owner Teams")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner Users")).not.toBeInTheDocument();

    await pick("Platform");

    await waitFor(() => {
      const latest: CriteriaIncident = onChange.mock.calls[
        onChange.mock.calls.length - 1
      ]![0] as CriteriaIncident;

      expect(ids(latest.ownerUserIds)).toEqual([ADA]);
      expect(ids(latest.ownerTeamIds)).toEqual([PLATFORM]);
    });
  });
});

describe("a monitor rule's alert", () => {
  test("names its owners with the same picker", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <MonitorCriteriaAlertForm
        initialValue={{
          id: "alert-1",
          title: "Storefront is offline",
          description: "",
          alertSeverityId: undefined,
          ownerTeamIds: [new ObjectID(PLATFORM)],
        }}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        onChange={(value: CriteriaAlert) => {
          onChange(value);
        }}
      />,
    );

    const owners: HTMLElement = await screen.findByRole("group", {
      name: /Owners/,
    });

    await waitFor(() => {
      expect(within(owners).getByTestId("people-chip")).toHaveTextContent(
        "Platform",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Platform" }));
    await pick("Ada Lovelace");

    await waitFor(() => {
      const latest: CriteriaAlert = onChange.mock.calls[
        onChange.mock.calls.length - 1
      ]![0] as CriteriaAlert;

      expect(ids(latest.ownerTeamIds)).toEqual([]);
      expect(ids(latest.ownerUserIds)).toEqual([ADA]);
    });
  });
});

describe("a monitor rule's read-only view", () => {
  test("lists an incident's owners, people then teams, in one Owners row", () => {
    render(
      <MonitorCriteriaIncidentView
        incident={{
          id: "incident-1",
          title: "Storefront is offline",
          description: "",
          incidentSeverityId: undefined,
          ownerTeamIds: [new ObjectID(PLATFORM)],
          ownerUserIds: [new ObjectID(ADA)],
        }}
        incidentSeverityOptions={[]}
        onCallPolicyOptions={[]}
        labelOptions={[]}
        teamOptions={[platform()]}
        userOptions={[ada()]}
        incidentRoleOptions={[]}
      />,
    );

    expect(screen.getByText("Owners")).toBeInTheDocument();
    expect(screen.queryByText("Owner Teams")).not.toBeInTheDocument();

    const chips: Array<HTMLElement> = screen.getAllByTestId("people-chip");

    expect(
      chips.map((chip: HTMLElement) => {
        return chip.getAttribute("data-id");
      }),
    ).toEqual([ADA, PLATFORM]);
  });

  test("says when an alert has no owners", () => {
    render(
      <MonitorCriteriaAlertView
        alert={{
          id: "alert-1",
          title: "Storefront is offline",
          description: "",
          alertSeverityId: undefined,
        }}
        alertSeverityOptions={[]}
        onCallPolicyOptions={[]}
        labelOptions={[]}
        teamOptions={[platform()]}
        userOptions={[ada()]}
      />,
    );

    expect(screen.getByText("No owners assigned")).toBeInTheDocument();
    expect(screen.queryByTestId("people-chip")).not.toBeInTheDocument();
  });
});
