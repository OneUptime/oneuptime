import ExceptionPullRequestTaskHandler from "./ExceptionPullRequestTaskHandler";
import { ExceptionDetails } from "../Utils/BackendAPI";
import PullRequestCreator from "../Utils/PullRequestCreator";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";

// Stack traces in PR bodies are truncated to keep the PR readable.
const PR_BODY_STACK_TRACE_LENGTH: number = 2000;

/*
 * Improves how the code HANDLES and REPORTS an exception — without
 * changing what the code does. This is the right recipe when the
 * exception is not a bug: expected user errors, intentional denials, and
 * throw sites whose messages interpolate user data. The agent
 * parameterizes messages, moves validation earlier, improves the error
 * returned to the caller, and marks expected errors as handled in
 * telemetry.
 */
export default class ImproveExceptionHandlingTaskHandler extends ExceptionPullRequestTaskHandler {
  public readonly taskType: string = CodeFixTaskType.ImproveExceptionHandling;
  public readonly name: string = "Improve Exception Handling Handler";

  protected readonly branchPrefix: string = "oneuptime-error-handling-";
  protected readonly noActionMessage: string =
    "No error-handling improvements could be applied to any repository";

  // Build the prompt for the code agent
  protected buildPrompt(
    exceptionDetails: ExceptionDetails,
    servicePathInRepository: string | null,
  ): string {
    const classificationContext: string = exceptionDetails.exception
      .aiClassification
      ? `\n**AI Triage Verdict:** ${exceptionDetails.exception.aiClassification} (this exception was triaged as NOT being a code defect — that is why this task improves its handling instead of "fixing" it)\n`
      : "";

    let prompt: string = `You are a software engineer improving how a codebase HANDLES and REPORTS an error. You are explicitly NOT fixing a bug — the error below is believed to be expected behavior (invalid user input, an intentional denial, or an operational condition), and your job is to make the code deal with it better.

## Exception Information

**Exception Type:** ${exceptionDetails.exception.exceptionType}
${classificationContext}
**Error Message:**
${exceptionDetails.exception.message}

**Stack Trace:**
\`\`\`
${exceptionDetails.exception.stackTrace}
\`\`\`

## Task

Locate the throw site from the stack trace and improve the error handling around it. Apply whichever of these apply (and nothing else):

1. **Parameterize the error message.** If the message interpolates dynamic values (IDs, emails, domains, file paths, user-provided values), make the message static and move the dynamic values into structured error fields/attributes or structured logging. This keeps user data out of error text and lets error-tracking group all variants as one issue.
2. **Validate earlier, fail clearer.** If bad input travels deep into the stack before exploding (e.g. a malformed ID reaching the database driver), add validation at the boundary where the input enters, returning a clear, actionable client error (the 4xx-equivalent for this codebase's conventions).
3. **Make the error actionable.** If a caller/end user sees this error, rewrite it to say what was wrong and what to do about it — without echoing the offending value back verbatim.
4. **Mark expected errors as handled in telemetry.** If this codebase records exceptions via OpenTelemetry (or a similar SDK) and this error is expected/operational, record it as handled (e.g. exception.escaped=false, span status set deliberately, or log-level warning instead of an exception event) so it stops being reported as an unhandled production exception.

## Hard Rules — never break these

- Do NOT change business behavior: every input that was accepted before must still be accepted, and every input that was rejected must still be rejected.
- NEVER delete or weaken input validation, authentication, authorization, payment/plan checks, rate limits, or state-machine invariants.
- NEVER change shared utilities or cross-cutting contracts to suppress a single call site's error; work at the call site.
- Do NOT swallow errors: an error that was surfaced must still be surfaced (just better).
- Keep the change minimal and focused; preserve existing code style and patterns.
- If none of the improvements apply, make no changes and explain why.

Please proceed.`;

    if (servicePathInRepository) {
      prompt = `The service code is located in the \`${servicePathInRepository}\` directory.\n\n${prompt}`;
    }

    return prompt;
  }

  /*
   * Commit subject and PR title are built from the exception TYPE and
   * service — never the message, which can interpolate user data.
   */
  protected buildCommitMessage(exceptionDetails: ExceptionDetails): string {
    const subject: string = PullRequestCreator.generatePRTitle({
      exceptionType: exceptionDetails.exception.exceptionType,
      serviceName: exceptionDetails.service?.name || "",
      prefix: "chore(errors): improve handling of",
    });

    return `${subject}

This commit improves how the code handles and reports an expected error
observed by OneUptime. It does not change business behavior.

Exception Type: ${exceptionDetails.exception.exceptionType}
Exception ID: ${exceptionDetails.exception.id}

Automatically generated by OneUptime AI Agent.`;
  }

  // Build the pull request title
  protected buildPullRequestTitle(exceptionDetails: ExceptionDetails): string {
    return PullRequestCreator.generatePRTitle({
      exceptionType: exceptionDetails.exception.exceptionType,
      serviceName: exceptionDetails.service?.name || "",
      prefix: "chore(errors): improve handling of",
    });
  }

  // Build the pull request body
  protected buildPullRequestBody(
    exceptionDetails: ExceptionDetails,
    agentSummary: string,
  ): string {
    const stackTrace: string = exceptionDetails.exception.stackTrace;

    return `## Error Handling Improvement

This pull request was automatically generated by OneUptime AI Agent. The exception below was assessed as **expected behavior rather than a code defect**${
      exceptionDetails.exception.aiClassification
        ? ` (triage verdict: \`${exceptionDetails.exception.aiClassification}\`)`
        : ""
    }, so this PR improves how the code handles and reports it — parameterized error messages, earlier validation, clearer errors, and/or telemetry hygiene. It does **not** change business behavior.

### Exception Details

**Service:** ${exceptionDetails.service?.name || "Unknown Service"}
**Type:** ${exceptionDetails.exception.exceptionType}
**Message (dynamic values and secrets redacted):** ${exceptionDetails.exception.message}

### Stack Trace

\`\`\`
${stackTrace.substring(0, PR_BODY_STACK_TRACE_LENGTH)}${stackTrace.length > PR_BODY_STACK_TRACE_LENGTH ? "\n...(truncated)" : ""}
\`\`\`

### Summary of Changes

${agentSummary}

---

> **Opened as a draft — review before merging.** Verify the change keeps behavior identical (only handling/reporting should differ), then mark the pull request ready for review. Nothing is merged automatically.

*This PR was automatically generated by [OneUptime AI Agent](https://oneuptime.com)*`;
  }

  // Get handler description
  public getDescription(): string {
    return "Improves how the code handles and reports an expected error: parameterizes messages that leak user data, validates input earlier with actionable errors, and marks expected errors as handled in telemetry. Does not change business behavior.";
  }
}
