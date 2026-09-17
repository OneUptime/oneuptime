import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import API from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import Permission from "../../../Types/Permission";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { getJestSpyOn } from "../../Spy";

/*
 * Settings > Danger Zone is where a customer deletes their project - the one
 * moment OneUptime can ask why they are leaving, because a second later the
 * project and every trace of the account are gone for good.
 *
 * The page is rendered for real down to the confirmation dialog. Page chrome
 * (the layout shell and the side menu) is stubbed: both want a router this
 * test has no use for, and neither has anything to do with deleting a project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: true };

(
  globalThis as unknown as { __dangerZoneConfig: MutableConfig }
).__dangerZoneConfig = config;

/*
 * BILLING_ENABLED is a module-scope const, so the two deployments have to be
 * switchable per test rather than per file. defineProperty rather than a
 * getter in the object literal: a literal getter is read once while the
 * object is built, which would freeze the value at mock time.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...jest.requireActual("../../../UI/Config"),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __dangerZoneConfig: MutableConfig | undefined;
          }
        ).__dangerZoneConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react");

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

/*
 * Imported after the mocks above so the page picks them up - the module reads
 * BILLING_ENABLED as soon as it renders.
 */
import DangerZone from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/DangerZone";

interface PageCalls {
  projectDeleted: number;
}

type RenderPageFunction = () => PageCalls;

const renderPage: RenderPageFunction = (): PageCalls => {
  const calls: PageCalls = { projectDeleted: 0 };

  render(
    <DangerZone
      pageRoute={new Route("/settings/danger-zone")}
      currentProject={null}
      hasPaymentMethod={true}
      onProjectDeleted={() => {
        calls.projectDeleted = calls.projectDeleted + 1;
      }}
    />,
  );

  return calls;
};

type OpenConfirmationFunction = () => void;

const openConfirmation: OpenConfirmationFunction = (): void => {
  fireEvent.click(
    screen.getByRole("button", { name: "Delete Project" }) as HTMLElement,
  );
};

type ConfirmFunction = () => Promise<void>;

/*
 * The confirm button kicks off the delete request, so the state updates it
 * causes land outside this tick - hence act rather than a bare click.
 */
const confirm: ConfirmFunction = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
};

type TypeReasonFunction = (reason: string) => void;

const typeReason: TypeReasonFunction = (reason: string): void => {
  fireEvent.change(screen.getByTestId("project-deletion-reason"), {
    target: { value: reason },
  });
};

describe("Settings > Danger Zone", () => {
  let postCalls: Array<{
    url: string;
    data: JSONObject;
    headers: Dictionary<string> | undefined;
  }> = [];

  beforeEach(() => {
    jest.restoreAllMocks();

    config.billingEnabled = true;
    postCalls = [];

    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      PROJECT_ID,
    );
    getJestSpyOn(ProjectUtil, "clearCurrentProject").mockImplementation(
      () => {},
    );
    getJestSpyOn(PermissionUtil, "clearProjectPermissions").mockImplementation(
      () => {},
    );

    /*
     * The delete button is gated on the viewer's permissions now, and without a
     * permission snapshot the card cannot tell "not allowed" from "not loaded
     * yet" and offers no button at all. Deleting a project is the owner's to
     * do, so that is who these tests are.
     */
    getJestSpyOn(PermissionUtil, "getAllPermissions").mockReturnValue([
      Permission.ProjectOwner,
    ]);

    getJestSpyOn(API, "post").mockImplementation((data: any) => {
      postCalls.push({
        url: data.url.toString(),
        data: data.data as JSONObject,
        headers: data.headers as Dictionary<string> | undefined,
      });

      return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
    });
  });

  /*
   * The server resolves which project's permissions this request carries from
   * the tenantid header. API.post does not add it (ModelAPI does), so without
   * it every delete from this page is refused - and the customer is told they
   * are not allowed to delete their own project.
   */
  it("sends the project the request is authenticated for", async () => {
    renderPage();
    openConfirmation();
    await confirm();

    await waitFor(() => {
      expect(postCalls).toHaveLength(1);
    });

    expect(postCalls[0]?.headers?.["tenantid"]).toBe(PROJECT_ID.toString());
  });

  it("warns that the deletion cannot be undone", () => {
    renderPage();

    expect(screen.getByText(/no way to recover/i)).toBeInTheDocument();
  });

  it("does not ask anything until the customer confirms they want to delete", () => {
    renderPage();

    expect(screen.queryByTestId("project-deletion-reason")).toBeNull();
  });

  it("asks why the customer is deleting the project", () => {
    renderPage();
    openConfirmation();

    expect(
      screen.getByText("Why are you deleting this project?"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("project-deletion-reason")).toBeInTheDocument();
  });

  it("sends the reason with the delete", async () => {
    renderPage();
    openConfirmation();
    typeReason("Too expensive for our team");
    await confirm();

    await waitFor(() => {
      expect(postCalls).toHaveLength(1);
    });

    expect(postCalls[0]?.url).toContain(
      `/project/${PROJECT_ID.toString()}/delete-project`,
    );
    expect(postCalls[0]?.data).toEqual({
      data: { deletionReason: "Too expensive for our team" },
    });
  });

  /*
   * Answering is optional. A customer who does not want to say why must still
   * be able to delete their project.
   */
  it("still deletes the project when no reason is given", async () => {
    const calls: PageCalls = renderPage();

    openConfirmation();
    await confirm();

    await waitFor(() => {
      expect(postCalls).toHaveLength(1);
    });

    expect(postCalls[0]?.data).toEqual({ data: { deletionReason: "" } });
    expect(calls.projectDeleted).toBe(1);
  });

  it("clears the deleted project out of the session on success", async () => {
    const calls: PageCalls = renderPage();

    openConfirmation();
    typeReason("Consolidating projects");
    await confirm();

    await waitFor(() => {
      expect(calls.projectDeleted).toBe(1);
    });

    expect(ProjectUtil.clearCurrentProject).toHaveBeenCalled();
    expect(PermissionUtil.clearProjectPermissions).toHaveBeenCalled();
  });

  /*
   * The success handler navigates away from the project. Running it after a
   * failed delete would leave the customer looking at a project they still
   * have and cannot get back to.
   */
  it("does not clear the session when the delete is refused", async () => {
    getJestSpyOn(API, "post").mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Delete not allowed" }, {}),
    );

    const calls: PageCalls = renderPage();

    openConfirmation();
    await confirm();

    await waitFor(() => {
      expect(screen.getByText("Delete Error")).toBeInTheDocument();
    });

    expect(calls.projectDeleted).toBe(0);
    expect(ProjectUtil.clearCurrentProject).not.toHaveBeenCalled();
  });

  /*
   * Self-hosted installs have nobody to follow up with and nowhere to record
   * an answer, so the question is not asked at all there.
   */
  describe("on a self-hosted install", () => {
    beforeEach(() => {
      config.billingEnabled = false;
    });

    it("does not ask why the project is being deleted", () => {
      renderPage();
      openConfirmation();

      expect(screen.queryByTestId("project-deletion-reason")).toBeNull();
      expect(
        screen.queryByText("Why are you deleting this project?"),
      ).toBeNull();
    });

    it("still deletes the project", async () => {
      const calls: PageCalls = renderPage();

      openConfirmation();
      await confirm();

      await waitFor(() => {
        expect(calls.projectDeleted).toBe(1);
      });

      expect(postCalls[0]?.url).toContain(
        `/project/${PROJECT_ID.toString()}/delete-project`,
      );
    });
  });
});
