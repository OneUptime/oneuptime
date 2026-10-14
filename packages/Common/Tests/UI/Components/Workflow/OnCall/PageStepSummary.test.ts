/*
 * A Page step in one line, for its card on the canvas: who it pages and what
 * the page is about. A workflow that pages different people down different
 * paths - the reason anybody puts a Page step behind an If / Else or a
 * Switch / Case - is read from these lines, so each one has to be true of
 * the step's settings:
 *
 *   - it counts what is named, in the words of the step's own kind;
 *   - it never counts a value from an earlier step, which can name any
 *     number of people, and says where the people come from instead;
 *   - it says what the page is about as the step would read it - an empty
 *     Page About is a new alert - and leaves that half out when it cannot
 *     know;
 *   - a step that names nobody has no line: its card says "Click to set up".
 */

import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import {
  PageTargetKind,
  getPageStepTarget,
} from "../../../../../Types/Workflow/Components/OnCall";
import {
  PAGE_ARGUMENT_IDS,
  PageAbout,
} from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import {
  PAGE_ABOUT_PHRASE,
  PAGE_SUMMARY_SEPARATOR,
  PAGE_TARGET_COUNT_TEMPLATES,
  PAGE_TARGET_FROM_VALUE,
  summarizePageStep,
} from "../../../../../UI/Components/Workflow/OnCall/PageStepSummary";
import { loadComponentsAndCategories } from "../../../../../UI/Components/Workflow/Utils";
import { describe, expect, test } from "@jest/globals";

// Every step the Builder offers: the hand-written ones and each database model's.
const CATALOG: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

const A: string = "11111111-1111-4111-8111-111111111111";
const B: string = "22222222-2222-4222-8222-222222222222";
const C: string = "33333333-3333-4333-8333-333333333333";
const OWNERS: string =
  "{{local.components.incident-on-create-1.returnValues.model.ownerUsers}}";
const INCIDENT_ID: string =
  "{{local.components.incident-on-create-1.returnValues.model._id}}";

// How the line of a schedule step starts: with who is paged, not with a count of schedules.
const ON_CALL_IN: RegExp = /^On call in /;

interface PageStep {
  id: ComponentID;
  argumentId: string;
  kind: PageTargetKind;
  one: string;
  two: string;
  fromValue: string;
}

const PAGE_STEPS: Array<PageStep> = [
  {
    id: ComponentID.PageUsers,
    argumentId: PAGE_ARGUMENT_IDS.users,
    kind: PageTargetKind.User,
    one: "1 user",
    two: "2 users",
    fromValue: "Users from an earlier step",
  },
  {
    id: ComponentID.PageTeam,
    argumentId: PAGE_ARGUMENT_IDS.teams,
    kind: PageTargetKind.Team,
    one: "1 team",
    two: "2 teams",
    fromValue: "Teams from an earlier step",
  },
  {
    id: ComponentID.PageOnCall,
    argumentId: PAGE_ARGUMENT_IDS.onCallSchedules,
    kind: PageTargetKind.OnCallSchedule,
    one: "On call in 1 schedule",
    two: "On call in 2 schedules",
    fromValue: "On call in schedules from an earlier step",
  },
  {
    id: ComponentID.PageOnCallPolicy,
    argumentId: PAGE_ARGUMENT_IDS.onCallPolicies,
    kind: PageTargetKind.OnCallPolicy,
    one: "1 on-call policy",
    two: "2 on-call policies",
    fromValue: "On-call policies from an earlier step",
  },
];

function stepArguments(
  step: PageStep,
  who: unknown,
  rest: JSONObject = {},
): JSONObject {
  return { [step.argumentId]: who, ...rest } as JSONObject;
}

describe("the steps the line is for", () => {
  test("the table here is every Page step, each with its own setting", () => {
    for (const step of PAGE_STEPS) {
      expect(getPageStepTarget(step.id)).toEqual({
        argumentId: step.argumentId,
        kind: step.kind,
      });
    }

    expect(
      Components.filter((component: ComponentMetadata): boolean => {
        return getPageStepTarget(component.id) !== null;
      }).map((component: ComponentMetadata): string => {
        return component.id;
      }),
    ).toEqual(
      PAGE_STEPS.map((step: PageStep): string => {
        return step.id;
      }),
    );
  });

  test("no other step has one, whatever its settings hold", () => {
    const others: Array<ComponentMetadata> = CATALOG.filter(
      (component: ComponentMetadata): boolean => {
        return getPageStepTarget(component.id) === null;
      },
    );

    expect(others.length).toBeGreaterThan(1500);
    expect(CATALOG.length - others.length).toBe(PAGE_STEPS.length);

    for (const component of others) {
      expect(
        summarizePageStep(component.id, {
          users: [A],
          teams: [A],
          "on-call-schedules": [A],
          "on-call-policies": [A],
          about: PageAbout.Incident,
        }),
      ).toBeNull();
    }
  });
});

describe.each(PAGE_STEPS)("$id", (step: PageStep) => {
  test("one named, about something new: the count in the singular, then New alert", () => {
    expect(summarizePageStep(step.id, stepArguments(step, [A]))).toBe(
      `${step.one} · New alert`,
    );
  });

  test("two named: the plural", () => {
    expect(summarizePageStep(step.id, stepArguments(step, [A, B]))).toBe(
      `${step.two} · New alert`,
    );
  });

  test("the same one named twice counts once", () => {
    expect(
      summarizePageStep(step.id, stepArguments(step, [A, A.toUpperCase()])),
    ).toBe(`${step.one} · New alert`);
  });

  test.each<[string, PageAbout, string]>([
    ["a new alert", PageAbout.NewAlert, "New alert"],
    ["an incident", PageAbout.Incident, "Incident"],
    ["an alert", PageAbout.Alert, "Alert"],
  ])(
    "about %s: says so after the dot",
    (_name: string, about: PageAbout, phrase: string) => {
      expect(
        summarizePageStep(
          step.id,
          stepArguments(step, [A], { [PAGE_ARGUMENT_IDS.about]: about }),
        ),
      ).toBe(`${step.one} · ${phrase}`);
    },
  );

  test("a value from an earlier step is not counted: the line says where the people come from", () => {
    expect(
      summarizePageStep(
        step.id,
        stepArguments(step, [OWNERS], {
          [PAGE_ARGUMENT_IDS.about]: PageAbout.Incident,
          [PAGE_ARGUMENT_IDS.incidentId]: INCIDENT_ID,
        }),
      ),
    ).toBe(`${step.fromValue} · Incident`);
  });

  test("picks beside a value are not counted either: the count would be wrong as often as not", () => {
    expect(
      summarizePageStep(step.id, stepArguments(step, [A, B, OWNERS])),
    ).toBe(`${step.fromValue} · New alert`);
  });

  test("nobody named: no line", () => {
    for (const who of [undefined, null, "", "  ", [], [""], [null]]) {
      expect(summarizePageStep(step.id, stepArguments(step, who))).toBeNull();
    }

    expect(summarizePageStep(step.id, {})).toBeNull();
    expect(summarizePageStep(step.id, undefined)).toBeNull();
  });

  test("nobody named and a Page About chosen is still no line: there is nobody to say it of", () => {
    expect(
      summarizePageStep(step.id, {
        [PAGE_ARGUMENT_IDS.about]: PageAbout.Incident,
        [PAGE_ARGUMENT_IDS.incidentId]: INCIDENT_ID,
      }),
    ).toBeNull();
  });

  test("the setting of another Page step is not this step's: still no line", () => {
    const other: PageStep = PAGE_STEPS.find((candidate: PageStep): boolean => {
      return candidate.id !== step.id;
    })!;

    expect(summarizePageStep(step.id, stepArguments(other, [A, B]))).toBeNull();
  });

  test("a Page About that is a value from an earlier step: who alone", () => {
    expect(
      summarizePageStep(
        step.id,
        stepArguments(step, [A, B], {
          [PAGE_ARGUMENT_IDS.about]: "{{local.variables.about}}",
        }),
      ),
    ).toBe(step.two);
  });

  test("a Page About that is none of the choices: who alone, never a made-up subject", () => {
    for (const about of ["postmortem", 7, { a: 1 }]) {
      expect(
        summarizePageStep(
          step.id,
          stepArguments(step, [A], {
            [PAGE_ARGUMENT_IDS.about]: about,
          } as JSONObject),
        ),
      ).toBe(step.one);
    }
  });

  test("a Page About in another case or with spaces is read as the step reads it", () => {
    expect(
      summarizePageStep(
        step.id,
        stepArguments(step, [A], { [PAGE_ARGUMENT_IDS.about]: " Incident " }),
      ),
    ).toBe(`${step.one} · Incident`);
  });

  test("a setting stored as one id, or as a list written as JSON text, is counted as the list it is", () => {
    expect(summarizePageStep(step.id, stepArguments(step, A))).toBe(
      `${step.one} · New alert`,
    );
    expect(
      summarizePageStep(step.id, stepArguments(step, JSON.stringify([A, B]))),
    ).toBe(`${step.two} · New alert`);
  });

  test("many", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 12; index++) {
      many.push(
        `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
      );
    }

    expect(summarizePageStep(step.id, stepArguments(step, many))).toBe(
      `${step.two.replace("2", "12")} · New alert`,
    );
  });
});

describe("people named by email address", () => {
  test("an address written into a workflow counts as one of the people", () => {
    expect(
      summarizePageStep(ComponentID.PageUsers, {
        [PAGE_ARGUMENT_IDS.users]: ["jane@example.com"],
      }),
    ).toBe("1 user · New alert");
    expect(
      summarizePageStep(ComponentID.PageUsers, {
        [PAGE_ARGUMENT_IDS.users]: [A, "jane@example.com", "john@example.com"],
      }),
    ).toBe("3 users · New alert");
  });
});

describe("the words", () => {
  test("every kind has a count in the singular and the plural, and each holds the count", () => {
    for (const kind of Object.values(PageTargetKind)) {
      expect(PAGE_TARGET_COUNT_TEMPLATES[kind].one).toContain("{{count}}");
      expect(PAGE_TARGET_COUNT_TEMPLATES[kind].other).toContain("{{count}}");
      expect(PAGE_TARGET_COUNT_TEMPLATES[kind].one).not.toBe(
        PAGE_TARGET_COUNT_TEMPLATES[kind].other,
      );
      expect(PAGE_TARGET_FROM_VALUE[kind].length).toBeGreaterThan(0);
    }
  });

  test("no two kinds share a phrase: the line alone tells a team from a schedule", () => {
    const phrases: Array<string> = [
      ...Object.values(PAGE_TARGET_COUNT_TEMPLATES).flatMap(
        (template: { one: string; other: string }): Array<string> => {
          return [template.one, template.other];
        },
      ),
      ...Object.values(PAGE_TARGET_FROM_VALUE),
    ];

    expect(new Set(phrases).size).toBe(phrases.length);
  });

  test("every Page About has a phrase, and they differ", () => {
    for (const about of Object.values(PageAbout)) {
      expect(PAGE_ABOUT_PHRASE[about].length).toBeGreaterThan(0);
    }

    expect(new Set(Object.values(PAGE_ABOUT_PHRASE)).size).toBe(
      Object.values(PageAbout).length,
    );
  });

  test("the two halves are joined by a dot with a space on each side", () => {
    expect(PAGE_SUMMARY_SEPARATOR).toBe(" · ");
    expect(
      summarizePageStep(ComponentID.PageTeam, {
        [PAGE_ARGUMENT_IDS.teams]: [A, B, C],
      })!.split(PAGE_SUMMARY_SEPARATOR),
    ).toEqual(["3 teams", "New alert"]);
  });

  test("a schedule step says who is paged, not what is picked: the person on call, not the schedule", () => {
    expect(
      summarizePageStep(ComponentID.PageOnCall, {
        [PAGE_ARGUMENT_IDS.onCallSchedules]: [A],
      }),
    ).toMatch(ON_CALL_IN);
  });
});
