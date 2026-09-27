import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Sending a subscriber notification again from its status badge.
 *
 * The badge is shared: the incident overview's 'created' notification, the
 * incident and scheduled maintenance state timelines, the postmortem, the
 * scheduled maintenance overview and announcements all use it. Only a caller
 * that passes a confirmation - the incident-created notification - offers
 * Resend after a success and asks before sending; every other caller keeps
 * Retry after a failure only, straight from the details dialog, as before.
 * A skipped notification never offers either.
 */

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

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      description: string | ReactElement;
      submitButtonText?: string;
      closeButtonText?: string;
      onSubmit: () => void;
      onClose?: () => void;
    }): ReactElement => {
      return (
        <div role="dialog" aria-label={props.title}>
          <h2>{props.title}</h2>
          <div>{props.description}</div>
          {props.onClose && (
            <button type="button" onClick={props.onClose}>
              {props.closeButtonText || "Cancel"}
            </button>
          )}
          <button type="button" onClick={props.onSubmit}>
            {props.submitButtonText || "OK"}
          </button>
        </div>
      );
    },
  };
});

import SubscriberNotificationStatus, {
  SubscriberNotificationResendConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus";
import SubscriberNotificationResendCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationResendCopy";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";

afterEach(() => {
  cleanup();
});

const CONFIRMATION: SubscriberNotificationResendConfirmation = {
  resendDescription:
    SubscriberNotificationResendCopy.incidentCreatedResendDescription,
  retryDescription:
    SubscriberNotificationResendCopy.incidentCreatedRetryDescription,
  retryToAllStatusPagesLabel:
    SubscriberNotificationResendCopy.incidentCreatedRetryToAllStatusPagesLabel,
  retryToAllStatusPagesDescription:
    SubscriberNotificationResendCopy.incidentCreatedResendToAllStatusPagesDescription,
  audience: (
    <div data-testid="audience">Will notify: Site 03 (up to 41 email)</div>
  ),
};

function renderBadge(data: {
  status: StatusPageSubscriberNotificationStatus;
  message?: string;
  confirmation?: SubscriberNotificationResendConfirmation;
  onResend?: MockFunction | null;
}): MockFunction {
  const onResend: MockFunction = data.onResend || getJestMockFunction();

  render(
    <SubscriberNotificationStatus
      status={data.status}
      subscriberNotificationStatusMessage={data.message}
      onResendNotification={
        data.onResend === null
          ? undefined
          : (...args: Array<unknown>) => {
              onResend(...args);
            }
      }
      resendConfirmation={data.confirmation}
    />,
  );

  return onResend;
}

function openDetails(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: /more details/ }));

  return screen.getByRole("dialog", { name: "Notification Status Details" });
}

describe("SubscriberNotificationStatus without a confirmation: as before", () => {
  test("a failure offers Retry, which sends it again at once", () => {
    const onResend: MockFunction = renderBadge({
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: "SMTP relay refused.",
    });

    const dialog: HTMLElement = openDetails();

    expect(within(dialog).getByText("SMTP relay refused.")).toBeVisible();

    act(() => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });

    expect(onResend).toHaveBeenCalledWith({ isToAllStatusPages: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a success offers nothing: not even the details button", () => {
    renderBadge({
      status: StatusPageSubscriberNotificationStatus.Success,
      message: "Site 03: 41 email sent.",
    });

    expect(screen.queryByRole("button", { name: /more details/ })).toBeNull();
    expect(screen.getByText("Notifications Sent")).toBeInTheDocument();
  });

  test("a skip shows its reason and only closes", () => {
    const onResend: MockFunction = renderBadge({
      status: StatusPageSubscriberNotificationStatus.Skipped,
      message: "Incident is not visible on status pages.",
    });

    const dialog: HTMLElement = openDetails();

    expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(onResend).not.toHaveBeenCalled();
  });
});

describe("SubscriberNotificationStatus with a confirmation (the incident-created notification)", () => {
  test("a success offers Resend, which asks first, naming who it reaches", () => {
    const onResend: MockFunction = renderBadge({
      status: StatusPageSubscriberNotificationStatus.Success,
      message: "Site 03: 41 email sent.",
      confirmation: CONFIRMATION,
    });

    const details: HTMLElement = openDetails();

    expect(within(details).getByText("Site 03: 41 email sent.")).toBeVisible();

    fireEvent.click(within(details).getByRole("button", { name: "Resend" }));

    // Nothing is sent from the details: the confirmation asks first.
    expect(onResend).not.toHaveBeenCalled();

    const confirm: HTMLElement = screen.getByRole("dialog", {
      name: SubscriberNotificationResendCopy.resendConfirmTitle,
    });

    expect(
      within(confirm).getByTestId("subscriber-notification-resend-description"),
    ).toHaveTextContent(
      SubscriberNotificationResendCopy.incidentCreatedResendDescription,
    );
    expect(within(confirm).getByTestId("audience")).toHaveTextContent(
      "Will notify: Site 03 (up to 41 email)",
    );
    // A resend always goes to every page: there is nothing to choose.
    expect(
      within(confirm).queryByTestId(
        "subscriber-notification-resend-to-all-pages",
      ),
    ).toBeNull();

    act(() => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Resend" }));
    });

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onResend).toHaveBeenCalledWith({ isToAllStatusPages: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a success without a message still offers Resend", () => {
    renderBadge({
      status: StatusPageSubscriberNotificationStatus.Success,
      confirmation: CONFIRMATION,
    });

    const details: HTMLElement = openDetails();

    expect(
      within(details).getByText("No additional information available."),
    ).toBeVisible();
    expect(
      within(details).getByRole("button", { name: "Resend" }),
    ).toBeInTheDocument();
  });

  test("a failure offers Retry, which says it resumes after the pages already reached", () => {
    const onResend: MockFunction = renderBadge({
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: "Not every subscriber was sent this notification.",
      confirmation: CONFIRMATION,
    });

    fireEvent.click(
      within(openDetails()).getByRole("button", { name: "Retry" }),
    );

    const confirm: HTMLElement = screen.getByRole("dialog", {
      name: SubscriberNotificationResendCopy.retryConfirmTitle,
    });

    expect(
      within(confirm).getByTestId("subscriber-notification-resend-description"),
    ).toHaveTextContent(
      SubscriberNotificationResendCopy.incidentCreatedRetryDescription,
    );
    expect(within(confirm).getByTestId("audience")).toBeInTheDocument();

    const toAll: HTMLElement = within(confirm).getByTestId(
      "subscriber-notification-resend-to-all-pages",
    );
    expect(toAll).not.toBeChecked();

    act(() => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Retry" }));
    });

    expect(onResend).toHaveBeenCalledWith({ isToAllStatusPages: false });
  });

  test("ticking 'every status page' turns Retry into 'Resend to all pages'", () => {
    const onResend: MockFunction = renderBadge({
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: "Not every subscriber was sent this notification.",
      confirmation: CONFIRMATION,
    });

    fireEvent.click(
      within(openDetails()).getByRole("button", { name: "Retry" }),
    );

    const confirm: HTMLElement = screen.getByRole("dialog", {
      name: SubscriberNotificationResendCopy.retryConfirmTitle,
    });

    act(() => {
      fireEvent.click(
        within(confirm).getByTestId(
          "subscriber-notification-resend-to-all-pages",
        ),
      );
    });

    expect(
      within(confirm).getByTestId("subscriber-notification-resend-description"),
    ).toHaveTextContent(
      SubscriberNotificationResendCopy.incidentCreatedResendToAllStatusPagesDescription,
    );

    act(() => {
      fireEvent.click(
        within(confirm).getByRole("button", {
          name: SubscriberNotificationResendCopy.resendToAllStatusPagesButton,
        }),
      );
    });

    expect(onResend).toHaveBeenCalledWith({ isToAllStatusPages: true });
  });

  test("the box starts unticked every time the dialog opens", () => {
    renderBadge({
      status: StatusPageSubscriberNotificationStatus.Failed,
      message: "Not every subscriber was sent this notification.",
      confirmation: CONFIRMATION,
    });

    fireEvent.click(
      within(openDetails()).getByRole("button", { name: "Retry" }),
    );
    act(() => {
      fireEvent.click(
        screen.getByTestId("subscriber-notification-resend-to-all-pages"),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(
      within(openDetails()).getByRole("button", { name: "Retry" }),
    );

    expect(
      screen.getByTestId("subscriber-notification-resend-to-all-pages"),
    ).not.toBeChecked();
  });

  test("Cancel sends nothing", () => {
    const onResend: MockFunction = renderBadge({
      status: StatusPageSubscriberNotificationStatus.Success,
      confirmation: CONFIRMATION,
    });

    fireEvent.click(
      within(openDetails()).getByRole("button", { name: "Resend" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onResend).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "a %s notification offers neither",
    (status: StatusPageSubscriberNotificationStatus) => {
      renderBadge({
        status,
        message: "Some message.",
        confirmation: CONFIRMATION,
      });

      const detailsButton: HTMLElement | null = screen.queryByRole("button", {
        name: /more details/,
      });

      if (!detailsButton) {
        return;
      }

      fireEvent.click(detailsButton);

      const dialog: HTMLElement = screen.getByRole("dialog");

      expect(
        within(dialog).queryByRole("button", { name: "Resend" }),
      ).toBeNull();
      expect(
        within(dialog).queryByRole("button", { name: "Retry" }),
      ).toBeNull();
    },
  );

  test("without a way to send it, nothing is offered", () => {
    renderBadge({
      status: StatusPageSubscriberNotificationStatus.Success,
      confirmation: CONFIRMATION,
      onResend: null,
    });

    expect(screen.queryByRole("button", { name: /more details/ })).toBeNull();
  });
});
