import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, jest, test } from "@jest/globals";
import SecurityCaseCard, {
  describeCaseAssignee,
  getCaseNumber,
  getPersonName,
} from "./SecurityCaseCard";
import { makeSecurityCase } from "../__tests__/testSupport";

/*
 * A security case in a list: where it stands and how urgent, then what it is
 * about, then who has it - and, when a playbook step on it waits for an
 * approval, that in words. A screen reader hears all of it in one label.
 */

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

describe("what a row says", () => {
  test("its status and priority, title, number and who has it", async () => {
    await render(
      <SecurityCaseCard
        securityCase={makeSecurityCase()}
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("Password spray against the VPN")).toBeTruthy();
    expect(screen.getByText("CASE-142 · Security case")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.queryByTestId("response-row-badge")).toBeNull();
  });

  test("a case waiting for an approval says so in words", async () => {
    await render(
      <SecurityCaseCard
        securityCase={makeSecurityCase()}
        awaitingApproval
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByTestId("response-row-badge")).toBeTruthy();
    expect(screen.getByText("Approval needed")).toBeTruthy();
  });

  test("the reader's own case is theirs", async () => {
    await render(
      <SecurityCaseCard
        securityCase={makeSecurityCase({
          assignedToUserId: "me",
          assignedToUser: { _id: "me", name: "Alex Morgan" },
        })}
        isMine
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByText("Assigned to you")).toBeTruthy();
    expect(screen.getByText(glyphFor("person-outline"))).toBeTruthy();
  });

  test("a team's case with nobody on it names the team, with the people icon", async () => {
    await render(
      <SecurityCaseCard
        securityCase={makeSecurityCase({
          assignedToTeamId: "team-1",
          assignedToTeam: { _id: "team-1", name: "Security Operations" },
        })}
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByText("Unassigned · Security Operations")).toBeTruthy();
    expect(screen.getByText(glyphFor("people-outline"))).toBeTruthy();
  });

  test("one label tells a screen reader the whole row", async () => {
    await render(
      <SecurityCaseCard
        securityCase={makeSecurityCase({
          assignedToUserId: "priya",
          assignedToUser: { _id: "priya", name: "Priya Shah" },
        })}
        awaitingApproval
        onPress={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Security case CASE-142, Password spray against the VPN. Status: New. Priority: Critical. Assigned to Priya Shah. A playbook step is waiting for approval.",
      }),
    ).toBeTruthy();
  });

  test("pressing it opens the case", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(
      <SecurityCaseCard securityCase={makeSecurityCase()} onPress={onPress} />,
    );

    await fireEvent.press(screen.getByRole("button"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a case without a status or priority read leaves those words out", async () => {
    await render(
      <SecurityCaseCard
        securityCase={makeSecurityCase({
          securityCaseStatus: null,
          securityCasePriority: null,
        })}
        onPress={jest.fn()}
      />,
    );

    expect(screen.queryByText("New")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Security case CASE-142, Password spray against the VPN. Unassigned.",
      }),
    ).toBeTruthy();
  });
});

describe("the words a row is built from", () => {
  test("a case's number: its prefixed number, else #n, else nothing", () => {
    expect(getCaseNumber(makeSecurityCase())).toBe("CASE-142");
    expect(
      getCaseNumber(makeSecurityCase({ caseNumberWithPrefix: null })),
    ).toBe("#142");
    expect(
      getCaseNumber(
        makeSecurityCase({ caseNumberWithPrefix: null, caseNumber: null }),
      ),
    ).toBe("");
  });

  test("a person by name, else by email, whatever shape the API sends", () => {
    expect(getPersonName({ _id: "a", name: "Priya Shah" })).toBe("Priya Shah");
    expect(
      getPersonName({ _id: "a", name: { _type: "Name", value: "Jordan Lee" } }),
    ).toBe("Jordan Lee");
    expect(getPersonName({ _id: "a", name: " ", email: "j@x.test" })).toBe(
      "j@x.test",
    );
    expect(getPersonName(null)).toBe("");
  });

  test("a case assigned to a person the reader cannot read is still assigned", () => {
    expect(
      describeCaseAssignee(
        makeSecurityCase({ assignedToUserId: "someone", assignedToUser: null }),
        false,
      ),
    ).toEqual({ text: "Assigned", isTeam: false });
  });

  test("a person on a team's case wins over the team", () => {
    expect(
      describeCaseAssignee(
        makeSecurityCase({
          assignedToUserId: "priya",
          assignedToUser: { _id: "priya", name: "Priya Shah" },
          assignedToTeam: { _id: "team-1", name: "Security Operations" },
        }),
        false,
      ),
    ).toEqual({ text: "Assigned to Priya Shah", isTeam: false });
  });
});
