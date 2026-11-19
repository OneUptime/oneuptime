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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * VOICEMAIL ON ON-CALL CALLS (#6594), in Project Settings > Notification
 * Channels' More settings: one switch, saved the moment it is flipped.
 *
 * On for every project - a project that never set it reads on, as the
 * server does (Project.detectVoicemailOnCalls defaults to true) - so a call
 * that voicemail answers counts as not answered. Its line says what on does
 * and what it costs; off, that a call voicemail answers counts as answered.
 * Only a Project Owner or Project Admin may flip it; anybody else sees it
 * locked, with why. The real card and switch are drawn; only the network
 * and the permission snapshot are stood in for.
 */

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
    },
  };
});

import VoicemailDetectionCard from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VoicemailDetectionCard";
import {
  getVoicemailDetectionFoldedItem,
  VOICEMAIL_DETECTION_COLUMN,
  VOICEMAIL_DETECTION_COPY,
  VOICEMAIL_DETECTION_PLACE,
  VOICEMAIL_DETECTION_TEST_ID,
  VOICEMAIL_DETECTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VoicemailDetectionWords";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FOLDED_SECTION_OFF } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "9a9a9a9a-0000-4000-8000-0000000006a4";

let stored: Record<string, unknown> = {};

interface ItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

function permit(permissions: Array<Permission>): void {
  getJestSpyOn(PermissionUtil, "getAllPermissions").mockReturnValue(
    permissions,
  );
}

const changes: Array<boolean> = [];

async function renderCard(): Promise<HTMLElement> {
  render(
    <VoicemailDetectionCard
      projectId={new ObjectID(PROJECT_ID)}
      onChange={(isOn: boolean) => {
        changes.push(isOn);
      }}
    />,
  );
  await flush();

  return screen.getByTestId(VOICEMAIL_DETECTION_TEST_ID);
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
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      Object.assign(stored, (options as UpdateCall).data);
      return {};
    },
  );

  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  permit([Permission.ProjectOwner]);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );
  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the voicemail card", () => {
  test("is one switch under the card's title and line, with no Edit button", async () => {
    const control: HTMLElement = await renderCard();

    expect(screen.getByText(VOICEMAIL_DETECTION_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(VOICEMAIL_DETECTION_COPY.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: VOICEMAIL_DETECTION_COPY.switchTitle,
      }),
    ).toBe(control);
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  test("reads the project's own column: a project that never set it is on, and says what on does and costs", async () => {
    const control: HTMLElement = await renderCard();

    const call: ItemCall = getItemMock.mock.calls[0]![0] as ItemCall;

    expect(call.modelType).toBe(Project);
    expect(call.id.toString()).toBe(PROJECT_ID);
    expect(call.select).toEqual({ [VOICEMAIL_DETECTION_COLUMN]: true });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(VOICEMAIL_DETECTION_COPY.switchOnDescription),
    ).toBeInTheDocument();
    expect(changes).toEqual([true]);
  });

  test("switching it off saves at once, with no question, and says what off means", async () => {
    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const update: UpdateCall = updateByIdMock.mock.calls[0]![0] as UpdateCall;

    expect(update.modelType).toBe(Project);
    expect(update.id.toString()).toBe(PROJECT_ID);
    expect(update.data).toEqual({ detectVoicemailOnCalls: false });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(VOICEMAIL_DETECTION_COPY.switchOffDescription),
    ).toBeInTheDocument();
    expect(changes).toEqual([true, false]);
  });

  test("a project that switched it off reads off, and switching it on saves at once", async () => {
    stored = { detectVoicemailOnCalls: false };

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-checked", "false");

    fireEvent.click(control);
    await flush();

    expect((updateByIdMock.mock.calls[0]![0] as UpdateCall).data).toEqual({
      detectVoicemailOnCalls: true,
    });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s may flip it",
    async (permission: Permission) => {
      permit([permission]);

      const control: HTMLElement = await renderCard();

      expect(control).not.toHaveAttribute("aria-disabled", "true");
    },
  );

  test("is locked, with the reason, for a member the column does not let change it", async () => {
    permit([Permission.ProjectMember]);

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-disabled", "true");

    const reason: string = (control.getAttribute("aria-describedby") || "")
      .split(" ")
      .map((id: string): string => {
        return document.getElementById(id)?.textContent || "";
      })
      .join(" ");

    expect(reason).toContain("You do not have permission to update this");

    fireEvent.click(control);
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("the words", () => {
  test("the card's place on the page is its title's", () => {
    expect(VOICEMAIL_DETECTION_TITLE).toBe("Voicemail on On-Call Calls");
    expect(VOICEMAIL_DETECTION_PLACE).toBe("voicemail-on-on-call-calls");
  });

  test("the switch's lines are one sentence or two, short enough to sit under it, and the card's line under its title", () => {
    expect(
      VOICEMAIL_DETECTION_COPY.switchOnDescription.length,
    ).toBeLessThanOrEqual(150);
    expect(
      VOICEMAIL_DETECTION_COPY.switchOffDescription.length,
    ).toBeLessThanOrEqual(150);
    expect(VOICEMAIL_DETECTION_COPY.cardDescription.length).toBeLessThanOrEqual(
      210,
    );
    // On says what it costs, on whose account it is charged: Twilio's.
    expect(VOICEMAIL_DETECTION_COPY.switchOnDescription).toContain(
      "Twilio charges",
    );
  });

  test("the model says the same of the column: on by default, set by a project's owners and admins", () => {
    const project: Project = new Project();
    const column: { defaultValue?: unknown; title?: string } | null =
      project.getTableColumnMetadata("detectVoicemailOnCalls") as unknown as {
        defaultValue?: unknown;
        title?: string;
      };

    expect(column?.defaultValue).toBe(true);
    expect(
      project.getColumnAccessControlFor("detectVoicemailOnCalls")?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
  });
});

describe("what More settings' folded header says", () => {
  test("on - as every project starts - it is named, not set", () => {
    expect(getVoicemailDetectionFoldedItem(true)).toEqual({
      key: VOICEMAIL_DETECTION_PLACE,
      title: VOICEMAIL_DETECTION_TITLE,
      isSet: false,
    });
  });

  test("off, it is set, and says Off", () => {
    expect(getVoicemailDetectionFoldedItem(false)).toEqual({
      key: VOICEMAIL_DETECTION_PLACE,
      title: VOICEMAIL_DETECTION_TITLE,
      isSet: true,
      value: FOLDED_SECTION_OFF,
      translateValue: true,
    });
  });
});
