import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, renderHook } from "@testing-library/react";
import useAiOffered, {
  useAiSwitchState,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/UseAiOffered";
import { ENABLE_AI_COLUMN } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/EnableAiColumn";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Whether a Dashboard page may draw an AI action, read off the selected
 * project's Enable AI (the project list selects it) and following every
 * save of the switch - so turning AI off in Project Settings takes "Draft
 * with AI", "Generate with AI", "Explain with AI" and the rest off every
 * open page at once, and turning it back on brings them back.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "20000000-0000-4000-8000-000000000002";

function selectProject(enableAi: boolean | undefined): void {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(
    enableAi === undefined
      ? null
      : (Object.assign(new Project(), {
          _id: PROJECT_ID,
          enableAi,
        }) as Project),
  );
}

function announce(projectId: string, value: boolean, column?: string): void {
  act(() => {
    announceModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(projectId),
      column: column || ENABLE_AI_COLUMN,
      value,
    });
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("useAiOffered", () => {
  test("AI on for the selected project: offered", () => {
    selectProject(true);

    expect(renderHook(useAiOffered).result.current).toBe(true);
  });

  test("AI switched off for the selected project: not offered", () => {
    selectProject(false);

    expect(renderHook(useAiOffered).result.current).toBe(false);
  });

  test("a project not loaded, or loaded without the switch, reads as AI on", () => {
    selectProject(undefined);
    expect(renderHook(useAiOffered).result.current).toBe(true);
    cleanup();

    jest.restoreAllMocks();
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(new Project());
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    expect(renderHook(useAiOffered).result.current).toBe(true);
  });

  test("follows Enable AI as it is saved, off and back on, without a reload", () => {
    selectProject(true);
    const { result } = renderHook(useAiOffered);

    announce(PROJECT_ID, false);
    expect(result.current).toBe(false);

    announce(PROJECT_ID, true);
    expect(result.current).toBe(true);
  });

  test("ignores another project's switch and another column of this one", () => {
    selectProject(true);
    const { result } = renderHook(useAiOffered);

    announce(OTHER_PROJECT_ID, false);
    expect(result.current).toBe(true);

    announce(PROJECT_ID, false, "isFeatureFlagMonitorGroupsEnabled");
    expect(result.current).toBe(true);
  });

  test("stops listening once the page is gone", () => {
    selectProject(true);
    const { result, unmount } = renderHook(useAiOffered);

    unmount();
    announce(PROJECT_ID, false);

    expect(result.current).toBe(true);
  });
});

/*
 * The switch itself, for a sentence about it: the Remediation step says
 * "Enable AI was off when OneUptime AI checked this incident. It is on
 * now." only of a switch it read as on - never of one it could not read,
 * which useAiOffered reads as on.
 */
describe("useAiSwitchState", () => {
  test("reads the selected project's Enable AI, on or off", () => {
    selectProject(true);
    expect(renderHook(useAiSwitchState).result.current).toBe(true);
    cleanup();

    jest.restoreAllMocks();
    selectProject(false);
    expect(renderHook(useAiSwitchState).result.current).toBe(false);
  });

  test("a project not loaded, or loaded without the switch, is not known: never on", () => {
    selectProject(undefined);
    expect(renderHook(useAiSwitchState).result.current).toBeUndefined();
    cleanup();

    jest.restoreAllMocks();
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(new Project());
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    expect(renderHook(useAiSwitchState).result.current).toBeUndefined();
    cleanup();

    jest.restoreAllMocks();
    jest.spyOn(ProjectUtil, "getCurrentProject").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    expect(renderHook(useAiSwitchState).result.current).toBeUndefined();
  });

  test("a save makes it known: off, then on, without a reload", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(new Project());
    const { result } = renderHook(useAiSwitchState);
    expect(result.current).toBeUndefined();

    announce(PROJECT_ID, false);
    expect(result.current).toBe(false);

    announce(PROJECT_ID, true);
    expect(result.current).toBe(true);
  });

  test("ignores another project's switch and another column of this one", () => {
    selectProject(false);
    const { result } = renderHook(useAiSwitchState);

    announce(OTHER_PROJECT_ID, true);
    announce(PROJECT_ID, true, "isFeatureFlagMonitorGroupsEnabled");

    expect(result.current).toBe(false);
  });
});
