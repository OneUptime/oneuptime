import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import SubscriptionConfirmationLink from "../../../Types/StatusPage/SubscriptionConfirmationLink";
import {
  SubscriberFormCopy,
  SubscriberTableStatus,
  getSubscriberTableStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices";
import SubscriberStatusPill from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberStatusPill";

/*
 * A status page's Email Subscribers and SMS Subscribers lists, and the
 * Status they show.
 *
 * An email or SMS subscriber who has not confirmed yet waits for the link
 * we sent them - while it works: a day after it was sent, as their Created
 * At (the Subscribed At column) says (SubscriptionConfirmationLink). Once it
 * has run out they never will confirm with it, and are sent nothing: the
 * list says Link Expired, and how to get them a new link, rather than
 * Awaiting Confirmation for good.
 */

const NOW: number = Date.UTC(2032, 2, 1, 12);
const HOUR: number = 60 * 60 * 1000;

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function subscriber(values: {
  isUnsubscribed?: boolean;
  isSubscriptionConfirmed?: boolean;
  hoursAgo?: number;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();

  if (values.isUnsubscribed !== undefined) {
    row.isUnsubscribed = values.isUnsubscribed;
  }

  if (values.isSubscriptionConfirmed !== undefined) {
    row.isSubscriptionConfirmed = values.isSubscriptionConfirmed;
  }

  if (values.hoursAgo !== undefined) {
    row.createdAt = new Date(NOW - values.hoursAgo * HOUR);
  }

  return row;
}

describe("getSubscriberTableStatus", () => {
  test.each([
    [
      "confirmed a year ago",
      {
        isUnsubscribed: false,
        isSubscriptionConfirmed: true,
        hoursAgo: 365 * 24,
      },
      SubscriberTableStatus.Subscribed,
    ],
    [
      "unsubscribed after confirming",
      { isUnsubscribed: true, isSubscriptionConfirmed: true, hoursAgo: 2 },
      SubscriberTableStatus.Unsubscribed,
    ],
    [
      "unsubscribed before confirming",
      { isUnsubscribed: true, isSubscriptionConfirmed: false, hoursAgo: 2 },
      SubscriberTableStatus.Unsubscribed,
    ],
    [
      "waiting, the link sent an hour ago",
      { isUnsubscribed: false, isSubscriptionConfirmed: false, hoursAgo: 1 },
      SubscriberTableStatus.AwaitingConfirmation,
    ],
    [
      "waiting, the link sent a minute short of a day ago",
      {
        isUnsubscribed: false,
        isSubscriptionConfirmed: false,
        hoursAgo: 24 - 1 / 60,
      },
      SubscriberTableStatus.AwaitingConfirmation,
    ],
    [
      "waiting, the link sent a day ago",
      { isUnsubscribed: false, isSubscriptionConfirmed: false, hoursAgo: 24 },
      SubscriberTableStatus.LinkExpired,
    ],
    [
      "waiting, the link sent a month ago",
      {
        isUnsubscribed: false,
        isSubscriptionConfirmed: false,
        hoursAgo: 30 * 24,
      },
      SubscriberTableStatus.LinkExpired,
    ],
    [
      "waiting, at an age that cannot be told",
      { isUnsubscribed: false, isSubscriptionConfirmed: false },
      SubscriberTableStatus.LinkExpired,
    ],
  ])(
    "%s: %s",
    (
      _label: string,
      values: {
        isUnsubscribed?: boolean;
        isSubscriptionConfirmed?: boolean;
        hoursAgo?: number;
      },
      expected: SubscriberTableStatus,
    ) => {
      expect(
        getSubscriberTableStatus(
          subscriber(values) as unknown as Record<string, unknown>,
          NOW,
        ),
      ).toBe(expected);
    },
  );

  test("reads Created At as the list hands it over, as text too", () => {
    expect(
      getSubscriberTableStatus(
        {
          isUnsubscribed: false,
          isSubscriptionConfirmed: false,
          createdAt: new Date(NOW - HOUR).toISOString(),
        },
        NOW,
      ),
    ).toBe(SubscriberTableStatus.AwaitingConfirmation);
  });

  test("its day is the server's: a link works for 24 hours", () => {
    expect(SubscriptionConfirmationLink.VALID_FOR_HOURS).toBe(24);
  });

  test("reads the browser's clock when it is not told the time", () => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);

    expect(
      getSubscriberTableStatus(
        subscriber({
          isUnsubscribed: false,
          isSubscriptionConfirmed: false,
          hoursAgo: 25,
        }) as unknown as Record<string, unknown>,
      ),
    ).toBe(SubscriberTableStatus.LinkExpired);
  });
});

describe("SubscriberStatusPill", () => {
  function renderPill(row: StatusPageSubscriber): void {
    render(
      <SubscriberStatusPill
        subscriber={row}
        awaitingConfirmationDescription={
          SubscriberFormCopy.awaitingConfirmationDescription
        }
      />,
    );
  }

  test("says Link Expired, and what to do, for one whose link ran out", () => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);

    renderPill(
      subscriber({
        isUnsubscribed: false,
        isSubscriptionConfirmed: false,
        hoursAgo: 48,
      }),
    );

    expect(screen.getByTestId("pill")).toHaveTextContent(
      SubscriberFormCopy.linkExpiredTitle,
    );
    expect(SubscriberFormCopy.linkExpiredTitle).toBe("Link Expired");
    expect(SubscriberFormCopy.linkExpiredDescription).toBe(
      "Gets nothing: the link we sent them to confirm expired before they opened it. They can sign up again, or you can add them again.",
    );
  });

  test("says Awaiting Confirmation while the link works", () => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);

    renderPill(
      subscriber({
        isUnsubscribed: false,
        isSubscriptionConfirmed: false,
        hoursAgo: 2,
      }),
    );

    expect(screen.getByTestId("pill")).toHaveTextContent(
      "Awaiting Confirmation",
    );
  });

  test.each([
    [
      "Subscribed",
      { isUnsubscribed: false, isSubscriptionConfirmed: true, hoursAgo: 400 },
    ],
    [
      "Unsubscribed",
      { isUnsubscribed: true, isSubscriptionConfirmed: false, hoursAgo: 400 },
    ],
  ])(
    "says %s as before",
    (
      text: string,
      values: {
        isUnsubscribed?: boolean;
        isSubscriptionConfirmed?: boolean;
        hoursAgo?: number;
      },
    ) => {
      jest.spyOn(Date, "now").mockReturnValue(NOW);

      renderPill(subscriber(values));

      expect(screen.getByTestId("pill")).toHaveTextContent(text);
    },
  );
});

describe("the lists that show it", () => {
  const VIEW_DIRECTORY: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View",
  );

  test.each([
    [
      "EmailSubscribers.tsx",
      "SubscriberFormCopy.awaitingConfirmationDescription",
    ],
    [
      "SMSSubscribers.tsx",
      "SubscriberFormCopy.awaitingTextConfirmationDescription",
    ],
  ])(
    "%s draws its Status with the pill, saying how the link reaches them",
    (file: string, description: string) => {
      const code: string = fs
        .readFileSync(path.join(VIEW_DIRECTORY, file), "utf8")
        .replace(/\s+/g, " ");

      expect(code).toContain(
        `<SubscriberStatusPill subscriber={item} awaitingConfirmationDescription={ ${description} } />`,
      );
      // Created At, which the Status reads, is one of the list's columns.
      expect(code).toContain("field: { createdAt: true, }");
      // The pill decides alone: no list keeps an Awaiting Confirmation of its own.
      expect(code).not.toContain('text={"Awaiting Confirmation"}');
    },
  );
});
