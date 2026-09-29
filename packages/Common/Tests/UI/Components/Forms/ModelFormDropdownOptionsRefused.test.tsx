import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ModelForm fetches the options of every entity dropdown up front, with the
 * permissions of the person using the form. Reading a dropdown's model is a
 * separate permission from editing the field: an incident member may edit
 * the status pages an incident is limited to without being able to read a
 * single status page (incident roles do not read them, by design).
 *
 * That list request used to be the end of the form: it was refused, the
 * error left the fetch loop - so no dropdown after it got its options - and
 * the form showed "You do not have permissions to read Status Page" in red on
 * every step. These tests drive the real ModelForm against the real Incident,
 * StatusPage and Label models and pin what happens instead:
 *
 *   - a list the person may not read leaves that dropdown empty, quietly (the
 *     page explains an empty status page picker next to it);
 *   - every other dropdown still gets its options;
 *   - any other failure is still shown, once, and still does not stop the
 *     other dropdowns;
 *   - a refused list is not asked for again on every render.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: permissionsForTest };
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

/*
 * How each table's list request ends: rows, or what to throw - ModelAPI
 * throws the HTTPErrorResponse itself, which is not an Error.
 */
let listOutcomeByTableName: Record<string, Array<unknown> | HTTPErrorResponse> =
  {};
let listRequests: Array<string> = [];

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (data: {
        modelType: { new (): { tableName: string | null } };
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        const tableName: string = new data.modelType().tableName || "";

        listRequests.push(tableName);

        // Cross a task boundary, as a real request does.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        const outcome: Array<unknown> | HTTPErrorResponse =
          listOutcomeByTableName[tableName] || [];

        if (!Array.isArray(outcome)) {
          throw outcome;
        }

        return { data: outcome, count: outcome.length, skip: 0, limit: 50 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

import ModelForm, {
  FormType,
  isListRefusedForLackOfPermission,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PermissionGate from "../../../../UI/Utils/PermissionGate";

const REFUSED_MESSAGE: string =
  "You do not have permissions to read Status Page. You need one of these permissions: Project Owner, Project Admin, Status Page Viewer.";

function refused(): HTTPErrorResponse {
  // What the API answers a NotAuthorizedException with.
  return new HTTPErrorResponse(422, { message: REFUSED_MESSAGE }, {});
}

function label(name: string): Label {
  const row: Label = new Label();
  row._id = ObjectID.generate().toString();
  row.name = name;
  row.color = new Color("#000000");
  return row;
}

// The status page picker, then a dropdown after it.
function fields(): Fields<Incident> {
  return [
    {
      field: { title: true },
      title: "Title",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Incident title",
    },
    {
      field: { statusPages: true },
      title: "Limit to these status pages",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: StatusPage,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Every status page that lists the monitors",
    },
    {
      field: { labels: true },
      title: "Labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Labels",
    },
  ];
}

interface HarnessProps {
  onFieldsReady?: ((fields: Fields<Incident>) => void) | undefined;
}

// A page that re-renders its form with a new `fields` array identity.
const Harness: React.FunctionComponent<
  HarnessProps
> = (): React.ReactElement => {
  const [renders, setRenders] = React.useState<number>(0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRenders(renders + 1);
        }}
      >
        Re-render {renders}
      </button>
      <ModelForm<Incident>
        modelType={Incident}
        name="Create New Incident"
        id="create-incident-form"
        formType={FormType.Create}
        submitButtonText="Create"
        onSuccess={() => {}}
        fields={fields()}
      />
    </>
  );
};

async function renderForm(): Promise<void> {
  await act(async (): Promise<void> => {
    render(<Harness />);
  });

  await waitFor(() => {
    expect(screen.getByPlaceholderText("Incident title")).toBeInTheDocument();
  });
}

function requestsFor(tableName: string): number {
  return listRequests.filter((name: string): boolean => {
    return name === tableName;
  }).length;
}

describe("ModelForm when a dropdown's list is refused", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();

    listRequests = [];
    listOutcomeByTableName = {
      StatusPage: refused(),
      Label: [label("Region East"), label("Region West")],
    };
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("shows no error: the form works, and the picker is simply empty", async () => {
    await renderForm();

    await waitFor(() => {
      expect(requestsFor("Label")).toBeGreaterThan(0);
    });

    expect(screen.queryByText(REFUSED_MESSAGE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  test("the dropdowns after it still get their options", async () => {
    await renderForm();

    // The status page list came first and was refused; the labels still load.
    await waitFor(() => {
      expect(listRequests.indexOf("Label")).toBeGreaterThan(
        listRequests.indexOf("StatusPage"),
      );
    });
  });

  test("a refused list is not asked for again when the page re-renders", async () => {
    await renderForm();

    await waitFor(() => {
      expect(requestsFor("Label")).toBeGreaterThan(0);
    });

    const statusPageRequestsBefore: number = requestsFor("StatusPage");

    await act(async (): Promise<void> => {
      screen.getByRole("button", { name: /Re-render/ }).click();
    });
    await act(async (): Promise<void> => {
      screen.getByRole("button", { name: /Re-render/ }).click();
    });

    expect(requestsFor("StatusPage")).toBe(statusPageRequestsBefore);
  });

  test("any other failure is still shown, and the other dropdowns still load", async () => {
    listOutcomeByTableName["StatusPage"] = new HTTPErrorResponse(
      500,
      { message: "The status page list failed." },
      {},
    );

    await renderForm();

    expect(
      await screen.findByText("The status page list failed."),
    ).toBeInTheDocument();
    expect(requestsFor("Label")).toBeGreaterThan(0);
  });
});

describe("isListRefusedForLackOfPermission", () => {
  test("a NotAuthorizedException answer (422) is a refusal", () => {
    expect(isListRefusedForLackOfPermission(refused())).toBe(true);
  });

  test.each([400, 401, 403, 404, 500])(
    "a %s answer is not",
    (statusCode: number) => {
      expect(
        isListRefusedForLackOfPermission(
          new HTTPErrorResponse(statusCode, { message: "No." }, {}),
        ),
      ).toBe(false);
    },
  );

  test("an error that is not an HTTP answer is not", () => {
    expect(isListRefusedForLackOfPermission(new Error("offline"))).toBe(false);
    expect(isListRefusedForLackOfPermission(undefined)).toBe(false);
  });
});
