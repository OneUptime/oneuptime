import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import GitHubWorkflowClient, {
  GitHubWorkflowError,
  GitHubWorkflowPermissions,
  GitHubWorkflowResponse,
} from "../../../../Utils/CodeRepository/GitHub/GitHubWorkflowClient";
import HTTPMethod from "../../../../../Types/API/HTTPMethod";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import GitHubActions from "../../../../../Types/Workflow/Components/GitHubActions";

const GITHUB_USERNAME_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const GITHUB_TEAM_SLUG_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ISSUE_NUMBER_PATTERN: RegExp = /^[1-9]\d*$/;

export class GitHubAction extends ComponentCode {
  public constructor(metadata: ComponentMetadata) {
    super();
    this.setMetadata(metadata);
  }

  private string(
    args: JSONObject,
    key: string,
    required: boolean = false,
    maxLength: number = 65_536,
  ): string | undefined {
    const value: unknown = args[key];
    if (value === undefined || value === null) {
      if (required) {
        throw new GitHubWorkflowError(`${key} is required.`);
      }
      return undefined;
    }
    if (
      typeof value !== "string" ||
      value.length > maxLength ||
      value.includes("\0") ||
      (required && !value.trim())
    ) {
      throw new GitHubWorkflowError(
        `${key} must be text${required ? " with a nonempty value" : ""} of at most ${maxLength} characters.`,
      );
    }
    return value;
  }

  private strings(
    args: JSONObject,
    key: string,
    required: boolean = false,
  ): Array<string> | undefined {
    let value: unknown = args[key];
    if (value === undefined || value === null || value === "") {
      if (required) {
        throw new GitHubWorkflowError(`${key} is required.`);
      }
      return undefined;
    }
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        throw new GitHubWorkflowError(
          `${key} must be a JSON array of text values.`,
        );
      }
    }
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      (required && value.length === 0) ||
      !value.every((item: unknown): boolean => {
        return (
          typeof item === "string" &&
          Boolean(item.trim()) &&
          item.length <= 100 &&
          !item.includes("\0")
        );
      })
    ) {
      throw new GitHubWorkflowError(
        `${key} must contain ${required ? "1" : "0"} to 100 nonempty text values.`,
      );
    }
    const values: Array<string> = value as Array<string>;
    if (key === "reviewers" || key === "assignees") {
      if (
        values.some((item: string): boolean => {
          return !GITHUB_USERNAME_PATTERN.test(item);
        })
      ) {
        throw new GitHubWorkflowError(`${key} must contain GitHub usernames.`);
      }
    }
    if (
      key === "team-reviewers" &&
      values.some((item: string): boolean => {
        return !GITHUB_TEAM_SLUG_PATTERN.test(item);
      })
    ) {
      throw new GitHubWorkflowError(
        "team-reviewers must contain GitHub team slugs.",
      );
    }
    return [...new Set(values)];
  }

  private number(args: JSONObject): number {
    const value: unknown = args["number"];
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      !ISSUE_NUMBER_PATTERN.test(String(value)) ||
      !Number.isSafeInteger(Number(value))
    ) {
      throw new GitHubWorkflowError(
        "number must be a positive whole issue or pull request number.",
      );
    }
    return Number(value);
  }

  private names(value: JSONValue | undefined, field: string): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((item: unknown): Array<string> => {
      if (typeof item === "string") {
        return [item];
      }
      if (
        item &&
        typeof item === "object" &&
        typeof (item as JSONObject)[field] === "string"
      ) {
        return [(item as JSONObject)[field] as string];
      }
      return [];
    });
  }

  private output(
    response: GitHubWorkflowResponse,
    itemNumber?: number,
  ): JSONObject {
    const data: JSONObject = Array.isArray(response.data) ? {} : response.data;
    return {
      "response-status": response.statusCode,
      id: typeof data["id"] === "number" ? data["id"] : null,
      number:
        typeof data["number"] === "number"
          ? data["number"]
          : itemNumber ?? null,
      url: typeof data["html_url"] === "string" ? data["html_url"] : null,
      title: typeof data["title"] === "string" ? data["title"] : null,
      body: typeof data["body"] === "string" ? data["body"] : null,
      state: typeof data["state"] === "string" ? data["state"] : null,
      labels: this.names(
        Array.isArray(response.data)
          ? (response.data as JSONArray)
          : data["labels"],
        "name",
      ),
      reviewers: this.names(data["requested_reviewers"], "login"),
      "team-reviewers": this.names(data["requested_teams"], "slug"),
      error: null,
    };
  }

  private validateResponse(
    response: GitHubWorkflowResponse,
    actionId: string,
    method: HTTPMethod,
    itemNumber?: number,
  ): void {
    const data: JSONObject | JSONArray = response.data;
    let valid: boolean = false;
    if (
      actionId === ComponentID.GitHubAddLabels ||
      actionId === ComponentID.GitHubRemoveLabel
    ) {
      valid =
        Array.isArray(data) &&
        data.every((label: unknown): boolean => {
          if (!label || typeof label !== "object" || Array.isArray(label)) {
            return false;
          }
          const name: unknown = (label as JSONObject)["name"];
          return typeof name === "string" && name.length > 0;
        });
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      const identity: unknown = data["id"];
      const number: unknown = data["number"];
      valid =
        typeof identity === "number" &&
        Number.isSafeInteger(identity) &&
        identity > 0;
      if (actionId !== ComponentID.GitHubAddComment) {
        valid =
          valid &&
          typeof number === "number" &&
          Number.isSafeInteger(number) &&
          number > 0 &&
          (itemNumber === undefined || number === itemNumber);
      }
    }
    if (!valid) {
      throw new GitHubWorkflowError(
        "GitHub returned an invalid response for this action." +
          (method === HTTPMethod.GET
            ? ""
            : " Check GitHub before retrying; the action may already have completed."),
        response.statusCode,
      );
    }
  }

  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (port: Port): boolean => {
        return port.id === "success";
      },
    );
    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (port: Port): boolean => {
        return port.id === "error";
      },
    );
    if (!successPort || !errorPort) {
      throw options.onError(
        new GitHubWorkflowError("GitHub action ports are not configured."),
      );
    }

    try {
      const id: string = this.getMetadata().id;
      const repository: string = this.string(args, "repository", true, 300)!;
      const itemNumber: number | undefined =
        id === ComponentID.GitHubCreateIssue ? undefined : this.number(args);
      let method: HTTPMethod = HTTPMethod.GET;
      let path: Array<string> = ["issues", String(itemNumber)];
      const body: JSONObject = {};
      let permissions: GitHubWorkflowPermissions = {
        metadata: "read",
        issues: "write",
      };

      switch (id) {
        case ComponentID.GitHubCreateIssue:
        case ComponentID.GitHubUpdateIssue: {
          const create: boolean = id === ComponentID.GitHubCreateIssue;
          method = create ? HTTPMethod.POST : HTTPMethod.PATCH;
          path = create ? ["issues"] : path;
          const title: string | undefined = this.string(
            args,
            "title",
            create,
            256,
          );
          if (title !== undefined && !title.trim()) {
            throw new GitHubWorkflowError("title must not be empty.");
          }
          const content: string | undefined = this.string(args, "body");
          const labels: Array<string> | undefined = this.strings(
            args,
            "labels",
          );
          const assignees: Array<string> | undefined = this.strings(
            args,
            "assignees",
          );
          if (title !== undefined) {
            body["title"] = title;
          }
          if (content !== undefined) {
            body["body"] = content;
          }
          if (labels !== undefined) {
            body["labels"] = labels;
          }
          if (assignees !== undefined) {
            body["assignees"] = assignees;
          }
          if (!create) {
            const state: string | undefined = this.string(args, "state");
            if (state) {
              if (state !== "open" && state !== "closed") {
                throw new GitHubWorkflowError("state must be open or closed.");
              }
              body["state"] = state;
            }
          }
          break;
        }
        case ComponentID.GitHubGetIssue:
          permissions = { metadata: "read", issues: "read" };
          break;
        case ComponentID.GitHubAddComment:
          method = HTTPMethod.POST;
          path.push("comments");
          body["body"] = this.string(args, "body", true)!;
          break;
        case ComponentID.GitHubAddLabels:
          method = HTTPMethod.POST;
          path.push("labels");
          body["labels"] = this.strings(args, "labels", true)!;
          break;
        case ComponentID.GitHubRemoveLabel: {
          method = HTTPMethod.DELETE;
          const label: string = this.string(args, "label", true, 100)!;
          if (label === "." || label === "..") {
            throw new GitHubWorkflowError(
              "label must not be a path navigation segment.",
            );
          }
          path.push("labels", label);
          break;
        }
        case ComponentID.GitHubGetPullRequest:
          path = ["pulls", String(itemNumber)];
          permissions = { metadata: "read", pull_requests: "read" };
          break;
        case ComponentID.GitHubUpdatePullRequest:
          method = HTTPMethod.PATCH;
          path = ["pulls", String(itemNumber)];
          permissions = { metadata: "read", pull_requests: "write" };
          for (const key of ["title", "body", "state", "base"]) {
            const value: string | undefined = this.string(
              args,
              key,
              false,
              key === "body" ? 65_536 : 256,
            );
            if (value === undefined || (key === "state" && value === "")) {
              continue;
            }
            if (key !== "body" && !value.trim()) {
              throw new GitHubWorkflowError(`${key} must not be empty.`);
            }
            if (key === "state" && value !== "open" && value !== "closed") {
              throw new GitHubWorkflowError("state must be open or closed.");
            }
            body[key] = value;
          }
          break;
        case ComponentID.GitHubRequestReview: {
          method = HTTPMethod.POST;
          path = ["pulls", String(itemNumber), "requested_reviewers"];
          permissions = { metadata: "read", pull_requests: "write" };
          const reviewers: Array<string> =
            this.strings(args, "reviewers") ?? [];
          const teams: Array<string> =
            this.strings(args, "team-reviewers") ?? [];
          if (!reviewers.length && !teams.length) {
            throw new GitHubWorkflowError(
              "Supply at least one reviewer or team reviewer.",
            );
          }
          body["reviewers"] = reviewers;
          body["team_reviewers"] = teams;
          break;
        }
        default:
          throw new GitHubWorkflowError("Unsupported GitHub action.");
      }

      if (method === HTTPMethod.PATCH && Object.keys(body).length === 0) {
        throw new GitHubWorkflowError("Supply at least one field to update.");
      }

      const response: GitHubWorkflowResponse =
        await GitHubWorkflowClient.request({
          projectId: options.projectId,
          repository,
          method,
          path,
          permissions,
          body: Object.keys(body).length ? body : undefined,
          getRemainingExecutionTimeInMs: options.getRemainingExecutionTimeInMs,
        });
      this.validateResponse(response, id, method, itemNumber);
      return {
        returnValues: this.output(response, itemNumber),
        executePort: successPort,
      };
    } catch (error) {
      return {
        returnValues: {
          error:
            error instanceof GitHubWorkflowError
              ? error.message
              : "GitHub action failed. Check the repository connection and workflow arguments.",
          "response-status":
            error instanceof GitHubWorkflowError ? error.statusCode : 0,
        },
        executePort: errorPort,
      };
    }
  }
}

const components: Array<ComponentCode> = GitHubActions.map(
  (metadata: ComponentMetadata): ComponentCode => {
    return new GitHubAction(metadata);
  },
);
export default components;
