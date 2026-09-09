import {
  GITHUB_SUPPORTED_EVENTS,
  GitHubEventEnvelope,
  GitHubEventMatch,
} from "../../Types/CodeRepository/GitHubEvent";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";

/** Pure normalization and matching shared by webhook admission and dispatch. */
export default class GitHubEventUtil {
  public static isSupportedEvent(event: string): boolean {
    return GITHUB_SUPPORTED_EVENTS.includes(event);
  }

  public static isCommentEvent(event: string): boolean {
    return [
      "issue_comment",
      "pull_request_review",
      "pull_request_review_comment",
    ].includes(event);
  }

  private static object(value: unknown, name: string): JSONObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(`GitHub ${name} must be an object.`);
    }
    return value as JSONObject;
  }

  private static optionalObject(value: unknown): JSONObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as JSONObject;
  }

  private static string(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private static identifier(value: unknown, name: string): string {
    const identifierPattern: RegExp = /^[1-9]\d*$/;
    if (
      (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
      (typeof value === "string" && identifierPattern.test(value))
    ) {
      return value.toString();
    }
    throw new BadDataException(`GitHub ${name} must be a positive identifier.`);
  }

  public static normalize(data: {
    event: string;
    deliveryId: string;
    payload: JSONObject;
    codeRepositoryId: string;
  }): GitHubEventEnvelope | null {
    if (!this.isSupportedEvent(data.event)) {
      return null;
    }

    const payload: JSONObject = this.object(data.payload, "payload");
    const repository: JSONObject = this.object(
      payload["repository"],
      "repository",
    );
    const installation: JSONObject = this.object(
      payload["installation"],
      "installation",
    );
    const sender: JSONObject = this.object(payload["sender"], "sender");
    const repositoryName: string = this.string(repository["full_name"]);
    const senderLogin: string = this.string(sender["login"]);
    const repositoryNamePattern: RegExp = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

    if (
      !repositoryNamePattern.test(repositoryName) ||
      repositoryName.split("/").some((part: string) => {
        return part === "." || part === "..";
      })
    ) {
      throw new BadDataException("GitHub repository full_name is invalid.");
    }
    if (!senderLogin || !data.deliveryId) {
      throw new BadDataException("GitHub sender and delivery ID are required.");
    }

    let subject: JSONObject = payload;
    let comment: JSONObject = {};
    let branch: string = "";
    let issueNumber: number | null = null;
    const isPullRequest: boolean =
      data.event.startsWith("pull_request") ||
      (data.event === "issue_comment" &&
        Boolean(this.optionalObject(payload["issue"])["pull_request"]));

    if (data.event === "issues" || data.event === "issue_comment") {
      subject = this.object(payload["issue"], "issue");
    } else if (data.event.startsWith("pull_request")) {
      subject = this.object(payload["pull_request"], "pull_request");
      branch = this.string(this.optionalObject(subject["head"])["ref"]);
    } else if (data.event === "workflow_run") {
      subject = this.object(payload["workflow_run"], "workflow_run");
      branch = this.string(subject["head_branch"]);
    } else if (data.event === "check_run" || data.event === "check_suite") {
      subject = this.object(payload[data.event], data.event);
      branch = this.string(
        data.event === "check_run"
          ? this.optionalObject(subject["check_suite"])["head_branch"]
          : subject["head_branch"],
      );
    } else if (data.event === "release") {
      subject = this.object(payload["release"], "release");
      branch = this.string(subject["target_commitish"]);
    } else if (data.event === "deployment_status") {
      subject = this.object(payload["deployment_status"], "deployment_status");
      branch = this.string(
        this.object(payload["deployment"], "deployment")["ref"],
      );
    } else if (data.event === "push") {
      const ref: string = this.string(payload["ref"]);
      if (!ref) {
        throw new BadDataException("GitHub push ref is required.");
      }
      branch = ref.replace(/^refs\/heads\//, "");
    }

    if (
      data.event === "issue_comment" ||
      data.event === "pull_request_review_comment"
    ) {
      comment = this.object(payload["comment"], "comment");
    } else if (data.event === "pull_request_review") {
      comment = this.object(payload["review"], "review");
    }

    if (
      data.event === "issues" ||
      data.event === "issue_comment" ||
      data.event.startsWith("pull_request")
    ) {
      issueNumber = Number(this.identifier(subject["number"], "issue number"));
      if (!Number.isSafeInteger(issueNumber)) {
        throw new BadDataException("GitHub issue number is too large.");
      }
    }

    const action: string =
      this.string(payload["action"]) ||
      (data.event === "push"
        ? "pushed"
        : data.event === "deployment_status"
          ? this.string(subject["state"])
          : "");
    if (!action) {
      throw new BadDataException("GitHub event action is required.");
    }

    const rawLabels: unknown = subject["labels"];
    const labels: Array<string> = Array.isArray(rawLabels)
      ? rawLabels
          .map((label: unknown): string => {
            return typeof label === "string"
              ? label
              : this.string(this.optionalObject(label)["name"]);
          })
          .filter(Boolean)
      : [];

    return {
      event: data.event,
      action: action,
      deliveryId: data.deliveryId,
      installationId: this.identifier(installation["id"], "installation ID"),
      repository: repositoryName,
      repositoryId: this.identifier(repository["id"], "repository ID"),
      codeRepositoryId: data.codeRepositoryId,
      sender: senderLogin,
      isBot: sender["type"] === "Bot" || senderLogin.endsWith("[bot]"),
      issueNumber: issueNumber,
      isPullRequest: isPullRequest,
      comment: this.string(comment["body"]),
      commandArguments: "",
      title: this.string(subject["title"]) || this.string(subject["name"]),
      body: this.string(subject["body"]),
      url:
        this.string(comment["html_url"]) ||
        this.string(subject["html_url"]) ||
        this.string(payload["compare"]) ||
        this.string(repository["html_url"]),
      branch: branch,
      labels: labels,
      payload: payload,
    };
  }

  private static filterText(filters: JSONObject, name: string): string {
    const value: unknown = filters[name];
    if (value === undefined || value === null || value === "") {
      return "";
    }
    if (typeof value !== "string") {
      throw new BadDataException(`GitHub ${name} filter must be text.`);
    }
    if (value.includes("{{") || value.includes("}}")) {
      throw new BadDataException(
        `GitHub ${name} filter has an unresolved variable.`,
      );
    }
    return value.trim();
  }

  private static filterBoolean(filters: JSONObject, name: string): boolean {
    const value: unknown = filters[name];
    if (value === undefined || value === null || value === "") {
      return true;
    }
    if (value === true || value === "true") {
      return true;
    }
    if (value === false || value === "false") {
      return false;
    }
    throw new BadDataException(`GitHub ${name} filter must be true or false.`);
  }

  private static csv(value: string): Array<string> {
    return value
      .split(",")
      .map((item: string): string => {
        return item.trim();
      })
      .filter(Boolean);
  }

  public static match(
    envelope: GitHubEventEnvelope,
    filters: JSONObject,
  ): GitHubEventMatch {
    const event: string = this.filterText(filters, "event");
    const repository: string = this.filterText(filters, "repository");
    const actions: Array<string> = this.csv(
      this.filterText(filters, "actions"),
    );
    const branch: string = this.filterText(filters, "branch");
    const label: string = this.filterText(filters, "label");
    const senders: Array<string> = this.csv(this.filterText(filters, "sender"));
    const commentType: string =
      this.filterText(filters, "commentType") || "all";
    const command: string = this.filterText(filters, "commentCommand");
    const ignoreBots: boolean = this.filterBoolean(filters, "ignoreBots");
    const requireWriteAccess: boolean =
      this.filterBoolean(filters, "requireWriteAccess") &&
      this.isCommentEvent(envelope.event);
    const noMatch: GitHubEventMatch = {
      matches: false,
      commandArguments: "",
      requireWriteAccess: requireWriteAccess,
    };

    if (!event) {
      throw new BadDataException(
        "Select a GitHub event, or use * for all supported events.",
      );
    }
    const events: Array<string> = this.csv(event);
    if (events.length === 0) {
      throw new BadDataException("GitHub event filter must contain an event.");
    }
    if (
      events.some((item: string): boolean => {
        return item !== "*" && !this.isSupportedEvent(item);
      })
    ) {
      throw new BadDataException(
        "GitHub event filter contains an unsupported event.",
      );
    }
    if (!["all", "issue", "pull_request"].includes(commentType)) {
      throw new BadDataException(
        "GitHub commentType must be all, issue, or pull_request.",
      );
    }
    if (ignoreBots && envelope.isBot) {
      return noMatch;
    }
    if (!events.includes("*") && !events.includes(envelope.event)) {
      return noMatch;
    }
    if (
      repository &&
      repository.toLowerCase() !== envelope.repository.toLowerCase() &&
      repository !== envelope.codeRepositoryId
    ) {
      return noMatch;
    }
    if (actions.length > 0 && !actions.includes(envelope.action)) {
      return noMatch;
    }
    if (branch && branch !== envelope.branch) {
      return noMatch;
    }
    if (label) {
      /*
       * Label transitions must match the changed label: adding an unrelated label
       * to an already-labelled issue must not create another incident.
       */
      const labelsToMatch: Array<string> = ["labeled", "unlabeled"].includes(
        envelope.action,
      )
        ? [this.string(this.optionalObject(envelope.payload["label"])["name"])]
        : envelope.labels;
      if (
        !labelsToMatch.some((item: string): boolean => {
          return item.toLowerCase() === label.toLowerCase();
        })
      ) {
        return noMatch;
      }
    }
    if (
      senders.length > 0 &&
      !senders.some((item: string): boolean => {
        return item.toLowerCase() === envelope.sender.toLowerCase();
      })
    ) {
      return noMatch;
    }
    if (
      commentType !== "all" &&
      (!this.isCommentEvent(envelope.event) ||
        (commentType === "pull_request") !== envelope.isPullRequest)
    ) {
      return noMatch;
    }
    let commandArguments: string = "";
    if (command) {
      if (!this.isCommentEvent(envelope.event)) {
        return noMatch;
      }
      if (
        actions.length === 0 &&
        envelope.action !==
          (envelope.event === "pull_request_review" ? "submitted" : "created")
      ) {
        return noMatch;
      }
      // A command must begin the comment. Quotes, code fences and prose do not execute it.
      const text: string = envelope.comment.trimStart();
      if (!text.startsWith(command)) {
        return noMatch;
      }
      const tail: string = text.slice(command.length);
      const whitespacePattern: RegExp = /^\s/;
      if (tail && !whitespacePattern.test(tail)) {
        return noMatch;
      }
      commandArguments = tail.trim();
    }
    return {
      matches: true,
      commandArguments: commandArguments,
      requireWriteAccess: requireWriteAccess,
    };
  }
}
