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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";

/*
 * An incoming call policy's Settings page, for real.
 *
 * It used to be two cards: "Voice Messages" ("Text-to-speech message played
 * to callers when they first connect", an emptied message reading "No
 * greeting message set" while callers in fact heard OneUptime's own words)
 * and "Policy Settings", one Edit dialog holding "Enabled" ("Enable or
 * disable this policy"), "Repeat Policy If No One Answers" and "Repeat
 * Policy Times". Now it is three cards, each about one thing: Answer Calls
 * (one switch that saves on flip, and asks before it turns calls away),
 * Repeat Policy (one choice) and Voice Messages.
 *
 * The UI review: Voice Messages says on the card when each message is read
 * out (the names alone do not tell No Answer from No One Available), shows
 * an emptied message's words first with a quiet Default pill - it read
 * "Not set. Callers hear ..." three times - and its dialog's boxes start at
 * three lines and grow. Stop answering calls? speaks of everyone who
 * calls, not of calls that hear.
 *
 * The page, its cards, the switch, the dialogs and the forms are the real
 * ones; only the network and the permission snapshot are stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "5b1f0a0e-1111-4c1e-9a1e-000000000001";
const POLICY_ID: string = "7b000000-0000-4000-8000-0000000000c1";

let stored: JSONObject = {};
let saved: Array<{ via: string; data: JSONObject }> = [];

function plain(model: Record<string, unknown>): JSONObject {
  const json: JSONObject = {};

  for (const key of Object.keys(model)) {
    const value: unknown = model[key];

    if (
      value !== undefined &&
      typeof value !== "function" &&
      !key.startsWith("_") &&
      key !== "tableName"
    ) {
      json[key] = value as JSONObject[string];
    }
  }

  return json;
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        return Object.assign(
          new data.modelType() as Record<string, unknown>,
          { _id: POLICY_ID },
          stored,
        );
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      updateById: async (data: { data: JSONObject }): Promise<unknown> => {
        saved.push({ via: "switch", data: data.data });
        return {};
      },
      createOrUpdate: async (data: {
        model: Record<string, unknown>;
      }): Promise<{ data: unknown }> => {
        saved.push({ via: "dialog", data: plain(data.model) });
        return { data: data.model };
      },
    },
  };
});

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

import IncomingCallPolicySettings, {
  getStopAnsweringCallsConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Settings";
import {
  INCOMING_CALL_ANSWER_CALLS_TEST_ID,
  INCOMING_CALL_DEFAULT_MESSAGE_PILL_TEST_ID,
  IncomingCallAnswerCallsCopy,
  IncomingCallVoiceMessagesCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy";
import {
  DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE,
  DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE,
} from "../../../Types/IncomingCall/IncomingCallMessages";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STORED_POLICY: JSONObject = {
  name: "Support hotline",
  isEnabled: true,
  repeatPolicyIfNoOneAnswers: false,
  repeatPolicyIfNoOneAnswersTimes: 1,
  greetingMessage: "Thanks for calling Acme. Connecting you now.",
  noAnswerMessage: "",
  noOneAvailableMessage: null,
};

beforeEach(() => {
  stored = { ...STORED_POLICY };
  saved = [];
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/incoming-call-policies/${POLICY_ID}/settings`,
  );
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 4; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderPage(): Promise<void> {
  const props: PageComponentProps = {
    pageRoute: new Route(
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/settings",
    ),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <IncomingCallPolicySettings {...props} />
    </MemoryRouter>,
  );
  await settle();
}

function theSwitch(): HTMLElement {
  return screen.getByRole("switch", {
    name: IncomingCallAnswerCallsCopy.switchTitle,
  });
}

describe("the cards, in order", () => {
  test("are Answer Calls, Repeat Policy and Voice Messages - and no Policy Settings", async () => {
    await renderPage();

    await screen.findByText(IncomingCallAnswerCallsCopy.cardTitle);

    const body: string = document.body.textContent || "";

    expect(body.indexOf("Answer Calls")).toBeGreaterThan(-1);
    expect(body.indexOf("Repeat Policy")).toBeGreaterThan(
      body.indexOf("Answer Calls"),
    );
    expect(body.indexOf("Voice Messages")).toBeGreaterThan(
      body.indexOf("Repeat Policy"),
    );

    expect(document.body).not.toHaveTextContent("Policy Settings");
    expect(document.body).not.toHaveTextContent("Edit Policy Settings");
    expect(document.body).not.toHaveTextContent("Enable or disable");
    expect(document.body).not.toHaveTextContent(
      "Repeat Policy If No One Answers",
    );
  });
});

describe("Answer Calls", () => {
  test("is one switch, on while the policy answers calls, saying what that does", async () => {
    await renderPage();

    await screen.findByTestId(INCOMING_CALL_ANSWER_CALLS_TEST_ID);

    expect(
      screen.getByText(IncomingCallAnswerCallsCopy.cardDescription),
    ).toBeInTheDocument();
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(document.body).toHaveTextContent(
      IncomingCallAnswerCallsCopy.switchOnDescription,
    );
  });

  test("turning calls away asks first, with a red button, then saves isEnabled off", async () => {
    await renderPage();
    await screen.findByTestId(INCOMING_CALL_ANSWER_CALLS_TEST_ID);

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await settle();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      IncomingCallAnswerCallsCopy.turnOffConfirmTitle,
    );
    expect(screen.getByTestId("modal")).toHaveTextContent(
      IncomingCallAnswerCallsCopy.turnOffConfirmDescription,
    );

    const submit: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    expect(submit).toHaveTextContent(
      IncomingCallAnswerCallsCopy.turnOffConfirmButton,
    );
    expect(submit.className).toMatch(/red/);
    expect(saved).toEqual([]);

    await act(async () => {
      fireEvent.click(submit);
    });
    await settle();

    expect(saved).toEqual([{ via: "switch", data: { isEnabled: false } }]);
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(document.body).toHaveTextContent(
      IncomingCallAnswerCallsCopy.switchOffDescription,
    );
  });

  test("cancelling the question keeps the line answering calls, and saves nothing", async () => {
    await renderPage();
    await screen.findByTestId(INCOMING_CALL_ANSWER_CALLS_TEST_ID);

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await settle();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      IncomingCallAnswerCallsCopy.turnOffConfirmTitle,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });
    await settle();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(saved).toEqual([]);
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(document.body).toHaveTextContent(
      IncomingCallAnswerCallsCopy.switchOnDescription,
    );
  });

  test("turning calls back on saves at once, without asking", async () => {
    stored = { ...STORED_POLICY, isEnabled: false };

    await renderPage();
    await screen.findByTestId(INCOMING_CALL_ANSWER_CALLS_TEST_ID);

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await settle();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(saved).toEqual([{ via: "switch", data: { isEnabled: true } }]);
  });

  test("asks before turning off only, as a danger", () => {
    expect(getStopAnsweringCallsConfirmation(true)).toBeUndefined();
    expect(getStopAnsweringCallsConfirmation(false)).toEqual({
      title: "Stop answering calls?",
      description: IncomingCallAnswerCallsCopy.turnOffConfirmDescription,
      submitButtonText: "Stop answering calls",
      submitButtonType: ButtonStyleType.DANGER,
    });
  });

  test("the question speaks of the people who call, not of calls that hear", () => {
    expect(IncomingCallAnswerCallsCopy.turnOffConfirmDescription).toBe(
      "Until it is turned back on, everyone who calls this policy's numbers hears that the line is not available, and nobody is rung.",
    );
    expect(IncomingCallAnswerCallsCopy.turnOffConfirmDescription).not.toContain(
      "every call to",
    );
  });
});

describe("Repeat Policy, on the Settings page", () => {
  test("says what happens when nobody answers, as a choice of the call policy", async () => {
    await renderPage();

    expect(
      await screen.findByTestId("incoming-call-repeat-summary"),
    ).toHaveTextContent(/^End the call$/);
  });
});

describe("Voice Messages", () => {
  test("say when each is read out, and show a policy's own words", async () => {
    await renderPage();

    await screen.findByText(IncomingCallVoiceMessagesCopy.cardTitle);

    expect(
      screen.getByText(IncomingCallVoiceMessagesCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Thanks for calling Acme. Connecting you now."),
    ).toBeInTheDocument();
  });

  test("an emptied message shows the words callers hear instead, marked Default - not 'No message set'", async () => {
    await renderPage();

    await screen.findByText(IncomingCallVoiceMessagesCopy.cardTitle);

    // The two emptied messages: their words, then a Default pill each.
    const pills: Array<HTMLElement> = screen.getAllByTestId(
      INCOMING_CALL_DEFAULT_MESSAGE_PILL_TEST_ID,
    );

    expect(pills).toHaveLength(2);

    for (const [index, words] of [
      DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE,
      DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE,
    ].entries()) {
      const row: HTMLElement = pills[index]!.parentElement as HTMLElement;

      expect(row).toHaveTextContent(words);
      expect(pills[index]).toHaveTextContent(/^Default$/);
      // The words first, then the pill.
      expect(row.textContent!.indexOf(words)).toBe(0);
    }

    expect(IncomingCallVoiceMessagesCopy.defaultPill).toBe("Default");
    expect(document.body).not.toHaveTextContent("Not set");
    expect(document.body).not.toHaveTextContent("No message set");
    expect(document.body).not.toHaveTextContent("No greeting message set");
  });

  test("a message of the policy's own is shown as written, with no pill", async () => {
    await renderPage();

    const own: HTMLElement = await screen.findByText(
      "Thanks for calling Acme. Connecting you now.",
    );

    expect(
      within(own.parentElement as HTMLElement).queryByTestId(
        INCOMING_CALL_DEFAULT_MESSAGE_PILL_TEST_ID,
      ),
    ).not.toBeInTheDocument();
  });

  test("the card says when each message is read out, not only the dialog", async () => {
    await renderPage();

    await screen.findByText(IncomingCallVoiceMessagesCopy.cardTitle);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    for (const message of [
      IncomingCallVoiceMessagesCopy.greeting,
      IncomingCallVoiceMessagesCopy.noAnswer,
      IncomingCallVoiceMessagesCopy.noOneAvailable,
    ]) {
      const when: HTMLElement = screen.getByText(message.description);
      const field: HTMLElement = when.closest(
        "[data-testid='detail-field']",
      ) as HTMLElement;

      // Under the message's own name, in its own row.
      expect(field).not.toBeNull();
      expect(field).toHaveTextContent(message.title);
    }
  });

  test("the dialog's boxes start at three lines and grow with the words", async () => {
    await renderPage();

    const edit: HTMLElement = await screen.findByRole("button", {
      name: "Edit Messages",
    });

    await act(async () => {
      fireEvent.click(edit);
    });
    await settle();

    const dialog: HTMLElement = await screen.findByTestId("modal");
    const boxes: Array<HTMLTextAreaElement> = Array.from(
      dialog.querySelectorAll("textarea"),
    );

    expect(boxes).toHaveLength(3);

    for (const box of boxes) {
      expect(box).toHaveAttribute("rows", "3");
      // Not held to the fixed box's six-line floor.
      expect(box.className).not.toContain("min-h-32");
    }
  });

  test("Edit Messages opens Edit Voice Messages, each field saying when it is read out", async () => {
    await renderPage();

    const edit: HTMLElement = await screen.findByRole("button", {
      name: "Edit Messages",
    });

    await act(async () => {
      fireEvent.click(edit);
    });
    await settle();

    const dialog: HTMLElement = await screen.findByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Edit Voice Messages",
    );

    for (const message of [
      IncomingCallVoiceMessagesCopy.greeting,
      IncomingCallVoiceMessagesCopy.noAnswer,
      IncomingCallVoiceMessagesCopy.noOneAvailable,
    ]) {
      expect(within(dialog).getByText(message.description)).toBeVisible();
    }

    expect(dialog).not.toHaveTextContent("Text-to-speech message played");
    expect(dialog).not.toHaveTextContent("escalation rules are exhausted");

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await settle();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]!.via).toBe("dialog");
    expect(saved[0]!.data).toEqual(
      expect.objectContaining({
        greetingMessage: "Thanks for calling Acme. Connecting you now.",
      }),
    );
  });
});
