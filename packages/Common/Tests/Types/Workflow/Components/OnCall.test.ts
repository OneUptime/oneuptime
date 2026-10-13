/*
 * The four Page steps as the Builder is handed them: what each is called,
 * which settings it has and in what order, when each setting is part of the
 * step, what it returns and which outputs it has.
 *
 * Saved workflows and templates store the setting, return-value and output
 * ids, the runtime reads them, and the docs name the settings - so they are
 * pinned here, whole.
 */

import { JSONObject } from "../../../../Types/JSON";
import IconProp from "../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  Argument,
  ArgumentChoice,
  ComponentInputType,
  ComponentType,
  Port,
  ReturnValue,
  getArgumentChoice,
  isArgumentRequired,
  isArgumentShown,
  isRecordListInputType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components, { Categories } from "../../../../Types/Workflow/Components";
import OnCallComponents, {
  ON_CALL_COMPONENT_CATEGORY,
  PageTargetKind,
  getPageStepTarget,
  getPageTargetKind,
  isPageStep,
} from "../../../../Types/Workflow/Components/OnCall";
import {
  PAGE_ARGUMENT_IDS,
  PageAbout,
} from "../../../../Types/Workflow/Components/OnCallPageSettings";
import { describe, expect, test } from "@jest/globals";

function step(id: ComponentID): ComponentMetadata {
  const found: ComponentMetadata | undefined = OnCallComponents.find(
    (metadata: ComponentMetadata): boolean => {
      return metadata.id === id;
    },
  );

  if (!found) {
    throw new Error(`No step ${id}`);
  }

  return found;
}

function argument(metadata: ComponentMetadata, id: string): Argument {
  const found: Argument | undefined = metadata.arguments.find(
    (candidate: Argument): boolean => {
      return candidate.id === id;
    },
  );

  if (!found) {
    throw new Error(`${metadata.id} has no setting ${id}`);
  }

  return found;
}

const PAGE_STEP_IDS: Array<ComponentID> = [
  ComponentID.PageUsers,
  ComponentID.PageTeam,
  ComponentID.PageOnCall,
  ComponentID.PageOnCallPolicy,
];

const DIRECT_STEP_IDS: Array<ComponentID> = [
  ComponentID.PageUsers,
  ComponentID.PageTeam,
  ComponentID.PageOnCall,
];

describe("the four Page steps", () => {
  test("are these four, in this order, and nothing else", () => {
    expect(
      OnCallComponents.map((metadata: ComponentMetadata): string => {
        return metadata.id;
      }),
    ).toEqual([
      "page-users",
      "page-team",
      "page-on-call",
      "page-on-call-policy",
    ]);
  });

  test("are called what a person looks for", () => {
    expect(
      OnCallComponents.map(
        (metadata: ComponentMetadata): [string, string, IconProp] => {
          return [metadata.title, metadata.description, metadata.iconProp];
        },
      ),
    ).toEqual([
      [
        "Page Users",
        "Pages the people you name, by their own on-call rules.",
        IconProp.User,
      ],
      [
        "Page a Team",
        "Pages every member of a team, by their own on-call rules.",
        IconProp.Team,
      ],
      [
        "Page Whoever Is On Call",
        "Pages the person on call in a schedule right now.",
        IconProp.Calendar,
      ],
      [
        "Page an On-Call Policy",
        "Starts an on-call policy, with its escalation rules.",
        IconProp.Call,
      ],
    ]);
  });

  test("are steps, not triggers, of the On-Call category", () => {
    for (const metadata of OnCallComponents) {
      expect(metadata.componentType).toBe(ComponentType.Component);
      expect(metadata.category).toBe(ON_CALL_COMPONENT_CATEGORY);
      expect(metadata.tableName).toBeUndefined();
    }

    expect(ON_CALL_COMPONENT_CATEGORY).toBe("On-Call");
  });

  test("a description fits the two lines the Add Component panel gives it", () => {
    for (const metadata of OnCallComponents) {
      expect(metadata.description.length).toBeLessThanOrEqual(75);
      expect(metadata.description.endsWith(".")).toBe(true);
    }
  });

  test("are in the catalog the Builder and the runner read", () => {
    for (const id of PAGE_STEP_IDS) {
      expect(
        Components.filter((metadata: ComponentMetadata): boolean => {
          return metadata.id === id;
        }),
      ).toHaveLength(1);
    }
  });

  test("their category is described, and leads the Add Component panel's groups", () => {
    expect(Categories[0]).toEqual({
      name: "On-Call",
      description:
        "Page people, a team, whoever is on call, or an on-call policy.",
      icon: IconProp.Call,
    });
  });

  test("no two steps share a setting, a port or a return value object", () => {
    /*
     * The Builder copies a step's metadata shallowly when it is added to
     * the canvas: an object shared between steps would let a change to one
     * step's setting reach every other step's.
     */
    const seen: Set<unknown> = new Set<unknown>();

    for (const metadata of OnCallComponents) {
      for (const item of [
        ...metadata.arguments,
        ...metadata.returnValues,
        ...metadata.inPorts,
        ...metadata.outPorts,
        ...metadata.arguments.flatMap((setting: Argument): Array<unknown> => {
          return [
            ...(setting.shownWhen ? [setting.shownWhen] : []),
            ...(setting.choices || []),
          ];
        }),
      ]) {
        expect(seen.has(item)).toBe(false);
        seen.add(item);
      }
    }

    expect(seen.size).toBeGreaterThan(60);
  });
});

describe("who to page: the first setting of each step", () => {
  test.each([
    [
      ComponentID.PageUsers,
      "users",
      "Users",
      ComponentInputType.UserList,
      PageTargetKind.User,
    ],
    [
      ComponentID.PageTeam,
      "teams",
      "Teams",
      ComponentInputType.TeamList,
      PageTargetKind.Team,
    ],
    [
      ComponentID.PageOnCall,
      "on-call-schedules",
      "On-Call Schedules",
      ComponentInputType.OnCallScheduleList,
      PageTargetKind.OnCallSchedule,
    ],
    [
      ComponentID.PageOnCallPolicy,
      "on-call-policies",
      "On-Call Policies",
      ComponentInputType.OnCallPolicyList,
      PageTargetKind.OnCallPolicy,
    ],
  ])(
    "%s",
    (
      id: ComponentID,
      argumentId: string,
      name: string,
      type: ComponentInputType,
      kind: PageTargetKind,
    ) => {
      const first: Argument = step(id).arguments[0] as Argument;

      expect({
        id: first.id,
        name: first.name,
        type: first.type,
        required: first.required,
        isAdvanced: first.isAdvanced,
        shownWhen: first.shownWhen,
      }).toEqual({
        id: argumentId,
        name: name,
        type: type,
        required: true,
        isAdvanced: undefined,
        shownWhen: undefined,
      });

      expect(getPageStepTarget(id)).toEqual({
        argumentId: argumentId,
        kind: kind,
      });
      expect(getPageTargetKind(type)).toBe(kind);
      expect(isRecordListInputType(type)).toBe(true);
      expect(isPageStep(id)).toBe(true);
    },
  );

  test("each says its entries can come from a list or from an earlier step", () => {
    for (const id of PAGE_STEP_IDS) {
      const description: string = (step(id).arguments[0] as Argument)
        .description;

      expect(description).toMatch(/\bPick\b|\bpick\b/);
      expect(description).toContain("from an earlier step");
    }
  });

  test("only people can be named by email address", () => {
    expect(
      (step(ComponentID.PageUsers).arguments[0] as Argument).description,
    ).toContain("email address");

    for (const id of [
      ComponentID.PageTeam,
      ComponentID.PageOnCall,
      ComponentID.PageOnCallPolicy,
    ]) {
      expect((step(id).arguments[0] as Argument).description).not.toContain(
        "email",
      );
    }
  });

  test("a step that is not a Page step has no who-to-page setting", () => {
    for (const id of [
      ComponentID.Log,
      ComponentID.IfElse,
      "incident-on-create",
    ]) {
      expect(getPageStepTarget(id)).toBeNull();
      expect(isPageStep(id)).toBe(false);
    }

    expect(getPageStepTarget(undefined)).toBeNull();
    expect(getPageStepTarget(null)).toBeNull();
    expect(getPageTargetKind(ComponentInputType.Text)).toBeNull();
    expect(isRecordListInputType(ComponentInputType.Text)).toBe(false);
    expect(isRecordListInputType(ComponentInputType.WorkflowSelect)).toBe(
      false,
    );
  });
});

describe("what the page is about: the same settings on all four steps", () => {
  test("after who to page: the choice, then what goes with each choice", () => {
    for (const id of PAGE_STEP_IDS) {
      expect(
        step(id)
          .arguments.slice(1)
          .map(
            (
              setting: Argument,
            ): [string, string, ComponentInputType, boolean, boolean] => {
              return [
                setting.id,
                setting.name,
                setting.type,
                setting.required,
                Boolean(setting.isAdvanced),
              ];
            },
          ),
      ).toEqual([
        ["about", "Page About", ComponentInputType.Choice, false, false],
        ["title", "Title", ComponentInputType.Text, true, false],
        ["message", "Message", ComponentInputType.LongText, false, false],
        ["incident-id", "Incident ID", ComponentInputType.Text, true, false],
        ["alert-id", "Alert ID", ComponentInputType.Text, true, false],
        [
          "alert-severity",
          "Severity",
          ComponentInputType.AlertSeveritySelect,
          false,
          true,
        ],
      ]);
    }
  });

  test("Page About offers a new alert first, then an incident, then an alert", () => {
    for (const id of PAGE_STEP_IDS) {
      expect(
        (argument(step(id), "about").choices || []).map(
          (choice: ArgumentChoice): [string, string] => {
            return [choice.value, choice.label];
          },
        ),
      ).toEqual([
        ["new-alert", "A new alert"],
        ["incident", "An incident"],
        ["alert", "An alert"],
      ]);
    }
  });

  test("every choice says what choosing it means", () => {
    for (const choice of argument(step(ComponentID.PageUsers), "about")
      .choices || []) {
      expect((choice.description || "").length).toBeGreaterThan(20);
      expect((choice.description || "").endsWith(".")).toBe(true);
    }
  });

  test("the choices are the three things a page can be about", () => {
    expect(
      (argument(step(ComponentID.PageTeam), "about").choices || []).map(
        (choice: ArgumentChoice): string => {
          return choice.value;
        },
      ),
    ).toEqual(Object.values(PageAbout));
  });
});

describe("which settings are part of the step, by what the page is about", () => {
  const metadata: ComponentMetadata = step(ComponentID.PageUsers);

  function shown(about: unknown): Array<string> {
    const values: JSONObject = {};

    if (about !== undefined) {
      values[PAGE_ARGUMENT_IDS.about] = about as string;
    }

    return metadata.arguments
      .filter((setting: Argument): boolean => {
        return isArgumentShown(setting, values);
      })
      .map((setting: Argument): string => {
        return setting.name;
      });
  }

  function required(values: JSONObject): Array<string> {
    return metadata.arguments
      .filter((setting: Argument): boolean => {
        return isArgumentRequired(setting, values);
      })
      .map((setting: Argument): string => {
        return setting.name;
      });
  }

  test("a new alert: a title, a message and, folded, a severity", () => {
    expect(shown("new-alert")).toEqual([
      "Users",
      "Page About",
      "Title",
      "Message",
      "Severity",
    ]);
  });

  test("a step whose Page About was never touched is about a new alert", () => {
    for (const empty of [undefined, null, "", "  "]) {
      expect(shown(empty)).toEqual(shown("new-alert"));
    }
  });

  test("an incident: its ID, and nothing of a new alert", () => {
    expect(shown("incident")).toEqual(["Users", "Page About", "Incident ID"]);
  });

  test("an alert: its ID, and nothing of a new alert", () => {
    expect(shown("alert")).toEqual(["Users", "Page About", "Alert ID"]);
  });

  test("a Page About that is none of the choices shows none of them", () => {
    expect(shown("episode")).toEqual(["Users", "Page About"]);
    expect(shown(42)).toEqual(["Users", "Page About"]);
  });

  test("only what is shown is required", () => {
    expect(required({})).toEqual(["Users", "Title"]);
    expect(required({ about: "new-alert" })).toEqual(["Users", "Title"]);
    expect(required({ about: "incident" })).toEqual(["Users", "Incident ID"]);
    expect(required({ about: "alert" })).toEqual(["Users", "Alert ID"]);
  });

  test("a title left over from before the choice changed is not asked for", () => {
    expect(
      required({ about: "incident", title: "", "incident-id": "" }),
    ).toEqual(["Users", "Incident ID"]);
  });

  test("the same on every Page step", () => {
    for (const id of PAGE_STEP_IDS) {
      const who: string = (step(id).arguments[0] as Argument).name;

      expect(
        step(id)
          .arguments.filter((setting: Argument): boolean => {
            return isArgumentRequired(setting, { about: "alert" });
          })
          .map((setting: Argument): string => {
            return setting.name;
          }),
      ).toEqual([who, "Alert ID"]);
    }
  });
});

describe("a setting shown only while another says so", () => {
  const rule: Argument = {
    id: "detail",
    name: "Detail",
    description: "",
    type: ComponentInputType.Text,
    required: true,
    shownWhen: { argumentId: "kind", values: ["a", "b"] },
  };

  test("is shown for the values it names, and no others", () => {
    expect(isArgumentShown(rule, { kind: "a" })).toBe(true);
    expect(isArgumentShown(rule, { kind: "b" })).toBe(true);
    expect(isArgumentShown(rule, { kind: "c" })).toBe(false);
    expect(isArgumentShown(rule, { kind: " a " })).toBe(true);
  });

  test("is not shown while the other setting is empty, unless it says so", () => {
    expect(isArgumentShown(rule, {})).toBe(false);
    expect(isArgumentShown(rule, null)).toBe(false);
    expect(isArgumentShown(rule, undefined)).toBe(false);
    expect(isArgumentShown(rule, { kind: "" })).toBe(false);

    const withEmpty: Argument = {
      ...rule,
      shownWhen: { argumentId: "kind", values: ["a"], includesEmpty: true },
    };

    expect(isArgumentShown(withEmpty, {})).toBe(true);
    expect(isArgumentShown(withEmpty, { kind: "" })).toBe(true);
    expect(isArgumentShown(withEmpty, { kind: "  " })).toBe(true);
    expect(isArgumentShown(withEmpty, { kind: "b" })).toBe(false);
  });

  test("a setting with no such rule is always shown", () => {
    const plain: Argument = { ...rule };
    delete plain.shownWhen;

    expect(isArgumentShown(plain, {})).toBe(true);
    expect(isArgumentShown(plain, { kind: "c" })).toBe(true);
  });

  test("while it is not shown, it is not required", () => {
    expect(isArgumentRequired(rule, { kind: "a" })).toBe(true);
    expect(isArgumentRequired(rule, { kind: "c" })).toBe(false);
    expect(isArgumentRequired(rule, {})).toBe(false);
  });

  test("a rule that makes it unnecessary still applies while it is shown", () => {
    const both: Argument = {
      ...rule,
      notRequiredWhen: { argumentId: "other" },
    };

    expect(isArgumentRequired(both, { kind: "a" })).toBe(true);
    expect(isArgumentRequired(both, { kind: "a", other: "set" })).toBe(false);
    expect(isArgumentRequired(both, { kind: "c", other: "" })).toBe(false);
  });
});

describe("the choice a Choice setting holds", () => {
  const about: Argument = argument(step(ComponentID.PageUsers), "about");

  test("the one that is stored", () => {
    expect(getArgumentChoice(about, "incident")?.label).toBe("An incident");
    expect(getArgumentChoice(about, " alert ")?.label).toBe("An alert");
  });

  test("its first, while nothing is stored", () => {
    for (const empty of [undefined, null, "", "   "]) {
      expect(getArgumentChoice(about, empty)?.value).toBe("new-alert");
    }
  });

  test("none, for a value that is not one of its choices", () => {
    expect(getArgumentChoice(about, "episode")).toBeNull();
    expect(getArgumentChoice(about, 3)).toBeNull();
    expect(getArgumentChoice(about, ["incident"])).toBeNull();
  });

  test("none, for a setting that has no choices", () => {
    expect(
      getArgumentChoice(argument(step(ComponentID.PageUsers), "title"), ""),
    ).toBeNull();
  });
});

describe("what a Page step hands on", () => {
  test("the steps that page people: a summary, who was paged, the record and why not", () => {
    for (const id of DIRECT_STEP_IDS) {
      expect(
        step(id).returnValues.map(
          (value: ReturnValue): [string, string, ComponentInputType] => {
            return [value.id, value.name, value.type];
          },
        ),
      ).toEqual([
        ["summary", "Summary", ComponentInputType.Text],
        ["paged-users", "Paged Users", ComponentInputType.JSONArray],
        ["alert-id", "Alert ID", ComponentInputType.Text],
        ["incident-id", "Incident ID", ComponentInputType.Text],
        ["error", "Error", ComponentInputType.Text],
      ]);
    }
  });

  test("the policy step: no list of people, since its rules decide who", () => {
    expect(
      step(ComponentID.PageOnCallPolicy).returnValues.map(
        (value: ReturnValue): string => {
          return value.id;
        },
      ),
    ).toEqual(["summary", "alert-id", "incident-id", "error"]);
  });

  test("nothing it returns is sensitive, or required", () => {
    for (const metadata of OnCallComponents) {
      for (const value of metadata.returnValues) {
        expect(value.required).toBe(false);
        expect(value.isSensitive).toBeUndefined();
        expect(value.description.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("a Page step's outputs", () => {
  test("In, then Success and Error, on every step", () => {
    for (const metadata of OnCallComponents) {
      expect(
        metadata.inPorts.map((port: Port): [string, string] => {
          return [port.id, port.title];
        }),
      ).toEqual([["in", "In"]]);
      expect(
        metadata.outPorts.map((port: Port): [string, string] => {
          return [port.id, port.title];
        }),
      ).toEqual([
        ["success", "Success"],
        ["error", "Error"],
      ]);
    }
  });

  test("Success means somebody was paged; for a policy, that it started", () => {
    for (const id of DIRECT_STEP_IDS) {
      expect(step(id).outPorts[0]?.description).toBe(
        "Runs once at least one person is paged.",
      );
      expect(step(id).outPorts[1]?.description).toBe(
        "Runs when nobody was paged. Error says why.",
      );
    }

    expect(step(ComponentID.PageOnCallPolicy).outPorts[0]?.description).toBe(
      "Runs once at least one policy has started.",
    );
    expect(step(ComponentID.PageOnCallPolicy).outPorts[1]?.description).toBe(
      "Runs when no policy could be started. Error says why.",
    );
  });
});
