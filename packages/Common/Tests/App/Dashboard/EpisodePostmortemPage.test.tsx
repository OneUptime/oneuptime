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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident episode's Postmortem page draws on the same postmortem
 * templates as an incident's, and had the same dead end: Apply Template, in
 * a project with none, opened a dialog pointing at "Project Settings >
 * Incident > Postmortem Templates". It is offered only when there is a
 * template now. The episode's postmortem is its note alone, so its draft
 * editor saves the note and nothing else.
 */

const EPISODE_ID: string = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): {
        permissions: Array<Record<string, unknown>>;
      } => {
        return {
          permissions: permissionsForTest.map(
            (permission: string): Record<string, unknown> => {
              return {
                permission,
                labelIds: [],
                _type: "UserPermission",
              };
            },
          ),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
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

jest.mock("../../../UI/Components/AI/GenerateFromAIModal", () => {
  return {
    __esModule: true,
    default: (props: {
      onSuccess: (content: string) => void;
    }): ReactElement => {
      return (
        <div data-testid="ai-modal">
          <button
            type="button"
            onClick={() => {
              props.onSuccess("## The episode, as AI wrote it");
            }}
          >
            Use the AI draft
          </button>
        </div>
      );
    },
  };
});

import EpisodePostmortem from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Postmortem";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentPostmortemTemplate from "../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const WAIT: { timeout: number } = { timeout: 20000 };

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

let templates: Array<{ id: string; name: string; note: string }> = [];

beforeEach(() => {
  permissionsForTest = [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectOwner,
  ];
  templates = [];
  PermissionGate.clearPermissionPropsCache();

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return {
      data: templates.map(
        (template: {
          id: string;
          name: string;
          note: string;
        }): IncidentPostmortemTemplate => {
          const model: IncidentPostmortemTemplate =
            new IncidentPostmortemTemplate();
          model._id = template.id;
          model.templateName = template.name;
          model.postmortemNote = template.note;
          return model;
        },
      ),
      count: templates.length,
      skip: 0,
      limit: 100,
    };
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<IncidentEpisode> => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode._id = EPISODE_ID;
    episode.postmortemNote = "## Stored episode note";
    return episode;
  });

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockResolvedValue({ data: {} });

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(EPISODE_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<EpisodePostmortem {...PAGE_PROPS} />);
  });

  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  }, WAIT);
  await screen.findByRole("button", { name: "Edit Postmortem" }, WAIT);
  await act(async () => {
    await Promise.resolve();
  });
}

async function savedEpisode(): Promise<Record<string, unknown>> {
  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalled();
  }, WAIT);

  return (
    createOrUpdateMock.mock.calls[0]![0] as { model: IncidentEpisode }
  ).model as unknown as Record<string, unknown>;
}

describe("an episode's Postmortem page", () => {
  test("offers no Apply Template without a postmortem template, and no dialog about it", async () => {
    await renderPage();

    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply Template" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No Postmortem Templates")).toBeNull();
    expect(screen.queryByText(/Project Settings/)).toBeNull();
  });

  test("with a template, Apply Template opens the editor on it, and saving sends the note only", async () => {
    templates = [
      { id: "t-1", name: "Episode review", note: "## From the template" },
    ];

    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Apply Template" }, WAIT),
    );

    const picker: HTMLElement = await screen.findByTestId("modal", {}, WAIT);

    expect(within(picker).getByText("Episode review")).toBeInTheDocument();

    fireEvent.click(within(picker).getByTestId("modal-footer-submit-button"));

    const editor: HTMLElement = await waitFor(() => {
      const modal: HTMLElement = screen.getByTestId("modal");
      expect(within(modal).getByText("Edit Postmortem")).toBeInTheDocument();
      return modal;
    }, WAIT);

    fireEvent.click(within(editor).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedEpisode();

    expect(saved["_id"]).toBe(EPISODE_ID);
    expect(saved["postmortemNote"]).toBe("## From the template");
    // The note is the form's only field: no other column is sent.
    expect(
      Object.keys(
        IncidentEpisode.toJSONObject(
          saved as unknown as IncidentEpisode,
          IncidentEpisode,
        ),
      ).sort(),
    ).toEqual(["_id", "postmortemNote"]);
  });

  test("what AI wrote opens in the same editor", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    fireEvent.click(await screen.findByText("Use the AI draft", {}, WAIT));

    const editor: HTMLElement = await screen.findByTestId("modal", {}, WAIT);

    fireEvent.click(within(editor).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedEpisode();

    expect(saved["postmortemNote"]).toBe("## The episode, as AI wrote it");
  });

  test("its Edit dialog is named for what it edits", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Postmortem" }));

    const editor: HTMLElement = await screen.findByTestId("modal", {}, WAIT);

    expect(within(editor).getByTestId("modal-title")).toHaveTextContent(
      "Edit Postmortem",
    );
  });

  test("for someone who may not edit the episode, both buttons are locked", async () => {
    permissionsForTest = [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.Viewer,
    ];
    templates = [
      { id: "t-1", name: "Episode review", note: "## From the template" },
    ];

    await renderPage();

    expect(
      await screen.findByRole("button", { name: "Apply Template" }, WAIT),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeDisabled();
  });
});
