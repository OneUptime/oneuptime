import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Users are the one resource whose custom field answers are not on the record
 * being viewed: User is global, so the per-project values live on the
 * ProjectUserProfile row for (project, user). Nothing can be rendered until
 * that row has been found, which is why the user pages go through this
 * wrapper instead of mounting CustomFieldsDetail directly.
 *
 * The same component backs two very different call sites - the dedicated
 * Custom Fields page, which owes the reader an explanation when there is
 * nothing to show, and the user overview, where it must simply not appear.
 * Both halves are pinned here.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import UserCustomFields from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/UserCustomFields";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectUserProfile from "../../../Models/DatabaseModels/ProjectUserProfile";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROFILE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type ListResultShape = {
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
};

type ToListResultFunction = (data: Array<BaseModel>) => ListResultShape;

const toListResult: ToListResultFunction = (
  data: Array<BaseModel>,
): ListResultShape => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

type BuildSchemaFunction = (
  names: Array<string>,
) => Array<TeamMemberCustomField>;

const buildSchema: BuildSchemaFunction = (
  names: Array<string>,
): Array<TeamMemberCustomField> => {
  return names.map((name: string) => {
    const schemaItem: TeamMemberCustomField = new TeamMemberCustomField();
    schemaItem.name = name;
    schemaItem.customFieldType = CustomFieldType.Text;
    return schemaItem;
  });
};

type BuildProfileFunction = () => ProjectUserProfile;

const buildProfile: BuildProfileFunction = (): ProjectUserProfile => {
  const profile: ProjectUserProfile = new ProjectUserProfile();
  profile.id = PROFILE_ID;
  return profile;
};

/*
 * getList is called for two different models: first the schema, then (only if
 * the project has any) the profile row. Dispatch on modelType rather than call
 * order so a test that expects the second call to be SKIPPED still reads
 * naturally.
 */
interface ListPlan {
  schema: Array<BaseModel>;
  profiles: Array<BaseModel>;
}

type PlanListsFunction = (plan: ListPlan) => void;

const planLists: PlanListsFunction = (plan: ListPlan): void => {
  getListMock.mockImplementation((args: any) => {
    if (args.modelType === TeamMemberCustomField) {
      return Promise.resolve(toListResult(plan.schema));
    }

    return Promise.resolve(toListResult(plan.profiles));
  });
};

type ResolveProfileItemFunction = (customFields: JSONObject) => void;

const resolveProfileItemWith: ResolveProfileItemFunction = (
  customFields: JSONObject,
): void => {
  const profile: ProjectUserProfile = buildProfile();
  profile.customFields = customFields;
  getItemMock.mockResolvedValue(profile as never);
};

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("UserCustomFields - the user overview (hideIfEmpty)", () => {
  test("shows the member's values once a profile row exists", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({
      schema: buildSchema(["Employee ID", "Desk"]),
      profiles: [buildProfile()],
    });
    resolveProfileItemWith({ "Employee ID": "E-4711", Desk: "3rd floor" });

    render(<UserCustomFields userId={USER_ID} hideIfEmpty={true} />);

    expect(await screen.findByText("E-4711")).toBeInTheDocument();
    expect(screen.getByText("3rd floor")).toBeInTheDocument();
    expect(screen.getByText("Employee ID")).toBeInTheDocument();
  });

  test("renders nothing when the project defined no member fields", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({ schema: [], profiles: [buildProfile()] });

    const { container } = render(
      <UserCustomFields userId={USER_ID} hideIfEmpty={true} />,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(container).toBeEmptyDOMElement();
  });

  /*
   * The profile row is created lazily, the first time someone saves their own
   * custom fields. Until then there is genuinely nothing to point the card at.
   */
  test("renders nothing when the member has no profile row yet", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({ schema: buildSchema(["Employee ID"]), profiles: [] });

    const { container } = render(
      <UserCustomFields userId={USER_ID} hideIfEmpty={true} />,
    );

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(1);
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing when the lookup fails", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    getListMock.mockRejectedValue(new Error("Upgrade your plan"));

    const { container } = render(
      <UserCustomFields userId={USER_ID} hideIfEmpty={true} />,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(screen.queryByText(/Upgrade your plan/i)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing, and asks for nothing, without a current project", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    const { container } = render(
      <UserCustomFields userId={USER_ID} hideIfEmpty={true} />,
    );

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("does not look for a profile row when there are no fields to fill", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({ schema: [], profiles: [buildProfile()] });

    render(<UserCustomFields userId={USER_ID} hideIfEmpty={true} />);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    expect((getListMock.mock.calls[0]![0] as JSONObject)["modelType"]).toBe(
      TeamMemberCustomField,
    );
  });

  test("looks the profile up by both project and user", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({
      schema: buildSchema(["Employee ID"]),
      profiles: [buildProfile()],
    });
    resolveProfileItemWith({ "Employee ID": "E-4711" });

    render(<UserCustomFields userId={USER_ID} hideIfEmpty={true} />);

    await screen.findByText("E-4711");

    const profileArgs: JSONObject = getListMock.mock.calls[1]![0] as JSONObject;
    expect(profileArgs["modelType"]).toBe(ProjectUserProfile);
    expect((profileArgs["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
    expect((profileArgs["query"] as JSONObject)["userId"]).toBe(USER_ID);
  });

  /*
   * The wrapper's own two lookups are not the only requests involved: the
   * card it mounts then fetches the schema and the profile row again for
   * itself. Hiding only the wrapper's half left the card's half free to paint
   * "No custom fields have been added" - and then an error box - onto the
   * overview of a user who plainly has custom fields.
   */
  test("renders nothing when the card's own read of the profile fails", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({
      schema: buildSchema(["Employee ID"]),
      profiles: [buildProfile()],
    });
    getItemMock.mockRejectedValue(new Error("Upgrade your plan"));

    const { container } = render(
      <UserCustomFields userId={USER_ID} hideIfEmpty={true} />,
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(screen.queryByText(/Upgrade your plan/i)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing when the profile row disappears between the two reads", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({
      schema: buildSchema(["Employee ID"]),
      profiles: [buildProfile()],
    });
    getItemMock.mockResolvedValue(null as never);

    const { container } = render(
      <UserCustomFields userId={USER_ID} hideIfEmpty={true} />,
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Item not found")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * Someone else's answers, on someone else's profile page. Reading them is
   * the point; editing them from here is not.
   */
  test("is read only", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({
      schema: buildSchema(["Employee ID"]),
      profiles: [buildProfile()],
    });
    resolveProfileItemWith({ "Employee ID": "E-4711" });

    render(<UserCustomFields userId={USER_ID} hideIfEmpty={true} />);

    expect(await screen.findByText("E-4711")).toBeInTheDocument();
    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();
  });
});

describe("UserCustomFields - the dedicated page (no hideIfEmpty)", () => {
  test("explains that the project defined no member fields", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({ schema: [], profiles: [buildProfile()] });

    render(<UserCustomFields userId={USER_ID} />);

    expect(
      await screen.findByText("No custom fields defined"),
    ).toBeInTheDocument();
  });

  test("explains that this member has not filled anything in", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({ schema: buildSchema(["Employee ID"]), profiles: [] });

    render(<UserCustomFields userId={USER_ID} />);

    expect(
      await screen.findByText("No custom field values"),
    ).toBeInTheDocument();
  });

  test("surfaces a failed lookup rather than hiding it", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    getListMock.mockRejectedValue(new Error("Upgrade your plan"));

    render(<UserCustomFields userId={USER_ID} />);

    expect(await screen.findByText(/Upgrade your plan/i)).toBeInTheDocument();
  });

  /*
   * The other half of the pair above: here the card's own read is the one
   * that fails, and this page is the one place that has to say so.
   */
  test("surfaces a failure of the card's own read too", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({
      schema: buildSchema(["Employee ID"]),
      profiles: [buildProfile()],
    });
    getItemMock.mockRejectedValue(new Error("Upgrade your plan"));

    render(<UserCustomFields userId={USER_ID} />);

    expect(await screen.findByText(/Upgrade your plan/i)).toBeInTheDocument();
  });

  test("still shows the values when there is something to show", async () => {
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
    planLists({
      schema: buildSchema(["Employee ID"]),
      profiles: [buildProfile()],
    });
    resolveProfileItemWith({ "Employee ID": "E-4711" });

    render(<UserCustomFields userId={USER_ID} />);

    expect(await screen.findByText("E-4711")).toBeInTheDocument();
    expect(screen.getByText("Custom Fields")).toBeInTheDocument();
  });
});
