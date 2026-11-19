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
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Toast from "../../../UI/Utils/Toast";
import UserUtil from "../../../UI/Utils/User";

/*
 * YOUR EMAIL ADDRESS, AND A NEW ONE WAITING TO BE CONFIRMED (#9821).
 *
 * A person's own change of address waits for a link to the new address;
 * the server answers every address alike, so the profile says only that
 * the change is waiting - the email to the new address says the rest. The
 * Basic Info card draws the address the person signs in with, the waiting
 * one beside it, and Cancel Change, which clears it (after which its link
 * changes nothing).
 */

const USER_ID: ObjectID = new ObjectID("51515151-5151-4151-8151-515151515151");
const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";

let updateById: jest.SpyInstance;
let toastSuccess: jest.SpyInstance;
let toastError: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
  updateById = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({} as never);
  toastSuccess = jest.spyOn(Toast, "success").mockReturnValue("toast");
  toastError = jest.spyOn(Toast, "error").mockReturnValue("toast");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the profile's email address", () => {
  test("with nothing waiting, it is the address and nothing more", () => {
    render(
      <PendingEmailChange
        email={OLD_EMAIL}
        pendingEmail={null}
        onCancelled={jest.fn()}
      />,
    );

    expect(screen.getByTestId("user-profile-email")).toHaveTextContent(
      OLD_EMAIL,
    );
    expect(screen.queryByTestId("user-profile-pending-email")).toBeNull();
    expect(screen.queryByText("Cancel Change")).toBeNull();
  });

  test("a new address waiting says so, and that the person signs in with the one they have", () => {
    render(
      <PendingEmailChange
        email={OLD_EMAIL}
        pendingEmail={NEW_EMAIL}
        onCancelled={jest.fn()}
      />,
    );

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
    // Never whether another account has the address: the page cannot know.
    expect(notice.textContent?.toLowerCase()).not.toContain("already");
  });

  test("Cancel Change clears the waiting address, says so, and reads the account again", async () => {
    const onCancelled: jest.Mock = jest.fn();

    render(
      <PendingEmailChange
        email={OLD_EMAIL}
        pendingEmail={NEW_EMAIL}
        onCancelled={onCancelled}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel Change"));
    });

    expect(updateById).toHaveBeenCalledTimes(1);

    const write: { modelType: unknown; id: ObjectID; data: unknown } =
      updateById.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        data: unknown;
      };

    expect(write.modelType).toBe(User);
    expect(write.id.toString()).toBe(USER_ID.toString());
    expect(write.data).toEqual({ newUnverifiedTemporaryEmail: null });
    expect(toastSuccess).toHaveBeenCalledWith(
      PENDING_EMAIL_CHANGE_COPY.cancelled,
    );
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  test("a refused cancel says why, and keeps the notice", async () => {
    const onCancelled: jest.Mock = jest.fn();
    updateById.mockRejectedValue(
      new BadDataException("Unable to reach OneUptime. Please try again."),
    );

    render(
      <PendingEmailChange
        email={OLD_EMAIL}
        pendingEmail={NEW_EMAIL}
        onCancelled={onCancelled}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel Change"));
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(onCancelled).not.toHaveBeenCalled();
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

  test("reads the waiting address and draws it beside the email", () => {
    expect(page).toContain("newUnverifiedTemporaryEmail: true");
    expect(page).toContain("<PendingEmailChange");
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
