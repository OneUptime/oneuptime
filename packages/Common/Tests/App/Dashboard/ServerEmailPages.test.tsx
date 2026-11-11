import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import InvitationLinkModal, {
  fetchInvitationLink,
  INVITATION_LINK_ROUTE,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
import { getGettingStartedTaskDescription } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import {
  ADMIN_EMAIL_SETTINGS_ROUTE,
  cannotSendEmail,
  getAdminEmailSettingsUrl,
  SERVER_EMAIL_COPY,
  ServerEmail,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ServerEmail";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE DASHBOARD ON A SERVER THAT CANNOT SEND EMAIL (#6825).
 *
 *   - Home's on-call step and Create Monitor's card say who is told: the
 *     project's owners by email where the server can send one; where it
 *     cannot, that nobody is, and the fix - for a master admin, setting
 *     email up in the Admin Dashboard; for anybody else, asking the
 *     server's admin. While the answer is on its way, the old words: on a
 *     server that can send, nothing changes;
 *   - a master admin who invites someone is handed the invitation's link
 *     (POST /team-member/invitation-link) to send themselves: the sign-up
 *     link for someone new, the sign-in page for someone with an account,
 *     and a way on when the link cannot be read.
 */

const ON_CALL_STEP: {
  description: string;
  descriptionWithoutEmail: { forAdmin: string; forOthers: string };
} = {
  description:
    "Page the right person when an incident or alert opens. Until then, the project's owners get an email.",
  descriptionWithoutEmail: {
    forAdmin: SERVER_EMAIL_COPY.onCallStepDescriptionForAdmin,
    forOthers: SERVER_EMAIL_COPY.onCallStepDescription,
  },
};

function server(
  canSendEmail: boolean | null,
  isMasterAdmin: boolean,
): ServerEmail {
  return { canSendEmail: canSendEmail, isMasterAdmin: isMasterAdmin };
}

describe("what a page says about who is emailed", () => {
  test.each([
    [true, false],
    [true, true],
    // While the answer is on its way: what it always said.
    [null, false],
    [null, true],
  ])(
    "can send %p, master admin %p: the project's owners get an email",
    (canSend: boolean | null, isMasterAdmin: boolean) => {
      expect(
        getGettingStartedTaskDescription(
          ON_CALL_STEP,
          server(canSend, isMasterAdmin),
        ),
      ).toBe(ON_CALL_STEP.description);
    },
  );

  test("cannot send, a master admin: set email up in the Admin Dashboard", () => {
    expect(
      getGettingStartedTaskDescription(ON_CALL_STEP, server(false, true)),
    ).toBe(SERVER_EMAIL_COPY.onCallStepDescriptionForAdmin);
  });

  test("cannot send, anybody else: ask the server's admin", () => {
    expect(
      getGettingStartedTaskDescription(ON_CALL_STEP, server(false, false)),
    ).toBe(SERVER_EMAIL_COPY.onCallStepDescription);
  });

  test("a step that promises no email reads the same either way", () => {
    expect(
      getGettingStartedTaskDescription(
        { description: "Publish a status page." },
        server(false, true),
      ),
    ).toBe("Publish a status page.");
  });

  test.each([
    [false, true],
    [true, false],
    [null, false],
  ])(
    "cannot send email is said only once the server says false (%p: %p)",
    (canSend: boolean | null, expected: boolean) => {
      expect(cannotSendEmail(server(canSend, false))).toBe(expected);
    },
  );

  test("Set up email goes to the Admin Dashboard's Settings > Emails", () => {
    expect(ADMIN_EMAIL_SETTINGS_ROUTE).toBe("/settings/smtp");
    expect(getAdminEmailSettingsUrl().toString()).toMatch(
      /\/admin\/settings\/smtp$/,
    );
  });
});

describe("the invitation link a master admin is handed", () => {
  const TEAM_MEMBER_ID: ObjectID = new ObjectID(
    "68250000-0000-4000-8000-0000000000c1",
  );

  let fetch: jest.SpyInstance;

  function answerWith(data: JSONObject | HTTPErrorResponse | Error): void {
    fetch = jest
      .spyOn(API, "fetch")
      .mockImplementation(async (): Promise<never> => {
        if (data instanceof Error) {
          throw data;
        }

        if (data instanceof HTTPErrorResponse) {
          return data as never;
        }

        return new HTTPResponse<JSONObject>(200, data, {}) as never;
      });
  }

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("is asked for with a POST naming the membership, and nothing else", async () => {
    answerWith({
      link: "https://oneuptime.example.com/accounts/register?email=a%40b.com&token=t",
      isRegistered: false,
      email: "a@b.com",
    });

    await fetchInvitationLink(TEAM_MEMBER_ID);

    const request: {
      method: HTTPMethod;
      url: URL;
      data: JSONObject;
    } = fetch.mock.calls[0]![0] as never;

    expect(request.method).toBe(HTTPMethod.POST);
    expect(request.url.toString()).toMatch(
      new RegExp(`${INVITATION_LINK_ROUTE}$`),
    );
    expect(request.data).toEqual({ teamMemberId: TEAM_MEMBER_ID.toString() });
  });

  test.each([
    [new HTTPErrorResponse(403, { message: "Forbidden" }, {})],
    [new Error("Network Error")],
    [{ link: "", isRegistered: false }],
    [{ isRegistered: true }],
  ])(
    "an answer that is not a link reads as none: %p",
    async (data: JSONObject | HTTPErrorResponse | Error) => {
      answerWith(data);

      await expect(fetchInvitationLink(TEAM_MEMBER_ID)).resolves.toBeNull();
    },
  );

  test("someone new: the link, to copy, and its rules", async () => {
    answerWith({
      link: "https://oneuptime.example.com/accounts/register?email=new%40example.com&token=11111111-2222-3333-4444-555555555555",
      isRegistered: false,
      email: "new@example.com",
    });

    await act(async () => {
      render(
        <InvitationLinkModal
          teamMemberId={TEAM_MEMBER_ID}
          onClose={(): void => {
            return undefined;
          }}
        />,
      );
    });

    expect(
      screen.getByText(SERVER_EMAIL_COPY.invitationLinkTitle),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invitation-link-value")).toHaveTextContent(
      "/accounts/register?email=new%40example.com&token=",
    );
    expect(
      screen.getByText(
        SERVER_EMAIL_COPY.invitationLinkDescription.replace(
          "{{email}}",
          "new@example.com",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  test("someone with an account: the sign-in page, said so", async () => {
    answerWith({
      link: "https://oneuptime.example.com/accounts",
      isRegistered: true,
      email: "member@example.com",
    });

    await act(async () => {
      render(
        <InvitationLinkModal
          teamMemberId={TEAM_MEMBER_ID}
          onClose={(): void => {
            return undefined;
          }}
        />,
      );
    });

    expect(screen.getByTestId("invitation-link-value")).toHaveTextContent(
      "https://oneuptime.example.com/accounts",
    );
    expect(
      screen.getByText(
        SERVER_EMAIL_COPY.invitationLinkRegisteredDescription.replace(
          "{{email}}",
          "member@example.com",
        ),
      ),
    ).toBeInTheDocument();
  });

  test("a link that cannot be read: the invitation stands, and the way on is said", async () => {
    answerWith(new HTTPErrorResponse(500, { message: "Server Error" }, {}));

    const onClose: jest.Mock = jest.fn();

    await act(async () => {
      render(
        <InvitationLinkModal teamMemberId={TEAM_MEMBER_ID} onClose={onClose} />,
      );
    });

    expect(screen.getByTestId("invitation-link-failed")).toHaveTextContent(
      SERVER_EMAIL_COPY.invitationLinkFailed,
    );
    expect(screen.queryByTestId("invitation-link")).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: SERVER_EMAIL_COPY.done }).click();
    });

    expect(onClose).toHaveBeenCalled();
  });
});
