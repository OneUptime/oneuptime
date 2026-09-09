import Route from "../../API/Route";
import IconProp from "../../Icon/IconProp";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  ReturnValue,
} from "../Component";
import ComponentID from "../ComponentID";

const repository: Argument = {
  id: "repository",
  name: "Repository",
  required: true,
  type: ComponentInputType.Text,
  description:
    "A GitHub repository connected to this project, as owner/repository or its Code Repository ID.",
  placeholder: "my-organization/my-repository",
};
const number: Argument = {
  id: "number",
  name: "Issue or Pull Request Number",
  required: true,
  type: ComponentInputType.Number,
  description: "The positive issue or pull request number shown on GitHub.",
  placeholder: "42",
};
const title: Argument = {
  id: "title",
  name: "Title",
  required: false,
  type: ComponentInputType.Text,
  description:
    "The issue or pull request title. Leave unset to keep the current title.",
  isSensitive: true,
};
const body: Argument = {
  id: "body",
  name: "Body",
  required: false,
  type: ComponentInputType.Markdown,
  description:
    "Markdown content. Leave unset to keep existing content; an empty string clears it when updating.",
  isSensitive: true,
};
const state: Argument = {
  id: "state",
  name: "State",
  required: false,
  type: ComponentInputType.Text,
  description:
    "Use open to reopen the item or closed to close it. Leave unset to keep its state.",
  placeholder: "closed",
};
const labels: Argument = {
  id: "labels",
  name: "Labels",
  required: false,
  type: ComponentInputType.JSONArray,
  description:
    "A JSON array of label names. Updating an issue replaces its labels; Add Labels preserves existing labels.",
  placeholder: '["incident", "oneuptime"]',
};
const assignees: Argument = {
  id: "assignees",
  name: "Assignees",
  required: false,
  type: ComponentInputType.JSONArray,
  description:
    "A JSON array of GitHub usernames. Updating an issue replaces its assignees; [] clears them.",
  placeholder: '["octocat"]',
};
const returnValues: Array<ReturnValue> = [
  {
    id: "id",
    name: "GitHub ID",
    description:
      "GitHub's identifier for the returned issue, pull request, or comment.",
    type: ComponentInputType.Number,
    required: false,
  },
  {
    id: "number",
    name: "Issue or Pull Request Number",
    description: "The affected issue or pull request number.",
    type: ComponentInputType.Number,
    required: false,
  },
  {
    id: "url",
    name: "GitHub URL",
    description: "Browser link to the affected item.",
    type: ComponentInputType.Text,
    required: false,
  },
  {
    id: "title",
    name: "Title",
    description: "Returned issue or pull request title.",
    type: ComponentInputType.Text,
    required: false,
    isSensitive: true,
  },
  {
    id: "body",
    name: "Body",
    description: "Returned Markdown body.",
    type: ComponentInputType.Markdown,
    required: false,
    isSensitive: true,
  },
  {
    id: "state",
    name: "State",
    description: "The item's open or closed state.",
    type: ComponentInputType.Text,
    required: false,
  },
  {
    id: "labels",
    name: "Labels",
    description: "The item's label names.",
    type: ComponentInputType.JSONArray,
    required: false,
  },
  {
    id: "reviewers",
    name: "Requested Reviewers",
    description: "GitHub usernames requested to review the pull request.",
    type: ComponentInputType.JSONArray,
    required: false,
  },
  {
    id: "team-reviewers",
    name: "Requested Teams",
    description: "Team slugs requested to review the pull request.",
    type: ComponentInputType.JSONArray,
    required: false,
  },
  {
    id: "response-status",
    name: "Response Status",
    description: "The GitHub HTTP status, or 0 if no response was available.",
    type: ComponentInputType.Number,
    required: false,
  },
  {
    id: "error",
    name: "Error",
    description: "An actionable error message if the Error port is followed.",
    type: ComponentInputType.Text,
    required: false,
  },
];

function component(
  id: ComponentID,
  name: string,
  description: string,
  args: Array<Argument>,
): ComponentMetadata {
  return {
    id,
    title: name,
    description,
    category: "GitHub",
    iconProp: IconProp.GitHub,
    componentType: ComponentType.Component,
    documentationLink: Route.fromString("/workflow/docs/GitHub.md"),
    arguments: [repository, ...args],
    returnValues,
    inPorts: [
      { id: "in", title: "In", description: "Run this GitHub action." },
    ],
    outPorts: [
      {
        id: "success",
        title: "Success",
        description: "GitHub completed the action.",
      },
      {
        id: "error",
        title: "Error",
        description: "GitHub rejected the request or the action could not run.",
      },
    ],
  };
}

const components: Array<ComponentMetadata> = [
  component(
    ComponentID.GitHubCreateIssue,
    "Create GitHub Issue",
    "Create an issue in a connected GitHub repository.",
    [{ ...title, required: true }, body, labels, assignees],
  ),
  component(
    ComponentID.GitHubUpdateIssue,
    "Update GitHub Issue",
    "Edit, close, or reopen a GitHub issue and manage its labels and assignees.",
    [number, title, body, state, labels, assignees],
  ),
  component(
    ComponentID.GitHubGetIssue,
    "Get GitHub Issue",
    "Read an issue from a connected GitHub repository.",
    [number],
  ),
  component(
    ComponentID.GitHubAddComment,
    "Comment on GitHub Issue or PR",
    "Post a conversation comment on an issue or pull request.",
    [number, { ...body, required: true }],
  ),
  component(
    ComponentID.GitHubAddLabels,
    "Add GitHub Labels",
    "Add labels to an issue or pull request while preserving its existing labels.",
    [number, { ...labels, required: true }],
  ),
  component(
    ComponentID.GitHubRemoveLabel,
    "Remove GitHub Label",
    "Remove one label from an issue or pull request.",
    [
      number,
      {
        id: "label",
        name: "Label",
        required: true,
        type: ComponentInputType.Text,
        description: "The exact name of the label to remove.",
        placeholder: "incident",
      },
    ],
  ),
  component(
    ComponentID.GitHubGetPullRequest,
    "Get GitHub Pull Request",
    "Read a pull request from a connected GitHub repository.",
    [number],
  ),
  component(
    ComponentID.GitHubUpdatePullRequest,
    "Update GitHub Pull Request",
    "Edit, close, or reopen a pull request, or change its base branch.",
    [
      number,
      title,
      body,
      state,
      {
        id: "base",
        name: "Base Branch",
        required: false,
        type: ComponentInputType.Text,
        description:
          "The existing branch in this repository that the pull request targets.",
        placeholder: "main",
      },
    ],
  ),
  component(
    ComponentID.GitHubRequestReview,
    "Request GitHub Review",
    "Request pull request reviews from GitHub users or teams.",
    [
      number,
      {
        id: "reviewers",
        name: "Reviewers",
        required: false,
        type: ComponentInputType.JSONArray,
        description:
          "A JSON array of GitHub usernames. Supply at least one reviewer or team.",
        placeholder: '["octocat"]',
      },
      {
        id: "team-reviewers",
        name: "Team Reviewers",
        required: false,
        type: ComponentInputType.JSONArray,
        description:
          "A JSON array of team slugs in the repository's organization.",
        placeholder: '["platform-team"]',
      },
    ],
  ),
];

export default components;
