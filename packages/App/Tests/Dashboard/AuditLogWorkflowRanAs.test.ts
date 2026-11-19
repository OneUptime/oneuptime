import { describe, expect, test } from "@jest/globals";
import {
  AUDIT_LOG_WORKFLOW_RAN_AS_FILTER_OPTIONS,
  getAuditLogWorkflowRanAs,
} from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import ObjectID from "Common/Types/ObjectID";
import { WorkflowRunAs } from "Common/Types/Workflow/WorkflowRunAs";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * WHAT A WORKFLOW'S STEP RAN AS, READ FROM ITS AUDIT ENTRY (#9766). An
 * entry that recorded nothing - no workflow made it, or it was recorded
 * before entries said it - reads as nothing, never as Default, which it
 * may not have been. Default says no giver: none gave it anything.
 */

function entry(data: {
  workflowRunAs?: string;
  workflowRunAsCustomRoleName?: string;
  workflowRunAsGivenByName?: string;
  workflowRunAsGivenByApiKeyId?: ObjectID;
}): AuditLog {
  const row: AuditLog = new AuditLog();

  if (data.workflowRunAs !== undefined) {
    row.workflowRunAs = data.workflowRunAs;
  }
  if (data.workflowRunAsCustomRoleName !== undefined) {
    row.workflowRunAsCustomRoleName = data.workflowRunAsCustomRoleName;
  }
  if (data.workflowRunAsGivenByName !== undefined) {
    row.workflowRunAsGivenByName = data.workflowRunAsGivenByName;
  }
  if (data.workflowRunAsGivenByApiKeyId !== undefined) {
    row.workflowRunAsGivenByApiKeyId = data.workflowRunAsGivenByApiKeyId;
  }

  return row;
}

describe("what a workflow's change ran as", () => {
  test("nothing recorded reads as nothing", () => {
    expect(getAuditLogWorkflowRanAs(entry({}))).toBeNull();
  });

  test("a value it can't read reads as nothing, not as Default", () => {
    expect(
      getAuditLogWorkflowRanAs(entry({ workflowRunAs: "Root" })),
    ).toBeNull();
  });

  test("Default names no giver", () => {
    expect(
      getAuditLogWorkflowRanAs(
        entry({
          workflowRunAs: WorkflowRunAs.Default,
          workflowRunAsGivenByName: "Jane Doe",
        }),
      ),
    ).toEqual({ runAs: WorkflowRunAs.Default });
  });

  test("Project Owner, given by a person", () => {
    expect(
      getAuditLogWorkflowRanAs(
        entry({
          workflowRunAs: WorkflowRunAs.ProjectOwner,
          workflowRunAsGivenByName: "Jane Doe",
        }),
      ),
    ).toEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      roleName: null,
      givenBy: "Jane Doe",
      isGivenByApiKey: false,
    });
  });

  test("a custom role, given by an API key", () => {
    expect(
      getAuditLogWorkflowRanAs(
        entry({
          workflowRunAs: WorkflowRunAs.CustomRole,
          workflowRunAsCustomRoleName: "Incident Responder",
          workflowRunAsGivenByName: "Terraform",
          workflowRunAsGivenByApiKeyId: ObjectID.generate(),
        }),
      ),
    ).toEqual({
      runAs: WorkflowRunAs.CustomRole,
      roleName: "Incident Responder",
      givenBy: "Terraform",
      isGivenByApiKey: true,
    });
  });

  test("a giver with no name then is said without one", () => {
    expect(
      getAuditLogWorkflowRanAs(
        entry({ workflowRunAs: WorkflowRunAs.ProjectOwner }),
      ),
    ).toEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      roleName: null,
      givenBy: null,
      isGivenByApiKey: false,
    });
  });
});

describe("the Workflow Ran As filter", () => {
  test("offers each thing a step can run as, valued as entries store it", () => {
    expect(
      AUDIT_LOG_WORKFLOW_RAN_AS_FILTER_OPTIONS.map((option: DropdownOption) => {
        return [option.label, option.value];
      }),
    ).toEqual([
      ["Default", WorkflowRunAs.Default],
      ["Project Owner", WorkflowRunAs.ProjectOwner],
      ["Custom Role", WorkflowRunAs.CustomRole],
    ]);
  });
});
