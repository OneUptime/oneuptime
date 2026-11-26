import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useDeclareIncidentDefaults, {
  DeclareIncidentDefaults,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/useDeclareIncidentDefaults";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * What Declare Incident reads about the selected project as it opens
 * (useDeclareIncidentDefaults): its two declare defaults, in one read.
 *
 *   - one read of the project, for exactly those two columns;
 *   - loading until it answers, so the form latches nothing early;
 *   - each default as the project holds it;
 *   - a project that cannot be read, or none selected, keeps what every
 *     project starts with: the notify box ticked, and incidents declared by
 *     hand starting where they always did.
 */

const PROJECT_ID: string = "c1113700-0000-4000-8000-0000000000d1";

let getItemSpy: ReturnType<typeof jest.spyOn>;

function projectWith(values: Record<string, unknown>): Project {
  return Object.assign(new Project(), { _id: PROJECT_ID, ...values });
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(projectWith({}) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settled(): Promise<DeclareIncidentDefaults> {
  const { result } = renderHook(() => {
    return useDeclareIncidentDefaults();
  });

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });

  return result.current;
}

describe("useDeclareIncidentDefaults", () => {
  test("reads the selected project once, for its two declare defaults", async () => {
    await settled();

    expect(getItemSpy).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemSpy.mock.calls[0]![0] as never;

    expect(request.modelType).toBe(Project);
    expect(request.id.toString()).toBe(PROJECT_ID);
    expect(request.select).toEqual({
      _id: true,
      notifyStatusPageSubscribersOfNewIncidentsByDefault: true,
      startIncidentsDeclaredByHandAcknowledged: true,
    });
  });

  test("is loading until the project answers, with what every project starts with", () => {
    getItemSpy.mockReturnValue(new Promise<never>(() => {}) as never);

    const { result } = renderHook(() => {
      return useDeclareIncidentDefaults();
    });

    expect(result.current).toEqual({
      isLoading: true,
      isNotifyTickedByDefault: true,
      isDeclaredByHandAcknowledged: false,
    });
  });

  test("a project that never changed either: the box ticked, incidents starting where they always did", async () => {
    expect(await settled()).toEqual({
      isLoading: false,
      isNotifyTickedByDefault: true,
      isDeclaredByHandAcknowledged: false,
    });
  });

  test("each default as the project holds it", async () => {
    getItemSpy.mockResolvedValue(
      projectWith({
        notifyStatusPageSubscribersOfNewIncidentsByDefault: false,
        startIncidentsDeclaredByHandAcknowledged: true,
      }) as never,
    );

    expect(await settled()).toEqual({
      isLoading: false,
      isNotifyTickedByDefault: false,
      isDeclaredByHandAcknowledged: true,
    });
  });

  test("a project that cannot be read keeps what every project starts with", async () => {
    getItemSpy.mockRejectedValue(new Error("timeout") as never);

    expect(await settled()).toEqual({
      isLoading: false,
      isNotifyTickedByDefault: true,
      isDeclaredByHandAcknowledged: false,
    });
  });

  test("with no project selected, nothing is read, and the same", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    expect(await settled()).toEqual({
      isLoading: false,
      isNotifyTickedByDefault: true,
      isDeclaredByHandAcknowledged: false,
    });
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});
