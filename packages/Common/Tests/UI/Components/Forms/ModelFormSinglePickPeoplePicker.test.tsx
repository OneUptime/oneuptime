import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A people picker that takes one pick, through the real ModelForm, with only
 * the network stubbed. Its value keys are the model's own columns for one
 * related record - an incoming call rule's onCallDutyPolicyScheduleId and
 * userId - and it must save them as such:
 *
 *   - a new record is saved with the picked kind's column holding the id and
 *     the other one empty, and nothing as misc data;
 *   - a record opened to edit selects both columns, shows what is saved, and
 *     a new pick of the other kind saves that column and clears the first;
 *   - left untouched, the edit form saves the one id it started with - never
 *     a list - so an edit of anything else keeps who the rule calls.
 */

type CapturedRequest = {
  model: JSONObject;
  miscDataProps: JSONObject;
};

let capturedRequests: Array<CapturedRequest> = [];
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/Permission", () => {
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

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
      getProfilePictureRoute: (): string => {
        return "/picture";
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
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

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
        miscDataProps: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({
          model: data.model,
          miscDataProps: { ...data.miscDataProps },
        });
        return { data: data.model };
      },
    },
  };
});

import IncomingCallPolicyEscalationRule from "../../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { PeoplePickerKind } from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RULE_ID: string = "22222222-2222-4222-8222-222222222221";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const PRIMARY: string = "0000000c-0000-4000-8000-000000000001";

function wanted(query: unknown, id: string): boolean {
  if (!(query instanceof Includes)) {
    return true;
  }

  return (query.values as Array<unknown>).some((value: unknown): boolean => {
    return String(value) === id;
  });
}

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const query: any = request.query || {};

    if (request.modelType === TeamMember) {
      const user: User = new User();
      user._id = ADA;
      user.name = new Name("Ada Lovelace");
      user.email = new Email("ada@example.com");

      const member: TeamMember = new TeamMember();
      member.user = user;

      const rows: Array<TeamMember> = wanted(query.userId, ADA) ? [member] : [];

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    }

    if (request.modelType === OnCallDutyPolicySchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = PRIMARY;
      schedule.name = "Primary rotation";

      const rows: Array<OnCallDutyPolicySchedule> = wanted(query._id, PRIMARY)
        ? [schedule]
        : [];

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });
}

const FIELDS: Array<ModelField<IncomingCallPolicyEscalationRule>> = [
  {
    field: { whoToCall: true } as never,
    title: "Who to call",
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: {
      kinds: [
        {
          kind: PeoplePickerKind.OnCallSchedule,
          valueKey: "onCallDutyPolicyScheduleId",
        },
        { kind: PeoplePickerKind.User, valueKey: "userId" },
      ],
      isSinglePick: true,
      addButtonText: "Choose who to call",
    },
    formOnly: true,
    required: true,
  },
  {
    field: { escalateAfterSeconds: true },
    title: "Ring for (in seconds)",
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "30",
  },
];

async function pick(name: string): Promise<void> {
  fireEvent.click(await screen.findByTestId("people-picker-add-button"));

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Choose who to call",
  });

  const options: Array<HTMLElement> =
    await within(dialog).findAllByRole("option");

  await act(async (): Promise<void> => {
    fireEvent.click(
      options.find((option: HTMLElement): boolean => {
        return option.textContent?.includes(name) || false;
      })!,
    );
  });

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}

async function submit(buttonText: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: buttonText }));
  });

  await waitFor(() => {
    expect(capturedRequests).toHaveLength(1);
  });
}

// An id as the request carries it: a string, or an ObjectID.
function idOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    throw new Error("A single pick was sent as a list.");
  }

  return value.toString();
}

function chipIds(): Array<string | null> {
  return screen
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

function renderEditForm(rule: IncomingCallPolicyEscalationRule): void {
  getItemMock.mockImplementation(
    async (): Promise<IncomingCallPolicyEscalationRule> => {
      return rule;
    },
  );

  render(
    <ModelForm<IncomingCallPolicyEscalationRule>
      modelType={IncomingCallPolicyEscalationRule}
      id="incoming-call-rule-form"
      fields={FIELDS}
      formType={FormType.Update}
      modelIdToEdit={new ObjectID(RULE_ID)}
      submitButtonText="Save Changes"
    />,
  );
}

function savedRule(
  data: Partial<
    Record<"userId" | "onCallDutyPolicyScheduleId", ObjectID | null>
  >,
): IncomingCallPolicyEscalationRule {
  const rule: IncomingCallPolicyEscalationRule =
    new IncomingCallPolicyEscalationRule();
  rule._id = RULE_ID;
  rule.escalateAfterSeconds = 20;
  Object.assign(rule, data);
  return rule;
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  jest.clearAllMocks();
});

describe("a single-pick people picker whose value keys are the model's columns", () => {
  test("a new record is saved with the picked kind's column, and the other empty", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();

    await act(async (): Promise<void> => {
      render(
        <ModelForm<IncomingCallPolicyEscalationRule>
          modelType={IncomingCallPolicyEscalationRule}
          id="incoming-call-rule-form"
          fields={FIELDS}
          formType={FormType.Create}
          submitButtonText="Add Rule"
        />,
      );
    });

    await pick("Primary rotation");
    // Changed my mind: a person, not the schedule.
    await pick("Ada Lovelace");

    expect(chipIds()).toEqual([ADA]);

    await submit("Add Rule");

    const request: CapturedRequest = capturedRequests[0]!;

    expect(idOf(request.model["userId"])).toBe(ADA);
    expect(idOf(request.model["onCallDutyPolicyScheduleId"])).toBeNull();
    // The picker's own key is never sent, and its picks are columns.
    expect(request.model["whoToCall"]).toBeUndefined();
    expect(request.miscDataProps).toEqual({});
  });

  test("a new record is not saved until something is picked", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();

    await act(async (): Promise<void> => {
      render(
        <ModelForm<IncomingCallPolicyEscalationRule>
          modelType={IncomingCallPolicyEscalationRule}
          id="incoming-call-rule-form"
          fields={FIELDS}
          formType={FormType.Create}
          submitButtonText="Add Rule"
        />,
      );
    });

    fireEvent.change(await screen.findByPlaceholderText("30"), {
      target: { value: "25" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));
    });

    expect(capturedRequests).toEqual([]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Who to call is required",
    );
  });

  test("a record opened to edit selects both columns and shows what it calls", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();

    await act(async (): Promise<void> => {
      renderEditForm(savedRule({ userId: new ObjectID(ADA) }));
    });

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    const select: JSONObject = (getItemMock.mock.calls[0]![0] as any).select;

    expect(select["userId"]).toBe(true);
    expect(select["onCallDutyPolicyScheduleId"]).toBe(true);
    expect(select).not.toHaveProperty("whoToCall");

    await waitFor(() => {
      expect(chipIds()).toEqual([ADA]);
    });

    expect(screen.getByTestId("people-picker-add-button")).toHaveTextContent(
      "Change",
    );
  });

  test("a new pick of the other kind saves that column and clears the first", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();

    await act(async (): Promise<void> => {
      renderEditForm(savedRule({ userId: new ObjectID(ADA) }));
    });

    await waitFor(() => {
      expect(chipIds()).toEqual([ADA]);
    });

    await pick("Primary rotation");

    expect(chipIds()).toEqual([PRIMARY]);

    await submit("Save Changes");

    const request: CapturedRequest = capturedRequests[0]!;

    expect(request.model["_id"]).toBe(RULE_ID);
    expect(idOf(request.model["onCallDutyPolicyScheduleId"])).toBe(PRIMARY);
    expect(idOf(request.model["userId"])).toBeNull();
    expect(request.miscDataProps).toEqual({});
  });

  test("left untouched, the edit form saves the one id it started with", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();

    await act(async (): Promise<void> => {
      renderEditForm(
        savedRule({
          onCallDutyPolicyScheduleId: new ObjectID(PRIMARY),
          userId: null,
        }),
      );
    });

    await waitFor(() => {
      expect(chipIds()).toEqual([PRIMARY]);
    });

    fireEvent.change(screen.getByPlaceholderText("30"), {
      target: { value: "45" },
    });

    await submit("Save Changes");

    const request: CapturedRequest = capturedRequests[0]!;

    expect(idOf(request.model["onCallDutyPolicyScheduleId"])).toBe(PRIMARY);
    expect(idOf(request.model["userId"])).toBeNull();
    expect(Number(request.model["escalateAfterSeconds"])).toBe(45);
  });
});
