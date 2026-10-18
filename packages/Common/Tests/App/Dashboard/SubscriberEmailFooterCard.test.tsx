import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

/*
 * The Email Footer card, under More settings on a status page's Subscriber
 * Settings: the line subscribers read at the end of every email, and one
 * choice to change it, The default footer or Your own text. It used to be
 * "Email Footer Settings", whose switch, "Enable Custom Email Footer
 * Text", came with a sentence explaining both modes, and showed the text
 * box whatever the switch said.
 *
 * Through the real card, detail, dialog and form, with only the network
 * and the permissions stubbed: what the card says, what the dialog asks,
 * and what is saved.
 */

const STATUS_PAGE_ID: string = "6c6c6c6c-0000-4000-8000-0000000000aa";

let stored: JSONObject = {};
let saved: Array<JSONObject> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const actualModel: { default: unknown } = jest.requireActual(
    "../../../Models/DatabaseModels/StatusPage",
  ) as { default: unknown };

  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        const StatusPageModel: { new (): Record<string, unknown> } =
          actualModel.default as { new (): Record<string, unknown> };
        const page: Record<string, unknown> = new StatusPageModel();

        Object.assign(
          page,
          (globalThis as Record<string, unknown>)[
            "__emailFooterStored"
          ] as JSONObject,
        );

        return page;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        (
          (globalThis as Record<string, unknown>)[
            "__emailFooterSaved"
          ] as Array<JSONObject>
        ).push(data.model);

        return { data: data.model };
      },
    },
  };
});

import SubscriberEmailFooterCard, {
  EmailFooterLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberEmailFooterCard";
import {
  EMAIL_FOOTER_CHOICE,
  EmailFooterChoice,
  SubscriberEmailFooterCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberEmailFooterCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT } from "../../../Types/StatusPage/SubscriberEmailFooter";

beforeEach(() => {
  stored = {
    _id: STATUS_PAGE_ID,
  };
  saved = [];
  (globalThis as Record<string, unknown>)["__emailFooterStored"] = stored;
  (globalThis as Record<string, unknown>)["__emailFooterSaved"] = saved;
});

afterEach(() => {
  cleanup();
});

function store(values: JSONObject): void {
  Object.assign(stored, values);
}

describe("the choice", () => {
  test("is the default footer or your own text, each with its one line", () => {
    expect(EMAIL_FOOTER_CHOICE.title).toBe("Footer");
    expect(EMAIL_FOOTER_CHOICE.options).toEqual([
      {
        value: EmailFooterChoice.Default,
        title: "The default footer",
        description:
          "A line that says they get the email because they subscribed.",
      },
      {
        value: EmailFooterChoice.Custom,
        title: "Your own text",
        description: "Add a note, a link or a support address.",
      },
    ]);
  });

  test("writes the switch it stands for, and never the text", () => {
    expect(EMAIL_FOOTER_CHOICE.getColumns(EmailFooterChoice.Custom)).toEqual({
      enableCustomSubscriberEmailNotificationFooterText: true,
    });
    expect(EMAIL_FOOTER_CHOICE.getColumns(EmailFooterChoice.Default)).toEqual({
      enableCustomSubscriberEmailNotificationFooterText: false,
    });
    expect(
      EMAIL_FOOTER_CHOICE.readChoice({
        enableCustomSubscriberEmailNotificationFooterText: true,
      }),
    ).toBe(EmailFooterChoice.Custom);
    // Only an explicit true is your own text: the column defaults to off.
    for (const value of [false, null, undefined, "true"]) {
      expect(
        EMAIL_FOOTER_CHOICE.readChoice({
          enableCustomSubscriberEmailNotificationFooterText: value,
        }),
      ).toBe(EmailFooterChoice.Default);
    }
  });
});

describe("the line the card shows", () => {
  test("is the page's own text when its emails use it", () => {
    const page: StatusPage = Object.assign(new StatusPage(), {
      enableCustomSubscriberEmailNotificationFooterText: true,
      subscriberEmailNotificationFooterText: "Questions? support@acme.com",
    });

    render(<EmailFooterLine item={page} />);

    expect(screen.getByTestId("email-footer-line")).toHaveTextContent(
      "Questions? support@acme.com",
    );
    expect(screen.queryByTestId("email-footer-default-pill")).toBeNull();
  });

  test.each([
    [{}],
    [
      {
        enableCustomSubscriberEmailNotificationFooterText: false,
        subscriberEmailNotificationFooterText: "An old note",
      },
    ],
    [
      {
        enableCustomSubscriberEmailNotificationFooterText: true,
        subscriberEmailNotificationFooterText: "",
      },
    ],
  ])(
    "is the default line, marked Default, when the emails send it: %j",
    (values: JSONObject) => {
      render(
        <EmailFooterLine item={Object.assign(new StatusPage(), values)} />,
      );

      expect(screen.getByTestId("email-footer-line")).toHaveTextContent(
        DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
      );
      expect(screen.getByTestId("email-footer-default-pill")).toHaveTextContent(
        SubscriberEmailFooterCopy.defaultPill,
      );
      expect(screen.getByTestId("email-footer-line")).not.toHaveTextContent(
        "An old note",
      );
    },
  );
});

async function renderCard(
  onLoaded?: (isCustomFooter: boolean) => void,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <SubscriberEmailFooterCard
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
        onLoaded={onLoaded}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("email-footer-line")).toBeInTheDocument();
  });
}

async function openDialog(): Promise<HTMLElement> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      screen.getByRole("button", {
        name: SubscriberEmailFooterCopy.editButton,
      }),
    );
  });

  const dialog: HTMLElement = await screen.findByTestId("modal");

  await waitFor(() => {
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
  });

  return dialog;
}

async function save(dialog: HTMLElement): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(() => {
    expect(saved).toHaveLength(1);
  });

  return saved[0]!;
}

describe("the card", () => {
  test("is titled Email Footer, says what the line is, and shows the line subscribers read", async () => {
    await renderCard();

    expect(screen.getByText("Email Footer")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The line at the end of every email to this page's subscribers.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
    expect(screen.getByTestId("email-footer-line")).toHaveTextContent(
      DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
    );
    expect(screen.queryByText("Enable Custom Email Footer Text")).toBeNull();
  });

  test("tells the page whether its emails use their own text", async () => {
    const told: Array<boolean> = [];

    store({
      enableCustomSubscriberEmailNotificationFooterText: true,
      subscriberEmailNotificationFooterText: "Questions?",
    });

    await renderCard((isCustomFooter: boolean): void => {
      told.push(isCustomFooter);
    });

    expect(told).toEqual([true]);
  });

  test("the dialog asks the one question, with no box until your own text is picked", async () => {
    await renderCard();

    const dialog: HTMLElement = await openDialog();

    expect(within(dialog).getByText("Edit Footer")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: "The default footer" }),
    ).toBeChecked();
    expect(
      within(dialog).queryByPlaceholderText(
        DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
      ),
    ).toBeNull();
    expect(
      within(dialog).queryByText("Enable Custom Email Footer Text"),
    ).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "Your own text" }),
      );
    });

    expect(
      within(dialog).getByPlaceholderText(DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Footer Text")).toBeInTheDocument();
  });

  test("your own text saves the switch on with the text", async () => {
    await renderCard();

    const dialog: HTMLElement = await openDialog();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "Your own text" }),
      );
    });

    fireEvent.change(
      within(dialog).getByPlaceholderText(DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT),
      { target: { value: "Questions? support@acme.com" } },
    );

    const model: JSONObject = await save(dialog);

    expect(model["enableCustomSubscriberEmailNotificationFooterText"]).toBe(
      true,
    );
    expect(model["subscriberEmailNotificationFooterText"]).toBe(
      "Questions? support@acme.com",
    );
    // The answer itself is the form's own: never sent.
    expect(Object.keys(model)).not.toContain("emailFooterChoice");
  });

  test("your own text cannot be left empty", async () => {
    await renderCard();

    const dialog: HTMLElement = await openDialog();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "Your own text" }),
      );
    });

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    expect(saved).toHaveLength(0);
    expect(
      within(dialog).getByText("Footer Text is required."),
    ).toBeInTheDocument();
  });

  test("going back to the default footer saves the switch off, and keeps the text for next time", async () => {
    store({
      enableCustomSubscriberEmailNotificationFooterText: true,
      subscriberEmailNotificationFooterText: "Questions?",
    });

    await renderCard();

    expect(screen.getByTestId("email-footer-line")).toHaveTextContent(
      "Questions?",
    );

    const dialog: HTMLElement = await openDialog();

    expect(
      within(dialog).getByRole("radio", { name: "Your own text" }),
    ).toBeChecked();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "The default footer" }),
      );
    });

    const model: JSONObject = await save(dialog);

    expect(model["enableCustomSubscriberEmailNotificationFooterText"]).toBe(
      false,
    );
    expect(model["subscriberEmailNotificationFooterText"]).toBe("Questions?");
  });
});
