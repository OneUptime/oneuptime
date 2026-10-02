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
 * The owners people picker through the real ModelForm, with only the network
 * stubbed. It must save exactly what the two dropdowns it replaced saved:
 *
 *   - on a model whose columns they are (an owner rule's ownerUsers and
 *     ownerTeams), the picks are selected when the form opens to edit, and
 *     saved as those columns;
 *   - on a model without them (an incident template), the picks go in the
 *     misc data, where the server's onCreateSuccess reads them;
 *   - the picker's own key ("owners") is neither selected nor sent.
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

import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import Team from "../../../../Models/DatabaseModels/Team";
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
import getOwnersFormField from "../../../../UI/Components/PeoplePicker/OwnersFormField";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RULE_ID: string = "22222222-2222-4222-8222-222222222221";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const user: User = new User();
      user._id = ADA;
      user.name = new Name("Ada Lovelace");
      user.email = new Email("ada@example.com");

      const member: TeamMember = new TeamMember();
      member.user = user;

      const wanted: boolean =
        !(request.query.userId instanceof Includes) ||
        (request.query.userId.values as Array<string>).includes(ADA);

      const rows: Array<TeamMember> = wanted ? [member] : [];

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    }

    if (request.modelType === Team) {
      const team: Team = new Team();
      team._id = PLATFORM;
      team.name = "Platform";

      return { data: [team], count: 1, skip: 0, limit: 1 };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });
}

const RULE_FIELDS: Array<ModelField<MonitorOwnerRule>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "Rule name",
  },
  getOwnersFormField<MonitorOwnerRule>({}),
];

const TEMPLATE_FIELDS: Array<ModelField<IncidentTemplate>> = [
  {
    field: { templateName: true },
    title: "Template Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "Template Name",
  },
  getOwnersFormField<IncidentTemplate>({}),
];

async function pick(name: string): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", {
    name: "Add owner",
  });

  if (button.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(button);
  }

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owner",
  });

  const options: Array<HTMLElement> = await within(dialog).findAllByRole(
    "option",
  );

  fireEvent.click(
    options.find((option: HTMLElement): boolean => {
      return option.textContent?.includes(name) || false;
    })!,
  );
}

async function submit(buttonText: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: buttonText }));
  });

  await waitFor(() => {
    expect(capturedRequests).toHaveLength(1);
  });
}

function idsOf(models: unknown): Array<string> {
  return ((models as Array<{ _id?: string }>) || []).map(
    (model: { _id?: string }): string => {
      return model._id || "";
    },
  );
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  jest.clearAllMocks();
});

describe("the owners picker on a model whose columns the owners are", () => {
  test("a new owner rule is saved with its picks as its ownerUsers and ownerTeams", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/monitors`);
    serveDirectory();

    await act(async (): Promise<void> => {
      render(
        <ModelForm<MonitorOwnerRule>
          modelType={MonitorOwnerRule}
          id="owner-rule-form"
          fields={RULE_FIELDS}
          formType={FormType.Create}
          submitButtonText="Create Rule"
        />,
      );
    });

    fireEvent.change(await screen.findByPlaceholderText("Rule name"), {
      target: { value: "Database owners" },
    });

    await pick("Ada Lovelace");
    await pick("Platform");

    await submit("Create Rule");

    const request: CapturedRequest = capturedRequests[0]!;

    expect(request.model["name"]).toBe("Database owners");
    expect(idsOf(request.model["ownerUsers"])).toEqual([ADA]);
    expect(idsOf(request.model["ownerTeams"])).toEqual([PLATFORM]);
    expect(request.model["owners"]).toBeUndefined();
    // Columns, not misc data: nothing else is sent.
    expect(request.miscDataProps).toEqual({});
  });

  test("an owner rule opened to edit selects its owners, shows them, and saves what is left", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/monitors`);
    serveDirectory();

    const ada: User = new User();
    ada._id = ADA;
    const platform: Team = new Team();
    platform._id = PLATFORM;

    getItemMock.mockImplementation(async (): Promise<MonitorOwnerRule> => {
      const rule: MonitorOwnerRule = new MonitorOwnerRule();
      rule._id = RULE_ID;
      rule.name = "Database owners";
      rule.ownerUsers = [ada];
      rule.ownerTeams = [platform];
      return rule;
    });

    await act(async (): Promise<void> => {
      render(
        <ModelForm<MonitorOwnerRule>
          modelType={MonitorOwnerRule}
          id="owner-rule-form"
          fields={RULE_FIELDS}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(RULE_ID)}
          submitButtonText="Save Changes"
        />,
      );
    });

    // Both owner columns are asked for, the picker's own key is not.
    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    const select: JSONObject = (getItemMock.mock.calls[0]![0] as any).select;

    expect(select["ownerUsers"]).toBe(true);
    expect(select["ownerTeams"]).toBe(true);
    expect(select).not.toHaveProperty("owners");

    await waitFor(() => {
      expect(
        screen.getAllByTestId("people-chip").map((chip: HTMLElement) => {
          return chip.getAttribute("data-id");
        }),
      ).toEqual([ADA, PLATFORM]);
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );

    await submit("Save Changes");

    const request: CapturedRequest = capturedRequests[0]!;

    expect(request.model["_id"]).toBe(RULE_ID);
    expect(idsOf(request.model["ownerUsers"])).toEqual([]);
    expect(idsOf(request.model["ownerTeams"])).toEqual([PLATFORM]);
    expect(request.miscDataProps).toEqual({});
  });
});

describe("the owners picker on a model without owner columns", () => {
  test("a new incident template sends its picks as misc data, as plain ids", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveDirectory();

    const seenByOnBeforeCreate: Array<JSONObject> = [];

    await act(async (): Promise<void> => {
      render(
        <ModelForm<IncidentTemplate>
          modelType={IncidentTemplate}
          id="incident-template-form"
          fields={TEMPLATE_FIELDS}
          formType={FormType.Create}
          submitButtonText="Create Incident Template"
          onBeforeCreate={async (
            item: IncidentTemplate,
            miscDataProps: JSONObject,
          ): Promise<IncidentTemplate> => {
            seenByOnBeforeCreate.push({ ...miscDataProps });
            return item;
          }}
        />,
      );
    });

    fireEvent.change(await screen.findByPlaceholderText("Template Name"), {
      target: { value: "Database outage" },
    });

    await pick("Ada Lovelace");
    await pick("Platform");

    await submit("Create Incident Template");

    const request: CapturedRequest = capturedRequests[0]!;

    expect(request.miscDataProps).toEqual({
      ownerUsers: [ADA],
      ownerTeams: [PLATFORM],
    });
    // A page's onBeforeCreate sees them where the server will.
    expect(seenByOnBeforeCreate).toEqual([
      { ownerUsers: [ADA], ownerTeams: [PLATFORM] },
    ]);
    expect(request.model["ownerUsers"]).toBeUndefined();
    expect(request.model["ownerTeams"]).toBeUndefined();
    expect(request.model["owners"]).toBeUndefined();
    expect(request.model["templateName"]).toBe("Database outage");
  });

  test("a template whose picker was never opened sends no owners at all", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveDirectory();

    await act(async (): Promise<void> => {
      render(
        <ModelForm<IncidentTemplate>
          modelType={IncidentTemplate}
          id="incident-template-form"
          fields={TEMPLATE_FIELDS}
          formType={FormType.Create}
          submitButtonText="Create Incident Template"
        />,
      );
    });

    fireEvent.change(await screen.findByPlaceholderText("Template Name"), {
      target: { value: "Database outage" },
    });

    await submit("Create Incident Template");

    expect(capturedRequests[0]!.miscDataProps).toEqual({});
  });

  test("starts with the owners a page hands it, and sends them on untouched", async () => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveDirectory();

    await act(async (): Promise<void> => {
      render(
        <ModelForm<IncidentTemplate>
          modelType={IncidentTemplate}
          id="incident-template-form"
          fields={TEMPLATE_FIELDS}
          formType={FormType.Create}
          initialValues={
            {
              templateName: "Database outage",
              ownerUsers: [new ObjectID(ADA)],
            } as never
          }
          submitButtonText="Create Incident Template"
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("people-chip")).toHaveTextContent(
        "Ada Lovelace",
      );
    });

    await submit("Create Incident Template");

    expect(capturedRequests[0]!.miscDataProps).toEqual({ ownerUsers: [ADA] });
  });
});
