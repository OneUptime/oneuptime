import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The subscriber notification badge. A caller that knows why notifications
 * were skipped can name the reason in the badge itself (statusText), and that
 * label goes through the dashboard's translations like the rest of the UI.
 * Without it the badge keeps its own wording.
 */

const translated: Record<string, string> = {
  "Skipped: hidden from status pages":
    "Übersprungen: auf Statusseiten ausgeblendet",
};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value === undefined ? value : translated[value] || value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import SubscriberNotificationStatus from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";

afterEach(() => {
  cleanup();
});

describe("SubscriberNotificationStatus label", () => {
  test("shows the caller's reason instead of the generic skipped label, translated", () => {
    render(
      <SubscriberNotificationStatus
        status={StatusPageSubscriberNotificationStatus.Skipped}
        subscriberNotificationStatusMessage={
          IncidentCreatedRenotify.hiddenFromStatusPagesMessage
        }
        statusText={IncidentCreatedRenotify.hiddenFromStatusPagesLabel}
      />,
    );

    expect(
      screen.getByText("Übersprungen: auf Statusseiten ausgeblendet"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Notifications skipped.")).toBeNull();
    // The full message is still one click away.
    expect(
      screen.getByRole("button", { name: /more details/ }),
    ).toBeInTheDocument();
  });

  test("an untranslated reason is shown as written", () => {
    render(
      <SubscriberNotificationStatus
        status={StatusPageSubscriberNotificationStatus.Skipped}
        statusText="Skipped: some other reason"
      />,
    );

    expect(screen.getByText("Skipped: some other reason")).toBeInTheDocument();
  });

  test.each([
    [StatusPageSubscriberNotificationStatus.Skipped, "Notifications skipped."],
    [StatusPageSubscriberNotificationStatus.Pending, "Sending Soon"],
    [StatusPageSubscriberNotificationStatus.Success, "Notifications Sent"],
    [StatusPageSubscriberNotificationStatus.Failed, "Failed"],
  ])(
    "keeps its own label for %s when no reason is given",
    (status: StatusPageSubscriberNotificationStatus, label: string) => {
      render(<SubscriberNotificationStatus status={status} />);

      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});
