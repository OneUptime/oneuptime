import "@testing-library/jest-dom";
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
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "SKIP UNTIL..." ON A PERSON IN A SCHEDULE LAYER (task oncall-skip-user-until).
 *
 * The button on a person's row in a layer opens the Add User Override form
 * - the one form for time away - as "Skip <name>", with only the network
 * stubbed here:
 *
 *   - Who is away? is the person whose row it was, not whoever is signed in;
 *   - Who covers? reads "Next person in the rotation", and Starts is now, so
 *     all that is left is when they are back;
 *   - saved that way it is a skip for every policy: the person away, no
 *     cover, no policy;
 *   - picking somebody under Who covers? makes it a named cover instead, and
 *     the person away is not offered to cover for themselves;
 *   - without an end, nothing is sent.
 */

let signedInUserId: string | null = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectAdmin"] };
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
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return signedInUserId || "";
          },
        };
      },
      getProfilePictureRoute: (): string => {
        return "/picture";
      },
    },
  };
});

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

const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0d500000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import SkipLayerUserModal from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import Timezone from "../../../Types/Timezone";

jest.setTimeout(30000);

const PROJECT_ID: string = "0d500000-0000-4000-8000-000000000001";

const ALEX: string = "0d500000-0000-4000-8000-0000000000a1";
const SAM: string = "0d500000-0000-4000-8000-0000000000b1";
const PAT: string = "0d500000-0000-4000-8000-0000000000c1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALEX]: { name: "Alex Chen", email: "alex@example.com" },
  [SAM]: { name: "Sam Rivera", email: "sam@example.com" },
  [PAT]: { name: "Pat Kim", email: "pat@example.com" },
};

// The dialog opens at 12:34 on 3 March 2026, UTC.
const NOW: Date = OneUptimeDate.fromString("2026-03-03T12:34:00.000Z");
const BACK_ON: Date = OneUptimeDate.fromString("2026-03-10T09:00:00.000Z");

let onClose: MockFunction = getJestMockFunction();
let onSkipped: MockFunction = getJestMockFunction();

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

// The ids an Includes query asks for, or every id when it asks for none.
function wanted(value: unknown, id: string): boolean {
  if (!(value instanceof Includes)) {
    return true;
  }

  return (value.values as Array<unknown>).some(
    (candidate: unknown): boolean => {
      return String(candidate).toLowerCase() === id.toLowerCase();
    },
  );
}

function user(id: string): User {
  const person: User = new User();
  person._id = id;
  person.name = new Name(PEOPLE[id]!.name);
  person.email = new Email(PEOPLE[id]!.email);
  return person;
}

beforeEach(() => {
  // Sam is signed in, and skips Alex.
  signedInUserId = SAM;
  onClose = getJestMockFunction();
  onSkipped = getJestMockFunction();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    // The people pickers' search lists, and their look-ups by id.
    if (params.modelType === TeamMember) {
      return list(
        [ALEX, SAM, PAT]
          .filter((id: string): boolean => {
            return wanted(query["userId"], id);
          })
          .map((id: string): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.user = user(id);
            return member;
          }),
      );
    }

    return list([]);
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

async function renderModal(): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <SkipLayerUserModal
        userId={ALEX}
        name="Alex Chen"
        onClose={() => {
          onClose();
        }}
        onSkipped={() => {
          onSkipped();
        }}
      />
    </MemoryRouter>,
  );

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByText("Who covers?");

  // BasicForm fills in the fields' defaults in an effect of its own.
  await waitFor(() => {
    expect(timeInput(modal, "Starts").value).not.toBe("");
    expect(chipIds(picker(modal, "Who is away?"))).toEqual([ALEX]);
  });

  return modal;
}

function timeInput(modal: HTMLElement, title: string): HTMLInputElement {
  const label: HTMLLabelElement | undefined = Array.from(
    modal.querySelectorAll("label"),
  ).find((candidate: HTMLLabelElement): boolean => {
    return (candidate.textContent || "").trim().startsWith(title);
  });

  if (!label) {
    throw new Error(`No field ${title}`);
  }

  return modal.querySelector(
    `[id="${label.getAttribute("for")}"]`,
  ) as HTMLInputElement;
}

// The people picker under a question: its group is named by the label.
function picker(modal: HTMLElement, question: string): HTMLElement {
  return within(modal).getByRole("group", { name: question });
}

function chipIds(group: HTMLElement): Array<string | null> {
  return within(group)
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

async function openPicker(
  modal: HTMLElement,
  question: string,
  listName: string,
): Promise<HTMLElement> {
  fireEvent.click(
    within(picker(modal, question)).getByTestId("people-picker-add-button"),
  );

  const popup: HTMLElement = await screen.findByRole("dialog", {
    name: listName,
  });

  await waitFor(() => {
    expect(within(popup).getByRole("listbox")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  return popup;
}

function setEnds(modal: HTMLElement, at: Date): void {
  fireEvent.change(timeInput(modal, "Ends"), {
    target: { value: OneUptimeDate.toDateTimeLocalString(at) },
  });
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", {
        name: "Skip Alex Chen",
        exact: true,
      }),
    );
  });
}

function sentOverride(): OnCallDutyPolicyUserOverride {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  return (createOrUpdateMock.mock.calls[0]![0] as any)
    .model as OnCallDutyPolicyUserOverride;
}

function idOf(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

describe("Skip until... on a person in a layer", () => {
  test("opens as 'Skip <name>', saying what a skip does", async () => {
    const modal: HTMLElement = await renderModal();

    expect(
      within(modal).getByRole("heading", { name: "Skip Alex Chen" }),
    ).toBeInTheDocument();
    expect(modal).toHaveTextContent(
      "While Alex Chen is away, each of their turns goes to the next person in the rotation, and they are back in their usual place when it ends. It applies to every on-call policy, and is listed under On-Call Duty > User Overrides.",
    );
    expect(
      within(modal).getByRole("button", {
        name: "Skip Alex Chen",
        exact: true,
      }),
    ).toBeInTheDocument();
  });

  test("asks the four questions of the one time-away form", async () => {
    const modal: HTMLElement = await renderModal();

    const labels: Array<string> = Array.from(modal.querySelectorAll("label"))
      .map((label: HTMLLabelElement): string => {
        return (label.textContent || "").trim();
      })
      .filter((text: string): boolean => {
        return text.length > 0;
      });

    expect(labels).toEqual(["Who is away?", "Who covers?", "Starts", "Ends"]);
  });

  test("Who is away? is the person whose row it was, not who is signed in", async () => {
    const modal: HTMLElement = await renderModal();

    expect(chipIds(picker(modal, "Who is away?"))).toEqual([ALEX]);
    expect(chipIds(picker(modal, "Who is away?"))).not.toContain(SAM);
  });

  test("Who covers? reads 'Next person in the rotation', Starts is now, Ends is left to you", async () => {
    const modal: HTMLElement = await renderModal();

    expect(chipIds(picker(modal, "Who covers?"))).toEqual([]);
    expect(
      within(picker(modal, "Who covers?")).getByTestId(
        "people-picker-nobody-picked",
      ),
    ).toHaveTextContent("Next person in the rotation");

    expect(timeInput(modal, "Starts").value).toMatch(/^2026-03-03T12:34/);
    expect(timeInput(modal, "Ends").value).toBe("");
  });

  test("saved with an end, it skips them for every policy: no cover, no policy", async () => {
    const modal: HTMLElement = await renderModal();

    setEnds(modal, BACK_ON);
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const sent: OnCallDutyPolicyUserOverride = sentOverride();

    expect(idOf(sent.overrideUserId)).toBe(ALEX);
    expect(sent.routeAlertsToUserId).toBeFalsy();
    expect(sent.onCallDutyPolicyId).toBeFalsy();
    expect(idOf(sent.projectId)).toBe(PROJECT_ID);
    expect(OneUptimeDate.fromString(sent.startsAt!).toISOString()).toBe(
      NOW.toISOString(),
    );
    expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
      BACK_ON.toISOString(),
    );

    // Nothing about a cover is sent at all: the server reads that as a skip.
    const json: string = JSON.stringify(
      OnCallDutyPolicyUserOverride.toJSON(sent, OnCallDutyPolicyUserOverride),
    );
    expect(json).not.toContain("routeAlertsToUserId");
    expect(json).not.toContain("onCallDutyPolicyId");

    await waitFor(() => {
      expect(onSkipped).toHaveBeenCalledTimes(1);
    });
  });

  test("with somebody picked under Who covers?, it is a named cover instead", async () => {
    const modal: HTMLElement = await renderModal();

    const popup: HTMLElement = await openPicker(
      modal,
      "Who covers?",
      "Choose someone",
    );

    const option: HTMLElement | undefined = within(popup)
      .getAllByRole("option")
      .find((candidate: HTMLElement): boolean => {
        return candidate.getAttribute("data-id") === PAT;
      });

    expect(option).toBeDefined();

    await act(async (): Promise<void> => {
      fireEvent.click(option!);
    });

    await waitFor(() => {
      expect(chipIds(picker(modal, "Who covers?"))).toEqual([PAT]);
    });

    setEnds(modal, BACK_ON);
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const sent: OnCallDutyPolicyUserOverride = sentOverride();

    expect(idOf(sent.overrideUserId)).toBe(ALEX);
    expect(idOf(sent.routeAlertsToUserId)).toBe(PAT);
  });

  test("does not offer the person away to cover for themselves", async () => {
    const modal: HTMLElement = await renderModal();

    const popup: HTMLElement = await openPicker(
      modal,
      "Who covers?",
      "Choose someone",
    );

    const offered: Array<string | null> = within(popup)
      .queryAllByRole("option")
      .map((option: HTMLElement): string | null => {
        return option.getAttribute("data-id");
      });

    expect(offered).toEqual(expect.arrayContaining([SAM, PAT]));
    expect(offered).not.toContain(ALEX);
  });

  test("without an end, nothing is sent", async () => {
    const modal: HTMLElement = await renderModal();

    await submit(modal);

    // The form stays open and says what is missing.
    expect(await within(modal).findByText("Ends is required.")).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(onSkipped).not.toHaveBeenCalled();
  });

  test("Cancel closes it and saves nothing", async () => {
    const modal: HTMLElement = await renderModal();

    fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});
