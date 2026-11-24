import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import PendingEmailChange, {
  PENDING_EMAIL_CHANGE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserProfile/PendingEmailChange";
import User from "../../../Models/DatabaseModels/User";
import BadDataException from "../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { writeReaderMoment } from "../../../UI/Utils/ReaderMoments";
import Toast from "../../../UI/Utils/Toast";
import UserUtil from "../../../UI/Utils/User";

/*
 * YOUR EMAIL ADDRESS, AND A NEW ONE WAITING TO BE CONFIRMED (#9821, #9908).
 *
 * A person's own change of address waits for a link to the new address;
 * the server answers every address alike, so the profile says only that
 * the change is waiting - the email to the new address says the rest. The
 * Basic Info card draws the address the person signs in with, the waiting
 * one beside it, and Cancel Change, which clears it (after which its link
 * changes nothing).
 *
 * The link works for a day (#9908). While it works the card says until
 * when; once it has run out the card says so, and Send Link Again asks for
 * the change again - the waiting address written as the new email, which
 * the server holds for a new link and counts as any change. A change kept
 * from before the server kept the time reads as waiting. The card turns to
 * expired by itself when the link runs out while it is open.
 */

const USER_ID: ObjectID = new ObjectID("51515151-5151-4151-8151-515151515151");
const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";

const HOUR_IN_MS: number = 60 * 60 * 1000;

let updateById: jest.SpyInstance;
let toastSuccess: jest.SpyInstance;
let toastError: jest.SpyInstance;
let isMasterAdmin: jest.SpyInstance;

function inHours(hours: number): Date {
  return new Date(Date.now() + hours * HOUR_IN_MS);
}

function renderCard(
  props: Partial<React.ComponentProps<typeof PendingEmailChange>> = {},
): { onChanged: jest.Mock } {
  const onChanged: jest.Mock = jest.fn();

  render(
    <PendingEmailChange
      email={OLD_EMAIL}
      pendingEmail={NEW_EMAIL}
      pendingEmailLinkExpires={inHours(20)}
      onChanged={onChanged}
      {...props}
    />,
  );

  return { onChanged };
}

function writeOf(call: number = 0): {
  modelType: unknown;
  id: ObjectID;
  data: unknown;
} {
  return updateById.mock.calls[call]![0] as {
    modelType: unknown;
    id: ObjectID;
    data: unknown;
  };
}

beforeEach(() => {
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
  isMasterAdmin = jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  updateById = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({} as never);
  toastSuccess = jest.spyOn(Toast, "success").mockReturnValue("toast");
  toastError = jest.spyOn(Toast, "error").mockReturnValue("toast");
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the profile's email address", () => {
  test("with nothing waiting, it is the address and nothing more", () => {
    renderCard({ pendingEmail: null, pendingEmailLinkExpires: null });

    expect(screen.getByTestId("user-profile-email")).toHaveTextContent(
      OLD_EMAIL,
    );
    expect(screen.queryByTestId("user-profile-pending-email")).toBeNull();
    expect(
      screen.queryByTestId("user-profile-pending-email-expired"),
    ).toBeNull();
    expect(screen.queryByText("Cancel Change")).toBeNull();
    expect(screen.queryByText("Send Link Again")).toBeNull();
  });
});

describe("while the link works", () => {
  test("says the change is waiting, that the person signs in with the one they have, and until when the link works", () => {
    const expires: Date = inHours(20);

    renderCard({ pendingEmailLinkExpires: expires });

    const notice: HTMLElement = screen.getByTestId(
      "user-profile-pending-email",
    );

    expect(notice).toHaveTextContent(
      `Waiting for you to confirm ${NEW_EMAIL}.`,
    );
    expect(notice).toHaveTextContent(
      "Open the link we emailed there to finish changing your email address.",
    );
    expect(notice).toHaveTextContent("Until then, you sign in with this one.");
    expect(
      screen.getByTestId("user-profile-pending-email-link-expires"),
    ).toHaveTextContent(`The link works until ${writeReaderMoment(expires)}.`);
    expect(notice).not.toHaveTextContent("expired");
    // Never whether another account has the address: the page cannot know.
    expect(notice.textContent?.toLowerCase()).not.toContain("already");
  });

  test("offers Send Link Again beside Cancel Change, neither of them the page's main action", () => {
    renderCard();

    const sendAgain: HTMLElement = screen.getByTestId(
      "user-profile-send-email-change-again",
    );
    const cancel: HTMLElement = screen.getByTestId(
      "user-profile-cancel-email-change",
    );

    expect(sendAgain).toHaveTextContent("Send Link Again");
    expect(cancel).toHaveTextContent("Cancel Change");
    expect(sendAgain.className).not.toContain("bg-indigo-600");
    expect(cancel.className).not.toContain("bg-indigo-600");
  });

  test("a change kept from before the time was: waiting, with no time it cannot know", () => {
    renderCard({ pendingEmailLinkExpires: null });

    expect(screen.getByTestId("user-profile-pending-email")).toHaveTextContent(
      `Waiting for you to confirm ${NEW_EMAIL}.`,
    );
    expect(
      screen.queryByTestId("user-profile-pending-email-link-expires"),
    ).toBeNull();
    expect(screen.getByText("Send Link Again")).toBeVisible();
    expect(screen.getByText("Cancel Change")).toBeVisible();
  });

  test("the time as the server sent it, as text, reads the same", () => {
    const expires: Date = inHours(5);

    renderCard({ pendingEmailLinkExpires: expires.toISOString() });

    expect(
      screen.getByTestId("user-profile-pending-email-link-expires"),
    ).toHaveTextContent(writeReaderMoment(expires));
  });
});

describe("once the link has run out", () => {
  test("says so, and that nothing has changed", () => {
    renderCard({ pendingEmailLinkExpires: inHours(-1) });

    const notice: HTMLElement = screen.getByTestId(
      "user-profile-pending-email-expired",
    );

    expect(notice).toHaveTextContent(
      `The link we emailed to ${NEW_EMAIL} has expired, so your email address has not changed.`,
    );
    expect(notice).toHaveTextContent(
      "Send a new link to finish the change, or cancel it.",
    );
    expect(screen.queryByTestId("user-profile-pending-email")).toBeNull();
    // It no longer says the change is merely waiting.
    expect(notice).not.toHaveTextContent("Waiting for you to confirm");
    expect(notice.textContent?.toLowerCase()).not.toContain("already");
  });

  test("Send Link Again is the one thing to do, with Cancel Change beside it", () => {
    renderCard({ pendingEmailLinkExpires: inHours(-1) });

    const sendAgain: HTMLElement = screen.getByTestId(
      "user-profile-send-email-change-again",
    );

    expect(sendAgain).toHaveTextContent("Send Link Again");
    expect(sendAgain.className).toContain("bg-indigo-600");
    expect(
      screen.getByTestId("user-profile-cancel-email-change").className,
    ).not.toContain("bg-indigo-600");
  });

  test("turns to expired by itself when the link runs out while the page is open", () => {
    jest.useFakeTimers();

    const expires: Date = new Date(Date.now() + 2000);

    renderCard({ pendingEmailLinkExpires: expires });

    expect(screen.getByTestId("user-profile-pending-email")).toBeVisible();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(
      screen.getByTestId("user-profile-pending-email-expired"),
    ).toBeVisible();
    expect(screen.queryByTestId("user-profile-pending-email")).toBeNull();
  });
});

describe("Send Link Again", () => {
  test("asks for the change again: the waiting address written as the new email", async () => {
    const { onChanged } = renderCard({ pendingEmailLinkExpires: inHours(-1) });

    await act(async () => {
      fireEvent.click(screen.getByText("Send Link Again"));
    });

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(writeOf().modelType).toBe(User);
    expect(writeOf().id.toString()).toBe(USER_ID.toString());
    expect(writeOf().data).toEqual({ email: NEW_EMAIL });
    // The same words whoever has the address.
    expect(toastSuccess).toHaveBeenCalledWith(
      PENDING_EMAIL_CHANGE_COPY.sentAgain,
    );
    expect(PENDING_EMAIL_CHANGE_COPY.sentAgain).toBe(
      "We emailed the new address again.",
    );
    // The card reads the account again: its new link's time.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("works while the link still does, for an email that never arrived", async () => {
    renderCard({ pendingEmailLinkExpires: inHours(3) });

    await act(async () => {
      fireEvent.click(screen.getByText("Send Link Again"));
    });

    expect(writeOf().data).toEqual({ email: NEW_EMAIL });
  });

  test("a refusal - too many changes this hour - says why, and keeps the card as it was", async () => {
    updateById.mockRejectedValue(
      new TooManyRequestsException(
        "You have asked to change your email address too many times in the last hour. Please try again later.",
      ),
    );

    const { onChanged } = renderCard({ pendingEmailLinkExpires: inHours(-1) });

    await act(async () => {
      fireEvent.click(screen.getByText("Send Link Again"));
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("user-profile-pending-email-expired"),
    ).toBeVisible();
  });

  test("a master admin, whose own change is written at once, is offered Cancel Change alone", () => {
    isMasterAdmin.mockReturnValue(true);

    renderCard({ pendingEmailLinkExpires: inHours(-1) });

    expect(screen.queryByText("Send Link Again")).toBeNull();
    expect(screen.getByText("Cancel Change")).toBeVisible();
  });
});

describe("Cancel Change", () => {
  test("clears the waiting address, says so, and reads the account again", async () => {
    const { onChanged } = renderCard();

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel Change"));
    });

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(writeOf().modelType).toBe(User);
    expect(writeOf().id.toString()).toBe(USER_ID.toString());
    expect(writeOf().data).toEqual({ newUnverifiedTemporaryEmail: null });
    expect(toastSuccess).toHaveBeenCalledWith(
      PENDING_EMAIL_CHANGE_COPY.cancelled,
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("works the same once the link has run out", async () => {
    const { onChanged } = renderCard({ pendingEmailLinkExpires: inHours(-1) });

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel Change"));
    });

    expect(writeOf().data).toEqual({ newUnverifiedTemporaryEmail: null });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("a refused cancel says why, and keeps the notice", async () => {
    updateById.mockRejectedValue(
      new BadDataException("Unable to reach OneUptime. Please try again."),
    );

    const { onChanged } = renderCard();

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel Change"));
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId("user-profile-pending-email")).toBeVisible();
  });
});

describe("the Basic Info card", () => {
  const page: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Index.tsx",
    ),
    "utf8",
  );

  test("reads the waiting address and when its link ends, and draws them beside the email", () => {
    expect(page).toContain("newUnverifiedTemporaryEmail: true");
    expect(page).toContain("newUnverifiedTemporaryEmailExpires: true");
    expect(page).toContain("<PendingEmailChange");
    expect(page).toContain("pendingEmailLinkExpires=");
    expect(page).toContain("onChanged=");
  });

  test("says under the Email field that the address changes once its link is opened", () => {
    expect(PENDING_EMAIL_CHANGE_COPY.formDescription).toBe(
      "Your email address changes once you open the link we email to the new one.",
    );
    expect(page).toContain("PENDING_EMAIL_CHANGE_COPY.formDescription");
    // A master admin's own change is written at once, and verified again.
    expect(page).toContain(
      "PENDING_EMAIL_CHANGE_COPY.masterAdminFormDescription",
    );
  });
});
