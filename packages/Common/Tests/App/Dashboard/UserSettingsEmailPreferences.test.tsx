import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import EmailPreferences from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/EmailPreferences";
import EmailNoiseCard from "../../../../App/FeatureSet/Dashboard/src/Components/EmailPreferences/EmailNoiseCard";
import UserNotificationEmailRollupSetting from "../../../Models/DatabaseModels/UserNotificationEmailRollupSetting";
import Route from "../../../Types/API/Route";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

/*
 * User Settings > Email Preferences: the two controls that change how MUCH
 * email a project sends one person, rendered for real.
 *
 * Both used to live above the tabs on Notification Settings, where they were
 * read as settings for whichever tab happened to be open. Neither is a
 * per-event choice, so neither can be a row in that matrix.
 *
 * What can go wrong here is quiet in every case, which is why these are
 * render tests and not source assertions:
 *
 *  - the preset posting without the tenantid header. The endpoint takes the
 *    project from that header alone and rejects the request without it, so
 *    the button does nothing and the only clue is a toast;
 *  - the preset reporting success on a failed request. It switches off
 *    twenty-one kinds of email; a green line over a request that changed
 *    nothing means the user believes they are done and keeps receiving them;
 *  - the rollup switch reading an absent row as OFF. Rollup shipped on with
 *    no backfill, so almost nobody has a row - reading no-row as off would
 *    show the overwhelming majority of users a switch that disagrees with
 *    the mail arriving in their inbox;
 *  - the create/update split going the wrong way. An update with no row
 *    writes nothing; a create against an existing row is rejected by the
 *    service's one-row rule. Either way the switch moves and the preference
 *    does not stick, which is worse than an error the user can see;
 *  - the undo link going missing. The preset is a bulk edit whose reversal
 *    is on another page now; without the link the copy promises a way back
 *    and provides none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ROLLUP_ROW_ID: string = "55555555-5555-4555-8555-555555555555";

describe("user settings > email preferences", () => {
  let post: jest.SpyInstance;
  let getList: jest.SpyInstance;
  let create: jest.SpyInstance;
  let updateById: jest.SpyInstance;
  let rollupRows: Array<UserNotificationEmailRollupSetting>;

  function rollupRow(
    isEnabled: boolean | undefined,
  ): UserNotificationEmailRollupSetting {
    const row: UserNotificationEmailRollupSetting =
      new UserNotificationEmailRollupSetting();
    row._id = ROLLUP_ROW_ID;
    row.projectId = PROJECT_ID;
    row.userId = USER_ID;
    if (isEnabled !== undefined) {
      row.isEnabled = isEnabled;
    }
    return row;
  }

  beforeEach(() => {
    rollupRows = [];
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(User, "getUserId").mockReturnValue(USER_ID);
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ tenantid: PROJECT_ID.toString() });
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockImplementation((err: unknown): string => {
        return err instanceof Error || err instanceof HTTPErrorResponse
          ? err.message
          : "Request failed";
      });
    getList = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<any> => {
        return { data: rollupRows, count: rollupRows.length };
      });
    create = jest
      .spyOn(ModelAPI, "create")
      .mockImplementation(async (): Promise<any> => {
        return {};
      });
    updateById = jest
      .spyOn(ModelAPI, "updateById")
      .mockImplementation(async (): Promise<any> => {
        return {};
      });
    post = jest
      .spyOn(API, "post")
      .mockImplementation(async (): Promise<any> => {
        return new HTTPResponse(200, { success: true }, {});
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  function renderPage(): void {
    render(
      <EmailPreferences
        pageRoute={new Route("/user-settings/email-preferences")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  }

  function rollupSwitch(): HTMLElement {
    return screen.getByRole("switch", {
      name: /^Roll up notification emails:/,
    });
  }

  async function waitForPageReady(): Promise<HTMLElement> {
    return screen.findByRole("switch", {
      name: /^Roll up notification emails:/,
    });
  }

  describe("both controls are on the page", () => {
    test("the routine-email preset and the rollup switch render together", async () => {
      renderPage();
      await waitForPageReady();

      expect(screen.getByText("Fewer routine emails")).toBeVisible();
      expect(screen.getByText("Email Rollup")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      ).toBeEnabled();
    });

    test("nothing is written just by opening the page", async () => {
      renderPage();
      await waitForPageReady();

      expect(post).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(updateById).not.toHaveBeenCalled();
    });

    test("the rollup row is read for this member in this project only", async () => {
      renderPage();
      await waitForPageReady();

      const read: any = getList.mock.calls.find((call: Array<any>): boolean => {
        return call[0].modelType === UserNotificationEmailRollupSetting;
      })![0];

      expect(read.query.projectId).toEqual(PROJECT_ID);
      expect(read.query.userId).toEqual(USER_ID);
      /* The service refuses a second row, so one is all there can be. */
      expect(read.limit).toBe(1);
    });
  });

  /*
   * THE UNDO. The preset is a bulk edit of twenty-one event types and its
   * reversal is a page away, so the link is the only thing standing between
   * "reversible" and "reversible in theory".
   */
  describe("the way back to the per-event switches", () => {
    test("the standing copy links to Notification Settings", async () => {
      renderPage();
      await waitForPageReady();

      expect(screen.getByText(/Applies to you in this project/)).toBeVisible();

      const link: HTMLElement = screen.getByRole("link", {
        name: "Turn individual emails back on in Notification Settings",
      });

      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/user-settings/notification-settings`,
      );
    });

    test("the confirmation links there too, and is announced", async () => {
      renderPage();
      await waitForPageReady();
      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );

      const status: HTMLElement = await screen.findByRole("status");

      expect(status).toHaveTextContent("Routine emails turned off.");
      expect(
        screen.getByRole("link", {
          name: "Review your individual preferences in Notification Settings",
        }),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/user-settings/notification-settings`,
      );
    });

    test("no link carries the unpopulated :projectId template", async () => {
      renderPage();
      await waitForPageReady();

      for (const link of screen.getAllByRole("link")) {
        expect(link.getAttribute("href")).not.toContain(":projectId");
      }
    });
  });

  describe("reducing routine emails", () => {
    test("posts once to the bulk endpoint with an empty body and the tenant header", async () => {
      renderPage();
      await waitForPageReady();
      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );
      await screen.findByRole("status");

      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0].url.toString()).toContain(
        "/user-notification-setting/reduce-routine-emails",
      );
      /*
       * The endpoint takes the user from the session and the project from the
       * header, and ignores the body. Sending ids in the body would look like
       * it worked while meaning nothing.
       */
      expect(post.mock.calls[0][0].data).toEqual({});
      expect(post.mock.calls[0][0].headers).toEqual({
        tenantid: PROJECT_ID.toString(),
      });
    });

    test("cannot be double-submitted while the request is in flight", async () => {
      let resolveRequest!: (response: HTTPResponse<any>) => void;
      post.mockReturnValue(
        new Promise<HTTPResponse<any>>(
          (resolve: (response: HTTPResponse<any>) => void): void => {
            resolveRequest = resolve;
          },
        ),
      );

      renderPage();
      await waitForPageReady();
      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );

      const saving: HTMLElement = screen.getByRole("button", {
        name: "Saving email preferences…",
      });
      expect(saving).toBeDisabled();
      fireEvent.click(saving);
      expect(post).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      await act(async () => {
        resolveRequest(new HTTPResponse(200, { success: true }, {}));
      });
      await screen.findByRole("status");
    });

    test.each(["resolved HTTP error", "network rejection"])(
      "shows %s instead of a success line, and allows a retry",
      async (kind: string) => {
        if (kind === "resolved HTTP error") {
          post.mockResolvedValueOnce(
            new HTTPErrorResponse(
              503,
              { message: "Preferences could not be saved" },
              {},
            ),
          );
        } else {
          post.mockRejectedValueOnce(
            new Error("Preferences could not be saved"),
          );
        }

        renderPage();
        await waitForPageReady();
        fireEvent.click(
          screen.getByRole("button", { name: "Reduce routine emails" }),
        );

        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Preferences could not be saved",
        );
        expect(screen.queryByRole("status")).not.toBeInTheDocument();

        fireEvent.click(
          screen.getByRole("button", { name: "Reduce routine emails" }),
        );
        await screen.findByRole("status");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      },
    );

    test("can be applied again after it has succeeded once", async () => {
      const apply: jest.Mock = jest.fn().mockResolvedValue(undefined);
      render(<EmailNoiseCard onApply={apply} />);

      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );
      await screen.findByRole("status");
      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );

      await waitFor(() => {
        expect(apply).toHaveBeenCalledTimes(2);
      });
    });

    /*
     * The copy is the user-facing statement of what the endpoint actually
     * does - email column only, this project, these categories. Softening it
     * turns an accurate promise into a false one, and nothing else in the
     * product would report the difference.
     */
    test("says what it does and does not touch", async () => {
      renderPage();
      await waitForPageReady();

      expect(
        screen.getByText(/Other notification channels, paging, account and/),
      ).toBeVisible();
      expect(
        screen.getByText(
          /Your choices for incident and alert creation, state changes/,
        ),
      ).toBeVisible();
    });
  });

  describe("the rollup switch: an absent row means ON", () => {
    test("a member with no row sees it on", async () => {
      renderPage();
      await waitForPageReady();

      expect(rollupSwitch()).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByText(
          "On: notifications that arrive together are delivered as one email.",
        ),
      ).toBeVisible();
    });

    test("a row with no value still reads as on", async () => {
      rollupRows = [rollupRow(undefined)];
      renderPage();
      await waitForPageReady();

      expect(rollupSwitch()).toHaveAttribute("aria-checked", "true");
    });

    test("only an explicit false reads as off", async () => {
      rollupRows = [rollupRow(false)];
      renderPage();
      await waitForPageReady();

      expect(rollupSwitch()).toHaveAttribute("aria-checked", "false");
      expect(
        screen.getByText(
          "Off: every notification arrives as its own email, immediately.",
        ),
      ).toBeVisible();
    });

    test("the accessible name says the state and what pressing it does", async () => {
      renderPage();
      await waitForPageReady();

      expect(
        screen.getByRole("switch", {
          name: "Roll up notification emails: On. Click to disable.",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("the rollup switch: writing the choice", () => {
    test("a member with no row gets one created, then it is read back", async () => {
      renderPage();
      await waitForPageReady();
      const readsBefore: number = getList.mock.calls.length;

      fireEvent.click(rollupSwitch());

      await waitFor(() => {
        expect(create).toHaveBeenCalledTimes(1);
      });
      const created: UserNotificationEmailRollupSetting =
        create.mock.calls[0][0].model;
      expect(created.projectId).toEqual(PROJECT_ID);
      expect(created.userId).toEqual(USER_ID);
      expect(created.isEnabled).toBe(false);
      expect(updateById).not.toHaveBeenCalled();

      /*
       * The service rejects a second row for the same (user, project), so the
       * created row has to be read back or the NEXT toggle tries to create
       * another one and fails on a switch that looked like it worked.
       */
      await waitFor(() => {
        expect(getList.mock.calls.length).toBeGreaterThan(readsBefore);
      });
    });

    test("a member who already has a row has it updated by id, value only", async () => {
      rollupRows = [rollupRow(true)];
      renderPage();
      await waitForPageReady();

      fireEvent.click(rollupSwitch());

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      expect(create).not.toHaveBeenCalled();
      expect(updateById.mock.calls[0][0].id.toString()).toBe(ROLLUP_ROW_ID);
      /*
       * isEnabled is the only updatable column on the model; sending
       * projectId or userId is rejected by column access control.
       */
      expect(updateById.mock.calls[0][0].data).toEqual({ isEnabled: false });
    });

    test("the switch moves before the write lands", async () => {
      rollupRows = [rollupRow(true)];
      let finishWrite!: () => void;
      updateById.mockReturnValue(
        new Promise<void>((resolve: () => void): void => {
          finishWrite = resolve;
        }),
      );

      renderPage();
      await waitForPageReady();
      fireEvent.click(rollupSwitch());

      await waitFor(() => {
        expect(rollupSwitch()).toHaveAttribute("aria-checked", "false");
      });
      expect(updateById).toHaveBeenCalledTimes(1);

      await act(async () => {
        finishWrite();
      });
      expect(rollupSwitch()).toHaveAttribute("aria-checked", "false");
    });

    test("a failed write puts the switch back and says why", async () => {
      rollupRows = [rollupRow(true)];
      updateById.mockRejectedValue(new Error("Rollup setting was not saved"));

      renderPage();
      await waitForPageReady();
      fireEvent.click(rollupSwitch());

      expect(
        await screen.findByText("Rollup setting was not saved"),
      ).toBeVisible();
      await waitFor(() => {
        expect(rollupSwitch()).toHaveAttribute("aria-checked", "true");
      });
    });

    test("it cannot be toggled twice while a write is in flight", async () => {
      rollupRows = [rollupRow(true)];
      let finishWrite!: () => void;
      updateById.mockReturnValue(
        new Promise<void>((resolve: () => void): void => {
          finishWrite = resolve;
        }),
      );

      renderPage();
      await waitForPageReady();
      fireEvent.click(rollupSwitch());
      fireEvent.click(rollupSwitch());

      expect(updateById).toHaveBeenCalledTimes(1);

      await act(async () => {
        finishWrite();
      });
    });

    /*
     * The question a reader actually has in front of a batching switch is
     * whether it can delay a page. Unanswered, the safe-feeling move is to
     * turn the feature off out of fear.
     */
    test("it says what rollup never delays", async () => {
      renderPage();
      await waitForPageReady();

      expect(
        screen.getByText(
          /On-call paging, security and sign-in email, and billing email are never rolled up and are never delayed/,
        ),
      ).toBeVisible();
      expect(
        screen.getByText(/This is your own setting, in this project only/),
      ).toBeVisible();
    });
  });

  describe("scoping", () => {
    test("switching projects re-reads the rollup row against the new project", async () => {
      rollupRows = [rollupRow(false)];
      const { rerender } = render(
        <EmailPreferences
          pageRoute={new Route("/user-settings/email-preferences")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );
      await waitForPageReady();
      expect(rollupSwitch()).toHaveAttribute("aria-checked", "false");

      const otherProjectId: ObjectID = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(otherProjectId);
      /* No opt-out exists in the other project. */
      rollupRows = [];
      getList.mockClear();

      rerender(
        <EmailPreferences
          pageRoute={new Route("/user-settings/email-preferences")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );

      await waitFor(() => {
        expect(rollupSwitch()).toHaveAttribute("aria-checked", "true");
      });
      expect(getList.mock.calls.length).toBeGreaterThan(0);
      for (const call of getList.mock.calls) {
        expect(call[0].query.projectId).toEqual(otherProjectId);
        expect(call[0].query.userId).toEqual(USER_ID);
      }
    });

    test("the success line from one project does not follow you to the next", async () => {
      const { rerender } = render(
        <EmailPreferences
          pageRoute={new Route("/user-settings/email-preferences")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );
      await waitForPageReady();
      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );
      await screen.findByRole("status");

      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(new ObjectID("44444444-4444-4444-8444-444444444444"));
      rerender(
        <EmailPreferences
          pageRoute={new Route("/user-settings/email-preferences")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );

      await waitForPageReady();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
