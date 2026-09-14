import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, jest as jestGlobal } from "@jest/globals";
import OnCallPageCard, {
  getPageSubject,
  type PageSubject,
} from "./OnCallPageCard";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius } from "../theme/tokens";
import type { OnCallPageItem } from "../api/types";

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

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

  test("an acknowledged response remains acknowledged even when a delivery attempt failed", async (): Promise<void> => {
    await render(
      <OnCallPageCard
        page={page({
          status: "Error",
          acknowledgedAt: new Date().toISOString(),
        })}
      />,
    );
    expect(screen.getByText("Acknowledged")).toBeTruthy();
    expect(screen.queryByText("Failed to notify")).toBeNull();
  });

  test("shows the policy without repeating the selected project", async (): Promise<void> => {
    await render(<OnCallPageCard page={page()} />);

    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  test("says when the policy context is unavailable", async (): Promise<void> => {
    await render(<OnCallPageCard page={page({ policyName: undefined })} />);

    expect(screen.getByText("On-call policy unavailable")).toBeTruthy();
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

type PageStatusToken = "statusSuccessBg" | "statusWarningBg" | "statusErrorBg";

const PAGE_STATUS_CASES: Array<[Partial<OnCallPageItem>, PageStatusToken]> = [
  [{ acknowledgedAt: "2026-03-03T10:00:00Z" }, "statusSuccessBg"],
  [{ status: "Completed" }, "statusWarningBg"],
  [{ status: "Error" }, "statusErrorBg"],
];

describe("OnCallPageCard surface", () => {
  test.each(PAGE_STATUS_CASES)(
    "the status pill for %o uses %s",
    async (
      overrides: Partial<OnCallPageItem>,
      token: PageStatusToken,
    ): Promise<void> => {
      await render(<OnCallPageCard page={page(overrides)} />);

      expect(flatStyle("page-status-log-1").backgroundColor).toBe(
        lightColors[token],
      );
    },
  );

  test("an inert page keeps the card surface and is not a button", async (): Promise<void> => {
    await render(<OnCallPageCard page={page({ triggeredByIncident: null })} />);

    const style: Record<string, unknown> = flatStyle("page-card-log-1");
    expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(style.borderRadius).toBe(radius.lg);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a linked page is one card-shaped button with a hint", async (): Promise<void> => {
    await render(<OnCallPageCard page={page()} onPress={jestGlobal.fn()} />);

    const card: ReturnType<typeof screen.getByRole> = screen.getByRole(
      "button",
      { name: "Replica lag. Not acknowledged." },
    );
    expect(card.props.testID).toBe("page-card-log-1");
    expect(card.props.accessibilityHint).toBe("Open incident details");
    const style: Record<string, unknown> = flatStyle("page-card-log-1");
    expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(style.borderRadius).toBe(radius.lg);
  });

  test("dark mode uses the dark card and status tokens", async (): Promise<void> => {
    mockColorScheme = "dark";
    try {
      await render(
        <ThemeProvider>
          <OnCallPageCard page={page({ status: "Error" })} />
        </ThemeProvider>,
      );

      expect(flatStyle("page-card-log-1").backgroundColor).toBe(
        darkColors.backgroundElevated,
      );
      expect(flatStyle("page-status-log-1").backgroundColor).toBe(
        darkColors.statusErrorBg,
      );
      expect(screen.getByText("Failed to notify")).toHaveStyle({
        color: darkColors.statusError,
      });
    } finally {
      mockColorScheme = "light";
    }
  });
});

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}
