import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * The compliance rule form through the REAL ModelForm, from loading a saved
 * rule to the body of the update it sends - the path an unwanted channel
 * survived: edit "Call for incidents", click a method card, go back to
 * "Incident on-call rules" (the channel now reads "Any channel"), save. The
 * form cleared the channel to undefined, the request body drops undefined
 * keys, and the server kept the stored Call. ComplianceRuleForm.test.tsx
 * covers the form's configuration with ModelFormModal stubbed out; this file
 * stubs nothing of the form, only the network and the signed-in user.
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

// The saved rule the form edits: Call for incidents, every severity.
const savedCallRule: () => TeamComplianceSetting =
  (): TeamComplianceSetting => {
    return BaseModel.fromJSON(
      {
        _id: CALL_RULE_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [],
        alertSeverities: [],
        enabled: true,
        teamId: TEAM_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
      TeamComplianceSetting,
    ) as TeamComplianceSetting;
  };

let createOrUpdate: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(savedCallRule() as never);
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

// The body ModelAPI.createOrUpdate puts on the wire for the model it is given.
const sentBody: () => JSONObject = (): JSONObject => {
  expect(createOrUpdate).toHaveBeenCalledTimes(1);

  const call: { model: TeamComplianceSetting; formType: FormType } =
    createOrUpdate.mock.calls[0]![0];

  expect(call.formType).toBe(FormType.Update);

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
    render(
      <ModelForm<TeamComplianceSetting>
        modelType={TeamComplianceSetting}
        id="team-compliance-rule-form"
        name="Teams > Compliance > Edit Rule"
        formType={FormType.Update}
        modelIdToEdit={new ObjectID(CALL_RULE_ID)}
        fields={getComplianceRuleFormFields()}
        steps={COMPLIANCE_RULE_FORM_STEPS}
        submitButtonText="Save rule"
        onSuccess={() => {
          // The page re-reads the status; nothing to do here.
        }}
      />,
    );

    // The saved rule loads as on-call, with its channel.
    await waitFor(() => {
      expect(
        screen.getByTestId(
          `card-select-option-${ComplianceRuleType.HasIncidentOnCallRules}`,
        ),
      ).toHaveAttribute("aria-checked", "true");
    });

    // A method card, then back to incident on-call rules.
    await chooseCard(ComplianceRuleType.HasNotificationCallMethod);
    await chooseCard(ComplianceRuleType.HasIncidentOnCallRules);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    // What the admin is shown: any channel.
    expect(
      await screen.findByTestId("compliance-rule-preview-title"),
    ).toHaveTextContent("Incident on-call rules");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    });

    await waitFor(() => {
      expect(createOrUpdate).toHaveBeenCalledTimes(1);
    });

    const body: JSONObject = sentBody();

    expect(body["_id"]).toBe(CALL_RULE_ID);
    expect(body["ruleType"]).toBe(ComplianceRuleType.HasIncidentOnCallRules);
    // Sent, and sent empty - so the server drops the stored Call.
    expect(Object.keys(body)).toContain("notificationChannel");
    expect(body["notificationChannel"]).toBeNull();
  });

  test("a channel nobody touched is sent as it was", async () => {
    render(
      <ModelForm<TeamComplianceSetting>
        modelType={TeamComplianceSetting}
        id="team-compliance-rule-form"
        name="Teams > Compliance > Edit Rule"
        formType={FormType.Update}
        modelIdToEdit={new ObjectID(CALL_RULE_ID)}
        fields={getComplianceRuleFormFields()}
        steps={COMPLIANCE_RULE_FORM_STEPS}
        submitButtonText="Save rule"
        onSuccess={() => {
          // The page re-reads the status; nothing to do here.
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `card-select-option-${ComplianceRuleType.HasIncidentOnCallRules}`,
        ),
      ).toHaveAttribute("aria-checked", "true");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    expect(
      await screen.findByTestId("compliance-rule-preview-title"),
    ).toHaveTextContent("Call for incidents");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    });

    await waitFor(() => {
      expect(createOrUpdate).toHaveBeenCalledTimes(1);
    });

    expect(sentBody()["notificationChannel"]).toBe(
      ComplianceNotificationChannel.Call,
    );
  });
});
