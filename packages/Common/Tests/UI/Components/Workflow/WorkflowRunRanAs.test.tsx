import "@testing-library/jest-dom";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import { createTranslator } from "../../../../Types/Translator";
import { WorkflowRunAs } from "../../../../Types/Workflow/WorkflowRunAs";
import User from "../../../../Models/DatabaseModels/User";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import {
  WORKFLOW_RUN_RAN_AS_SELECT,
  WorkflowRunRanAsNote,
  describeWorkflowRunRanAs,
  getWorkflowRunRanAs,
} from "../../../../UI/Components/Workflow/WorkflowRunRanAs";
import {
  buildWorkflowRunLogText,
  getWorkflowRunExportFromWorkflowLog,
} from "../../../../UI/Components/Workflow/WorkflowRunExport";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * EVERY RUN SAYS WHAT IT RAN AS (#9695): a run that ran as more than
 * Default says so in its window and at the head of a downloaded log, with
 * whose permissions; a run as Default, and one from before Run As, say
 * nothing new.
 */

const ENGLISH: ReturnType<typeof createTranslator> =
  createTranslator(undefined);

function runRow(data: {
  runAs?: WorkflowRunAs;
  roleName?: string;
  givenBy?: string;
}): WorkflowLog {
  const log: WorkflowLog = new WorkflowLog();
  log._id = "b1b1b1b1-0000-4000-8000-000000000001";
  log.logs = "Executing Component: manual-1";

  if (data.runAs) {
    log.runAs = data.runAs;
  }

  if (data.roleName) {
    log.runAsCustomRoleName = data.roleName;
  }

  if (data.givenBy) {
    const user: User = new User();
    user.name = new Name(data.givenBy);
    user.email = new Email("jane@example.com");
    log.runAsGivenByUser = user;
  }

  return log;
}

afterEach(() => {
  cleanup();
});

describe("what a run row says it ran as", () => {
  test("nothing for Default, and for a run from before Run As", () => {
    expect(getWorkflowRunRanAs(runRow({}))).toBeNull();
    expect(
      getWorkflowRunRanAs(runRow({ runAs: WorkflowRunAs.Default })),
    ).toBeNull();
  });

  test("Project Owner, with whose permissions", () => {
    expect(
      getWorkflowRunRanAs(
        runRow({ runAs: WorkflowRunAs.ProjectOwner, givenBy: "Jane Doe" }),
      ),
    ).toEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      roleName: null,
      givenBy: "Jane Doe",
    });
  });

  test("a custom role, by the name it had when the run started", () => {
    expect(
      getWorkflowRunRanAs(
        runRow({
          runAs: WorkflowRunAs.CustomRole,
          roleName: "Team Provisioner",
        }),
      ),
    ).toEqual({
      runAs: WorkflowRunAs.CustomRole,
      roleName: "Team Provisioner",
      givenBy: null,
    });
  });

  test("the run lists ask for what it ran as, and whose permissions: a person's or an API key's", () => {
    expect(Object.keys(WORKFLOW_RUN_RAN_AS_SELECT).sort()).toEqual([
      "runAs",
      "runAsCustomRoleName",
      "runAsGivenByApiKeyName",
      "runAsGivenByUser",
    ]);
  });

  test("an API key's permissions, by the key's name when the run started (#9765)", () => {
    const log: WorkflowLog = runRow({
      runAs: WorkflowRunAs.CustomRole,
      roleName: "Team Provisioner",
    });
    log.runAsGivenByApiKeyName = " Terraform ";

    expect(getWorkflowRunRanAs(log)).toEqual({
      runAs: WorkflowRunAs.CustomRole,
      roleName: "Team Provisioner",
      givenBy: "Terraform",
      isGivenByApiKey: true,
    });
  });
});

describe("the sentence", () => {
  test("names what it ran as and whose permissions", () => {
    expect(
      describeWorkflowRunRanAs(ENGLISH, {
        runAs: WorkflowRunAs.ProjectOwner,
        givenBy: "Jane Doe",
      }),
    ).toBe("Ran as Project Owner, with the permissions of Jane Doe.");
    expect(
      describeWorkflowRunRanAs(ENGLISH, { runAs: WorkflowRunAs.ProjectOwner }),
    ).toBe("Ran as Project Owner.");
    expect(
      describeWorkflowRunRanAs(ENGLISH, {
        runAs: WorkflowRunAs.CustomRole,
        roleName: "Team Provisioner",
        givenBy: "Jane Doe",
      }),
    ).toBe(
      'Ran as the custom role "Team Provisioner", with the permissions of Jane Doe.',
    );
  });

  test("names an API key as one (#9765)", () => {
    expect(
      describeWorkflowRunRanAs(ENGLISH, {
        runAs: WorkflowRunAs.ProjectOwner,
        givenBy: "Terraform",
        isGivenByApiKey: true,
      }),
    ).toBe(
      'Ran as Project Owner, with the permissions of the API key "Terraform".',
    );
    expect(
      describeWorkflowRunRanAs(ENGLISH, {
        runAs: WorkflowRunAs.CustomRole,
        roleName: "Team Provisioner",
        givenBy: "Terraform",
        isGivenByApiKey: true,
      }),
    ).toBe(
      'Ran as the custom role "Team Provisioner", with the permissions of the API key "Terraform".',
    );
  });

  test("Default, as the audit log says it (#9766)", () => {
    expect(
      describeWorkflowRunRanAs(ENGLISH, { runAs: WorkflowRunAs.Default }),
    ).toBe("Ran with the default permissions.");
  });

  test("the run's window draws it as a note", () => {
    render(
      <WorkflowRunRanAsNote
        ranAs={{ runAs: WorkflowRunAs.ProjectOwner, givenBy: "Jane Doe" }}
      />,
    );

    expect(screen.getByTestId("workflow-run-ran-as")).toHaveTextContent(
      "Ran as Project Owner, with the permissions of Jane Doe.",
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});

describe("a downloaded log", () => {
  test("of a raised run says what it ran as in its heading", () => {
    const text: string = buildWorkflowRunLogText(
      getWorkflowRunExportFromWorkflowLog(
        runRow({ runAs: WorkflowRunAs.ProjectOwner, givenBy: "Jane Doe" }),
      ),
    );

    expect(text).toContain(
      "Ran as: Ran as Project Owner, with the permissions of Jane Doe.",
    );
  });

  test("of a run an API key gave its permissions to names the key", () => {
    const log: WorkflowLog = runRow({ runAs: WorkflowRunAs.ProjectOwner });
    log.runAsGivenByApiKeyName = "Terraform";

    expect(
      buildWorkflowRunLogText(getWorkflowRunExportFromWorkflowLog(log)),
    ).toContain(
      'Ran as: Ran as Project Owner, with the permissions of the API key "Terraform".',
    );
  });

  test("of a Default run says nothing new", () => {
    const text: string = buildWorkflowRunLogText(
      getWorkflowRunExportFromWorkflowLog(
        runRow({ runAs: WorkflowRunAs.Default }),
      ),
    );

    expect(text).not.toContain("Ran as");
  });
});
