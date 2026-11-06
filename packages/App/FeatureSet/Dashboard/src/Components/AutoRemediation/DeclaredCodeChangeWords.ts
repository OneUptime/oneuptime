import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import { isCloudAiResourceType } from "Common/Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  DeclaredCodeChangeJSON,
  DeclaredCodeChangeState,
  DeclaredCodeOwnerCandidateJSON,
  DeclaredCodeOwnerReason,
  getLastingCloudChange,
  readDeclaredCode,
} from "Common/Utils/AiRemediation/DeclaredCodeChange";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A FIX THAT LASTS, ON THE FIX'S CARD: THE WORDS AND THE CHOICES.
 *
 * A step that changes a value of a cloud resource declared as code (its
 * command carries managedAsCode, and the change is one whose value the code
 * declares) can also become a pull request to that code
 * (Utils/AiRemediation/DeclaredCodeChange): a line under the step offers it,
 * a dialog asks before opening it - which repository, and why that one -
 * and the line then says where the pull request stands.
 *
 * Import-clean on purpose: the suites read it without a browser.
 */

// Whether a step of a fix can be asked for in the code that declares its resource.
export function canAskForDeclaredCodeChange(
  command: AiRemediationCommand,
): boolean {
  return Boolean(
    command.stepType === RunbookStepType.ResourceCommand &&
      isCloudAiResourceType(command.resourceType) &&
      readDeclaredCode(command.managedAsCode) &&
      getLastingCloudChange({
        resourceType: command.resourceType,
        command: command.command,
      }),
  );
}

// Whether the live change of a step ran, so the code is to say what the resource does now.
export function hasLiveChangeRun(command: AiRemediationCommand): boolean {
  return (
    command.execution?.status === AiRemediationCommandExecutionStatus.Succeeded
  );
}

// The step's code change, from the list the card read.
export function findDeclaredCodeChange(
  changes: ReadonlyArray<DeclaredCodeChangeJSON>,
  sequence: number,
): DeclaredCodeChangeJSON | null {
  return (
    changes.find((change: DeclaredCodeChangeJSON): boolean => {
      return change.sequence === sequence;
    }) || null
  );
}

// The answer of the list route, as the card reads it.
export function readDeclaredCodeChanges(
  value: unknown,
): Array<DeclaredCodeChangeJSON> {
  const list: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["changes"]
      : null;

  if (!Array.isArray(list)) {
    return [];
  }

  const states: Array<string> = Object.values(DeclaredCodeChangeState);
  const changes: Array<DeclaredCodeChangeJSON> = [];

  for (const raw of list) {
    const row: Record<string, unknown> | null =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;

    if (
      !row ||
      typeof row["sequence"] !== "number" ||
      typeof row["taskId"] !== "string" ||
      !states.includes(row["state"] as string)
    ) {
      continue;
    }

    const change: DeclaredCodeChangeJSON = {
      sequence: row["sequence"],
      taskId: row["taskId"],
      repositoryName:
        typeof row["repositoryName"] === "string" ? row["repositoryName"] : "",
      state: row["state"] as DeclaredCodeChangeState,
    };

    if (
      typeof row["pullRequestUrl"] === "string" &&
      (row["pullRequestUrl"].startsWith("https://") ||
        row["pullRequestUrl"].startsWith("http://"))
    ) {
      change.pullRequestUrl = row["pullRequestUrl"];
    }

    if (typeof row["pullRequestNumber"] === "number") {
      change.pullRequestNumber = row["pullRequestNumber"];
    }

    changes.push(change);
  }

  return changes;
}

// How often the card asks again while a pull request is being written.
export const DECLARED_CODE_CHANGE_POLL_MS: number = 15000;

// ---- The line under the step ---------------------------------------------------

export const DECLARED_CODE_ASK_TITLE: string = translationKey(
  "Open a pull request to the code",
);
export const DECLARED_CODE_ASK_HINT: string = translationKey(
  "The same change in the {{code}} code, so the next apply keeps it.",
);
export const DECLARED_CODE_VIEW_TASK: string = translationKey("View the task");
export const DECLARED_CODE_VIEW_PULL_REQUEST: string =
  translationKey("View pull request");
export const DECLARED_CODE_ASK_AGAIN: string = translationKey("Ask again");

// What the line says of a pull request asked for, by where it stands.
export const DECLARED_CODE_STATE_WORDS: Readonly<
  Record<DeclaredCodeChangeState, string>
> = {
  [DeclaredCodeChangeState.Writing]: translationKey(
    "A pull request to the code is being written in {{repository}}.",
  ),
  [DeclaredCodeChangeState.Opened]: translationKey(
    "A pull request to the code is open in {{repository}}: merge it, and the next apply keeps the fix.",
  ),
  [DeclaredCodeChangeState.Ended]: translationKey(
    "AI opened no pull request in {{repository}}: it found nothing to change, or it waits for your answer.",
  ),
  [DeclaredCodeChangeState.Failed]: translationKey(
    "The pull request to the code could not be written in {{repository}}.",
  ),
};

// A repository the reader may not read is still a repository.
export const DECLARED_CODE_UNNAMED_REPOSITORY: string =
  translationKey("a repository");

// ---- The dialog that asks before opening it ----------------------------------

export const DECLARED_CODE_DIALOG_TITLE: string = translationKey(
  "Open a pull request to the code",
);
export const DECLARED_CODE_DIALOG_DESCRIPTION: string = translationKey(
  "{{code}} declares this resource, so the next apply puts back whatever the code says. A pull request makes the code say the same as the fix.",
);
export const DECLARED_CODE_DIALOG_CHANGE_LABEL: string =
  translationKey("The change");
export const DECLARED_CODE_DIALOG_TARGET: string = translationKey(
  "Most likely the {{attribute}} of the {{resourceType}} that declares it.",
);
export const DECLARED_CODE_DIALOG_REPOSITORY_LABEL: string =
  translationKey("Repository");
export const DECLARED_CODE_DIALOG_SUBMIT: string =
  translationKey("Open pull request");
export const DECLARED_CODE_DIALOG_LOADING: string = translationKey(
  "Looking for the code in your repositories…",
);
export const DECLARED_CODE_DIALOG_NO_REPOSITORY: string = translationKey(
  "No repository connected to Code can take this pull request yet.",
);
export const DECLARED_CODE_DIALOG_CONNECT: string = translationKey(
  "Connect a repository",
);
export const DECLARED_CODE_DIALOG_MAY_NOT_ASK: string = translationKey(
  "You may not ask AI to work in it.",
);
export const DECLARED_CODE_DIALOG_WAITING_NOTE: string = translationKey(
  "The live change still waits for approval: approve it too to fix the problem now, or dismiss it and let the next apply make the change once the pull request is merged.",
);
export const DECLARED_CODE_DIALOG_RAN_NOTE: string = translationKey(
  "The live change already ran: the pull request makes the code say the same, so the next apply does not undo it.",
);

// Why a repository is offered, in the reader's words.
export const DECLARED_CODE_REASON_WORDS: Readonly<
  Record<DeclaredCodeOwnerReason, string>
> = {
  [DeclaredCodeOwnerReason.NamedByTag]: translationKey(
    "A tag of the resource names this repository.",
  ),
  [DeclaredCodeOwnerReason.HasNamedFile]: translationKey(
    "Its {{code}} code has a file named after the resource: {{path}}",
  ),
  [DeclaredCodeOwnerReason.HasCodeOfKind]: translationKey(
    "It holds {{code}} code.",
  ),
  [DeclaredCodeOwnerReason.OnlyRepository]: translationKey(
    "The only repository AI can work in.",
  ),
  [DeclaredCodeOwnerReason.NoEvidence]: translationKey(
    "Nothing says it holds this code.",
  ),
};

/*
 * The repository the dialog starts on: the best one the reader may ask in,
 * or none - a person then picks.
 */
export function getStartingRepositoryId(
  candidates: ReadonlyArray<DeclaredCodeOwnerCandidateJSON>,
): string | null {
  const best: DeclaredCodeOwnerCandidateJSON | undefined = candidates.find(
    (candidate: DeclaredCodeOwnerCandidateJSON): boolean => {
      return candidate.isBest && candidate.canAsk;
    },
  );

  return best ? best.repositoryId : null;
}
