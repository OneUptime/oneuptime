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
import useAiLaneSwitchStates from "../../../../App/FeatureSet/Dashboard/src/Components/AI/useAiLaneSwitchStates";
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
 *   - useAiCardFold, the page's go-between: the Remediation card says what
 *     fixing did, the AI card says how it is drawn, each for one record and
 *     never for the next one;
 *   - useAiLaneSwitchStates, the record's two switches as they are now, read
 *     once per project and kind of record, and only while the card is folded.
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

function SwitchesHarness(props: {
  subjectType: AiOffSubjectType;
  isEnabled: boolean;
}): React.ReactElement {
  switches = useAiLaneSwitchStates({
    subjectType: props.subjectType,
    isEnabled: props.isEnabled,
  });
  return <div />;
}

beforeEach(() => {
  wiring = null;
  switches = {};
  getItemMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("useAiCardFold, between a page's AI card and its Remediation card", () => {
  test("starts from 'still reading' and 'checking'", () => {
    render(<FoldHarness recordKey="incident-1" />);

    expect(wiring!.remediationState).toEqual({ kind: "loading" });
    expect(wiring!.fold).toBe("checking");
  });

  test("hands each card what the other said", () => {
    render(<FoldHarness recordKey="incident-1" />);

    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "fixing_off" });
    });
    expect(wiring!.remediationState).toEqual({
      kind: "off",
      reason: "fixing_off",
    });

    act(() => {
      wiring!.onFoldChange("folded");
    });
    expect(wiring!.fold).toBe("folded");
  });

  test("the same answer twice keeps what it holds, so neither card has anything new to draw", () => {
    render(<FoldHarness recordKey="incident-1" />);

    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "fixing_off" });
      wiring!.onFoldChange("folded");
    });
    const kept: AiCardFoldWiring = wiring!;

    // A new object that says the same thing: the one held stays.
    act(() => {
      wiring!.onRemediationStateChange({ kind: "off", reason: "fixing_off" });
      wiring!.onFoldChange("folded");
    });

    expect(wiring!.remediationState).toBe(kept.remediationState);
    expect(wiring!.fold).toBe("folded");

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
      wiring!.onFoldChange("folded");
    });

    view.rerender(<FoldHarness recordKey="incident-2" />);

    expect(wiring!.remediationState).toEqual({ kind: "loading" });
    expect(wiring!.fold).toBe("checking");

    act(() => {
      wiring!.onRemediationStateChange({ kind: "on" });
    });

    expect(wiring!.remediationState).toEqual({ kind: "on" });
    expect(wiring!.fold).toBe("checking");
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
    expect(wiring!.onFoldChange).toBe(first.onFoldChange);
  });
});

describe("useAiLaneSwitchStates, the record's switches as they are now", () => {
  test("reads nothing while the card is not folded", async () => {
    render(<SwitchesHarness subjectType="incident" isEnabled={false} />);
    await settle();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(switches).toEqual({});
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
  });

  test("a value it cannot read stays unknown", async () => {
    getItemMock.mockResolvedValue(new Project());

    render(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(switches).toEqual({ investigate: undefined, fix: undefined });
  });

  test("a read refused stays unknown, and says nothing", async () => {
    getItemMock.mockRejectedValue(new Error("You do not have permission"));

    render(<SwitchesHarness subjectType="alert" isEnabled={true} />);
    await settle();

    expect(switches).toEqual({});
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

    view.rerender(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(switches).toEqual({ investigate: true, fix: true });
  });

  test("without a selected project there is nothing to read", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    render(<SwitchesHarness subjectType="incident" isEnabled={true} />);
    await settle();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(switches).toEqual({});
  });
});
