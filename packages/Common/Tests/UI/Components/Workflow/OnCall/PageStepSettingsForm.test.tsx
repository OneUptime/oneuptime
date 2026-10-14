/*
 * A Page step's settings, as the person building the workflow fills them in:
 * who to page, what the page is about, and only the settings that go with
 * that answer.
 *
 *   Users             the people picker, with { } for a value from a step
 *   Page About        A new alert | An incident | An alert
 *   Title, Message    for a new alert
 *   Incident ID       for an incident
 *   Alert ID          for an alert
 *   More fields       Severity, for a new alert
 *
 * The form, its fields, the people picker, the value picker and the step's
 * own state are the real thing; only the API is stood in for. What must
 * hold:
 *
 *   - a new step asks for who to page and a title, and nothing about
 *     records it is not about;
 *   - choosing what the page is about swaps the settings under it, stores
 *     the choice, and keeps what was typed for the other answers;
 *   - only the settings on the form can stop the step from being saved;
 *   - who to page is stored as a list - ids, and values from earlier steps
 *     as their references - which is what the step reads when it runs;
 *   - the severity is one of the project's own, listed most severe first.
 */

// Utils.ts imports the database-model registry, which nothing here reads.
jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

/*
 * The project, as the API lists it to the person editing the workflow:
 * people through their team memberships, teams, on-call schedules, on-call
 * policies and alert severities (in the project's order: most severe
 * first). The workflow has no variables.
 */
jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const PEOPLE: Array<Record<string, unknown>> = [
    {
      user: {
        _id: "10000000-0000-4000-8000-000000000001",
        name: "Jane Doe",
        email: "jane@example.com",
      },
    },
    {
      user: {
        _id: "10000000-0000-4000-8000-000000000002",
        name: "John Roe",
        email: "john@example.com",
      },
    },
  ];

  const BY_TABLE: Record<string, Array<Record<string, unknown>>> = {
    TeamMember: PEOPLE,
    Team: [{ _id: "7eae0000-0000-4000-8000-000000000001", name: "Platform" }],
    OnCallDutyPolicySchedule: [
      { _id: "5c4e0000-0000-4000-8000-000000000001", name: "Primary" },
    ],
    OnCallDutyPolicy: [
      { _id: "dddddddd-0000-4000-8000-000000000001", name: "Critical" },
    ],
    AlertSeverity: [
      { _id: "5e000000-0000-4000-8000-0000000000c1", name: "Critical" },
      { _id: "5e000000-0000-4000-8000-0000000000c2", name: "High" },
      { _id: "5e000000-0000-4000-8000-0000000000c3", name: "Low" },
    ],
  };

  return {
    __esModule: true,
    default: {
      getList: jest.fn(
        async (args: {
          modelType: new () => unknown;
          query?: Record<string, unknown>;
        }) => {
          const tableName: string =
            (new args.modelType() as { tableName?: string }).tableName || "";

          let data: Array<Record<string, unknown>> = BY_TABLE[tableName] || [];

          // A lookup of picks by id: only the ones asked for.
          const wanted: unknown = (
            (args.query?.["userId"] || args.query?.["_id"]) as
              | { values?: Array<unknown> }
              | undefined
          )?.values;

          if (Array.isArray(wanted)) {
            const ids: Array<string> = wanted.map(String);

            data = data.filter((row: Record<string, unknown>): boolean => {
              const id: unknown =
                (row["user"] as Record<string, unknown> | undefined)?.["_id"] ||
                row["_id"];

              return ids.includes(String(id));
            });
          }

          return { data: data, count: data.length, skip: 0, limit: 10 };
        },
      ),
    },
  };
});

import ArgumentsForm from "../../../../../UI/Components/Workflow/ArgumentsForm";
import ModelAPI from "../../../../../UI/Utils/ModelAPI/ModelAPI";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import { PAGE_ARGUMENT_IDS } from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import { getNewPageStepArguments } from "../../../../../Types/Workflow/Components/OnCallPageNewStep";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import {
  chipsIn,
  editorValue,
  placeCaret,
} from "../ValuePicker/ValuePickerTestUtils";
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const JANE: string = "10000000-0000-4000-8000-000000000001";
const JOHN: string = "10000000-0000-4000-8000-000000000002";
const PLATFORM: string = "7eae0000-0000-4000-8000-000000000001";
const PRIMARY: string = "5c4e0000-0000-4000-8000-000000000001";
const CRITICAL_POLICY: string = "dddddddd-0000-4000-8000-000000000001";
const HIGH_SEVERITY: string = "5e000000-0000-4000-8000-0000000000c2";

const MANUAL_VALUE: string = "{{local.components.manual-1.returnValues.value}}";

function metadataOf(id: ComponentID): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
}

function step(
  id: ComponentID,
  args: JSONObject = {},
  stepId: string = `${id}-1`,
): NodeDataProp {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    error: "",
    id: stepId,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${stepId}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
}

const MANUAL: NodeDataProp = step(ComponentID.Manual, {}, "manual-1");

interface RenderedStep {
  user: UserEvent;
  onFormChange: MockFunction;
  onErrors: MockFunction;
}

// The step's settings, once its form is drawn (it waits for the severities).
async function renderStep(node: NodeDataProp): Promise<RenderedStep> {
  const onFormChange: MockFunction = getJestMockFunction();
  const onErrors: MockFunction = getJestMockFunction();

  render(
    <ArgumentsForm
      component={node}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      graphComponents={[MANUAL, node]}
      valueSources={{
        upstream: [MANUAL],
        downstreamIds: [],
        hasIncomingConnection: true,
      }}
      onHasFormValidationErrors={(errors: Dictionary<boolean>): void => {
        onErrors(errors);
      }}
      onFormChange={(value: NodeDataProp) => {
        onFormChange(value);
      }}
    />,
  );

  await waitFor(() => {
    expect(settingNames()).toContain("Page About");
  });

  /*
   * The form takes in the values it starts with in an effect that runs just
   * after it is drawn, and tells nobody of a change made before that. A
   * person cannot press anything that soon; a test can, so it waits a turn.
   */
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });

  return {
    user: userEvent.setup({ delay: null }),
    onFormChange: onFormChange,
    onErrors: onErrors,
  };
}

function lastArguments(onFormChange: MockFunction): JSONObject {
  const calls: Array<Array<unknown>> = onFormChange.mock.calls as Array<
    Array<unknown>
  >;

  return (calls[calls.length - 1]![0] as NodeDataProp).arguments;
}

// The names of the settings on the form, top to bottom, as their labels say them.
function settingNames(): Array<string> {
  return Array.from(document.querySelectorAll("label[id$='-label']"))
    .filter((label: Element): boolean => {
      // A folded "More fields" keeps its settings in the page, hidden.
      return !label.closest("[hidden]");
    })
    .map((label: Element): string => {
      return (label.textContent || "").replace("(Optional)", "").trim();
    });
}

function textbox(name: string): HTMLElement {
  return screen.getByRole("textbox", { name: new RegExp(`^${name}`) });
}

function choose(answer: string): void {
  fireEvent.click(screen.getByRole("radio", { name: answer }));
}

function moreFields(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^More fields/ });
}

async function pickFromPicker(
  user: UserEvent,
  addButton: string,
  name: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: addButton }));
  await user.click(await screen.findByText(name));
}

beforeEach(() => {
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/workflows`);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("a new Page Users step", () => {
  test("asks who to page, what about, and for a title and a message - nothing about records it is not about", async () => {
    await renderStep(step(ComponentID.PageUsers));

    expect(settingNames()).toEqual(["Users", "Page About", "Title", "Message"]);
    expect(screen.queryByRole("textbox", { name: /^Incident ID/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /^Alert ID/ })).toBeNull();
  });

  test("the page is about a new alert until somebody says otherwise", async () => {
    await renderStep(step(ComponentID.PageUsers));

    expect(screen.getByRole("radio", { name: "A new alert" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "An incident" }),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "An alert" })).not.toBeChecked();
  });

  test("Users is the people picker, with { } at the end of its row", async () => {
    await renderStep(step(ComponentID.PageUsers));

    const users: HTMLElement = screen.getByRole("group", { name: /^Users/ });

    expect(
      within(users).getByRole("button", { name: "Add user" }),
    ).toBeInTheDocument();
    expect(
      within(users).getByTestId("workflow-argument-users-insert-value"),
    ).toHaveAccessibleName("Add a value from an earlier step or a variable");
    // Not a box to type ids into.
    expect(within(users).queryByRole("textbox")).toBeNull();
  });

  test("Users and Title say they are required; Message says it is optional", async () => {
    await renderStep(step(ComponentID.PageUsers));

    expect(screen.getByText(/^Required\. Who to page\./)).toBeInTheDocument();
    expect(
      screen.getByText(/^Required\. What the page says, in a few words\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^Optional\. More about it: what happened/),
    ).toBeInTheDocument();
  });

  /*
   * The form's own "(Optional)" beside an optional setting's name said it a
   * second time: "Message (Optional)" over "Optional. More about it".
   */
  test("an optional setting says so once: in its help, not beside its name as well", async () => {
    await renderStep(step(ComponentID.PageUsers));

    fireEvent.click(moreFields()!);
    await screen.findByText(/^Optional\. How severe the new alert is\./);

    const labels: Array<Element> = Array.from(
      document.querySelectorAll("label"),
    );

    expect(labels.length).toBeGreaterThan(0);

    for (const label of labels) {
      expect(label.textContent || "").not.toContain("(Optional)");
    }

    // Named by its label alone, for whoever hears the form read out.
    expect(
      screen.getByRole("textbox", { name: "Message" }),
    ).toBeInTheDocument();
  });

  test("Page About says neither: an answer is always chosen", async () => {
    await renderStep(step(ComponentID.PageUsers));

    const help: HTMLElement = screen.getByText(/^What the page is about\./);

    expect(help.textContent).toBe(
      "What the page is about. The people paged are told this, and acknowledging the page acknowledges it.",
    );
    // Nor "(Optional)" beside its name.
    expect(
      screen.getByText("Page About", { selector: "label span" }).textContent,
    ).not.toContain("Optional");
  });

  test("Title is one line and Message a box that grows, each with the value picker", async () => {
    await renderStep(step(ComponentID.PageUsers));

    expect(textbox("Title")).toHaveAttribute("aria-multiline", "false");
    expect(textbox("Message")).toHaveAttribute("aria-multiline", "true");
    expect(
      screen.getByTestId("workflow-argument-title-insert-value"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-argument-message-insert-value"),
    ).toBeInTheDocument();
    expect(textbox("Title")).toHaveAttribute(
      "aria-placeholder",
      "Database CPU is above 90%",
    );
  });

  test("Severity is folded under More fields, which names it", async () => {
    await renderStep(step(ComponentID.PageUsers));

    const fold: HTMLElement = moreFields()!;

    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold).toHaveTextContent("Severity");
  });
});

describe("choosing what the page is about", () => {
  test("An incident: Incident ID takes the place of the title, the message and the severity", async () => {
    const { onFormChange } = await renderStep(step(ComponentID.PageUsers));

    choose("An incident");

    await waitFor(() => {
      expect(settingNames()).toEqual(["Users", "Page About", "Incident ID"]);
    });
    expect(moreFields()).toBeNull();
    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.about]).toBe(
        "incident",
      );
    });
    // Required, and it says so.
    await waitFor(() => {
      expect(
        screen.getByText(/^Required\. The incident to page about\./),
      ).toBeInTheDocument();
    });
    expect(textbox("Incident ID")).toHaveAttribute(
      "aria-placeholder",
      "Pick a value with { } or paste an ID",
    );
  });

  test("An alert: Alert ID instead", async () => {
    const { onFormChange } = await renderStep(step(ComponentID.PageUsers));

    choose("An alert");

    await waitFor(() => {
      expect(settingNames()).toEqual(["Users", "Page About", "Alert ID"]);
    });
    expect(moreFields()).toBeNull();
    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.about]).toBe(
        "alert",
      );
    });
    await waitFor(() => {
      expect(
        screen.getByText(/^Required\. The alert to page about\./),
      ).toBeInTheDocument();
    });
  });

  test("back to A new alert: the title and the message are back, with what was typed", async () => {
    const { user, onFormChange } = await renderStep(
      step(ComponentID.PageUsers),
    );

    placeCaret(textbox("Title"), 0);
    await user.keyboard("Database CPU is above 90%");

    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.title]).toBe(
        "Database CPU is above 90%",
      );
    });

    choose("An incident");

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: /^Title/ })).toBeNull();
    });

    // The title is kept while it is off the form: the step does not read it.
    expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.title]).toBe(
      "Database CPU is above 90%",
    );

    choose("A new alert");

    await waitFor(() => {
      expect(settingNames()).toEqual([
        "Users",
        "Page About",
        "Title",
        "Message",
      ]);
    });
    expect(editorValue(textbox("Title"))).toBe("Database CPU is above 90%");
    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.about]).toBe(
        "new-alert",
      );
    });
    expect(moreFields()).not.toBeNull();
  });

  test("the other answer's ID is kept too, should the choice be changed back", async () => {
    const { user, onFormChange } = await renderStep(
      step(ComponentID.PageUsers, { about: "incident" }),
    );

    placeCaret(textbox("Incident ID"), 0);
    await user.paste("3f000000-0000-4000-8000-000000000001");

    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.incidentId]).toBe(
        "3f000000-0000-4000-8000-000000000001",
      );
    });

    choose("An alert");

    await waitFor(() => {
      expect(settingNames()).toEqual(["Users", "Page About", "Alert ID"]);
    });

    choose("An incident");

    await waitFor(() => {
      expect(editorValue(textbox("Incident ID"))).toBe(
        "3f000000-0000-4000-8000-000000000001",
      );
    });
  });
});

describe("what stops the step from being saved", () => {
  test("a new step: nobody to page and no title", async () => {
    const { onErrors } = await renderStep(step(ComponentID.PageUsers));

    await waitFor(() => {
      expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });
    });
  });

  test("somebody picked and a title typed: nothing", async () => {
    const { user, onErrors, onFormChange } = await renderStep(
      step(ComponentID.PageUsers),
    );

    await pickFromPicker(user, "Add user", "Jane Doe");

    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.users]).toEqual([
        JANE,
      ]);
    });
    // Still no title.
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });

    placeCaret(textbox("Title"), 0);
    await user.keyboard("Database CPU is above 90%");

    await waitFor(() => {
      expect(onErrors).toHaveBeenLastCalledWith({ arguments: false });
    });
  });

  test("a page about an incident does not ask for a title: only the settings on the form count", async () => {
    const { onErrors } = await renderStep(
      step(ComponentID.PageUsers, {
        users: [JANE],
        about: "incident",
        "incident-id": MANUAL_VALUE,
      }),
    );

    expect(screen.queryByRole("textbox", { name: /^Title/ })).toBeNull();

    await waitFor(() => {
      expect(onErrors).toHaveBeenCalled();
    });
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: false });
  });

  test("a page about an incident with no Incident ID is stopped", async () => {
    const { onErrors } = await renderStep(
      step(ComponentID.PageUsers, {
        users: [JANE],
        about: "incident",
        // Filled in, and not read: this page is about an incident.
        title: "Database CPU is above 90%",
      }),
    );

    await waitFor(() => {
      expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });
    });
  });

  test("the last person taken out stops it again: an empty list is nobody", async () => {
    const { onErrors, onFormChange } = await renderStep(
      step(ComponentID.PageUsers, {
        users: [JANE],
        title: "Database CPU is above 90%",
      }),
    );

    await waitFor(() => {
      expect(onErrors).toHaveBeenLastCalledWith({ arguments: false });
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Jane Doe" }),
    );

    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.users]).toEqual([]);
    });
    await waitFor(() => {
      expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });
    });
  });

  test("a value from an earlier step counts as somebody: who it names is known when the step runs", async () => {
    const { onErrors } = await renderStep(
      step(ComponentID.PageUsers, {
        users: [MANUAL_VALUE],
        title: "Database CPU is above 90%",
      }),
    );

    await waitFor(() => {
      expect(onErrors).toHaveBeenCalled();
    });
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: false });
  });
});

describe("who to page", () => {
  test("the people picked are stored as a list of their ids, in the order picked", async () => {
    const { user, onFormChange } = await renderStep(
      step(ComponentID.PageUsers),
    );

    await pickFromPicker(user, "Add user", "John Roe");
    await user.click(await screen.findByText("Jane Doe"));

    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.users]).toEqual([
        JOHN,
        JANE,
      ]);
    });
  });

  test("ids the step holds are shown as the people they are", async () => {
    await renderStep(step(ComponentID.PageUsers, { users: [JANE, JOHN] }));

    const users: HTMLElement = screen.getByRole("group", { name: /^Users/ });

    expect(
      await within(users).findByRole("button", { name: "Remove Jane Doe" }),
    ).toBeInTheDocument();
    expect(
      within(users).getByRole("button", { name: "Remove John Roe" }),
    ).toBeInTheDocument();
  });

  test("a value picked with { } joins the list as its reference, beside the picks", async () => {
    const { user, onFormChange } = await renderStep(
      step(ComponentID.PageUsers, { users: [JANE] }),
    );

    await user.click(
      screen.getByTestId("workflow-argument-users-insert-value"),
    );

    const option: HTMLElement = await waitFor(() => {
      const found: HTMLElement | undefined = screen
        .getAllByRole("option")
        .find((candidate: HTMLElement): boolean => {
          return candidate.getAttribute("data-reference") === MANUAL_VALUE;
        });

      if (!found) {
        throw new Error("The trigger's value is not offered yet");
      }

      return found;
    });

    fireEvent.click(option);

    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.users]).toEqual([
        JANE,
        MANUAL_VALUE,
      ]);
    });

    // Named the way values are named in the Builder, not as the raw reference.
    const chip: HTMLElement = await screen.findByTestId(
      "workflow-argument-users-value-chip",
    );

    expect(chip).toHaveTextContent("Manual");
    expect(chip.textContent).not.toContain("{{local.components");
  });

  test.each<[ComponentID, string, string, string, string, string]>([
    [ComponentID.PageUsers, "Users", "Add user", "Jane Doe", "users", JANE],
    [ComponentID.PageTeam, "Teams", "Add team", "Platform", "teams", PLATFORM],
    [
      ComponentID.PageOnCall,
      "On-Call Schedules",
      "Add on-call schedule",
      "Primary",
      "on-call-schedules",
      PRIMARY,
    ],
    [
      ComponentID.PageOnCallPolicy,
      "On-Call Policies",
      "Add on-call policy",
      "Critical",
      "on-call-policies",
      CRITICAL_POLICY,
    ],
  ])(
    "%s: its %s is picked from that kind of record, and stored under its own setting",
    async (
      id: ComponentID,
      setting: string,
      addButton: string,
      record: string,
      argumentId: string,
      recordId: string,
    ) => {
      const { user, onFormChange } = await renderStep(step(id));

      // Every Page step asks the same things after who to page.
      expect(settingNames()).toEqual([
        setting,
        "Page About",
        "Title",
        "Message",
      ]);

      const who: HTMLElement = screen.getByRole("group", {
        name: new RegExp(`^${setting}`),
      });

      await user.click(within(who).getByRole("button", { name: addButton }));
      await user.click(await screen.findByText(record));

      await waitFor(() => {
        expect(lastArguments(onFormChange)[argumentId]).toEqual([recordId]);
      });
    },
  );
});

describe("the severity of a new alert", () => {
  test("is one of the project's own, listed in the project's order", async () => {
    const { user } = await renderStep(step(ComponentID.PageUsers));

    await user.click(moreFields()!);

    const severity: HTMLElement = await screen.findByRole("combobox", {
      name: /^Severity/,
    });

    fireEvent.keyDown(severity, { key: "ArrowDown", code: "ArrowDown" });

    const options: Array<string> = (await screen.findAllByRole("option")).map(
      (option: HTMLElement): string => {
        return option.textContent || "";
      },
    );

    expect(options).toEqual(["Critical", "High", "Low"]);

    // Asked of the API in the project's order, not the alphabet's.
    const request: JSONObject | undefined = (
      ModelAPI.getList as unknown as jest.Mock<(args: JSONObject) => unknown>
    ).mock.calls
      .map((call: Array<JSONObject>): JSONObject => {
        return call[0]!;
      })
      .find((args: JSONObject): boolean => {
        return (
          (
            new (args["modelType"] as unknown as new () => {
              tableName?: string;
            })() as { tableName?: string }
          ).tableName === "AlertSeverity"
        );
      });

    expect(request!["sort"]).toEqual({ order: SortOrder.Ascending });
  });

  test("the one picked is stored as its ID", async () => {
    const { user, onFormChange } = await renderStep(
      step(ComponentID.PageUsers),
    );

    await user.click(moreFields()!);

    const severity: HTMLElement = await screen.findByRole("combobox", {
      name: /^Severity/,
    });

    fireEvent.keyDown(severity, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("High"));

    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.alertSeverity]).toBe(
        HIGH_SEVERITY,
      );
    });
  });

  test("a step that has one shows it by name, and its fold says it is set", async () => {
    await renderStep(
      step(ComponentID.PageUsers, { "alert-severity": HIGH_SEVERITY }),
    );

    expect(
      within(moreFields()!).getByTestId("folded-section-item"),
    ).toHaveAttribute("data-item-set", "true");

    fireEvent.click(moreFields()!);

    expect(await screen.findByText("High")).toBeInTheDocument();
  });

  test("it is optional, and says what an empty one means", async () => {
    await renderStep(step(ComponentID.PageUsers));

    fireEvent.click(moreFields()!);

    expect(
      await screen.findByText(
        /^Optional\. How severe the new alert is\..*Left empty, it is the project's most severe\.$/,
      ),
    ).toBeInTheDocument();
  });

  test("an empty list says what it stands for, in the list itself", async () => {
    await renderStep(step(ComponentID.PageUsers));

    fireEvent.click(moreFields()!);

    // Where an empty box said nothing.
    expect(
      await screen.findByText("The project's most severe"),
    ).toBeInTheDocument();
  });

  test("a severity that is picked takes that line's place", async () => {
    await renderStep(
      step(ComponentID.PageUsers, { "alert-severity": HIGH_SEVERITY }),
    );

    fireEvent.click(moreFields()!);

    expect(await screen.findByText("High")).toBeInTheDocument();
    expect(screen.queryByText("The project's most severe")).toBeNull();
  });
});

describe("a step added to a workflow that starts on an incident", () => {
  test("opens as a page about that incident, its ID already the trigger's value", async () => {
    const trigger: NodeDataProp = {
      ...step(ComponentID.Manual, {}, "incident-on-create-1"),
      metadata: {
        ...metadataOf(ComponentID.Manual),
        id: "incident-on-create",
        title: "On Create Incident",
        tableName: "Incident",
        returnValues: [
          {
            id: "model",
            name: "Incident",
            description: "Incident created in the database",
            type: metadataOf(ComponentID.Manual).returnValues[0]!.type,
            required: false,
          },
        ],
      },
    };

    const started: JSONObject = getNewPageStepArguments({
      metadataId: ComponentID.PageOnCall,
      steps: [trigger],
    })!;

    await renderStep(step(ComponentID.PageOnCall, started));

    expect(screen.getByRole("radio", { name: "An incident" })).toBeChecked();
    expect(settingNames()).toEqual([
      "On-Call Schedules",
      "Page About",
      "Incident ID",
    ]);

    // One value, drawn as a chip - not the raw reference.
    const incidentId: HTMLElement = textbox("Incident ID");

    expect(chipsIn(incidentId)).toHaveLength(1);
    expect(editorValue(incidentId)).toBe(
      "{{local.components.incident-on-create-1.returnValues.model._id}}",
    );
  });
});

describe("a step whose Page About comes from an earlier step", () => {
  /*
   * Only a workflow written through the API can hold this: the form asks
   * the question as rows. What it comes to is known when the step runs, so
   * the form shows it as the value it is, with every setting that could go
   * with it - and stops nobody from saving for the ones left empty.
   */
  const FROM_STEP: JSONObject = {
    users: [JANE],
    about: "{{local.components.manual-1.returnValues.value}}",
  };

  test("is shown as that value, with the settings of all three answers on the form", async () => {
    await renderStep(step(ComponentID.PageUsers, FROM_STEP));

    expect(settingNames()).toEqual([
      "Users",
      "Page About",
      "Title",
      "Message",
      "Incident ID",
      "Alert ID",
    ]);
    expect(moreFields()).toHaveTextContent("Severity");

    // The value, as a chip in a text box - not rows with none chosen.
    expect(chipsIn(textbox("Page About"))).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("none of those settings is required: which one the step reads is known when it runs", async () => {
    const { onErrors } = await renderStep(
      step(ComponentID.PageUsers, FROM_STEP),
    );

    await waitFor(() => {
      expect(onErrors).toHaveBeenCalled();
    });
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: false });

    for (const help of [
      /^Optional\. What the page says, in a few words\./,
      /^Optional\. The incident to page about\./,
      /^Optional\. The alert to page about\./,
    ]) {
      expect(screen.getByText(help)).toBeInTheDocument();
    }
  });

  test("who to page is still required", async () => {
    const { onErrors } = await renderStep(
      step(ComponentID.PageUsers, { about: FROM_STEP["about"]! }),
    );

    await waitFor(() => {
      expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });
    });
  });
});

describe("a step whose Page About is none of the answers", () => {
  test("says what it holds, shows no setting that goes with an answer, and is put right by picking one", async () => {
    const { onFormChange } = await renderStep(
      step(ComponentID.PageUsers, { users: [JANE], about: "postmortem" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This is set to “postmortem”, which is not one of the choices. Pick one.",
    );
    expect(settingNames()).toEqual(["Users", "Page About"]);

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }

    choose("An alert");

    await waitFor(() => {
      expect(settingNames()).toEqual(["Users", "Page About", "Alert ID"]);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => {
      expect(lastArguments(onFormChange)[PAGE_ARGUMENT_IDS.about]).toBe(
        "alert",
      );
    });
  });

  test("written in another case, it is the answer it names", async () => {
    await renderStep(
      step(ComponentID.PageUsers, { users: [JANE], about: "Incident" }),
    );

    expect(screen.getByRole("radio", { name: "An incident" })).toBeChecked();
    expect(settingNames()).toEqual(["Users", "Page About", "Incident ID"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
