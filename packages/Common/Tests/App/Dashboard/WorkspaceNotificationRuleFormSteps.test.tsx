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
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A workspace notification rule's create form, walked in a browser-like DOM.
 *
 * Its Rules step asked when the rule fires and where it posts on one page:
 * the Any/All switch and the conditions, then the existing-channel, chat and
 * new-channel switches, each opening its own options - a dozen fields at
 * once. It now asks the two on separate steps, Conditions then Destination,
 * and each step checks its own half. Both halves still edit the one
 * notificationRule the rule is saved with.
 *
 * A rule for incidents or alerts has one more step, Video Call: whether the
 * rule starts a call for the event, and where. It edits the same
 * notificationRule, and it is the last step, so the rule is created from it.
 *
 * The production table builds the form; only the table around it is
 * replaced, by the create modal the real table opens (the same
 * ModelFormModal, ModelForm and BasicForm). Transport, permissions and the
 * project are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (
      props: ModelTableProps<WorkspaceNotificationRule>,
    ): ReactElement => {
      // What the real table opens from its Create button.
      return (
        <ModelFormModal<WorkspaceNotificationRule>
          title="Create Notification Rule"
          name="Settings > Create Notification Rule"
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText="Create Notification Rule"
          onClose={() => {}}
          onSuccess={() => {}}
          onBeforeCreate={props.onBeforeCreate}
          formProps={{
            id: "create-WorkspaceNotificationRule-from",
            name: "create-WorkspaceNotificationRule-from",
            modelType: props.modelType,
            fields: props.formFields || [],
            steps: props.formSteps || [],
            formType: FormType.Create,
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import WorkspaceNotificationRuleTable from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceNotificationRulesTable";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

const NAME_PLACEHOLDER: string = "Notify DevOps Team";
const SUBMIT_LABEL: string = "Create Notification Rule";

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create Notification Rule" });
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function stepTitles(): Array<string> {
  return Array.from(progress().querySelectorAll("li")).map(
    (item: Element): string => {
      return item.textContent || "";
    },
  );
}

function switchNamed(name: RegExp): HTMLElement {
  return within(dialog()).getByRole("switch", { name });
}

async function waitForStep(title: string): Promise<void> {
  await waitFor(() => {
    expect(activeStep()).toBe(title);
  });
}

async function next(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: "Next" }),
  );
}

async function submit(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: SUBMIT_LABEL }),
  );
}

async function renderForm(
  eventType: NotificationRuleEventType,
): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceNotificationRuleTable
        workspaceType={WorkspaceType.Slack}
        eventType={eventType}
      />,
    );
  });

  await screen.findByPlaceholderText(NAME_PLACEHOLDER, {}, { timeout: 10000 });

  return userEvent.setup({ delay: null });
}

/*
 * Each half of the rule is a BasicForm of its own, and BasicForm hands a
 * change up only once its initial values have settled - in an effect that
 * runs after its fields are drawn. A click that lands between the two is
 * kept by the half and never reaches the rule. A person cannot click that
 * fast; a test on a loaded CI runner can, so it lets the effects run first.
 */
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  });
}

/*
 * Each half is a form of its own inside the step, and fills in its fields a
 * tick after the step opens, so arriving waits for its first control.
 */
async function toConditions(user: UserEvent): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
    target: { value: "Page the database team" },
  });
  await next(user);
  await waitForStep("Conditions");
  await within(dialog()).findByRole("button", { name: "Add Condition" });
  await settle();
}

async function toDestination(user: UserEvent): Promise<void> {
  await toConditions(user);
  await next(user);
  await waitForStep("Destination");
  await within(dialog()).findByRole("switch", {
    name: /^Post to Existing Slack Channel/,
  });
  await settle();
}

// On from the Destination step, which checks the destination on the way.
async function toVideoCall(user: UserEvent): Promise<void> {
  await next(user);
  await waitForStep("Video Call");
  await within(dialog()).findByRole("switch", {
    name: /^Start a video call for the/,
  });
  await settle();
}

type CreateCall = {
  model: WorkspaceNotificationRule;
  miscDataProps?: JSONObject | undefined;
};

function createCall(): CreateCall {
  return createOrUpdateMock.mock.calls[0]?.[0] as CreateCall;
}

describe("Create a Slack notification rule for incidents", () => {
  beforeEach(() => {
    createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  test("walks Basic, Conditions, Destination, then Video Call", async () => {
    await renderForm(NotificationRuleEventType.Incident);

    expect(stepTitles()).toEqual([
      "Basic",
      "Conditions",
      "Destination",
      "Video Call",
    ]);
    expect(activeStep()).toBe("Basic");
  });

  test("asks only when the rule fires on the Conditions step", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toConditions(user);

    expect(
      within(dialog()).getByText("Notify Slack on Incident when..."),
    ).toBeVisible();
    expect(
      within(dialog()).getByRole("button", { name: "Add Condition" }),
    ).toBeVisible();
    // No conditions yet: nothing to combine, so no All / Any.
    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);
    expect(
      within(dialog()).queryByRole("switch", {
        name: /^Post to Existing Slack Channel/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("switch", { name: /^Create Slack Channel/ }),
    ).not.toBeInTheDocument();
  });

  // No conditions is a rule for every incident, not a missing answer.
  test("can leave the Conditions step without any condition", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toConditions(user);
    await next(user);

    await waitForStep("Destination");
    expect(within(dialog()).queryAllByRole("alert")).toHaveLength(0);
  });

  test("does not leave the Conditions step with a condition left half-written", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toConditions(user);
    await user.click(
      within(dialog()).getByRole("button", { name: "Add Condition" }),
    );
    await next(user);

    expect(
      await within(dialog()).findByText(/^Value is required for /),
    ).toBeVisible();
    expect(activeStep()).toBe("Conditions");
  });

  test("asks only where the rule posts on the Destination step", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toDestination(user);

    expect(within(dialog()).getByText("Then, in Slack...")).toBeVisible();
    expect(switchNamed(/^Post to Existing Slack Channel/)).toBeVisible();
    expect(switchNamed(/^Create Slack Channel/)).toBeVisible();
    expect(
      within(dialog()).queryByRole("button", { name: "Add Condition" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("radio", { name: "Any" }),
    ).not.toBeInTheDocument();

    // Not the last step: the rule is created from the Video Call step.
    expect(
      await within(dialog()).findByRole("button", { name: "Next" }),
    ).toBeVisible();
    expect(
      within(dialog()).queryByRole("button", { name: SUBMIT_LABEL }),
    ).not.toBeInTheDocument();
  });

  // Not on arrival - only once the person tries to create the rule.
  test("asks for a destination before creating the rule, without nagging on arrival", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toDestination(user);

    expect(within(dialog()).queryAllByRole("alert")).toHaveLength(0);

    await next(user);

    expect(
      await within(dialog()).findByText(
        "Please select a destination: create a Slack channel or post to an existing Slack channel",
      ),
    ).toBeVisible();
    expect(activeStep()).toBe("Destination");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("asks for the channel name of an existing channel", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toDestination(user);
    await user.click(switchNamed(/^Post to Existing Slack Channel/));
    await next(user);

    expect(
      await within(dialog()).findByText(
        "Existing Slack channel name is required",
      ),
    ).toBeVisible();
    expect(activeStep()).toBe("Destination");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("creates the rule with both halves in one notificationRule, and nothing else sent", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toDestination(user);
    await user.click(switchNamed(/^Post to Existing Slack Channel/));
    fireEvent.change(
      await within(dialog()).findByPlaceholderText(
        "#channel-name, #general, etc.",
      ),
      { target: { value: "#incidents" } },
    );
    await settle();
    await toVideoCall(user);
    await submit(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const call: CreateCall = createCall();
    const rule: JSONObject = call.model
      .notificationRule as unknown as JSONObject;

    expect(call.model.name).toBe("Page the database team");
    expect(call.model.eventType).toBe(NotificationRuleEventType.Incident);
    expect(call.model.workspaceType).toBe(WorkspaceType.Slack);
    expect(rule["shouldPostToExistingChannel"]).toBe(true);
    expect(rule["existingChannelNames"]).toBe("#incidents");
    /*
     * What the Conditions step held: no conditions - and All, which a new
     * rule starts on, kept although the step never asked.
     */
    expect(rule["filterCondition"]).toBe(FilterCondition.All);
    expect(rule["filters"]).toEqual([]);
    // A call is only started by a rule that asks for one.
    expect(rule["shouldStartVideoCall"]).toBeUndefined();
    // The Destination and Video Call steps' own keys are form-only: never sent.
    expect(call.miscDataProps).toEqual({});
  });

  /*
   * All or Any is asked only once there are two conditions to combine, under
   * them; a rule with fewer is created with All, which it never asked.
   */
  test("asks All or Any only once there are two conditions, and creates the rule with the one picked", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toConditions(user);

    await user.click(
      within(dialog()).getByRole("button", { name: "Add Condition" }),
    );
    await settle();
    fireEvent.change(within(dialog()).getAllByRole("textbox")[0]!, {
      target: { value: "database" },
    });
    await settle();

    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);

    await user.click(
      within(dialog()).getByRole("button", { name: "Add Condition" }),
    );
    await settle();
    fireEvent.change(within(dialog()).getAllByRole("textbox")[1]!, {
      target: { value: "postgres" },
    });
    await settle();

    const all: HTMLElement = await within(dialog()).findByRole("radio", {
      name: "All",
    });
    expect(all).toBeChecked();

    await user.click(within(dialog()).getByRole("radio", { name: "Any" }));
    await settle();

    await next(user);
    await waitForStep("Destination");
    await settle();
    await user.click(switchNamed(/^Create Slack Channel/));
    fireEvent.change(
      await within(dialog()).findByPlaceholderText("oneuptime-incident-"),
      { target: { value: "oneuptime-incident-" } },
    );
    await settle();
    await toVideoCall(user);
    await submit(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const rule: JSONObject = createCall().model
      .notificationRule as unknown as JSONObject;

    expect(rule["filterCondition"]).toBe(FilterCondition.Any);
    expect(
      (rule["filters"] as Array<JSONObject>).map(
        (filter: JSONObject): unknown => {
          return filter["value"];
        },
      ),
    ).toEqual(["database", "postgres"]);
  });

  test("creates a rule with one condition with All, which it never asked", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toConditions(user);

    await user.click(
      within(dialog()).getByRole("button", { name: "Add Condition" }),
    );
    await settle();
    fireEvent.change(within(dialog()).getAllByRole("textbox")[0]!, {
      target: { value: "database" },
    });
    await settle();

    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);

    await next(user);
    await waitForStep("Destination");
    await settle();
    await user.click(switchNamed(/^Create Slack Channel/));
    fireEvent.change(
      await within(dialog()).findByPlaceholderText("oneuptime-incident-"),
      { target: { value: "oneuptime-incident-" } },
    );
    await settle();
    await toVideoCall(user);
    await submit(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const rule: JSONObject = createCall().model
      .notificationRule as unknown as JSONObject;

    expect(rule["filterCondition"]).toBe(FilterCondition.All);
    expect(rule["filters"]).toEqual([
      expect.objectContaining({ value: "database" }),
    ]);
  });

  test("asks on the Video Call step whether the rule starts a call, off to begin with", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toDestination(user);
    await user.click(switchNamed(/^Create Slack Channel/));
    fireEvent.change(
      await within(dialog()).findByPlaceholderText("oneuptime-incident-"),
      { target: { value: "oneuptime-incident-" } },
    );
    await settle();
    await toVideoCall(user);

    expect(switchNamed(/^Start a video call for the incident/)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // Nothing to pick until the call is on.
    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);
    // The last step: its button creates the rule.
    expect(
      within(dialog()).getByRole("button", { name: SUBMIT_LABEL }),
    ).toBeVisible();
  });

  test("creates a rule that starts the huddle of the channel it creates", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toDestination(user);
    await user.click(switchNamed(/^Create Slack Channel/));
    fireEvent.change(
      await within(dialog()).findByPlaceholderText("oneuptime-incident-"),
      { target: { value: "oneuptime-incident-" } },
    );
    await settle();
    await toVideoCall(user);

    await user.click(switchNamed(/^Start a video call for the incident/));
    await settle();

    // With no connections yet, the channel's huddle is the one place, and is picked.
    const huddle: HTMLElement = await within(dialog()).findByRole("radio", {
      name: /Slack huddle/,
    });

    expect(huddle).toHaveAttribute("aria-checked", "true");
    expect(
      within(dialog()).getByRole("link", { name: /Connect a provider/ }),
    ).toBeVisible();

    await submit(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const call: CreateCall = createCall();
    const rule: JSONObject = call.model
      .notificationRule as unknown as JSONObject;

    expect(rule["shouldStartVideoCall"]).toBe(true);
    expect(rule["videoCallSource"]).toBe("SlackHuddle");
    // The rest of the rule is what the other steps chose.
    expect(rule["shouldCreateNewChannel"]).toBe(true);
    expect(rule["newChannelTemplateName"]).toBe("oneuptime-incident-");
    expect(call.miscDataProps).toEqual({});
  });

  test("keeps what the Destination step chose when going back to Conditions and on again", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
    );

    await toDestination(user);
    await user.click(switchNamed(/^Create Slack Channel/));
    await waitFor(() => {
      expect(switchNamed(/^Create Slack Channel/)).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    await user.click(within(progress()).getByText("Conditions"));
    await waitForStep("Conditions");
    await next(user);
    await waitForStep("Destination");

    expect(
      await within(dialog()).findByRole("switch", {
        name: /^Create Slack Channel/,
      }),
    ).toHaveAttribute("aria-checked", "true");
    // And its own options with it.
    expect(
      await within(dialog()).findByPlaceholderText("oneuptime-incident-"),
    ).toBeVisible();
  });
});

describe("Create a Slack notification rule for monitors", () => {
  beforeEach(() => {
    createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  // A monitor has no call of its own: no Video Call step.
  test("walks the same three steps, without a Video Call step", async () => {
    await renderForm(NotificationRuleEventType.Monitor);

    expect(stepTitles()).toEqual(["Basic", "Conditions", "Destination"]);
  });
});
