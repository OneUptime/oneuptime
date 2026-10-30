import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import useAiCardFold, {
  AiCardFoldWiring,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/useAiCardFold";
import useAiLaneSwitchStates, {
  AiLaneSwitchRead,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/useAiLaneSwitchStates";
import {
  AiLaneSwitchStates,
  AiOffSubjectType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The two hooks behind the AI card's one line:
 *
 *   - useAiCardFold, what the card's Remediation step said fixing did,
 *     kept for the card for one record and never for the next one (the card
 *     hands the step how it is drawn itself: the step is drawn inside it);
 *   - useAiLaneSwitchStates, the record's two switches as they are now, read
 *     once per project and kind of record, and only while the card may fold;
 *     the card folds once they are read, so the line is drawn in its final
 *     words.
 */

const PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 6; index++) {
      await Promise.resolve();
    }
  });
}

let wiring: AiCardFoldWiring | null = null;

function FoldHarness(props: { recordKey: string }): React.ReactElement {
  wiring = useAiCardFold(props.recordKey);
  return <div />;
}

let switches: AiLaneSwitchStates = {};
let isRead: boolean = false;

function SwitchesHarness(props: {
  subjectType: AiOffSubjectType;
  isEnabled: boolean;
}): React.ReactElement {
  const read: AiLaneSwitchRead = useAiLaneSwitchStates({
    subjectType: props.subjectType,
    isEnabled: props.isEnabled,
  });
  switches = read.states;
  isRead = read.isRead;
  return <div />;
}

beforeEach(() => {
  wiring = null;
  switches = {};
  isRead = false;
  getItemMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("useAiCardFold, what the card's Remediation step said", () => {
  test("starts from 'still reading'", () => {
    render(<FoldHarness recordKey="incident-1" />);

    expect(wiring!.remediationState).toEqual({ kind: "loading" });
  });

  test("hands the card what the step said", () => {
    render(<FoldHarness recordKey="incident-1" />);

    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "fixing_off" });
    });
    expect(wiring!.remediationState).toEqual({
      kind: "off",
      reason: "fixing_off",
    });
  });

  test("the same answer twice keeps what it holds, so the card has nothing new to draw", () => {
    render(<FoldHarness recordKey="incident-1" />);

    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "fixing_off" });
    });
    const kept: AiCardFoldWiring = wiring!;

    // A new object that says the same thing: the one held stays.
    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "fixing_off" });
    });

    expect(wiring!.remediationState).toBe(kept.remediationState);

    // Something different is taken.
    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "ai_off" });
    });

    expect(wiring!.remediationState).not.toBe(kept.remediationState);
    expect(wiring!.remediationState).toEqual({ kind: "off", reason: "ai_off" });
  });

  test("what was said for one record is never read for the next", () => {
    const view: ReturnType<typeof render> = render(
      <FoldHarness recordKey="incident-1" />,
    );

    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "fixing_off" });
    });

    view.rerender(<FoldHarness recordKey="incident-2" />);

    expect(wiring!.remediationState).toEqual({ kind: "loading" });

    act(() => {
      wiring!.onRemediationStateChange({ kind: "on" });
    });

    expect(wiring!.remediationState).toEqual({ kind: "on" });

    // Back on the first record, what was said for it is not read either.
    view.rerender(<FoldHarness recordKey="incident-1" />);

    expect(wiring!.remediationState).toEqual({ kind: "loading" });
  });

  test("its callbacks are the same between draws of one record", () => {
    const view: ReturnType<typeof render> = render(
      <FoldHarness recordKey="incident-1" />,
    );
    const first: AiCardFoldWiring = wiring!;

    view.rerender(<FoldHarness recordKey="incident-1" />);

    expect(wiring!.onRemediationStateChange).toBe(
      first.onRemediationStateChange,
    );
  });
});

describe("useAiLaneSwitchStates, the record's switches as they are now", () => {
  test("reads nothing while the card cannot fold", async () => {
    render(<SwitchesHarness subjectType="incident" isEnabled={false} />);
    await settle();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(switches).toEqual({});
    expect(isRead).toBe(false);
  });

  test("is not read until the answer is in: the card waits rather than redraw the line", async () => {
    let answer: (project: Project) => void = (): void => {};
    getItemMock.mockImplementationOnce((): Promise<Project> => {
      return new Promise<Project>((resolve: (project: Project) => void) => {
        answer = resolve;
      });
    });

    render(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(isRead).toBe(false);
    expect(switches).toEqual({});

    answer(
      Object.assign(new Project(), {
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticIncidentRemediation: false,
      }),
    );
    await settle();

    expect(isRead).toBe(true);
    expect(switches).toEqual({ investigate: true, fix: false });
  });

  test.each<[AiOffSubjectType, Record<string, boolean>]>([
    [
      "incident",
      {
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticIncidentRemediation: true,
      },
    ],
    [
      "alert",
      {
        enableAutomaticAlertInvestigation: true,
        enableAutomaticAlertRemediation: true,
      },
    ],
  ])(
    "an %s's two switches, from the project the dashboard has selected",
    async (subjectType: AiOffSubjectType, select: Record<string, boolean>) => {
      getItemMock.mockResolvedValue(
        Object.assign(new Project(), {
          enableAutomaticIncidentInvestigation: subjectType === "incident",
          enableAutomaticIncidentRemediation: false,
          enableAutomaticAlertInvestigation: subjectType === "alert",
          enableAutomaticAlertRemediation: false,
        }),
      );

      render(<SwitchesHarness subjectType={subjectType} isEnabled={true} />);
      await settle();

      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect(getItemMock.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ modelType: Project, select }),
      );
      expect(
        (getItemMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
      ).toBe(PROJECT_ID);
      expect(switches).toEqual({ investigate: true, fix: false });
      expect(isRead).toBe(true);
    },
  );

  test("once: folding again, or drawing again, reads nothing more", async () => {
    getItemMock.mockResolvedValue(
      Object.assign(new Project(), {
        enableAutomaticIncidentInvestigation: false,
        enableAutomaticIncidentRemediation: false,
      }),
    );

    const view: ReturnType<typeof render> = render(
      <SwitchesHarness subjectType="incident" isEnabled={true} />,
    );
    await settle();

    view.rerender(<SwitchesHarness subjectType="incident" isEnabled={false} />);
    view.rerender(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(switches).toEqual({ investigate: false, fix: false });
    expect(isRead).toBe(true);
  });

  test("a value it cannot read stays unknown", async () => {
    getItemMock.mockResolvedValue(new Project());

    render(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(switches).toEqual({ investigate: undefined, fix: undefined });
    expect(isRead).toBe(true);
  });

  test("a read refused stays unknown, and says nothing", async () => {
    getItemMock.mockRejectedValue(new Error("You do not have permission"));

    render(<SwitchesHarness subjectType="alert" isEnabled={true} />);
    await settle();

    expect(switches).toEqual({});
    // Refused is answered: the line is drawn without them.
    expect(isRead).toBe(true);
  });

  test("a read cut short by the card unfolding is read again when it folds again", async () => {
    let answer: (project: Project) => void = (): void => {};
    getItemMock.mockImplementationOnce((): Promise<Project> => {
      return new Promise<Project>((resolve: (project: Project) => void) => {
        answer = resolve;
      });
    });
    getItemMock.mockResolvedValue(
      Object.assign(new Project(), {
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticIncidentRemediation: true,
      }),
    );

    const view: ReturnType<typeof render> = render(
      <SwitchesHarness subjectType="incident" isEnabled={true} />,
    );
    await settle();

    view.rerender(<SwitchesHarness subjectType="incident" isEnabled={false} />);
    // The first answer lands after the card unfolded: not taken.
    answer(
      Object.assign(new Project(), {
        enableAutomaticIncidentInvestigation: false,
        enableAutomaticIncidentRemediation: false,
      }),
    );
    await settle();

    expect(switches).toEqual({});
    expect(isRead).toBe(false);

    view.rerender(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(switches).toEqual({ investigate: true, fix: true });
    expect(isRead).toBe(true);
  });

  test("without a selected project there is nothing to read", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    render(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(switches).toEqual({});
    // Nothing to wait for: the line is drawn at once.
    expect(isRead).toBe(true);
  });
});
