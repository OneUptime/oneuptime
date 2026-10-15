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
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import URL from "../../../Types/API/URL";

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

/*
 * The project's number prefixes, as GET
 * /workspace-notification-rule/number-prefixes answers them: the rule
 * form's channel name preview is built from them. Any other request the
 * table makes is refused, as the old tests never answered one.
 */
let numberPrefixesAnswer: JSONObject | "refuse" = {
  Incident: "INC-",
  Alert: "ALT-",
  "Incident Episode": "IE-",
  "Alert Episode": "AE-",
  "Scheduled Maintenance": "SM-",
};

const apiGets: Array<string> = [];

beforeEach(() => {
  apiGets.length = 0;

  jest.spyOn(API, "get").mockImplementation((async (options: {
    url: URL;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const route: string = new globalThis.URL(options.url.toString()).pathname;
    apiGets.push(route);

    if (
      route.endsWith("/workspace-notification-rule/number-prefixes") &&
      numberPrefixesAnswer !== "refuse"
    ) {
      return new HTTPResponse<JSONObject>(
        200,
        { numberPrefixes: numberPrefixesAnswer },
        {},
      );
    }

    // A Microsoft Teams rule's form lists the teams and chats it can use.
    if (route.endsWith("/microsoft-teams/teams")) {
      return new HTTPResponse<JSONObject>(
        200,
        { teams: [{ id: "team-ops", name: "Ops" }] },
        {},
      );
    }

    if (route.endsWith("/microsoft-teams/chats")) {
      return new HTTPResponse<JSONObject>(200, { chats: [] }, {});
    }

    return new HTTPErrorResponse(500, { message: "Not answered" }, {});
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The Channel Name Prefix field, found by its label: it has no placeholder.
async function prefixField(): Promise<HTMLElement> {
  return within(dialog()).findByRole("textbox", {
    name: /^Channel Name Prefix/,
  });
}

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
  workspaceType: WorkspaceType = WorkspaceType.Slack,
): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceNotificationRuleTable
        workspaceType={workspaceType}
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
      await prefixField(),
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
      await prefixField(),
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
      await prefixField(),
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
      await prefixField(),
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
      await prefixField(),
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

/*
 * THE NAME OF THE CHANNEL A RULE CREATES.
 *
 * The customer's question: a prefix of foo- names incident INC-123's channel
 * foo-inc-123 - can it be inc-123? The prefix is optional now: without one,
 * the channel is named after its record. The field says what it is for, and
 * the preview under it shows the name an example record's channel gets as
 * the prefix is typed - with the project's own number prefixes, which the
 * table reads from GET /workspace-notification-rule/number-prefixes.
 */
describe("Name the channel a rule creates", () => {
  const PREFIXES: JSONObject = {
    Incident: "INC-",
    Alert: "ALT-",
    "Incident Episode": "IE-",
    "Alert Episode": "AE-",
    "Scheduled Maintenance": "SM-",
  };

  beforeEach(() => {
    createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
    numberPrefixesAnswer = PREFIXES;
  });

  afterEach(() => {
    cleanup();
    numberPrefixesAnswer = PREFIXES;
  });

  async function toNewChannel(
    user: UserEvent,
    workspaceName: string = "Slack",
  ): Promise<void> {
    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: "Open a channel" },
    });
    await next(user);
    await waitForStep("Conditions");
    await within(dialog()).findByRole("button", { name: "Add Condition" });
    await settle();
    await next(user);
    await waitForStep("Destination");
    await settle();
    await user.click(
      await within(dialog()).findByRole("switch", {
        name: new RegExp(`^Create ${workspaceName} Channel`),
      }),
    );
    await prefixField();
    await settle();
  }

  async function typePrefix(prefix: string): Promise<void> {
    fireEvent.change(await prefixField(), { target: { value: prefix } });
    await settle();
  }

  function preview(): string {
    return within(dialog()).getByTestId("channel-name-preview").textContent || "";
  }

  function previewNotes(): string {
    return (
      within(dialog()).getByTestId("channel-name-preview-notes").textContent ||
      ""
    );
  }

  test("the prefix is optional, and the preview shows the channel named after the incident", async () => {
    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);

    expect(await prefixField()).toHaveValue("");
    expect(await prefixField()).toHaveAccessibleName(
      "Channel Name Prefix (Optional)",
    );
    expect(
      within(dialog()).getByText(
        "Each new channel is named after its incident. Anything you write here goes in front of that name.",
      ),
    ).toBeVisible();

    expect(preview()).toBe("#inc-42");
    expect(previewNotes()).toBe(
      "For incident INC-42. If Slack already has a channel with this name, OneUptime adds -2 to the end.",
    );
  });

  test("creates the rule without a prefix: no channel name is required any more", async () => {
    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);
    await toVideoCall(user);

    expect(within(dialog()).queryByText(/channel name is required/)).toBe(
      null,
    );

    await submit(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const rule: JSONObject = createCall().model
      .notificationRule as unknown as JSONObject;

    expect(rule["shouldCreateNewChannel"]).toBe(true);
    expect(rule["newChannelTemplateName"] || "").toBe("");
  });

  test("the customer's foo- shows foo-inc-42, and is saved as typed", async () => {
    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);
    await typePrefix("foo-");

    expect(preview()).toBe("#foo-inc-42");

    await toVideoCall(user);
    await submit(user);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(
      (createCall().model.notificationRule as unknown as JSONObject)[
        "newChannelTemplateName"
      ],
    ).toBe("foo-");
  });

  test("the preview follows the prefix as it is typed, and cleared again", async () => {
    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);

    await typePrefix("prod-");
    expect(preview()).toBe("#prod-inc-42");

    await typePrefix("");
    expect(preview()).toBe("#inc-42");

    await typePrefix("   ");
    expect(preview()).toBe("#inc-42");
  });

  test("says what Slack does to capitals, spaces and symbols", async () => {
    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);
    await typePrefix("Prod Team #1-");

    expect(preview()).toBe("#prodteam1-inc-42");
    expect(previewNotes()).toContain(
      "Slack channel names use only lowercase letters, numbers, - and _.",
    );

    await typePrefix("prod-");
    expect(previewNotes()).not.toContain("lowercase letters");
  });

  test("says when a long prefix is shortened to Slack's 80 characters", async () => {
    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);
    await typePrefix("a".repeat(100));

    expect(preview()).toBe(`#${"a".repeat(74)}inc-42`);
    expect(previewNotes()).toContain(
      "Shortened to Slack's limit of 80 characters.",
    );
  });

  test("a project that writes its incidents #42: the channel is incident-42", async () => {
    numberPrefixesAnswer = {
      Incident: null,
      Alert: null,
      "Incident Episode": null,
      "Alert Episode": null,
      "Scheduled Maintenance": null,
    };

    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);

    expect(preview()).toBe("#incident-42");
    expect(previewNotes()).toContain("For incident #42.");
  });

  test("reads the project's number prefixes once, from the rule route", async () => {
    await renderForm(NotificationRuleEventType.Incident);

    expect(
      apiGets.filter((route: string): boolean => {
        return route.endsWith("/workspace-notification-rule/number-prefixes");
      }),
    ).toHaveLength(1);
  });

  test("without the project's number prefixes, the field works and nothing is guessed", async () => {
    numberPrefixesAnswer = "refuse";

    const user: UserEvent = await renderForm(NotificationRuleEventType.Incident);

    await toNewChannel(user);
    await typePrefix("ops-");

    expect(within(dialog()).queryByTestId("channel-name-preview")).toBe(null);
    expect(await prefixField()).toHaveValue("ops-");
  });

  test.each([
    [NotificationRuleEventType.Alert, "#alt-42", "For alert ALT-42."],
    [
      NotificationRuleEventType.IncidentEpisode,
      "#ie-42",
      "For incident episode IE-42.",
    ],
    [
      NotificationRuleEventType.AlertEpisode,
      "#ae-42",
      "For alert episode AE-42.",
    ],
    [
      NotificationRuleEventType.ScheduledMaintenance,
      "#sm-42",
      "For scheduled maintenance event SM-42.",
    ],
    [NotificationRuleEventType.Monitor, "#website", "For the monitor Website."],
  ])(
    "a %s rule previews %s",
    async (
      eventType: NotificationRuleEventType,
      name: string,
      note: string,
    ) => {
      const user: UserEvent = await renderForm(eventType);

      await toNewChannel(user);

      expect(preview()).toBe(name);
      expect(previewNotes()).toContain(note);
    },
  );

  test("Microsoft Teams: no # before the name, and its own words", async () => {
    const user: UserEvent = await renderForm(
      NotificationRuleEventType.Incident,
      WorkspaceType.MicrosoftTeams,
    );

    await toNewChannel(user, "Microsoft Teams");

    expect(preview()).toBe("inc-42");
    expect(previewNotes()).toBe(
      "For incident INC-42. If the team already has a channel with this name, OneUptime adds -2 to the end.",
    );

    await typePrefix("Prod Team #1-");

    // Teams keeps capitals and spaces, and leaves the # out.
    expect(preview()).toBe("Prod Team 1-inc-42");
    expect(previewNotes()).toContain(
      "OneUptime uses only letters, numbers, spaces, - and _ in Microsoft Teams channel names.",
    );

    await typePrefix("x".repeat(60));
    expect(preview()).toBe(`${"x".repeat(44)}inc-42`);
    expect(previewNotes()).toContain(
      "Shortened to the Microsoft Teams limit of 50 characters.",
    );
  });
});
