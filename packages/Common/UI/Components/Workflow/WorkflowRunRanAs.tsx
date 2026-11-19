import Select from "../../../Types/BaseDatabase/Select";
import {
  WorkflowRunAs,
  readWorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import User from "../../../Models/DatabaseModels/User";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A RUN RAN AS (#9695): every run records it (WorkflowLog.runAs), and
 * a run that ran as more than Default says so where it is read - its
 * window, under its status, and the heading of a downloaded log - with
 * whose permissions: a person's, or a project API key's (#9765). A run as
 * Default says nothing new: it ran as every workflow always did. The audit
 * log says the same of each change a workflow's step made, Default
 * included (#9766).
 */

// What a run ran as, as the run lists and the audit log read it.
export interface WorkflowRunRanAs {
  runAs: WorkflowRunAs;
  roleName?: string | null | undefined;
  // The person's name or email, or the API key's name.
  givenBy?: string | null | undefined;
  // Whether `givenBy` names a project API key rather than a person.
  isGivenByApiKey?: boolean | undefined;
}

// What a run row's read asks for, beside the rest: spread into its select.
export const WORKFLOW_RUN_RAN_AS_SELECT: Select<WorkflowLog> = {
  runAs: true,
  runAsCustomRoleName: true,
  runAsGivenByApiKeyName: true,
  runAsGivenByUser: {
    name: true,
    email: true,
  },
};

// A run's row, read: null for a run that ran as Default, or before Run As.
export const getWorkflowRunRanAs: (
  log: Pick<WorkflowLog, "runAs" | "runAsCustomRoleName"> & {
    runAsGivenByApiKeyName?: string | null | undefined;
    runAsGivenByUser?: Pick<User, "name" | "email"> | null | undefined;
  },
) => WorkflowRunRanAs | null = (
  log: Pick<WorkflowLog, "runAs" | "runAsCustomRoleName"> & {
    runAsGivenByApiKeyName?: string | null | undefined;
    runAsGivenByUser?: Pick<User, "name" | "email"> | null | undefined;
  },
): WorkflowRunRanAs | null => {
  const runAs: WorkflowRunAs | null = readWorkflowRunAs(log.runAs);

  if (!runAs || runAs === WorkflowRunAs.Default) {
    return null;
  }

  const keyName: string = (log.runAsGivenByApiKeyName || "").trim();

  if (keyName) {
    return {
      runAs: runAs,
      roleName: log.runAsCustomRoleName || null,
      givenBy: keyName,
      isGivenByApiKey: true,
    };
  }

  return {
    runAs: runAs,
    roleName: log.runAsCustomRoleName || null,
    givenBy:
      log.runAsGivenByUser?.name?.toString() ||
      log.runAsGivenByUser?.email?.toString() ||
      null,
  };
};

export const WorkflowRunRanAsCopy: {
  readonly default: string;
  readonly owner: string;
  readonly ownerGivenBy: string;
  readonly ownerGivenByKey: string;
  readonly role: string;
  readonly roleGivenBy: string;
  readonly roleGivenByKey: string;
} = {
  default: translationKey("Ran with the default permissions."),
  owner: translationKey("Ran as Project Owner."),
  ownerGivenBy: translationKey(
    "Ran as Project Owner, with the permissions of {{name}}.",
  ),
  ownerGivenByKey: translationKey(
    'Ran as Project Owner, with the permissions of the API key "{{name}}".',
  ),
  role: translationKey('Ran as the custom role "{{roleName}}".'),
  roleGivenBy: translationKey(
    'Ran as the custom role "{{roleName}}", with the permissions of {{name}}.',
  ),
  roleGivenByKey: translationKey(
    'Ran as the custom role "{{roleName}}", with the permissions of the API key "{{name}}".',
  ),
};

// What a run ran as, in a sentence of the reader's language.
export const describeWorkflowRunRanAs: (
  translator: Translator,
  ranAs: WorkflowRunRanAs,
) => string = (translator: Translator, ranAs: WorkflowRunRanAs): string => {
  if (ranAs.runAs === WorkflowRunAs.Default) {
    return translator.translateText(WorkflowRunRanAsCopy.default) || "";
  }

  const name: string = ranAs.givenBy || "";

  if (ranAs.runAs === WorkflowRunAs.CustomRole) {
    const roleName: string = ranAs.roleName || "";

    if (!name) {
      return translator.translateTemplate(WorkflowRunRanAsCopy.role, {
        roleName: roleName,
      });
    }

    return translator.translateTemplate(
      ranAs.isGivenByApiKey
        ? WorkflowRunRanAsCopy.roleGivenByKey
        : WorkflowRunRanAsCopy.roleGivenBy,
      {
        roleName: roleName,
        name: name,
      },
    );
  }

  if (!name) {
    return translator.translateText(WorkflowRunRanAsCopy.owner) || "";
  }

  return translator.translateTemplate(
    ranAs.isGivenByApiKey
      ? WorkflowRunRanAsCopy.ownerGivenByKey
      : WorkflowRunRanAsCopy.ownerGivenBy,
    {
      name: name,
    },
  );
};

export interface ComponentProps {
  ranAs: WorkflowRunRanAs;
}

// The quiet line in a run's window under its status.
export const WorkflowRunRanAsNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      role="note"
      className="text-sm leading-6 text-gray-600"
      data-testid="workflow-run-ran-as"
    >
      {describeWorkflowRunRanAs(translator, props.ranAs)}
    </p>
  );
};
