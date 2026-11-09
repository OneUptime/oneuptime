import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * onItemFetched: an Update form's record as it was fetched, before the form
 * opens on it. A rule's Owning Teams are kept in a table of their own and
 * sent as misc data (the server's RuleOwningTeams), so the rule's own fetch
 * does not carry them: the rule lists fill them in here. Without it, the
 * Edit form opened on no owning teams, and adding one sent a list without
 * the teams that already owned the rule - which the server takes as the
 * whole list, removing them.
 *
 *   - the form opens on what onItemFetched filled in, and the picker shows it;
 *   - a save sends the list as the person left it: the same list, one more
 *     team, or none at all - an empty list, which makes the rule the
 *     project's again;
 *   - a form with no such hook opens as before, and sends no list until the
 *     person picks one.
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

import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import Team from "../../../../Models/DatabaseModels/Team";
import ObjectID from "../../../../Types/ObjectID";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { PeoplePickerKind } from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import SelectFormFields from "../../../../UI/Types/SelectEntityField";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RULE_ID: string = "22222222-2222-4222-8222-222222222221";
const OVERSIGHT: string = "0000000b-0000-4000-8000-000000000001";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000002";

function serveTeams(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === Team) {
      const teams: Array<Team> = [
        [OVERSIGHT, "Oversight"],
        [PLATFORM, "Platform"],
      ].map(([id, name]: Array<string>): Team => {
        const team: Team = new Team();
        team._id = id!;
        team.name = name!;
        return team;
      });

      return { data: teams, count: teams.length, skip: 0, limit: 10 };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });
}

function serveRule(): void {
  getItemMock.mockImplementation(async (): Promise<IncidentOnCallRule> => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule._id = RULE_ID;
    rule.name = "Page Oversight";
    return rule;
  });
}

// The rule form's Owning Teams: teams only, kept in owningTeams, sent as misc data.
const FIELDS: Array<ModelField<IncidentOnCallRule>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "Rule name",
  },
  {
    field: {
      ruleOwningTeams: true,
    } as unknown as SelectFormFields<IncidentOnCallRule>,
    title: "Owning Teams",
    required: false,
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: {
      kinds: [{ kind: PeoplePickerKind.Team, valueKey: "owningTeams" }],
      addButtonText: "Add team",
      searchPlaceholder: "Search teams...",
      emptyText: "No teams found.",
    },
    formOnly: true,
  },
];

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  });

  await waitFor(() => {
    expect(capturedRequests).toHaveLength(1);
  });
}

function chipIds(): Array<string | null> {
  return screen.queryAllByTestId("people-chip").map((chip: HTMLElement) => {
    return chip.getAttribute("data-id");
  });
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  jest.clearAllMocks();
});

describe("an Update form's fields that are no columns, filled in when the record is fetched", () => {
  const renderForm: (
    onItemFetched?: (item: IncidentOnCallRule) => Promise<IncidentOnCallRule>,
  ) => Promise<void> = async (
    onItemFetched?: (item: IncidentOnCallRule) => Promise<IncidentOnCallRule>,
  ): Promise<void> => {
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveTeams();
    serveRule();

    await act(async (): Promise<void> => {
      render(
        <ModelForm<IncidentOnCallRule>
          modelType={IncidentOnCallRule}
          id="on-call-rule-form"
          fields={FIELDS}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(RULE_ID)}
          submitButtonText="Save Changes"
          onItemFetched={onItemFetched}
        />,
      );
    });
  };

  // The rule list's hook: who owns the rule now.
  const ownedByOversight: (
    item: IncidentOnCallRule,
  ) => Promise<IncidentOnCallRule> = async (
    item: IncidentOnCallRule,
  ): Promise<IncidentOnCallRule> => {
    (item as unknown as Record<string, unknown>)["owningTeams"] = [OVERSIGHT];
    return item;
  };

  test("the form opens on the teams that own the rule, and saving sends them as they are", async () => {
    await renderForm(ownedByOversight);

    await waitFor(() => {
      expect(chipIds()).toEqual([OVERSIGHT]);
    });

    // The picker's own key is not a column the rule is fetched with.
    const select: JSONObject = (getItemMock.mock.calls[0]![0] as any).select;
    expect(select).not.toHaveProperty("ruleOwningTeams");
    expect(select).not.toHaveProperty("owningTeams");

    await submit();

    expect(capturedRequests[0]!.miscDataProps["owningTeams"]).toEqual([
      OVERSIGHT,
    ]);
    expect(capturedRequests[0]!.model["owningTeams"]).toBeUndefined();
  });

  test("taking the last team off sends an empty list: the rule is the project's again", async () => {
    await renderForm(ownedByOversight);

    await waitFor(() => {
      expect(chipIds()).toEqual([OVERSIGHT]);
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Oversight" }),
    );

    await waitFor(() => {
      expect(chipIds()).toEqual([]);
    });

    await submit();

    expect(capturedRequests[0]!.miscDataProps["owningTeams"]).toEqual([]);
  });

  test("a form with no such hook opens on no teams, and sends no list until one is picked", async () => {
    await renderForm(undefined);

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByDisplayValue("Page Oversight")).toBeVisible();
    expect(chipIds()).toEqual([]);

    await submit();

    expect(capturedRequests[0]!.miscDataProps).not.toHaveProperty(
      "owningTeams",
    );
  });
});
