import {
  MAX_REFERENCE_LOOKUP_ROWS,
  resolveInvestigationReferences,
} from "../../../../Server/Utils/AI/SRE/InvestigationReferences";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import { InvestigationEventReference } from "../../../../Types/AI/InvestigationEvidence";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Color from "../../../../Types/Color";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "Recurrence of #6954" is model-authored text. A link is only minted when
 * that number resolves — inside the subject's project, under the viewer's
 * own permissions — to exactly one record; anything else stays plain text.
 * These tests pin that trust boundary plus the query shape (one lookup per
 * kind) and the "links are decoration, never an error" contract.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

const viewerProps: DatabaseCommonInteractionProps = {
  userId: new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

let generatedIdCounter: number = 0;

function nextId(): ObjectID {
  generatedIdCounter++;
  return new ObjectID(
    `00000000-0000-4000-8000-${generatedIdCounter.toString().padStart(12, "0")}`,
  );
}

function incidentRow(data: {
  number: number;
  prefix?: string | undefined;
  title?: string | undefined;
  stateName?: string | undefined;
  stateColor?: string | undefined;
  id?: ObjectID | undefined;
}): Incident {
  const incident: Incident = new Incident(data.id || nextId());
  incident.incidentNumber = data.number;
  if (data.prefix !== undefined) {
    incident.incidentNumberWithPrefix = data.prefix;
  }
  incident.title = data.title ?? `Incident ${data.number}`;
  if (data.stateName || data.stateColor) {
    const state: IncidentState = new IncidentState();
    if (data.stateName) {
      state.name = data.stateName;
    }
    if (data.stateColor) {
      state.color = new Color(data.stateColor);
    }
    incident.currentIncidentState = state;
  }
  return incident;
}

function alertRow(data: {
  number: number;
  prefix?: string | undefined;
  title?: string | undefined;
  stateName?: string | undefined;
  stateColor?: string | undefined;
}): Alert {
  const alert: Alert = new Alert(nextId());
  alert.alertNumber = data.number;
  if (data.prefix !== undefined) {
    alert.alertNumberWithPrefix = data.prefix;
  }
  alert.title = data.title ?? `Alert ${data.number}`;
  if (data.stateName || data.stateColor) {
    const state: AlertState = new AlertState();
    if (data.stateName) {
      state.name = data.stateName;
    }
    if (data.stateColor) {
      state.color = new Color(data.stateColor);
    }
    alert.currentAlertState = state;
  }
  return alert;
}

function findByCall(spy: jest.SpyInstance, index: number = 0): JSONObject {
  return spy.mock.calls[index]![0] as JSONObject;
}

describe("resolveInvestigationReferences", () => {
  let incidentFindBy: jest.SpyInstance;
  let alertFindBy: jest.SpyInstance;
  let anySpy: jest.SpyInstance;

  beforeEach(() => {
    generatedIdCounter = 0;
    incidentFindBy = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);
    alertFindBy = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    anySpy = jest.spyOn(QueryHelper, "any");
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("resolves an incident report's references with one lookup, pinned to the project, under the viewer's props", async () => {
    const recurrence: Incident = incidentRow({
      number: 6954,
      prefix: "INC-6954",
      title: "Checkout pool exhausted",
      stateName: "Resolved",
      stateColor: "#10b981",
    });
    const sibling: Incident = incidentRow({ number: 6963, title: "DB lag" });
    incidentFindBy.mockResolvedValue([recurrence, sibling]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown:
          "**Summary** — a recurrence of #6954 (prior: #6963, #7001) [C1].",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(references).toEqual([
      {
        kind: "incident",
        number: 6954,
        id: recurrence.id!.toString(),
        displayNumber: "INC-6954",
        title: "Checkout pool exhausted",
        stateName: "Resolved",
        stateColor: "#10b981",
      },
      {
        kind: "incident",
        number: 6963,
        id: sibling.id!.toString(),
        displayNumber: "#6963",
        title: "DB lag",
      },
    ]);

    expect(incidentFindBy).toHaveBeenCalledTimes(1);
    expect(alertFindBy).not.toHaveBeenCalled();
    expect(anySpy).toHaveBeenCalledWith([6954, 6963, 7001]);

    const call: JSONObject = findByCall(incidentFindBy);
    expect(call["props"]).toBe(viewerProps);
    expect(call["props"]).not.toHaveProperty("isRoot");
    expect(call["query"]).toEqual({
      projectId: PROJECT_ID,
      incidentNumber: anySpy.mock.results[0]!.value,
    });
    expect(call["select"]).toEqual({
      _id: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      title: true,
      currentIncidentState: { name: true, color: true },
    });
    expect(call["sort"]).toEqual({ incidentNumber: SortOrder.Ascending });
    expect(call["limit"]).toBe(MAX_REFERENCE_LOOKUP_ROWS);
    expect(call["skip"]).toBe(0);
  });

  test("an alert report treats unqualified numbers as alerts and qualified ones by their word", async () => {
    alertFindBy.mockResolvedValue([
      alertRow({
        number: 12,
        prefix: "ALT-12",
        title: "p95 latency",
        stateName: "Acknowledged",
        stateColor: "#f59e0b",
      }),
    ]);
    incidentFindBy.mockResolvedValue([
      incidentRow({ number: 5, title: "Related incident" }),
    ]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "Alert fired again (#12); it maps to incident #5.",
        subjectType: "alert",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(
      references.map((reference: InvestigationEventReference): string => {
        return `${reference.kind}:${reference.number}:${reference.displayNumber}`;
      }),
    ).toEqual(["alert:12:ALT-12", "incident:5:#5"]);
    expect(references[0]).toEqual(
      expect.objectContaining({
        title: "p95 latency",
        stateName: "Acknowledged",
        stateColor: "#f59e0b",
      }),
    );

    expect(alertFindBy).toHaveBeenCalledTimes(1);
    expect(incidentFindBy).toHaveBeenCalledTimes(1);

    const alertCall: JSONObject = findByCall(alertFindBy);
    expect(alertCall["props"]).toBe(viewerProps);
    expect((alertCall["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
    expect(alertCall["select"]).toEqual({
      _id: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
      title: true,
      currentAlertState: { name: true, color: true },
    });
    expect(anySpy).toHaveBeenCalledWith([12]);
    expect(anySpy).toHaveBeenCalledWith([5]);
  });

  test("qualifier words carry across a list", async () => {
    await resolveInvestigationReferences({
      markdown: "Same as alerts #1, #2 and #3.",
      subjectType: "incident",
      projectId: PROJECT_ID,
      props: viewerProps,
    });

    expect(incidentFindBy).not.toHaveBeenCalled();
    expect(anySpy).toHaveBeenCalledWith([1, 2, 3]);
    expect(alertFindBy).toHaveBeenCalledTimes(1);
  });

  /*
   * An unqualified "#N" is looked up as the subject's kind, so a qualifier
   * the extractor fails to read links to an unrelated record of that kind.
   */
  test("a qualifier followed by punctuation keeps its kind on an alert report", async () => {
    incidentFindBy.mockResolvedValue([
      incidentRow({ number: 12, title: "Prior outage" }),
    ]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown:
          "This matches prior incidents: #12, #13 and a similar incident (#14).",
        subjectType: "alert",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(alertFindBy).not.toHaveBeenCalled();
    expect(incidentFindBy).toHaveBeenCalledTimes(1);
    expect(anySpy).toHaveBeenCalledWith([12, 13, 14]);
    expect(
      references.map((reference: InvestigationEventReference): string => {
        return `${reference.kind}:${reference.number}`;
      }),
    ).toEqual(["incident:12"]);
  });

  test("numbers from another numbering are never looked up", async () => {
    expect(
      await resolveInvestigationReferences({
        markdown:
          "Scheduled maintenance #42 overlapped; PRs #45, #46 and step #1 of the runbook.",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      }),
    ).toEqual([]);

    expect(incidentFindBy).not.toHaveBeenCalled();
    expect(alertFindBy).not.toHaveBeenCalled();
  });

  test("a bare number the report also names as the other kind is not looked up as the subject's kind", async () => {
    incidentFindBy.mockResolvedValue([incidentRow({ number: 12 })]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "Incident #12 recurred.\n\n#12 had the same pool exhaustion.",
        subjectType: "alert",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(alertFindBy).not.toHaveBeenCalled();
    expect(anySpy).toHaveBeenCalledWith([12]);
    expect(references).toEqual([
      expect.objectContaining({ kind: "incident", number: 12 }),
    ]);
  });

  test("reads only the model's note, not the server's evidence labels or footer", async () => {
    const report: string = [
      "## 🧠 AI — Automated Root Cause Analysis",
      "",
      "**Summary** — a recurrence of #6954 [C1].",
      "",
      "**Evidence checked**",
      "- **[C1]** Incident #7001 timeline — 1 row(s)",
      "- **[C2]** Alerts #88 and #89 — 2 row(s)",
      "",
      "---",
      "*Investigated automatically by OneUptime AI — read-only, 2 queries run across your own telemetry. This is an AI-generated first pass; verify before acting.*",
    ].join("\n");

    await resolveInvestigationReferences({
      markdown: report,
      subjectType: "incident",
      projectId: PROJECT_ID,
      props: viewerProps,
    });

    expect(anySpy).toHaveBeenCalledTimes(1);
    expect(anySpy).toHaveBeenCalledWith([6954]);
    expect(alertFindBy).not.toHaveBeenCalled();
  });

  test("a number matching more than one record is ambiguous and stays plain text", async () => {
    incidentFindBy.mockResolvedValue([
      incidentRow({ number: 42, title: "First 42" }),
      incidentRow({ number: 42, title: "Second 42" }),
      incidentRow({ number: 43, title: "Only 43" }),
    ]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "See #42 and #43.",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(
      references.map((reference: InvestigationEventReference): number => {
        return reference.number;
      }),
    ).toEqual([43]);
  });

  test("when the lookup hits its row limit, the possibly-truncated last number is dropped", async () => {
    const rows: Array<Incident> = [];

    for (
      let index: number = 0;
      index < MAX_REFERENCE_LOOKUP_ROWS - 1;
      index++
    ) {
      // #1 is duplicated many times; #2 appears once but is the tail group.
      rows.push(incidentRow({ number: 1 }));
    }
    rows.push(incidentRow({ number: 2 }));
    incidentFindBy.mockResolvedValue(rows);

    expect(
      await resolveInvestigationReferences({
        markdown: "See #1 and #2.",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      }),
    ).toEqual([]);
  });

  test("below the row limit the last number is kept", async () => {
    incidentFindBy.mockResolvedValue([
      incidentRow({ number: 1 }),
      incidentRow({ number: 2 }),
    ]);

    expect(
      (
        await resolveInvestigationReferences({
          markdown: "See #1 and #2.",
          subjectType: "incident",
          projectId: PROJECT_ID,
          props: viewerProps,
        })
      ).length,
    ).toBe(2);
  });

  test("numbers the viewer cannot see (or that do not exist) are simply not linked", async () => {
    incidentFindBy.mockResolvedValue([incidentRow({ number: 7 })]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "#7, #8 and #9",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(
      references.map((reference: InvestigationEventReference): number => {
        return reference.number;
      }),
    ).toEqual([7]);
  });

  test("keeps the report's first-mention order and mentions each record once", async () => {
    incidentFindBy.mockResolvedValue([
      incidentRow({ number: 3 }),
      incidentRow({ number: 10 }),
    ]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "#10 first, then #3, then #10 again.",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(anySpy).toHaveBeenCalledWith([10, 3]);
    expect(
      references.map((reference: InvestigationEventReference): number => {
        return reference.number;
      }),
    ).toEqual([10, 3]);
  });

  test("skips rows without an id or number", async () => {
    const withoutId: Incident = new Incident();
    withoutId.incidentNumber = 4;
    const withoutNumber: Incident = new Incident(nextId());
    incidentFindBy.mockResolvedValue([withoutId, withoutNumber]);

    expect(
      await resolveInvestigationReferences({
        markdown: "#4",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      }),
    ).toEqual([]);
  });

  test("an untitled record resolves with an empty title", async () => {
    const untitled: Incident = incidentRow({ number: 11 });
    untitled.title = undefined as unknown as string;
    incidentFindBy.mockResolvedValue([untitled]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "#11",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(references[0]!.title).toBe("");
    expect(references[0]).not.toHaveProperty("stateName");
    expect(references[0]).not.toHaveProperty("stateColor");
  });

  test.each([
    ["no references at all", "The pool ran dry [C1]."],
    ["an empty report", ""],
    ["references only inside code", "Run `kill #123` or:\n\n```\n#456\n```"],
    ["headings and anchors", "## Summary\nSee https://x.test/#12 and abc#34."],
  ])(
    "makes no lookup for %s",
    async (_description: string, markdown: string) => {
      expect(
        await resolveInvestigationReferences({
          markdown,
          subjectType: "incident",
          projectId: PROJECT_ID,
          props: viewerProps,
        }),
      ).toEqual([]);

      expect(incidentFindBy).not.toHaveBeenCalled();
      expect(alertFindBy).not.toHaveBeenCalled();
    },
  );

  test("no project, no lookup", async () => {
    expect(
      await resolveInvestigationReferences({
        markdown: "#1",
        subjectType: "incident",
        projectId: undefined as unknown as ObjectID,
        props: viewerProps,
      }),
    ).toEqual([]);
    expect(incidentFindBy).not.toHaveBeenCalled();
  });

  test("a lookup error is logged and yields no links — never an exception", async () => {
    incidentFindBy.mockRejectedValue(new Error("permission denied"));

    await expect(
      resolveInvestigationReferences({
        markdown: "Recurrence of #6954.",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      }),
    ).resolves.toEqual([]);

    expect(logger.error).toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  /*
   * A viewer without read access to one table is normal (an alert-only
   * member reading "incident #5"), and the panel polls, so a permission
   * denial must not log an error on every poll.
   */
  test("a permission denial is logged at debug level and yields no links for that kind", async () => {
    incidentFindBy.mockRejectedValue(
      new NotAuthorizedException("You do not have Read permission on Incident"),
    );
    alertFindBy.mockResolvedValue([alertRow({ number: 9 })]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "Alert #9 fired during incident #6954.",
        subjectType: "alert",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(
      references.map((reference: InvestigationEventReference): string => {
        return `${reference.kind}:${reference.number}`;
      }),
    ).toEqual(["alert:9"]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(String((logger.debug as jest.Mock).mock.calls[0]![0])).toContain(
      "incident",
    );
  });

  test("an alert permission denial is logged at debug level too", async () => {
    alertFindBy.mockRejectedValue(
      new NotAuthorizedException("You do not have Read permission on Alert"),
    );

    await expect(
      resolveInvestigationReferences({
        markdown: "Same as #3.",
        subjectType: "alert",
        projectId: PROJECT_ID,
        props: viewerProps,
      }),
    ).resolves.toEqual([]);

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  test("one kind failing does not take down the other kind's links", async () => {
    incidentFindBy.mockRejectedValue(new Error("no incident access"));
    alertFindBy.mockResolvedValue([alertRow({ number: 9 })]);

    const references: Array<InvestigationEventReference> =
      await resolveInvestigationReferences({
        markdown: "Alert #9 fired during incident #6954.",
        subjectType: "incident",
        projectId: PROJECT_ID,
        props: viewerProps,
      });

    expect(
      references.map((reference: InvestigationEventReference): string => {
        return `${reference.kind}:${reference.number}`;
      }),
    ).toEqual(["alert:9"]);
  });

  test("caps the lookup at the extractor's reference limit", async () => {
    const numbers: Array<string> = [];
    for (let index: number = 1; index <= 40; index++) {
      numbers.push(`#${index}`);
    }

    await resolveInvestigationReferences({
      markdown: numbers.join(" "),
      subjectType: "incident",
      projectId: PROJECT_ID,
      props: viewerProps,
    });

    const lookedUp: Array<number> = anySpy.mock.calls[0]![0] as Array<number>;
    expect(lookedUp).toHaveLength(25);
    expect(lookedUp[0]).toBe(1);
  });
});
