import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, jest as jestGlobal } from "@jest/globals";
import OnCallPageCard, {
  getPageSubject,
  type PageSubject,
} from "./OnCallPageCard";
import type { OnCallPageItem } from "../api/types";

/*
 * The one thing this card must never do is let "Completed" read as "somebody
 * dealt with it". Completed is the SERVER's status - it means the notification
 * rules finished running - and a page that woke nobody is Completed too. So
 * acknowledgement, not execution status, is what the badge reports.
 */

function page(overrides: Partial<OnCallPageItem> = {}): OnCallPageItem {
  return {
    _id: "log-1",
    projectId: "project-1",
    projectName: "Acme",
    createdAt: new Date().toISOString(),
    status: "Completed",
    acknowledgedAt: null,
    policyName: "Database",
    triggeredByIncident: { _id: "incident-1", title: "Replica lag" },
    triggeredByAlert: null,
    triggeredByIncidentEpisode: null,
    triggeredByAlertEpisode: null,
    ...overrides,
  };
}

describe("getPageSubject", () => {
  test("picks the incident when the page came from one", () => {
    const subject: PageSubject = getPageSubject(page());

    expect(subject).toEqual({
      title: "Replica lag",
      kind: "incident",
      id: "incident-1",
    });
  });

  test("picks the alert when there is no incident", () => {
    const subject: PageSubject = getPageSubject(
      page({
        triggeredByIncident: null,
        triggeredByAlert: { _id: "alert-1", title: "Disk full" },
      }),
    );

    expect(subject.kind).toBe("alert");
    expect(subject.id).toBe("alert-1");
  });

  test("handles both episode kinds", () => {
    expect(
      getPageSubject(
        page({
          triggeredByIncident: null,
          triggeredByIncidentEpisode: { _id: "ie-1", title: "Rolling outage" },
        }),
      ).kind,
    ).toBe("incident-episode");

    expect(
      getPageSubject(
        page({
          triggeredByIncident: null,
          triggeredByAlertEpisode: { _id: "ae-1", title: "Flapping" },
        }),
      ).kind,
    ).toBe("alert-episode");
  });

  test("degrades to a generic subject with no id when nothing is linked", () => {
    const subject: PageSubject = getPageSubject(
      page({ triggeredByIncident: null }),
    );

    expect(subject).toEqual({
      title: "On-call notification",
      kind: "unknown",
      id: null,
    });
  });

  test("uses a fallback title when the linked resource has none", () => {
    const subject: PageSubject = getPageSubject(
      page({ triggeredByIncident: { _id: "incident-1" } }),
    );

    expect(subject.title).toBe("Incident");
  });
});

describe("OnCallPageCard status", () => {
  test("an acknowledged page says so", async (): Promise<void> => {
    await render(
      <OnCallPageCard
        page={page({ acknowledgedAt: new Date().toISOString() })}
      />,
    );

    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });

  test("a delivered but unanswered page says NOT acknowledged, despite 'Completed'", async (): Promise<void> => {
    /*
     * The whole point of the screen. `status: "Completed"` here is the server
     * saying it finished paging - not that anybody picked up.
     */
    await render(<OnCallPageCard page={page({ status: "Completed" })} />);

    expect(screen.getByText("Not acknowledged")).toBeTruthy();
    expect(screen.queryByText("Acknowledged")).toBeNull();
  });

  test("a failed notification is called out separately", async (): Promise<void> => {
    await render(<OnCallPageCard page={page({ status: "Error" })} />);

    expect(screen.getByText("Failed to notify")).toBeTruthy();
  });

  test("shows the project and policy that paged you", async (): Promise<void> => {
    await render(<OnCallPageCard page={page()} />);

    expect(screen.getByText("Acme · Database")).toBeTruthy();
  });

  test("falls back to just the project when the policy is unknown", async (): Promise<void> => {
    await render(<OnCallPageCard page={page({ policyName: undefined })} />);

    expect(screen.getByText("Acme")).toBeTruthy();
  });
});

describe("OnCallPageCard navigation", () => {
  test("is pressable when it points at something", async (): Promise<void> => {
    const onPress: (item: OnCallPageItem) => void = jestGlobal.fn();

    await render(<OnCallPageCard page={page()} onPress={onPress} />);

    await fireEvent.press(screen.getByLabelText(/Replica lag/));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("is inert when the page links to nothing", async (): Promise<void> => {
    /*
     * A chevron that navigates nowhere is worse than no chevron - it reads as
     * a broken app rather than as a page whose resource was deleted.
     */
    const onPress: (item: OnCallPageItem) => void = jestGlobal.fn();

    await render(
      <OnCallPageCard
        page={page({ triggeredByIncident: null })}
        onPress={onPress}
      />,
    );

    expect(screen.queryByLabelText(/On-call notification/)).toBeNull();
  });
});
