import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";

/*
 * The compliance rule form through the REAL ModelForm, from loading a saved
 * rule to the body of the update it sends - the path an unwanted channel
 * survived: edit "Call for incidents", click a method card, go back to
 * "Incident on-call rules" (the channels now read "Any channel"), save. The
 * form cleared the channel to undefined, the request body drops undefined
 * keys, and the server kept the stored Call. ComplianceRuleForm.test.tsx
 * covers the form's configuration with ModelFormModal stubbed out; this file
 * stubs nothing of the form, only the network and the signed-in user.
 *
 * The channels are a multi-select (react-select, driven here the way a
 * person drives it: open the menu, pick an option, or remove a picked
 * channel by its chip), and a rule on several channels needs a rule on
 * each - so what is picked, what the preview says and what is sent must
 * always be the same list.
 */

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectAdmin"] };
      },
    },
  };
});

import {
  COMPLIANCE_RULE_FORM_STEPS,
  getComplianceRuleFormFields,
} from "../../../Dashboard/TeamCompliance/ComplianceRuleForm";
import { CALL_RULE_ID, PROJECT_ID, TEAM_ID } from "./ComplianceFixtures";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * A saved incident rule for every severity, on the given channels, stored as
 * the settings service stores it: the list, and the deprecated single column
 * holding its first channel (which the form never reads).
 */
const savedRule: (
  channels: Array<ComplianceNotificationChannel>,
) => TeamComplianceSetting = (
  channels: Array<ComplianceNotificationChannel>,
): TeamComplianceSetting => {
  return BaseModel.fromJSON(
    {
      _id: CALL_RULE_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: channels,
      notificationChannel: channels[0] || null,
      incidentSeverities: [],
      alertSeverities: [],
      enabled: true,
      teamId: TEAM_ID.toString(),
      projectId: PROJECT_ID.toString(),
    },
    TeamComplianceSetting,
  ) as TeamComplianceSetting;
};

let getItem: jest.SpyInstance;
let createOrUpdate: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  getItem = jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(
      savedRule([ComplianceNotificationChannel.Call]) as never,
    );
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 50,
  } as never);
  createOrUpdate = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockResolvedValue({ data: {}, miscData: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const renderForm: (formType: FormType) => void = (formType: FormType): void => {
  render(
    <ModelForm<TeamComplianceSetting>
      modelType={TeamComplianceSetting}
      id="team-compliance-rule-form"
      name={
        formType === FormType.Update
          ? "Teams > Compliance > Edit Rule"
          : "Teams > Compliance > Add Rule"
      }
      formType={formType}
      modelIdToEdit={
        formType === FormType.Update ? new ObjectID(CALL_RULE_ID) : undefined
      }
      initialValues={
        formType === FormType.Create ? { enabled: true } : undefined
      }
      fields={getComplianceRuleFormFields()}
      steps={COMPLIANCE_RULE_FORM_STEPS}
      submitButtonText={formType === FormType.Update ? "Save rule" : "Add rule"}
      onSuccess={() => {
        // The page re-reads the status; nothing to do here.
      }}
    />,
  );
};

// Edits the saved rule, and waits for it to load as an incident rule.
const editSavedRule: () => Promise<void> = async (): Promise<void> => {
  renderForm(FormType.Update);

  await waitFor(() => {
    expect(
      screen.getByTestId(
        `card-select-option-${ComplianceRuleType.HasIncidentOnCallRules}`,
      ),
    ).toHaveAttribute("aria-checked", "true");
  });
};

const chooseCard: (ruleType: ComplianceRuleType) => Promise<void> = async (
  ruleType: ComplianceRuleType,
): Promise<void> => {
  const card: HTMLElement = await screen.findByTestId(
    `card-select-option-${ruleType}`,
  );

  await act(async () => {
    fireEvent.click(card);
  });
};

const goToScopeStep: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  });

  await screen.findByTestId("compliance-rule-preview-title");
};

const submit: (buttonText: string) => Promise<void> = async (
  buttonText: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: buttonText }));
  });

  await waitFor(() => {
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });
};

// The channels field's react-select input, found by the field's own label.
const channelsControl: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("combobox", { name: /^Channels/ });
};

// The react-select control around the channels input: its chips live here.
const channelsBox: () => HTMLElement = (): HTMLElement => {
  const box: HTMLElement | null = channelsControl().closest(
    ".ou-select__control",
  );

  if (!box) {
    throw new Error("No channels control");
  }

  return box;
};

// The channels picked, as the chips in the control show them.
const pickedChannelLabels: () => Array<string> = (): Array<string> => {
  return Array.from(
    channelsBox().querySelectorAll(".ou-select__multi-value__label"),
  ).map((chip: Element): string => {
    return chip.textContent || "";
  });
};

// Opens the channels menu and picks the option with this label.
const pickChannel: (label: string) => Promise<void> = async (
  label: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(channelsControl(), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
  });

  const menu: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | null =
      document.querySelector<HTMLElement>(".ou-select__menu");

    if (!found) {
      throw new Error("The channels menu did not open");
    }

    return found;
  });

  await act(async () => {
    fireEvent.click(within(menu).getByText(label));
  });
};

// Removes a picked channel with the remove button on its chip.
const removeChannel: (label: string) => Promise<void> = async (
  label: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(
      within(channelsBox()).getByRole("button", { name: `Remove ${label}` }),
    );
  });
};

const previewTitle: () => string = (): string => {
  return screen.getByTestId("compliance-rule-preview-title").textContent || "";
};

// The body ModelAPI.createOrUpdate puts on the wire for the model it is given.
const sentBody: (formType?: FormType) => JSONObject = (
  formType: FormType = FormType.Update,
): JSONObject => {
  expect(createOrUpdate).toHaveBeenCalledTimes(1);

  const call: { model: TeamComplianceSetting; formType: FormType } =
    createOrUpdate.mock.calls[0]![0];

  expect(call.formType).toBe(formType);

  return JSON.parse(
    JSON.stringify(
      JSONFunctions.serialize(
        BaseModel.toJSON(call.model, TeamComplianceSetting),
      ),
    ),
  ) as JSONObject;
};

describe("editing a rule through the real form", () => {
  test("a channel cleared by a detour through a method card is saved as cleared", async () => {
    await editSavedRule();

    // A method card, then back to incident on-call rules.
    await chooseCard(ComplianceRuleType.HasNotificationCallMethod);
    await chooseCard(ComplianceRuleType.HasIncidentOnCallRules);

    await goToScopeStep();

    // What the admin is shown: any channel.
    expect(previewTitle()).toBe("Incident on-call rules");
    expect(pickedChannelLabels()).toEqual([]);

    await submit("Save rule");

    const body: JSONObject = sentBody();

    expect(body["_id"]).toBe(CALL_RULE_ID);
    expect(body["ruleType"]).toBe(ComplianceRuleType.HasIncidentOnCallRules);
    // Sent, and sent empty - so the server drops the stored Call.
    expect(Object.keys(body)).toContain("notificationChannels");
    expect(body["notificationChannels"]).toEqual([]);
    // The deprecated single column is never sent: the list says it all.
    expect(Object.keys(body)).not.toContain("notificationChannel");
  });

  test("a channel nobody touched is sent as it was", async () => {
    await editSavedRule();
    await goToScopeStep();

    expect(previewTitle()).toBe("Call for incidents");
    expect(pickedChannelLabels()).toEqual(["Call"]);

    await submit("Save rule");

    const body: JSONObject = sentBody();

    expect(body["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Call,
    ]);
    expect(Object.keys(body)).not.toContain("notificationChannel");
  });

  test("the saved rule is read with its channel list, never the single column", async () => {
    await editSavedRule();

    const request: { select: Record<string, unknown> } = getItem.mock
      .calls[0]![0] as { select: Record<string, unknown> };

    expect(request.select["notificationChannels"]).toBe(true);
    expect(request.select["notificationChannel"]).toBeUndefined();
  });

  test("a rule saved on Call and Push opens with both picked", async () => {
    getItem.mockResolvedValue(
      savedRule([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]) as never,
    );

    await editSavedRule();
    await goToScopeStep();

    expect(pickedChannelLabels()).toEqual(["Call", "Push notification"]);
    expect(
      within(channelsBox()).getByRole("button", { name: "Remove Call" }),
    ).toBeInTheDocument();
    expect(
      within(channelsBox()).getByRole("button", {
        name: "Remove Push notification",
      }),
    ).toBeInTheDocument();
    expect(previewTitle()).toBe("Call and Push notification for incidents");
    expect(
      screen.getByTestId("compliance-rule-preview-sentence"),
    ).toHaveTextContent(
      "Every member has incident on-call rules that notify them by Call and by Push notification for every incident severity.",
    );
  });

  test("an untouched two-channel rule is sent back with both channels", async () => {
    getItem.mockResolvedValue(
      savedRule([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]) as never,
    );

    await editSavedRule();
    await goToScopeStep();
    await submit("Save rule");

    expect(sentBody()["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
  });

  test("a channel added in the dropdown joins the one already picked, and the preview follows", async () => {
    await editSavedRule();
    await goToScopeStep();

    expect(previewTitle()).toBe("Call for incidents");

    await pickChannel("Push notification");

    expect(pickedChannelLabels()).toEqual(["Call", "Push notification"]);
    // Live: the preview says what will be saved before anything is.
    expect(previewTitle()).toBe("Call and Push notification for incidents");
    expect(createOrUpdate).not.toHaveBeenCalled();

    await submit("Save rule");

    expect(sentBody()["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
  });

  test("a third channel can be added too", async () => {
    await editSavedRule();
    await goToScopeStep();

    await pickChannel("Push notification");
    await pickChannel("SMS");

    expect(pickedChannelLabels()).toEqual(["Call", "Push notification", "SMS"]);
    // The preview reads in catalog order, whatever order they were picked in.
    expect(previewTitle()).toBe(
      "Call, SMS and Push notification for incidents",
    );

    await submit("Save rule");

    expect(
      [...(sentBody()["notificationChannels"] as Array<string>)].sort(),
    ).toEqual(
      [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.SMS,
      ].sort(),
    );
  });

  test("a picked channel leaves the menu, so it cannot be picked twice", async () => {
    await editSavedRule();
    await goToScopeStep();

    await act(async () => {
      fireEvent.keyDown(channelsControl(), {
        key: "ArrowDown",
        code: "ArrowDown",
      });
    });

    const menu: HTMLElement = await waitFor((): HTMLElement => {
      const found: HTMLElement | null =
        document.querySelector<HTMLElement>(".ou-select__menu");

      if (!found) {
        throw new Error("The channels menu did not open");
      }

      return found;
    });

    expect(within(menu).queryByText("Call")).toBeNull();
    expect(within(menu).getByText("Push notification")).toBeInTheDocument();
    expect(within(menu).getByText("Microsoft Teams")).toBeInTheDocument();
  });

  test("a channel removed by its chip is saved without it", async () => {
    getItem.mockResolvedValue(
      savedRule([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]) as never,
    );

    await editSavedRule();
    await goToScopeStep();

    await removeChannel("Call");

    expect(pickedChannelLabels()).toEqual(["Push notification"]);
    expect(previewTitle()).toBe("Push notification for incidents");

    await submit("Save rule");

    expect(sentBody()["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Push,
    ]);
  });

  test("removing every channel saves the rule for any channel", async () => {
    getItem.mockResolvedValue(
      savedRule([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]) as never,
    );

    await editSavedRule();
    await goToScopeStep();

    await removeChannel("Call");
    await removeChannel("Push notification");

    expect(pickedChannelLabels()).toEqual([]);
    expect(previewTitle()).toBe("Incident on-call rules");

    await submit("Save rule");

    const body: JSONObject = sentBody();

    expect(Object.keys(body)).toContain("notificationChannels");
    expect(body["notificationChannels"]).toEqual([]);
  });
});

describe("adding a rule through the real form", () => {
  test("an on-call rule on two channels is created with both", async () => {
    renderForm(FormType.Create);

    await chooseCard(ComplianceRuleType.HasAlertOnCallRules);
    await goToScopeStep();

    // Nothing picked yet: any channel.
    expect(pickedChannelLabels()).toEqual([]);
    expect(previewTitle()).toBe("Alert on-call rules");

    await pickChannel("Call");
    await pickChannel("Push notification");

    expect(previewTitle()).toBe("Call and Push notification for alerts");

    await submit("Add rule");

    const body: JSONObject = sentBody(FormType.Create);

    expect(body["ruleType"]).toBe(ComplianceRuleType.HasAlertOnCallRules);
    expect(body["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(Object.keys(body)).not.toContain("notificationChannel");
  });

  test("a method rule shows no channels, and sends none", async () => {
    renderForm(FormType.Create);

    await chooseCard(ComplianceRuleType.HasNotificationSMSMethod);
    await goToScopeStep();

    expect(screen.queryByRole("combobox", { name: /^Channels/ })).toBeNull();
    expect(previewTitle()).toBe("Verified phone for SMS");

    await submit("Add rule");

    const body: JSONObject = sentBody(FormType.Create);

    expect(body["ruleType"]).toBe(ComplianceRuleType.HasNotificationSMSMethod);
    expect(body["notificationChannels"]).toEqual([]);
    expect(Object.keys(body)).not.toContain("notificationChannel");
  });

  test("channels picked for an on-call rule are dropped when a method card is chosen instead", async () => {
    renderForm(FormType.Create);

    await chooseCard(ComplianceRuleType.HasIncidentOnCallRules);
    await goToScopeStep();
    await pickChannel("Call");
    await pickChannel("SMS");

    expect(previewTitle()).toBe("Call and SMS for incidents");

    /*
     * Back to the first step - its entry in the progress list - and a
     * method card instead.
     */
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("navigation", { name: "Progress" })).getByText(
          "Rule",
        ),
      );
    });
    await chooseCard(ComplianceRuleType.HasNotificationPushMethod);
    await goToScopeStep();

    expect(previewTitle()).toBe("Verified push device");

    await submit("Add rule");

    expect(sentBody(FormType.Create)["notificationChannels"]).toEqual([]);
  });
});
