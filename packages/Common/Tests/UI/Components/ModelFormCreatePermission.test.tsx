import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The second half of issue #3306, and the part that made the bug so confusing
 * to the person who filed it.
 *
 * A Viewer who reached the "Create New Monitor" page got a form that looked
 * complete: three steps, every one of them showing as done, and an active
 * Create button. That is because ModelForm's per-FIELD access control had
 * quietly stripped every column the viewer could not write - which is all of
 * them - leaving a wizard of empty steps with nothing left to fail validation.
 * Submitting posted an empty body, and the API answered with whichever field
 * it validated first: "Monitor type required to create monitor". A permissions
 * problem, reported as a form-validation problem, about a field the user was
 * never shown.
 *
 * A create form the viewer cannot submit now says so instead of rendering.
 *
 * The scope of that rule matters. It applies to CREATE only, and never to a
 * model that Public may create - the status page's own subscribe forms are
 * public creates rendered for visitors who may also happen to be signed in to
 * a project in the same browser, and blocking those would break sign-up flows
 * for a permission that has nothing to do with them.
 */

let permissionsForTest: Array<unknown> = [];

/*
 * ModelForm reads the merged list for the model-level gate but still reads the
 * global/project snapshots directly for its per-column checks, so all three
 * have to agree or the field-level path fails for reasons that have nothing to
 * do with what is being tested here.
 */
jest.mock("../../../UI/Utils/Permission", () => {
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import URL from "../../../Types/API/URL";
import Permission from "../../../Types/Permission";

describe("ModelForm model-level create permission", () => {
  beforeEach(() => {
    permissionsForTest = [];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("renders the create form for someone who may create", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    render(
      <ModelForm<Monitor>
        modelType={Monitor}
        name="Create New Monitor"
        id="create-monitor-form"
        formType={FormType.Create}
        submitButtonText="Create Monitor"
        onSuccess={() => {}}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Name")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/You do not have permission to create/),
    ).toBeNull();
  });

  /*
   * The heart of the reported bug. Before, this rendered an empty but
   * apparently-complete form; now it renders one sentence saying why.
   */
  test("replaces the create form with the reason when the viewer may not create", async () => {
    permissionsForTest = [Permission.Viewer];

    render(
      <ModelForm<Monitor>
        modelType={Monitor}
        name="Create New Monitor"
        id="create-monitor-form"
        formType={FormType.Create}
        submitButtonText="Create Monitor"
        onSuccess={() => {}}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/You do not have permission to create this Monitor/),
      ).toBeInTheDocument();
    });

    // And no submit button to press, so there is no wrong error to reach.
    expect(screen.queryByText("Create Monitor")).toBeNull();
  });

  test("names the permissions that would let them create", async () => {
    permissionsForTest = [Permission.Viewer];

    render(
      <ModelForm<Monitor>
        modelType={Monitor}
        name="Create New Monitor"
        id="create-monitor-form"
        formType={FormType.Create}
        onSuccess={() => {}}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/You need one of these permissions/),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Create Monitor/)).toBeInTheDocument();
  });

  /*
   * Before the snapshot arrives the honest answer is "we do not know yet", and
   * blanking a create page over it would be a worse bug than the one being
   * fixed - the page would flash an accusation and then work.
   */
  test("renders the form while the permission snapshot has not loaded", async () => {
    permissionsForTest = [];

    render(
      <ModelForm<Monitor>
        modelType={Monitor}
        name="Create New Monitor"
        id="create-monitor-form"
        formType={FormType.Create}
        onSuccess={() => {}}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            showEvenIfPermissionDoesNotExist: true,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Name")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/You do not have permission to create/),
    ).toBeNull();
  });

  /*
   * A status page visitor signing in. The form is a ModelForm over
   * StatusPagePrivateUser with formType Create, but it posts to the login
   * endpoint - the model's create permission has nothing to do with whether
   * this visitor may sign in. A signed-in project Viewer opening a status page
   * in the same browser must not be locked out of its login form.
   */
  test("never blocks a form that posts somewhere other than the model endpoint", async () => {
    permissionsForTest = [Permission.Viewer];

    render(
      <ModelForm<StatusPagePrivateUser>
        modelType={StatusPagePrivateUser}
        name="Login"
        id="login-form"
        formType={FormType.Create}
        createOrUpdateApiUrl={URL.fromString("http://localhost/api/login")}
        onSuccess={() => {}}
        fields={[
          {
            field: { email: true },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            showEvenIfPermissionDoesNotExist: true,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Email")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/You do not have permission to create/),
    ).toBeNull();
  });

  /*
   * A status page visitor subscribing to updates. StatusPageSubscriber lists
   * Public among its create permissions, which is the marker for "anybody may
   * do this" - the gate must not touch it, no matter what unrelated project
   * permissions happen to be sitting in the same browser's storage.
   */
  test("never blocks a create that Public is allowed to perform", async () => {
    permissionsForTest = [Permission.Viewer];

    render(
      <ModelForm<StatusPageSubscriber>
        modelType={StatusPageSubscriber}
        name="Subscribe"
        id="subscribe-form"
        formType={FormType.Create}
        onSuccess={() => {}}
        fields={[
          {
            field: { subscriberEmail: true },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            showEvenIfPermissionDoesNotExist: true,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Email")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/You do not have permission to create/),
    ).toBeNull();
  });
});
