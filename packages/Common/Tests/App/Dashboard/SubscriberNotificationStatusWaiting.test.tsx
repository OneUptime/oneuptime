import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The subscriber notification badge, drawn as waiting. A postmortem
 * published while its incident is hidden is not skipped for good: it is sent
 * when the incident is made visible on status pages. So the Postmortem page
 * labels it "Not sent yet: incident hidden from status pages" and asks the
 * badge to draw it as waiting - a clock - instead of the crossed-out circle
 * of a skip that will never be sent. Its colour stays the status's own.
 *
 * IconText is stood in for, to read which icon and colour the badge asks for.
 */

jest.mock("../../../UI/Components/IconText/IconText", () => {
  return {
    __esModule: true,
    default: (props: {
      text: string;
      icon: string;
      iconColor?: { toString: () => string } | null;
    }): ReactElement => {
      return (
        <span
          data-testid="badge"
          data-icon={props.icon}
          data-color={props.iconColor?.toString() || ""}
        >
          {props.text}
        </span>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import SubscriberNotificationStatus from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus";
import { Gray500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import IncidentPostmortemPublication from "../../../Types/StatusPage/IncidentPostmortemPublication";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";

afterEach(() => {
  cleanup();
});

function badge(): HTMLElement {
  return screen.getByTestId("badge");
}

describe("SubscriberNotificationStatus, waiting", () => {
  test("a skip drawn as waiting shows a clock, in the skip's own grey, with the caller's label", () => {
    render(
      <SubscriberNotificationStatus
        status={StatusPageSubscriberNotificationStatus.Skipped}
        subscriberNotificationStatusMessage={
          IncidentPostmortemPublication.hiddenIncidentMessage
        }
        statusText={IncidentPostmortemPublication.hiddenIncidentLabel}
        isWaiting={true}
      />,
    );

    expect(badge()).toHaveAttribute("data-icon", IconProp.Clock);
    expect(badge()).toHaveAttribute("data-color", Gray500.toString());
    expect(badge()).toHaveTextContent(
      IncidentPostmortemPublication.hiddenIncidentLabel,
    );
    // Why it waits is one click away.
    expect(
      screen.getByRole("button", { name: /more details/ }),
    ).toBeInTheDocument();
  });

  test("a skip not drawn as waiting keeps the crossed-out circle", () => {
    render(
      <SubscriberNotificationStatus
        status={StatusPageSubscriberNotificationStatus.Skipped}
        subscriberNotificationStatusMessage={
          IncidentPostmortemPublication.notShownMessage
        }
      />,
    );

    expect(badge()).toHaveAttribute("data-icon", IconProp.CircleClose);
    expect(badge()).toHaveTextContent("Notifications skipped.");
  });

  test("waiting changes only the icon: every other status keeps its own colour and label", () => {
    render(
      <SubscriberNotificationStatus
        status={StatusPageSubscriberNotificationStatus.Success}
        isWaiting={false}
      />,
    );

    expect(badge()).toHaveAttribute("data-icon", IconProp.CheckCircle);
    expect(badge()).toHaveTextContent("Notifications Sent");
  });

  test("offers neither Retry nor Resend for a waiting skip: showing the incident is what sends it", () => {
    render(
      <SubscriberNotificationStatus
        status={StatusPageSubscriberNotificationStatus.Skipped}
        subscriberNotificationStatusMessage={
          IncidentPostmortemPublication.hiddenIncidentMessage
        }
        statusText={IncidentPostmortemPublication.hiddenIncidentLabel}
        isWaiting={true}
        onResendNotification={(): void => {
          // Never offered.
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });
});
