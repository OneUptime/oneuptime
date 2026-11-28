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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE VOICE A PROJECT'S CALLS SPEAK WITH THROUGH THE SERVER'S TWILIO
 * ACCOUNT (#11065), in Project Settings > Notification Channels' More
 * settings - drawn only while the server lets projects choose one.
 *
 * The card says the voice chosen, or that the calls speak with the
 * server's voice; Choose Voice opens the picker a Twilio config's voice is
 * chosen with, and under it, the first lines a page's call says in the
 * voice with the project's name, what it costs - or, with none chosen, that
 * the server's voice is used. Only a Project Owner or Project Admin may
 * choose: anybody else sees the button locked, with why. The real card,
 * detail and form are drawn; only the network and the permission snapshot
 * are stood in for.
 */

jest.setTimeout(60000);

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import ProjectCallVoiceCard from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectCallVoiceCard";
import {
  PROJECT_CALL_VOICE_COPY,
  PROJECT_CALL_VOICE_PLACE,
  PROJECT_CALL_VOICE_TEST_ID,
  PROJECT_CALL_VOICE_TITLE,
  getProjectCallVoiceFoldedItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectCallVoiceWords";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "11065000-0000-4000-8000-0000000000d1";
const PROJECT_NAME: string = "Northwind Payments";

let stored: Record<string, unknown> = {};

interface ItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 12; i++) {
      await Promise.resolve();
    }
  });
}

function permit(permissions: Array<Permission>): void {
  getJestSpyOn(PermissionUtil, "getAllPermissions").mockReturnValue(
    permissions,
  );
  getJestSpyOn(PermissionGate, "hasPermissionSnapshot").mockReturnValue(true);
}

const changes: Array<string | null> = [];

async function renderCard(): Promise<HTMLElement> {
  render(
    <ProjectCallVoiceCard
      projectId={new ObjectID(PROJECT_ID)}
      onChange={(voice: string | null) => {
        changes.push(voice);
      }}
    />,
  );
  await flush();

  await waitFor(() => {
    expect(
      screen.getByTestId(`${PROJECT_CALL_VOICE_TEST_ID}-summary`),
    ).toBeVisible();
  });

  return screen.getByTestId(PROJECT_CALL_VOICE_TEST_ID);
}

async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(
    screen.getByRole("button", { name: PROJECT_CALL_VOICE_COPY.button }),
  );
  await flush();

  let dialog: HTMLElement | null = null;

  await waitFor(() => {
    dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
  });

  return dialog as unknown as HTMLElement;
}

beforeEach(() => {
  stored = {};
  changes.length = 0;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    Object.assign(project, stored);
    return project;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return { data: {} };
  });

  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  permit([Permission.ProjectOwner]);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );
  getJestSpyOn(ProjectUtil, "getCurrentProject").mockImplementation(
    (): Project => {
      const project: Project = new Project();
      project._id = PROJECT_ID;
      project.name = PROJECT_NAME;
      return project;
    },
  );
  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the card", () => {
  test("says what it is for, and that a Twilio config of the project's own has its own voice", async () => {
    const card: HTMLElement = await renderCard();

    expect(within(card).getByText(PROJECT_CALL_VOICE_TITLE)).toBeVisible();
    expect(
      within(card).getByText(PROJECT_CALL_VOICE_COPY.cardDescription),
    ).toBeVisible();
    // Its place on the page, so a link to it opens More settings at it.
    expect(card.querySelector(`#${PROJECT_CALL_VOICE_PLACE}`)).not.toBeNull();
  });

  test("reads the project's own column, and with none chosen says the server's voice is used", async () => {
    await renderCard();

    const call: ItemCall = getItemMock.mock.calls[0]![0] as ItemCall;

    expect(call.modelType).toBe(Project);
    expect(call.id.toString()).toBe(PROJECT_ID);
    expect(call.select).toEqual(expect.objectContaining({ callVoice: true }));
    expect(
      screen.getByTestId(`${PROJECT_CALL_VOICE_TEST_ID}-summary`),
    ).toHaveTextContent(PROJECT_CALL_VOICE_COPY.serverVoice);
    expect(changes).toEqual([null]);
  });

  test("a voice chosen: by its name, who makes it and how it sounds", async () => {
    stored = { callVoice: "Polly.Matthew-Neural" };

    await renderCard();

    const summary: HTMLElement = screen.getByTestId(
      `${PROJECT_CALL_VOICE_TEST_ID}-summary`,
    );

    expect(summary).toHaveTextContent("Matthew");
    expect(summary).toHaveTextContent("Amazon Polly");
    expect(summary).toHaveTextContent("US English, male voice");
    expect(changes).toEqual(["Polly.Matthew-Neural"]);
  });

  test("a stored voice the list no longer holds reads as the server's voice, as a call takes it", async () => {
    stored = { callVoice: "Polly.Kevin-Neural" };

    await renderCard();

    expect(
      screen.getByTestId(`${PROJECT_CALL_VOICE_TEST_ID}-summary`),
    ).toHaveTextContent(PROJECT_CALL_VOICE_COPY.serverVoice);
    expect(changes).toEqual([null]);
  });
});

describe("who may choose", () => {
  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "a %s: Choose Voice",
    async (permission: Permission) => {
      permit([permission]);

      await renderCard();

      expect(
        screen.getByRole("button", { name: PROJECT_CALL_VOICE_COPY.button }),
      ).toBeEnabled();
    },
  );

  test("anybody else sees the button locked, as the server would refuse the save", async () => {
    permit([Permission.ProjectMember]);

    await renderCard();

    expect(
      screen.getByRole("button", { name: PROJECT_CALL_VOICE_COPY.button }),
    ).toBeDisabled();
  });
});

describe("the picker", () => {
  test("with none chosen: the server's voice, and no sample of a voice nobody chose", async () => {
    permit([Permission.ProjectOwner]);

    await renderCard();

    const dialog: HTMLElement = await openPicker();

    expect(
      await within(dialog).findByTestId(
        `${PROJECT_CALL_VOICE_TEST_ID}-server-voice`,
      ),
    ).toHaveTextContent(PROJECT_CALL_VOICE_COPY.serverVoiceSentence);
    expect(within(dialog).queryByTestId("call-voice-sample")).toBeNull();
  });

  test("with a voice chosen: what a page's call says in it, with the project's name, what it costs and how to hear it", async () => {
    stored = { callVoice: "Polly.Brian-Neural" };

    await renderCard();

    const dialog: HTMLElement = await openPicker();
    const sample: HTMLElement = await within(dialog).findByTestId(
      "call-voice-sample",
    );

    expect(
      within(sample).getByTestId("call-voice-sample-sentence"),
    ).toHaveTextContent(`This is a call from ${PROJECT_NAME}.`);
    expect(within(sample).getByTestId("call-voice-sample-voice")).toHaveTextContent(
      "Brian",
    );
    expect(within(sample).getByTestId("call-voice-sample-cost")).toHaveTextContent(
      "under 3 US cents for each page's call, in any language",
    );
    expect(
      within(sample).getByTestId("call-voice-sample-hear-it"),
    ).toHaveTextContent("Save, then send a test call to hear it.");
    expect(
      within(dialog).queryByTestId(`${PROJECT_CALL_VOICE_TEST_ID}-server-voice`),
    ).toBeNull();
  });
});

describe("as More settings' folded header names it", () => {
  test("unset while the project speaks with the server's voice", () => {
    for (const value of [null, undefined, "", "man", "Polly.Kevin-Neural"]) {
      const item: FoldedSectionItem = getProjectCallVoiceFoldedItem(value);

      expect(item.title).toBe(PROJECT_CALL_VOICE_TITLE);
      expect(item.key).toBe(PROJECT_CALL_VOICE_PLACE);
      expect(item.isSet).toBe(false);
      expect(item.value).toBeUndefined();
    }
  });

  test("set, by the voice's own name - drawn as written - once one is chosen", () => {
    const item: FoldedSectionItem = getProjectCallVoiceFoldedItem(
      "Google.en-US-Neural2-J",
    );

    expect(item.isSet).toBe(true);
    expect(item.value).toBe("Neural2-J");
    expect(item.translateValue).toBeUndefined();
  });
});
