import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react-native";
import { describe, test, expect, beforeEach } from "@jest/globals";
import MyOnCallPagesScreen from "./MyOnCallPagesScreen";
import type { OnCallPageItem } from "../api/types";

const mockNavigate: jest.Mock = jest.fn();
const mockRefetch: jest.Mock = jest.fn();
const mockPages: {
  current: {
    pages: OnCallPageItem[];
    isLoading: boolean;
    isError: boolean;
    refetch: jest.Mock;
  };
} = {
  current: {
    pages: [],
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  },
};

jest.mock("../hooks/useMyOnCallPages", () => {
  return {
    useMyOnCallPages: () => {
      return mockPages.current;
    },
  };
});
jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return {
        getParent: () => {
          return { navigate: mockNavigate };
        },
      };
    },
  };
});
jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        lightImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

function page(overrides: Partial<OnCallPageItem> = {}): OnCallPageItem {
  return {
    _id: "page-1",
    projectId: "project-1",
    projectName: "Production",
    createdAt: "2026-09-10T09:00:00Z",
    acknowledgedAt: null,
    status: "Completed",
    triggeredByIncident: null,
    triggeredByAlert: null,
    triggeredByIncidentEpisode: null,
    triggeredByAlertEpisode: null,
    ...overrides,
  };
}

describe("My pages response workflow", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockRefetch.mockReset();
    mockPages.current = {
      pages: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    };
  });

  test("filters by acknowledgement even when notification delivery completed or failed", async (): Promise<void> => {
    mockPages.current.pages = [
      page({
        _id: "unanswered",
        triggeredByIncident: { _id: "incident", title: "Database unavailable" },
      }),
      page({ _id: "answered", acknowledgedAt: "2026-09-10T09:05:00Z" }),
      page({ _id: "failed", status: "Error" }),
    ];
    await render(<MyOnCallPagesScreen />);
    expect(screen.getByText("2 pages need a response")).toBeTruthy();
    await fireEvent.press(screen.getByText("Unacknowledged (2)"));
    expect(screen.queryByTestId("page-card-answered")).toBeNull();
    expect(screen.getByTestId("page-card-unanswered")).toBeTruthy();
    expect(screen.getByTestId("page-card-failed")).toBeTruthy();
    await fireEvent.press(screen.getByText("All (3)"));
    expect(screen.getByTestId("page-card-answered")).toBeTruthy();
  });

  test.each([
    {
      field: "triggeredByIncident",
      tab: "Inbox",
      destination: "IncidentDetail",
      idKey: "incidentId",
    },
    {
      field: "triggeredByAlert",
      tab: "Inbox",
      destination: "AlertDetail",
      idKey: "alertId",
    },
    {
      field: "triggeredByIncidentEpisode",
      tab: "Inbox",
      destination: "IncidentEpisodeDetail",
      idKey: "episodeId",
    },
    {
      field: "triggeredByAlertEpisode",
      tab: "Inbox",
      destination: "AlertEpisodeDetail",
      idKey: "episodeId",
    },
  ])(
    "opens $destination in the correct project and tab while preserving its inbox Back route",
    async ({
      field,
      tab,
      destination,
      idKey,
    }: {
      field: string;
      tab: string;
      destination: string;
      idKey: string;
    }): Promise<void> => {
      mockPages.current.pages = [
        page({
          [field]: { _id: "resource-1", title: "Service needs attention" },
        }),
      ];
      await render(<MyOnCallPagesScreen />);
      await fireEvent.press(
        screen.getByRole("button", {
          name: "Service needs attention. Not acknowledged.",
        }),
      );
      expect(mockNavigate).toHaveBeenCalledWith(tab, {
        screen: destination,
        initial: false,
        params: { [idKey]: "resource-1", projectId: "project-1" },
      });
    },
  );

  test("keeps pages without a resource readable without offering broken navigation", async (): Promise<void> => {
    mockPages.current.pages = [page()];
    await render(<MyOnCallPagesScreen />);
    expect(screen.getByText("On-call notification")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /On-call notification/ }),
    ).toBeNull();
  });

  test("explains an empty unanswered filter and reserves generous bottom clearance", async (): Promise<void> => {
    mockPages.current.pages = [
      page({ acknowledgedAt: "2026-09-10T09:05:00Z" }),
    ];
    await render(<MyOnCallPagesScreen />);
    await fireEvent.press(screen.getByText("Unacknowledged (0)"));
    expect(
      screen.getByText("Every page in this list has been acknowledged."),
    ).toBeTruthy();
    expect(
      screen.getByTestId("my-pages-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBeGreaterThanOrEqual(124);
  });

  test("offers retry for a failed read without claiming all pages were answered", async (): Promise<void> => {
    mockPages.current.isError = true;
    await render(<MyOnCallPagesScreen />);
    expect(screen.getByText("Could not load your pages")).toBeTruthy();
    expect(screen.queryByText("All listed pages acknowledged")).toBeNull();
    await fireEvent.press(screen.getByText("Retry"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  test("keeps loading and no-notification states distinct", async (): Promise<void> => {
    mockPages.current.isLoading = true;
    const rendered: Awaited<ReturnType<typeof render>> = await render(
      <MyOnCallPagesScreen />,
    );
    expect(screen.queryByText("No pages yet")).toBeNull();
    mockPages.current.isLoading = false;
    await rendered.rerender(<MyOnCallPagesScreen />);
    expect(screen.getByText("No pages yet")).toBeTruthy();
  });
});

describe("Refresh recovery", () => {
  test.each([false, true])(
    "keeps refresh available and visible while pending (error: %s)",
    async (isError: boolean) => {
      let finish: () => void = (): void => {};
      const refresh: jest.Mock = jest.fn(() => {
        return new Promise<void>((resolve: () => void) => {
          finish = resolve;
        });
      });
      mockPages.current = {
        pages: [],
        isLoading: false,
        isError,
        refetch: refresh,
      };
      await render(<MyOnCallPagesScreen />);
      expect(screen.getByText("My pages")).toBeTruthy();
      let request: Promise<void>;
      await act(() => {
        request = screen
          .getByTestId("my-pages-scroll")
          .props.refreshControl.props.onRefresh();
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("my-pages-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(true);
      await act(async () => {
        finish();
        await request;
      });
      expect(
        screen.getByTestId("my-pages-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(false);
    },
  );
});
