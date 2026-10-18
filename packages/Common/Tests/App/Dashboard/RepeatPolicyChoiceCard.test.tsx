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
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

/*
 * What happens after a policy's last level, on the real card and in its real
 * Edit dialog: an on-call policy's Repeat Policy card (its Escalation Rules
 * page) and an incoming call policy's (its Settings page).
 *
 * The dialog used to hold a switch, "Repeat if no one acknowledges" (help:
 * "If enabled, the on-call policy restarts from the first escalation rule
 * when no one acknowledges the incident.") and a number, "Number of times to
 * repeat"; the card could say "Repeat enabled" over a policy that never
 * repeated. Now it is one choice, Stop or Start again, and "How many more
 * times?" only once it starts again - written into the same two columns.
 *
 * The card (CardModelDetail), the dialog (ModelFormModal), the form
 * (ModelForm, BasicForm) and the radio are the real ones; only the network
 * and the permission snapshot are stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

const POLICY_ID: string = "4e000000-0000-4000-8000-0000000000e1";

let stored: JSONObject = {};
let storedModelName: string = "OnCallDutyPolicy";
let saved: Array<JSONObject> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType() as Record<
          string,
          unknown
        >;
        storedModelName = String(item["tableName"] || "");
        return Object.assign(item, { _id: POLICY_ID }, stored);
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
      createOrUpdate: async (data: {
        model: Record<string, unknown>;
      }): Promise<{ data: unknown }> => {
        const json: JSONObject = {};

        for (const key of Object.keys(data.model)) {
          const value: unknown = data.model[key];

          if (
            value !== undefined &&
            typeof value !== "function" &&
            !key.startsWith("_") &&
            key !== "tableName"
          ) {
            json[key] = value as JSONObject[string];
          }
        }

        saved.push(json);
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

import ObjectID from "../../../Types/ObjectID";
import RepeatPolicy from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatPolicy";
import RepeatChoiceCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoiceCard";
import {
  INCOMING_CALL_POLICY_REPEAT,
  ON_CALL_POLICY_REPEAT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoice";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";

beforeEach(() => {
  stored = {};
  saved = [];
});

afterEach(() => {
  cleanup();
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

async function renderOnCallCard(storedPair: JSONObject): Promise<void> {
  stored = storedPair;
  render(<RepeatPolicy onCallDutyPolicyId={new ObjectID(POLICY_ID)} />);
  await settle();
}

async function renderIncomingCallCard(storedPair: JSONObject): Promise<void> {
  stored = storedPair;
  render(
    <RepeatChoiceCard<IncomingCallPolicy>
      config={INCOMING_CALL_POLICY_REPEAT}
      modelType={IncomingCallPolicy}
      modelId={new ObjectID(POLICY_ID)}
      name="Incoming Call Policy > Repeat Policy"
    />,
  );
  await settle();
}

function summary(testIdPrefix: string): HTMLElement {
  return screen.getByTestId(`${testIdPrefix}-summary`);
}

async function openEdit(): Promise<HTMLElement> {
  const edit: HTMLElement = await screen.findByRole("button", {
    name: "Edit",
  });

  await act(async () => {
    fireEvent.click(edit);
  });
  await settle();

  return await screen.findByTestId("modal");
}

function radio(dialog: HTMLElement, name: string): HTMLInputElement {
  return within(dialog).getByRole("radio", { name: name }) as HTMLInputElement;
}

function timesBox(dialog: HTMLElement): HTMLInputElement | null {
  return within(dialog).queryByRole("spinbutton") as HTMLInputElement | null;
}

async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
  await settle();
}

describe("an on-call policy's Repeat Policy card", () => {
  test("says a policy that stops: Stop paging", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: false,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
    });

    expect(await screen.findByText("Repeat Policy")).toBeInTheDocument();
    expect(
      screen.getByText(
        "What happens when nobody acknowledges after the last level.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("After the last level")).toBeInTheDocument();
    expect(summary("repeat-policy")).toHaveTextContent(/^Stop paging$/);
    expect(storedModelName).toBe("OnCallDutyPolicy");
  });

  test("says how many more times a policy starts again, in the right number", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
    });

    expect(summary("repeat-policy")).toHaveTextContent(
      /^Start again from Level 1, up to 2 more times$/,
    );

    cleanup();
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 1,
    });

    expect(summary("repeat-policy")).toHaveTextContent(
      /^Start again from Level 1, up to 1 more time$/,
    );
  });

  test("says Stop paging for the switch on with 0 repeats, which never repeated - not 'Repeat enabled'", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
    });

    expect(summary("repeat-policy")).toHaveTextContent(/^Stop paging$/);
    expect(document.body).not.toHaveTextContent("Repeat enabled");
    expect(document.body).not.toHaveTextContent("Repeat disabled");
    expect(document.body).not.toHaveTextContent("still runs only once");
  });

  test("the dialog asks one question with two plain answers, and no number while it stops", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: false,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
    });

    const dialog: HTMLElement = await openEdit();

    expect(within(dialog).getByText("Edit Repeat Policy")).toBeInTheDocument();
    expect(
      within(dialog).getByText("If nobody acknowledges after the last level"),
    ).toBeInTheDocument();

    const stop: HTMLInputElement = radio(dialog, "Stop paging");
    const startAgain: HTMLInputElement = radio(
      dialog,
      "Start again from Level 1",
    );

    expect(stop.checked).toBe(true);
    expect(startAgain.checked).toBe(false);
    expect(within(dialog).getByText("Nobody is paged again.")).toBeVisible();
    expect(
      within(dialog).getByText("Every level is paged again, in order."),
    ).toBeVisible();

    // Stopping needs no number: the box is not there to fill in.
    expect(timesBox(dialog)).toBeNull();
    expect(
      within(dialog).queryByText("How many more times?"),
    ).not.toBeInTheDocument();

    // The old switch and its help are gone.
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Repeat if no one acknowledges");
    expect(dialog).not.toHaveTextContent("Number of times to repeat");
  });

  test("Start again asks how many more times, starting at 1, and saves exactly the two columns", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: false,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
    });

    const dialog: HTMLElement = await openEdit();

    await act(async () => {
      fireEvent.click(radio(dialog, "Start again from Level 1"));
    });
    await settle();

    expect(within(dialog).getByText("How many more times?")).toBeVisible();
    expect(
      within(dialog).getByText("After that, paging stops."),
    ).toBeVisible();
    expect(timesBox(dialog)!.value).toBe("1");

    await save();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual(
      expect.objectContaining({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 1,
      }),
    );
    // The choice itself is the form's own: nothing else is sent under it.
    expect(Object.keys(saved[0]!)).not.toContain("repeatChoice");
  });

  test("a typed number is saved as typed", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
    });

    const dialog: HTMLElement = await openEdit();

    expect(radio(dialog, "Start again from Level 1").checked).toBe(true);
    expect(timesBox(dialog)!.value).toBe("2");

    await act(async () => {
      fireEvent.change(timesBox(dialog)!, { target: { value: "4" } });
    });
    await settle();
    await save();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual(
      expect.objectContaining({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 4,
      }),
    );
  });

  test("emptying the number box keeps Start again picked, and asks for a number", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
    });

    const dialog: HTMLElement = await openEdit();

    await act(async () => {
      fireEvent.change(timesBox(dialog)!, { target: { value: "" } });
    });
    await settle();

    // Still there to type into: an empty box does not flip the choice to Stop.
    expect(radio(dialog, "Start again from Level 1").checked).toBe(true);
    expect(timesBox(dialog)).not.toBeNull();

    await save();

    expect(saved).toHaveLength(0);
    expect(dialog).toHaveTextContent(/How many more times\? is required/);
  });

  test("Stop turns the switch off and leaves the stored number as it was", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
    });

    const dialog: HTMLElement = await openEdit();

    await act(async () => {
      fireEvent.click(radio(dialog, "Stop paging"));
    });
    await settle();

    expect(timesBox(dialog)).toBeNull();

    await save();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual(
      expect.objectContaining({
        repeatPolicyIfNoOneAcknowledges: false,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    );
  });

  test("a policy whose repeats were switched off gets its old number back when it starts again", async () => {
    await renderOnCallCard({
      repeatPolicyIfNoOneAcknowledges: false,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
    });

    const dialog: HTMLElement = await openEdit();

    expect(radio(dialog, "Stop paging").checked).toBe(true);

    await act(async () => {
      fireEvent.click(radio(dialog, "Start again from Level 1"));
    });
    await settle();

    expect(timesBox(dialog)!.value).toBe("3");
  });
});

describe("an incoming call policy's Repeat Policy card", () => {
  test("speaks of rules and calls", async () => {
    await renderIncomingCallCard({
      repeatPolicyIfNoOneAnswers: false,
      repeatPolicyIfNoOneAnswersTimes: 1,
    });

    expect(await screen.findByText("Repeat Policy")).toBeInTheDocument();
    expect(
      screen.getByText("What happens when nobody answers after the last rule."),
    ).toBeInTheDocument();
    expect(screen.getByText("After the last rule")).toBeInTheDocument();
    expect(summary("incoming-call-repeat")).toHaveTextContent(
      /^End the call$/,
    );
    expect(storedModelName).toBe("IncomingCallPolicy");
  });

  test("reads the switch on with 0 as ringing again once, as calls do", async () => {
    await renderIncomingCallCard({
      repeatPolicyIfNoOneAnswers: true,
      repeatPolicyIfNoOneAnswersTimes: 0,
    });

    expect(summary("incoming-call-repeat")).toHaveTextContent(
      /^Ring again from the first rule, up to 1 more time$/,
    );
  });

  test("the dialog offers End the call or Ring again, and saves the call policy's columns", async () => {
    await renderIncomingCallCard({
      repeatPolicyIfNoOneAnswers: false,
      repeatPolicyIfNoOneAnswersTimes: 1,
    });

    const dialog: HTMLElement = await openEdit();

    expect(
      within(dialog).getByText("If nobody answers after the last rule"),
    ).toBeInTheDocument();
    expect(radio(dialog, "End the call").checked).toBe(true);
    expect(
      within(dialog).getByText("The caller hears the No Answer Message."),
    ).toBeVisible();

    await act(async () => {
      fireEvent.click(radio(dialog, "Ring again from the first rule"));
    });
    await settle();

    expect(
      within(dialog).getByText(
        "After that, the caller hears the No Answer Message.",
      ),
    ).toBeVisible();
    expect(timesBox(dialog)!.value).toBe("1");

    await save();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual(
      expect.objectContaining({
        repeatPolicyIfNoOneAnswers: true,
        repeatPolicyIfNoOneAnswersTimes: 1,
      }),
    );
    expect(Object.keys(saved[0]!)).not.toContain(
      ON_CALL_POLICY_REPEAT.columns.repeat,
    );
  });
});
