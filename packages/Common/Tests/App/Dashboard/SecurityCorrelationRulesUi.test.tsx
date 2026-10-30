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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Correlation rules in the Dashboard: what kind of rule a YAML is, read for
 * a person (DetectionRuleShape); the sentence that says what a correlation
 * looks for (DetectionRuleSummary); the Detection Rules list's Type column
 * and the form's summary under the YAML, which leaves out the single rule's
 * counting fields for a correlation; and the Rule Library, which marks its
 * correlations, finds them by kind and explains them in their details.
 */

type CapturedColumn = {
  field: Record<string, boolean>;
  title: string;
  getElement?:
    | ((item: Record<string, unknown>) => React.ReactElement)
    | undefined;
};

type CapturedFormField = {
  field: Record<string, boolean>;
  title: string;
  description?: string | undefined;
  stepId?: string | undefined;
  collapsibleSection?: { title: string } | undefined;
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
  getFooterElement?:
    | ((values: Record<string, unknown>) => React.ReactElement | undefined)
    | undefined;
};

type CapturedTableProps = {
  columns?: Array<CapturedColumn>;
  formFields?: Array<CapturedFormField>;
  selectMoreFields?: Record<string, boolean>;
  createInitialValues?: Record<string, unknown>;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return React.createElement("div", {
        "data-testid": "detection-rules-table",
      });
    },
  };
});

import DetectionRulesPage, {
  countsByFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/DetectionRules";
import RuleLibraryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleLibrary";
import DetectionRuleSummary, {
  DetectionRuleSentencePart,
  DetectionRuleTypeLabel,
  describeDetectionRuleShape,
  describeDetectionRuleShapeParts,
  formatTimespan,
  splitMarkedSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleSummary";
import {
  DETECTION_RULE_TYPE_DESCRIPTIONS,
  DETECTION_RULE_TYPE_TITLES,
  DetectionRuleShape,
  getDetectionRuleTypeCatalogDescription,
  readDetectionRuleShape,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleShape";
import {
  getLibraryRuleViews,
  LibraryRuleView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  DETECTION_RULE_TYPE_DEFINITIONS,
  DetectionRuleType,
  getDetectionRuleTypeDefinition,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-3434-4565-8787-909090909090",
);

const FAILED: string = `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

const SUCCEEDED: string = `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

const SEQUENCE: string = `title: Failed sign-in, then a success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalIp]
  timespan: 10m
---
${FAILED}
---
${SUCCEEDED}`;

function shapeOf(yaml: string): DetectionRuleShape {
  const shape: DetectionRuleShape | null = readDetectionRuleShape(yaml);

  expect(shape).not.toBeNull();

  return shape!;
}

function sentence(yaml: string): string {
  return describeDetectionRuleShape(shapeOf(yaml), getGlobalTranslator());
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  capturedTableProps = null;
});

describe("readDetectionRuleShape", () => {
  test("a single Sigma rule is one event, with nothing of a correlation's", () => {
    expect(shapeOf(FAILED)).toEqual({
      type: DetectionRuleType.SingleEvent,
      typeTitle: "Single event",
      isCorrelation: false,
      groupBy: [],
      timespanInSeconds: null,
      stepTitles: ["Failed sign-in"],
      valueFields: [],
      minimumCount: null,
      stepsNeeded: null,
    });
  });

  test("a sequence: its steps in order, its grouping and its timespan", () => {
    expect(shapeOf(SEQUENCE)).toEqual({
      type: DetectionRuleType.TemporalOrdered,
      typeTitle: "Sequence",
      isCorrelation: true,
      groupBy: ["principalIp"],
      timespanInSeconds: 600,
      stepTitles: ["Failed sign-in", "Successful sign-in"],
      valueFields: [],
      minimumCount: null,
      stepsNeeded: null,
    });
  });

  test("YAML being typed, or nothing, has no shape", () => {
    expect(readDetectionRuleShape("title: [unclosed")).toBeNull();
    expect(readDetectionRuleShape("")).toBeNull();
    expect(readDetectionRuleShape(undefined)).toBeNull();
    expect(readDetectionRuleShape(42)).toBeNull();
  });

  test("a step the YAML reads from the project's rules is named as the YAML names it", () => {
    expect(
      shapeOf(`title: Project rules
correlation:
  type: temporal
  rules: [failed_sign_in, 2b1d9c1e-0000-4000-8000-000000000000]
  timespan: 5m`).stepTitles,
    ).toEqual(["failed_sign_in", "2b1d9c1e-0000-4000-8000-000000000000"]);
  });

  test("every kind's title and description are the Common catalog's words", () => {
    for (const definition of DETECTION_RULE_TYPE_DEFINITIONS) {
      expect(DETECTION_RULE_TYPE_TITLES[definition.type]).toBe(
        definition.title,
      );
      expect(DETECTION_RULE_TYPE_DESCRIPTIONS[definition.type]).toBe(
        definition.description,
      );
      expect(getDetectionRuleTypeCatalogDescription(definition.type)).toBe(
        getDetectionRuleTypeDefinition(definition.type).description,
      );
    }
  });
});

describe("describeDetectionRuleShape", () => {
  test("a single rule has no sentence", () => {
    expect(sentence(FAILED)).toBe("");
  });

  test("each kind, said for a person", () => {
    expect(sentence(SEQUENCE)).toBe(
      "Fires when Failed sign-in → Successful sign-in happen in this order for the same principalIp within 10 minutes.",
    );

    expect(
      sentence(`title: Burst
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp, principalUser]
  timespan: 1h
  condition:
    gt: 9
---
${FAILED}`),
    ).toBe(
      "Fires when 10 events happen for the same principalIp / principalUser within 1 hour.",
    );

    expect(
      sentence(`title: Burst anywhere
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 30s
  condition:
    gte: 50
---
${FAILED}`),
    ).toBe("Fires when 50 events happen within 30 seconds.");

    expect(
      sentence(`title: Spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 10m
  condition:
    field: principalUser
    gte: 5
---
${FAILED}`),
    ).toBe(
      "Fires when the same principalIp shows 5 different principalUser values within 10 minutes.",
    );

    expect(
      sentence(`title: Together
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 2h
---
${FAILED}
---
${SUCCEEDED}`),
    ).toBe(
      "Fires when Failed sign-in and Successful sign-in all happen for the same principalUser within 2 hours, in any order.",
    );

    expect(
      sentence(`title: Two of three
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in, third]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}
---
${SUCCEEDED}
---
title: Third
name: third
detection:
  selection:
    a: b
  condition: selection`),
    ).toBe(
      "Fires when 2 of Failed sign-in, Successful sign-in and Third happen within 5 minutes, in any order.",
    );

    expect(
      sentence(`title: New address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 14d
  condition:
    field: principalIp
---
${SUCCEEDED}`),
    ).toBe(
      "Fires the first time a principalUser shows a principalIp it has not shown in 2 weeks.",
    );
  });

  test("a timespan in its largest whole unit", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();

    expect(formatTimespan(1, translator)).toBe("1 second");
    expect(formatTimespan(90, translator)).toBe("90 seconds");
    expect(formatTimespan(120, translator)).toBe("2 minutes");
    expect(formatTimespan(3600, translator)).toBe("1 hour");
    expect(formatTimespan(86400, translator)).toBe("1 day");
    expect(formatTimespan(30 * 86400, translator)).toBe("30 days");
    expect(formatTimespan(14 * 86400, translator)).toBe("2 weeks");
  });
});

describe("DetectionRuleSummary and DetectionRuleTypeLabel", () => {
  test("nothing for a single rule, or for YAML being typed", () => {
    const { container } = render(
      <div>
        <DetectionRuleSummary shape={shapeOf(FAILED)} />
        <DetectionRuleSummary shape={null} />
      </div>,
    );

    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  test("a correlation's kind and sentence", () => {
    render(<DetectionRuleSummary shape={shapeOf(SEQUENCE)} />);

    const summary: HTMLElement = screen.getByTestId("detection-rule-summary");

    expect(summary).toHaveTextContent(
      "Sequence · Fires when Failed sign-in → Successful sign-in happen in this order for the same principalIp within 10 minutes.",
    );
  });

  /*
   * The sentence names rules by their titles and fields by their column
   * names: each drawn apart from the words around it - a title in a heavier
   * weight, a field as code - wherever a language puts it.
   */
  test("draws the rules it reads by their titles, and each field as a column name", () => {
    render(<DetectionRuleSummary shape={shapeOf(SEQUENCE)} />);

    expect(
      screen
        .getAllByTestId("detection-rule-summary-rule")
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        }),
    ).toEqual(["Failed sign-in", "Successful sign-in"]);

    const fields: Array<HTMLElement> = screen.getAllByTestId(
      "detection-rule-summary-field",
    );

    expect(
      fields.map((element: HTMLElement): string => {
        return element.textContent || "";
      }),
    ).toEqual(["principalIp"]);
    expect(fields[0]!.tagName).toBe("CODE");
  });

  test("the sentence in parts: words, rule titles and fields, in its own order", () => {
    const parts: Array<DetectionRuleSentencePart> =
      describeDetectionRuleShapeParts(shapeOf(SEQUENCE), getGlobalTranslator());

    expect(parts).toEqual([
      { kind: "text", text: "Fires when " },
      { kind: "rule", text: "Failed sign-in" },
      { kind: "text", text: " → " },
      { kind: "rule", text: "Successful sign-in" },
      { kind: "text", text: " happen in this order for the same " },
      { kind: "field", text: "principalIp" },
      { kind: "text", text: " within 10 minutes." },
    ]);
    // The plain sentence is the parts' words, marks and all left out.
    expect(
      parts
        .map((part: DetectionRuleSentencePart): string => {
          return part.text;
        })
        .join(""),
    ).toBe(sentence(SEQUENCE));
  });

  test("a title or field holding a mark cannot cut the sentence", () => {
    const shape: DetectionRuleShape = {
      ...shapeOf(SEQUENCE),
      stepTitles: ["Failed \uE002sign-in\uE003", "Successful \uE001sign-in"],
      groupBy: ["principal\uE004Ip"],
    };

    const parts: Array<DetectionRuleSentencePart> =
      describeDetectionRuleShapeParts(shape, getGlobalTranslator());

    expect(
      parts.filter((part: DetectionRuleSentencePart): boolean => {
        return part.kind !== "text";
      }),
    ).toEqual([
      { kind: "rule", text: "Failed sign-in" },
      { kind: "rule", text: "Successful sign-in" },
      { kind: "field", text: "principalIp" },
    ]);
  });

  test("a sentence without marks is one part of words; nothing makes no part", () => {
    expect(splitMarkedSentence("Fires when it does.")).toEqual([
      { kind: "text", text: "Fires when it does." },
    ]);
    expect(splitMarkedSentence("")).toEqual([]);
    expect(
      describeDetectionRuleShapeParts(shapeOf(FAILED), getGlobalTranslator()),
    ).toEqual([]);
  });

  test("the label names the kind, and explains it on hover", () => {
    render(
      <DetectionRuleTypeLabel shape={shapeOf(SEQUENCE)} dataTestId="label" />,
    );

    const label: HTMLElement = screen.getByTestId("label");

    expect(label).toHaveTextContent("Sequence");
    expect(label).toHaveAttribute(
      "title",
      "Fires when the rules match in order for the same user, host or address within a time span.",
    );
  });
});

describe("the Detection Rules page", () => {
  function renderRulesPage(): void {
    const project: Project = new Project();
    project.id = PROJECT_ID;

    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });

    render(
      <MemoryRouter>
        <DetectionRulesPage
          pageRoute={new Route("/dashboard/security-events/detection-rules")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  function fieldTitled(title: string): CapturedFormField {
    const field: CapturedFormField | undefined =
      capturedTableProps?.formFields?.find(
        (candidate: CapturedFormField): boolean => {
          return candidate.title === title;
        },
      );

    expect(field).toBeDefined();

    return field!;
  }

  test("the list reads each rule's YAML and shows its kind", () => {
    renderRulesPage();

    expect(capturedTableProps?.selectMoreFields).toEqual({
      sigmaRuleYaml: true,
      // Whether each rule is on, for Enable and Disable in bulk to count.
      isEnabled: true,
      // A real-time rule's Status and Interval say so.
      isRealTime: true,
    });

    const column: CapturedColumn | undefined =
      capturedTableProps?.columns?.find(
        (candidate: CapturedColumn): boolean => {
          return candidate.title === "Type";
        },
      );

    expect(column?.field).toEqual({ sigmaRuleYaml: true });

    const { unmount } = render(
      column!.getElement!({ sigmaRuleYaml: SEQUENCE }),
    );
    expect(screen.getByTestId("detection-rule-type")).toHaveTextContent(
      "Sequence",
    );
    unmount();

    render(column!.getElement!({ sigmaRuleYaml: FAILED }));
    expect(screen.getByTestId("detection-rule-type")).toHaveTextContent(
      "Single event",
    );
  });

  test("the YAML field says it takes a correlation, and summarizes one under it", () => {
    renderRulesPage();

    const yamlField: CapturedFormField = fieldTitled("Sigma Rule (YAML)");

    expect(yamlField.description).toBe(
      "One Sigma rule, or a Sigma correlation with the rules it reads, in YAML.",
    );
    /*
     * A single rule, or YAML that does not parse yet, gets no summary: the
     * footer holds Draft with AI alone (DetectionRuleAiDraft).
     */
    for (const yaml of [FAILED, "title: ["]) {
      const { unmount } = render(
        yamlField.getFooterElement!({ sigmaRuleYaml: yaml })!,
      );
      expect(screen.queryByTestId("detection-rule-summary")).toBeNull();
      unmount();
    }

    render(yamlField.getFooterElement!({ sigmaRuleYaml: SEQUENCE })!);

    expect(screen.getByTestId("detection-rule-summary")).toHaveTextContent(
      "Fires when Failed sign-in → Successful sign-in happen in this order",
    );
  });

  test("Run in Real Time waits under More fields on On Match, off on a new rule, offered to a rule that fires on one event", () => {
    renderRulesPage();

    const realTime: CapturedFormField = fieldTitled("Run in Real Time");

    expect(realTime.field).toEqual({ isRealTime: true });
    expect(realTime.stepId).toBe("on-match");
    expect(realTime.collapsibleSection?.title).toBe("More fields");
    expect(realTime.description).toBe(
      "Check each event as it arrives, within seconds. For a rule that fires on one event: threshold 1, no distinct count field, no regular expression.",
    );
    expect(capturedTableProps?.createInitialValues?.["isRealTime"]).toBe(false);

    // Offered for a single rule; not for a correlation...
    expect(realTime.showIf!({ sigmaRuleYaml: FAILED })).toBe(true);
    expect(realTime.showIf!({ sigmaRuleYaml: SEQUENCE })).toBe(false);
    // ...unless the rule runs in real time already: the switch that must go off stays.
    expect(
      realTime.showIf!({ sigmaRuleYaml: SEQUENCE, isRealTime: true }),
    ).toBe(true);
    expect(
      realTime.showIf!({ sigmaRuleYaml: SEQUENCE, isRealTime: "true" }),
    ).toBe(true);
  });

  test("a real-time rule runs on no interval: the interval hides, and the list says Real time", () => {
    renderRulesPage();

    const interval: CapturedFormField = fieldTitled(
      "Evaluation Interval (Minutes)",
    );

    expect(interval.showIf!({ sigmaRuleYaml: FAILED })).toBe(true);
    expect(interval.showIf!({ sigmaRuleYaml: FAILED, isRealTime: true })).toBe(
      false,
    );

    const column: CapturedColumn | undefined =
      capturedTableProps?.columns?.find(
        (candidate: CapturedColumn): boolean => {
          return candidate.title === "Interval (Minutes)";
        },
      );

    const { unmount } = render(
      column!.getElement!({ evaluationIntervalInMinutes: 5, isRealTime: true }),
    );
    expect(document.body).toHaveTextContent("Real time");
    unmount();

    render(
      column!.getElement!({
        evaluationIntervalInMinutes: 5,
        isRealTime: false,
      }),
    );
    expect(document.body).toHaveTextContent("5");
    expect(document.body).not.toHaveTextContent("Real time");
  });

  test("a real-time rule's Status says so, in green, instead of waiting for a run it never has", () => {
    renderRulesPage();

    const status: CapturedColumn | undefined =
      capturedTableProps?.columns?.find(
        (candidate: CapturedColumn): boolean => {
          return candidate.title === "Status";
        },
      );

    render(status!.getElement!({ isEnabled: true, isRealTime: true }));

    expect(document.body).toHaveTextContent("Real time");
    expect(document.body).not.toHaveTextContent("Waiting for first run");
  });

  test("a correlation counts by its YAML, so the single rule's counting fields are left out", () => {
    renderRulesPage();

    for (const title of [
      "Group By Field",
      "Distinct Count Field",
      "Match Count Threshold",
    ]) {
      const field: CapturedFormField = fieldTitled(title);

      expect(field.showIf).toBe(countsByFormFields);
      expect(field.showIf!({ sigmaRuleYaml: FAILED })).toBe(true);
      expect(field.showIf!({ sigmaRuleYaml: SEQUENCE })).toBe(false);
      // While the YAML does not parse yet, the fields stay.
      expect(field.showIf!({ sigmaRuleYaml: "" })).toBe(true);
    }
  });
});

describe("correlations in the Rule Library", () => {
  const CORRELATIONS: Array<DetectionRuleLibraryEntry> =
    DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return (
          readDetectionRuleShape(entry.sigmaRuleYaml)?.isCorrelation === true
        );
      },
    );

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [] as Array<DetectionRule>,
      count: 0,
      skip: 0,
      limit: 100,
    } as never);
    // What the project sends: nothing this week.
    jest
      .spyOn(AnalyticsModelAPI, "aggregate")
      .mockResolvedValue({ data: [] } as never);
  });

  async function renderLibrary(): Promise<void> {
    const project: Project = new Project();
    project.id = PROJECT_ID;

    await act(async () => {
      render(
        <MemoryRouter>
          <RuleLibraryPage
            pageRoute={new Route("/dashboard/security-events/rule-library")}
            currentProject={project}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });
  }

  test("the library has sequences and first-seen rules", () => {
    const kinds: Set<DetectionRuleType> = new Set(
      CORRELATIONS.map(
        (entry: DetectionRuleLibraryEntry): DetectionRuleType => {
          return readDetectionRuleShape(entry.sigmaRuleYaml)!.type;
        },
      ),
    );

    expect(kinds.has(DetectionRuleType.TemporalOrdered)).toBe(true);
    expect(kinds.has(DetectionRuleType.NewValue)).toBe(true);
  });

  test("each correlation is marked with its kind, and no single rule is", async () => {
    await renderLibrary();

    for (const entry of DETECTION_RULE_LIBRARY) {
      const shape: DetectionRuleShape = readDetectionRuleShape(
        entry.sigmaRuleYaml,
      )!;
      const label: HTMLElement | null = screen.queryByTestId(
        `rule-library-type-${entry.id}`,
      );

      if (shape.isCorrelation) {
        expect(label).toHaveTextContent(shape.typeTitle);
      } else {
        expect(label).toBeNull();
      }
    }
  });

  test("searching a kind finds its rules", () => {
    const sequences: Array<LibraryRuleView> = getLibraryRuleViews({
      category: "",
      search: "sequence",
      existingRules: [],
    });

    // Every sequence is found (a rule whose words say "sequence" may be too).
    const found: Array<string> = sequences.map(
      (view: LibraryRuleView): string => {
        return view.entry.id;
      },
    );
    const sequenceIds: Array<string> = CORRELATIONS.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return (
          readDetectionRuleShape(entry.sigmaRuleYaml)?.type ===
          DetectionRuleType.TemporalOrdered
        );
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.id;
    });

    expect(sequenceIds.length).toBeGreaterThan(0);

    for (const id of sequenceIds) {
      expect(found).toContain(id);
    }

    const firstSeen: Array<LibraryRuleView> = getLibraryRuleViews({
      category: "",
      search: "first seen",
      existingRules: [],
    });

    expect(
      firstSeen.some((view: LibraryRuleView): boolean => {
        return (
          readDetectionRuleShape(view.entry.sigmaRuleYaml)?.type ===
          DetectionRuleType.NewValue
        );
      }),
    ).toBe(true);
  });

  test("a correlation's details say what it looks for, its grouping and its YAML", async () => {
    await renderLibrary();

    const entry: DetectionRuleLibraryEntry = CORRELATIONS[0]!;
    const row: HTMLElement = screen.getByTestId(
      `rule-library-entry-${entry.id}`,
    );

    // The rule's name opens its details beside the list.
    await act(async () => {
      fireEvent.click(within(row).getByTestId(`rule-library-name-${entry.id}`));
    });

    const summary: HTMLElement = await screen.findByTestId(
      "rule-library-details-summary",
    );
    const shape: DetectionRuleShape = readDetectionRuleShape(
      entry.sigmaRuleYaml,
    )!;

    expect(summary).toHaveTextContent(shape.typeTitle);
    // The grouping beside the schedule, as the field names it, and in the sentence.
    expect(screen.getByText("Grouped by").nextElementSibling).toHaveTextContent(
      shape.groupBy.join(" / "),
    );
    // Not the single rule's "Fires at" and "Counting distinct".
    expect(screen.queryByText("Fires at")).toBeNull();
    expect(screen.queryByText("Counting distinct")).toBeNull();
  });
});
