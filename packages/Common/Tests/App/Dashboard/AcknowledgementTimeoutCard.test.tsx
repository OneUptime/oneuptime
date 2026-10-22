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
 * A POLICY'S ACKNOWLEDGEMENT TIMEOUT, ON THE REAL CARD AND IN ITS REAL
 * EDIT DIALOG (issue #5123).
 *
 * "Page again if it is acknowledged but not resolved in N minutes": one
 * plain choice, as the Repeat Policy card above it asks - Don't page again
 * (what every policy does until somebody changes it), or Page again, and
 * only then after how many minutes, 30 to start with. Both answers write
 * the one column, acknowledgementTimeoutInMinutes: empty, or the minutes.
 *
 * The card (CardModelDetail), the dialog (ModelFormModal), the form
 * (ModelForm, BasicForm) and the radio are the real ones; only the network
 * and the permission snapshot are stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

const POLICY_ID: string = "4e000000-0000-4000-8000-0000000000f1";

let stored: JSONObject = {};
let saved: Array<JSONObject> = [];
let reads: number = 0;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        reads++;
        const item: Record<string, unknown> = new data.modelType() as Record<
          string,
          unknown
        >;
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
        // What is saved is what is read next.
        stored = { ...stored, ...json };
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
import AcknowledgementTimeoutCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/AcknowledgementTimeout/AcknowledgementTimeoutCard";

let loaded: Array<number | null> = [];

beforeEach(() => {
  stored = {};
  saved = [];
  reads = 0;
  loaded = [];
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

async function renderCard(policy: JSONObject): Promise<void> {
  stored = policy;
  render(
    <AcknowledgementTimeoutCard
      onCallDutyPolicyId={new ObjectID(POLICY_ID)}
      onLoaded={(minutes: number | null) => {
        loaded.push(minutes);
      }}
    />,
  );
  await settle();
}

function summary(): HTMLElement {
  return screen.getByTestId("acknowledgement-timeout-summary");
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

function minutesBox(dialog: HTMLElement): HTMLInputElement | null {
  return within(dialog).queryByRole("spinbutton") as HTMLInputElement | null;
}

async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
  await settle();
}

describe("the Acknowledgement Timeout card", () => {
  test("says what it is for, and that a policy that never set it does not page again", async () => {
    await renderCard({});

    expect(
      await screen.findByText("Acknowledgement Timeout"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "What happens when someone acknowledges but nobody resolves.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("After an acknowledgement")).toBeInTheDocument();
    expect(summary()).toHaveTextContent(/^Don't page again$/);
  });

  test("says after how long a policy pages again", async () => {
    await renderCard({ acknowledgementTimeoutInMinutes: 30 });

    expect(summary()).toHaveTextContent(
      /^Page again if not resolved within 30 minutes$/,
    );

    cleanup();
    await renderCard({ acknowledgementTimeoutInMinutes: 120 });

    expect(summary()).toHaveTextContent(
      /^Page again if not resolved within 120 minutes$/,
    );
  });

  test("tells the page what the policy is set to, each time it reads it", async () => {
    await renderCard({ acknowledgementTimeoutInMinutes: 45 });

    await waitFor(() => {
      expect(loaded).toEqual([45]);
    });

    cleanup();
    loaded = [];
    await renderCard({ acknowledgementTimeoutInMinutes: null });

    await waitFor(() => {
      expect(loaded).toEqual([null]);
    });
  });

  test("the dialog asks one question with two plain answers, and no number while it does not page again", async () => {
    await renderCard({});

    const dialog: HTMLElement = await openEdit();

    expect(
      within(dialog).getByText("Edit Acknowledgement Timeout"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("If it is acknowledged but not resolved"),
    ).toBeInTheDocument();

    expect(radio(dialog, "Don't page again").checked).toBe(true);
    expect(radio(dialog, "Page again").checked).toBe(false);
    expect(
      within(dialog).getByText("Acknowledging stops the paging for good."),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "Pages whoever acknowledged it, and whoever is on call now.",
      ),
    ).toBeVisible();

    expect(minutesBox(dialog)).toBeNull();
    expect(
      within(dialog).queryByText("After how many minutes?"),
    ).not.toBeInTheDocument();

    // Nothing else to pick: who is paged and how often is decided for everybody.
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  });

  test("Page again asks after how many minutes, starting at 30, and saves the minutes", async () => {
    await renderCard({});

    const dialog: HTMLElement = await openEdit();

    await act(async () => {
      fireEvent.click(radio(dialog, "Page again"));
    });
    await settle();

    expect(within(dialog).getByText("After how many minutes?")).toBeVisible();
    expect(
      within(dialog).getByText(
        "Counted from each acknowledgement. It pages again 5 times at most.",
      ),
    ).toBeVisible();
    expect(minutesBox(dialog)!.value).toBe("30");

    await save();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual(
      expect.objectContaining({ acknowledgementTimeoutInMinutes: 30 }),
    );
    // The choice is the form's own: nothing else is sent under it.
    expect(Object.keys(saved[0]!)).not.toContain(
      "acknowledgementTimeoutChoice",
    );
  });

  test("a typed number is saved as typed, and the card says it", async () => {
    await renderCard({ acknowledgementTimeoutInMinutes: 30 });

    const dialog: HTMLElement = await openEdit();

    expect(radio(dialog, "Page again").checked).toBe(true);
    expect(minutesBox(dialog)!.value).toBe("30");

    await act(async () => {
      fireEvent.change(minutesBox(dialog)!, { target: { value: "45" } });
    });
    await settle();
    await save();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual(
      expect.objectContaining({ acknowledgementTimeoutInMinutes: 45 }),
    );

    await waitFor(() => {
      expect(summary()).toHaveTextContent(
        /^Page again if not resolved within 45 minutes$/,
      );
    });
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  test("Don't page again saves it empty: the policy stops paging at an acknowledgement again", async () => {
    await renderCard({ acknowledgementTimeoutInMinutes: 30 });

    const dialog: HTMLElement = await openEdit();

    await act(async () => {
      fireEvent.click(radio(dialog, "Don't page again"));
    });
    await settle();

    expect(minutesBox(dialog)).toBeNull();

    await save();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]!["acknowledgementTimeoutInMinutes"]).toBeNull();
  });

  test("emptying the minutes box keeps Page again picked, and asks for a number", async () => {
    await renderCard({ acknowledgementTimeoutInMinutes: 30 });

    const dialog: HTMLElement = await openEdit();

    await act(async () => {
      fireEvent.change(minutesBox(dialog)!, { target: { value: "" } });
    });
    await settle();

    expect(radio(dialog, "Page again").checked).toBe(true);
    expect(minutesBox(dialog)).not.toBeNull();

    await save();

    expect(saved).toHaveLength(0);
    expect(dialog).toHaveTextContent(/After how many minutes\? is required/);
  });

  test.each([
    ["4", "too short to have looked"],
    ["1441", "longer than a day"],
  ])(
    "%s minutes is refused before anything is sent (%s)",
    async (value: string) => {
      await renderCard({ acknowledgementTimeoutInMinutes: 30 });

      const dialog: HTMLElement = await openEdit();

      await act(async () => {
        fireEvent.change(minutesBox(dialog)!, { target: { value: value } });
      });
      await settle();
      await save();

      expect(saved).toHaveLength(0);
      expect(minutesBox(dialog)).not.toBeNull();
    },
  );

  test("a policy that paged again before and was turned off gets 30 back, not its old number", async () => {
    await renderCard({ acknowledgementTimeoutInMinutes: null });

    const dialog: HTMLElement = await openEdit();

    await act(async () => {
      fireEvent.click(radio(dialog, "Page again"));
    });
    await settle();

    expect(minutesBox(dialog)!.value).toBe("30");
  });
});
