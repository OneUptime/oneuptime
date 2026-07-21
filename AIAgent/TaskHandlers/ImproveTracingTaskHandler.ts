import SubjectPullRequestTaskHandler from "./SubjectPullRequestTaskHandler";
import { SubjectTaskDetails } from "../Utils/BackendAPI";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";

/*
 * ImproveTracing: a service-scoped tracing-instrumentation pass. A user
 * clicks "Improve tracing with AI" on the service's Traces page; the agent
 * audits the service's tracing and opens a draft PR that adds spans where
 * they are missing, fixes span naming and status/exception semantics, and
 * stamps useful attributes — WITHOUT changing behavior. Context (service
 * id + name, repository resolved by service name) comes from
 * /ai-agent-data/get-instrumentation-task-details.
 */
export default class ImproveTracingTaskHandler extends SubjectPullRequestTaskHandler {
  public readonly taskType: string = CodeFixTaskType.ImproveTracing;
  public readonly name: string = "Improve Tracing Handler";

  protected readonly branchPrefix: string = "oneuptime-tracing-";
  protected readonly noActionMessage: string =
    "No tracing improvements could be applied to any repository";
  protected readonly noRepositoryMessage: string =
    "Could not resolve a repository for this tracing-improvement task. Connect the right repository through the GitHub App.";

  // Build the prompt for the code agent
  protected buildPrompt(
    details: SubjectTaskDetails,
    servicePathInRepository: string | null,
  ): string {
    let prompt: string = `You are a software engineer improving the DISTRIBUTED TRACING of a codebase${
      details.serviceName ? ` (the service "${details.serviceName}")` : ""
    }. This is an instrumentation-hygiene pass: you change how the code is traced, never what the code does.

## Task

Audit the tracing instrumentation in this repository and improve it. Work through this checklist, applying whichever items you find violations of — and nothing else:

1. **Cover the significant operations.** Add spans (using the tracing library the repository already uses — OpenTelemetry or its idiom) around entry points and significant operations that currently have none: request handlers, queue consumers, scheduled jobs, outbound calls, and expensive internal operations. Auto-instrumentation may already cover frameworks — only add manual spans where coverage is genuinely missing.
2. **Fix span names.** Span names must be LOW-CARDINALITY: operation templates ("GET /orders/:id", "process-payment"), never interpolated values ("GET /orders/12345", "process-payment for jane@x.com"). Move the dynamic values into span attributes.
3. **Record exceptions on spans correctly.** Where operations can fail, record the exception on the active span (recordException or the library's equivalent), set the span status to error on genuine failures, and set the escaped/unhandled semantics correctly — an exception that is caught and handled must not be recorded as unhandled.
4. **Stamp useful attributes.** Add semantic-convention attributes where cheap and safe (http.*, db.system/db.statement with bound parameters NOT interpolated values, messaging.*), and code.filepath/code.function on manual spans — these let observability tools map spans back to source. Never put secrets or personal data in attribute values.
5. **Propagate context.** Ensure trace context crosses async boundaries the repository uses (queues, background jobs, fire-and-forget calls) via the library's propagation API, so traces do not fracture mid-flow.
6. **If the repository has NO tracing at all**, add the minimal standard OpenTelemetry setup for its language/framework (SDK initialization + auto-instrumentation), configured via standard OTEL_* environment variables — do not hardcode endpoints or tokens.

## Requirements

- Use the tracing library the repository ALREADY uses; only introduce OpenTelemetry if there is no tracing at all (item 6), and then only the standard minimal setup
- Do NOT change any business logic, control flow, error handling behavior, or return values — this change is instrumentation only
- Keep the diff focused: instrument the clearest gaps rather than every function; prefer entry points, error paths, and outbound calls
- Never put secrets, credentials, tokens, or personal data in span names or attributes
- Preserve existing code style and patterns
- If the tracing is already in good shape, make no changes and explain why

Please proceed with auditing and improving the tracing.`;

    if (servicePathInRepository) {
      prompt = `The service code is located in the \`${servicePathInRepository}\` directory — audit THAT directory's tracing.\n\n${prompt}`;
    }

    return prompt;
  }

  // Build commit message for the tracing change
  protected buildCommitMessage(details: SubjectTaskDetails): string {
    return `chore(tracing): improve tracing instrumentation${
      details.serviceName ? ` for ${details.serviceName}` : ""
    }

Added spans on uninstrumented operations, fixed span naming and
status/exception semantics, and stamped semantic-convention attributes.
Instrumentation only — no business logic is changed.

Automatically generated by OneUptime AI Agent.`;
  }

  // Build the pull request title
  protected buildPullRequestTitle(details: SubjectTaskDetails): string {
    const title: string = `chore(tracing): improve tracing instrumentation${
      details.serviceName ? ` for ${details.serviceName}` : ""
    }`;

    return this.cleanSubjectTitle(
      title,
      SubjectPullRequestTaskHandler.PR_TITLE_SUBJECT_LENGTH,
    );
  }

  // Build the pull request body
  protected buildPullRequestBody(
    details: SubjectTaskDetails,
    agentSummary: string,
  ): string {
    return `## Tracing Improvement

This pull request was automatically generated by OneUptime AI Agent at a user's request. It improves the tracing instrumentation of ${
      details.serviceName
        ? `the service **${details.serviceName}**`
        : "this repository"
    }: spans on uninstrumented operations, low-cardinality span names, correct status/exception recording, semantic-convention attributes, and context propagation across async boundaries. It does **not** change business behavior.

### Summary of Changes

${agentSummary}

---

> **Instrumentation only** — this PR must not change business logic. It is opened as a draft: review it and mark it ready for review before merging; nothing is merged automatically.

*This PR was automatically generated by [OneUptime AI Agent](https://oneuptime.com)*`;
  }

  // Get handler description
  public getDescription(): string {
    return "Audits a service's tracing and opens a pull request that adds missing spans, fixes span naming and status/exception semantics, stamps semantic-convention attributes, and propagates context across async boundaries — without changing business behavior.";
  }
}
