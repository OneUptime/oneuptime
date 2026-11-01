import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import {
  AiCardFold,
  RemediationFoldState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The Remediation step and the AI card it is the second step of, when
 * OneUptime AI did nothing with an incident or alert because it was off for
 * it. The step tells the card what fixing did (onFoldStateChange), and,
 * while the card is its one-line "AI investigation is off" summary - or is
 * still deciding whether it is - draws nothing: the line says "nothing was
 * fixed" too. A fix to show, or anything else it has to say, is never off,
 * so the card never folds over it.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const NEXT_INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000013",
);
const ALERT_ID: ObjectID = new ObjectID("0193c0de-3333-4aaa-8bbb-000000000004");

interface Served {
  suggestions: Array<AutoRemediationSuggestion>;
  decisions: Array<JSONObject>;
}

let getListSpy: ReturnType<typeof jest.spyOn>;

function serve(bySubject: (query: JSONObject) => Served): void {
  getListSpy.mockImplementation((async (data: {
    modelType: { new (): unknown };
    query: JSONObject;
  }): Promise<
    ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
  > => {
    const served: Served = bySubject(data.query);

    if (data.modelType === AutoRemediationDecision) {
      const rows: Array<AutoRemediationDecision> = served.decisions.map(
        (row: JSONObject) => {
          return Object.assign(new AutoRemediationDecision(), row);
        },
      );
      return { data: rows, count: rows.length, skip: 0, limit: 5 };
    }

    return {
      data: served.suggestions,
      count: served.suggestions.length,
      skip: 0,
      limit: 10,
    };
  }) as never);
}

function serveAll(served: Served): void {
  serve((): Served => {
    return served;
  });
}

function evaluated(entries: Array<JSONObject>): JSONObject {
  return {
    stage: "Evaluated",
    createdAt: new Date("2026-10-05T10:00:00Z"),
    entries,
  };
}

const FIXING_OFF: JSONObject = evaluated([
  { lane: "Project", reason: "RemediationOff" },
]);

const CLUSTER_FIX_STARTED: JSONObject = evaluated([
  {
    lane: "KubernetesCluster",
    reason: "ClusterRoundStarted",
    kubernetesClusterId: "0193c0de-5555-4aaa-8bbb-000000000005",
    kubernetesClusterName: "prod-eu-west-1",
  },
]);

function suggestion(): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000006",
    status: AutoRemediationSuggestionStatus.Suggested,
    ruleNameSnapshot: "Restart checkout",
    runbookNameSnapshot: "Restart the checkout pods",
    createdAt: new Date("2026-10-05T10:00:00Z"),
  });
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 8; index++) {
      await Promise.resolve();
    }
  });
}

function reported(
  onFoldStateChange: MockFunction,
): Array<RemediationFoldState> {
  return onFoldStateChange.mock.calls.map(
    (call: Array<unknown>): RemediationFoldState => {
      return call[0] as RemediationFoldState;
    },
  );
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  getListSpy = jest.spyOn(ModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the Remediation card tells the AI card", () => {
  test("still reading, then fixing was off - once each", async () => {
    serveAll({ suggestions: [], decisions: [FIXING_OFF] });
    const onFoldStateChange: MockFunction = getJestMockFunction();

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
        onFoldStateChange={
          onFoldStateChange as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    expect(reported(onFoldStateChange)).toEqual([
      { kind: "loading" },
      { kind: "off", reason: "fixing_off" },
    ]);
  });

  test("a fix to show is on", async () => {
    serveAll({ suggestions: [suggestion()], decisions: [FIXING_OFF] });
    const onFoldStateChange: MockFunction = getJestMockFunction();

    render(
      <RemediationStep
        investigationStage="reported"
        alertId={ALERT_ID}
        onFoldStateChange={
          onFoldStateChange as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    expect(reported(onFoldStateChange).pop()).toEqual({ kind: "on" });
  });

  test("a fix that started is on; nothing recorded is off, with nothing to show", async () => {
    serveAll({ suggestions: [], decisions: [CLUSTER_FIX_STARTED] });
    const started: MockFunction = getJestMockFunction();

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
        onFoldStateChange={
          started as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    expect(reported(started).pop()).toEqual({ kind: "on" });

    cleanup();
    serveAll({ suggestions: [], decisions: [] });
    const nothing: MockFunction = getJestMockFunction();

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
        onFoldStateChange={
          nothing as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    expect(reported(nothing).pop()).toEqual({
      kind: "off",
      reason: "not_recorded",
    });
  });

  test("moving to the next incident starts again, and tells what it read for that one", async () => {
    serve((query: JSONObject): Served => {
      return String(query["incidentId"]) === INCIDENT_ID.toString()
        ? { suggestions: [], decisions: [FIXING_OFF] }
        : { suggestions: [], decisions: [FIXING_OFF] };
    });
    const onFoldStateChange: MockFunction = getJestMockFunction();

    const view: ReturnType<typeof render> = render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
        onFoldStateChange={
          onFoldStateChange as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    expect(reported(onFoldStateChange)).toEqual([
      { kind: "loading" },
      { kind: "off", reason: "fixing_off" },
    ]);

    view.rerender(
      <RemediationStep
        investigationStage="reported"
        incidentId={NEXT_INCIDENT_ID}
        onFoldStateChange={
          onFoldStateChange as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    /*
     * The same answer for the next incident is told again: the page keeps
     * what it hears per incident. And never the first one's while the next
     * one's is on its way.
     */
    expect(reported(onFoldStateChange)).toEqual([
      { kind: "loading" },
      { kind: "off", reason: "fixing_off" },
      { kind: "loading" },
      { kind: "off", reason: "fixing_off" },
    ]);
  });

  test("an answer for an incident the page has moved on from is never taken", async () => {
    let releaseFirst: () => void = (): void => {};
    const firstAnswered: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseFirst = resolve;
      },
    );

    getListSpy.mockImplementation((async (data: {
      modelType: { new (): unknown };
      query: JSONObject;
    }): Promise<
      ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
    > => {
      const isFirst: boolean =
        String(data.query["incidentId"]) === INCIDENT_ID.toString();

      if (isFirst) {
        await firstAnswered;
      }

      if (data.modelType === AutoRemediationDecision) {
        const rows: Array<AutoRemediationDecision> = [
          Object.assign(
            new AutoRemediationDecision(),
            isFirst ? CLUSTER_FIX_STARTED : FIXING_OFF,
          ),
        ];
        return { data: rows, count: 1, skip: 0, limit: 5 };
      }

      return { data: [], count: 0, skip: 0, limit: 10 };
    }) as never);

    const onFoldStateChange: MockFunction = getJestMockFunction();
    const view: ReturnType<typeof render> = render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
        onFoldStateChange={
          onFoldStateChange as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    view.rerender(
      <RemediationStep
        investigationStage="reported"
        incidentId={NEXT_INCIDENT_ID}
        onFoldStateChange={
          onFoldStateChange as unknown as (state: RemediationFoldState) => void
        }
      />,
    );
    await settle();

    expect(reported(onFoldStateChange).pop()).toEqual({
      kind: "off",
      reason: "fixing_off",
    });

    // The first incident's answer lands late: it is not this page's.
    releaseFirst();
    await settle();

    expect(reported(onFoldStateChange).pop()).toEqual({
      kind: "off",
      reason: "fixing_off",
    });
  });
});

describe("what the Remediation step draws inside a folded AI card", () => {
  function renderWithFold(aiCardFold: AiCardFold | undefined): void {
    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
        {...(aiCardFold ? { aiCardFold } : {})}
      />,
    );
  }

  test.each<[AiCardFold]>([["folded"], ["checking"]])(
    "fixing off, beside an AI card that is %s: the line says it, the card does not",
    async (aiCardFold: AiCardFold) => {
      serveAll({ suggestions: [], decisions: [FIXING_OFF] });

      renderWithFold(aiCardFold);
      await settle();

      expect(screen.queryByText("Remediation")).toBeNull();
      expect(screen.queryByTestId("remediation-decision")).toBeNull();
    },
  );

  test.each<[AiCardFold | undefined]>([["full"], [undefined]])(
    "fixing off, beside an AI card that is %s: the card says it, as always",
    async (aiCardFold: AiCardFold | undefined) => {
      serveAll({ suggestions: [], decisions: [FIXING_OFF] });

      renderWithFold(aiCardFold);

      expect(
        await screen.findByTestId("remediation-decision"),
      ).toHaveTextContent(
        '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.',
      );
      expect(screen.getByText("Remediation")).toBeVisible();
    },
  );

  /*
   * The step is part of the card: while the card is one line, or still
   * deciding whether it is, the step draws nothing - whatever it holds.
   * What it holds decides the card instead: a fix to show, or a fix that
   * started, is fixing "on", and the card never folds over it.
   */
  test.each<[string, Served, AiCardFold]>([
    [
      "a fix to show",
      { suggestions: [suggestion()], decisions: [FIXING_OFF] },
      "checking",
    ],
    [
      "a fix that started",
      { suggestions: [], decisions: [CLUSTER_FIX_STARTED] },
      "checking",
    ],
  ])(
    "%s keeps the card whole: it reports fixing on",
    async (_case: string, served: Served, aiCardFold: AiCardFold) => {
      serveAll(served);
      const onFoldStateChange: MockFunction = getJestMockFunction();

      render(
        <RemediationStep
          investigationStage="reported"
          incidentId={INCIDENT_ID}
          aiCardFold={aiCardFold}
          onFoldStateChange={
            onFoldStateChange as unknown as (
              state: RemediationFoldState,
            ) => void
          }
        />,
      );
      await settle();

      expect(reported(onFoldStateChange).pop()).toEqual({ kind: "on" });
      // Drawn as soon as the card is: never before, and never folded away.
      expect(screen.queryByTestId("ai-card-step-remediation")).toBeNull();
    },
  );

  test("once the card is whole, the fix is drawn", async () => {
    serveAll({ suggestions: [suggestion()], decisions: [FIXING_OFF] });

    renderWithFold("full");

    expect(
      await screen.findByText("Restart the checkout pods"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Remediation" }),
    ).toBeVisible();
  });
});
