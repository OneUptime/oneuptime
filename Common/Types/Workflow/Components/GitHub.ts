import Route from "../../API/Route";
import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  ReturnValue,
} from "../Component";

const textOutputs: Array<[string, string, string]> = [
  [
    "event",
    "Event",
    "GitHub event name, such as issue_comment or pull_request.",
  ],
  [
    "action",
    "Action",
    "GitHub action. Push events use pushed; deployment status events use their state.",
  ],
  ["deliveryId", "Delivery ID", "GitHub webhook delivery identifier."],
  [
    "installationId",
    "Installation ID",
    "Verified GitHub App installation identifier.",
  ],
  ["repository", "Repository", "Repository full name, such as acme/service."],
  [
    "repositoryId",
    "GitHub Repository ID",
    "Numeric GitHub repository identifier, represented as text.",
  ],
  [
    "codeRepositoryId",
    "Connected Repository ID",
    "OneUptime connected repository ID. Pass this to GitHub actions.",
  ],
  ["sender", "Sender", "GitHub username that caused the event."],
  [
    "comment",
    "Comment",
    "Issue comment, PR conversation comment, review comment, or review body.",
  ],
  [
    "commandArguments",
    "Command Arguments",
    "Text after the configured comment command.",
  ],
  [
    "title",
    "Title",
    "Issue or pull request title, or check, workflow run, or release name.",
  ],
  ["body", "Body", "Issue, pull request, or release body."],
  [
    "url",
    "GitHub URL",
    "Link to the comment, review, issue, pull request, or event resource.",
  ],
  [
    "branch",
    "Branch",
    "Source branch for pull requests; head branch for runs/checks; pushed branch or tag ref; release target or deployment ref.",
  ],
];

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.GitHubEvent,
    title: "GitHub Event",
    category: "GitHub",
    description:
      "Run a workflow when a connected GitHub repository receives an issue, pull request, comment, review, push, check, workflow run, release, or deployment event.",
    iconProp: IconProp.GitHub,
    componentType: ComponentType.Trigger,
    documentationLink: Route.fromString("/workflow/docs/GitHub.md"),
    arguments: [
      {
        id: "repository",
        name: "Repository",
        description:
          "Filter by owner/repository or a OneUptime connected repository ID. Leave blank for all repositories connected to this project.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "acme/service",
      },
      {
        id: "event",
        name: "Events",
        description:
          "Comma-separated GitHub events: issues, issue_comment, pull_request, pull_request_review, pull_request_review_comment, push, workflow_run, check_run, check_suite, release, deployment_status. Use * for all supported events.",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "issue_comment",
      },
      {
        id: "actions",
        name: "Actions",
        description:
          "Optional comma-separated actions, such as created, opened, closed, completed, or published. A comment command defaults to created (submitted for reviews), preventing edits or deletions from executing it again.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "created",
      },
      {
        id: "commentCommand",
        name: "Comment Command",
        description:
          "Only run when a comment begins with this command followed by whitespace or the end of the comment. Remaining text is returned as commandArguments.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "/oneuptime incident",
      },
      {
        id: "commentType",
        name: "Comment Type",
        description:
          "all (default), issue, or pull_request. A specific type matches only comment/review events of that type.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "all",
        isAdvanced: true,
      },
      {
        id: "branch",
        name: "Branch",
        description:
          "Exact source branch or ref. Pull request events use the head branch, and push events remove the refs/heads/ prefix.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "main",
        isAdvanced: true,
      },
      {
        id: "label",
        name: "Label",
        description:
          "Match this label (case insensitive). For labeled/unlabeled events, match the label being changed; otherwise match current issue or pull request labels.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "incident",
        isAdvanced: true,
      },
      {
        id: "sender",
        name: "Senders",
        description:
          "Optional comma-separated GitHub usernames (case insensitive).",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "octocat, release-manager",
        isAdvanced: true,
      },
      {
        id: "ignoreBots",
        name: "Ignore Bots",
        description:
          "Defaults to true. Ignore bot accounts to prevent automated replies from repeatedly triggering workflows.",
        type: ComponentInputType.Boolean,
        required: false,
        isAdvanced: true,
      },
      {
        id: "requireWriteAccess",
        name: "Require Repository Write Access",
        description:
          "Defaults to true for comments and reviews. Check the sender's current GitHub repository write permission before running. Set false explicitly to accept comments from external contributors.",
        type: ComponentInputType.Boolean,
        required: false,
        isAdvanced: true,
      },
    ],
    returnValues: [
      ...textOutputs.map(
        ([id, name, description]: [string, string, string]): ReturnValue => {
          return {
            id,
            name,
            description,
            type: ComponentInputType.Text,
            required: false,
          };
        },
      ),
      {
        id: "issueNumber",
        name: "Issue or Pull Request Number",
        description: "Issue or pull request number, when present.",
        type: ComponentInputType.Number,
        required: false,
      },
      {
        id: "isPullRequest",
        name: "Is Pull Request",
        description:
          "True for pull request events and comments or reviews on a pull request.",
        type: ComponentInputType.Boolean,
        required: false,
      },
      {
        id: "isBot",
        name: "Is Bot",
        description: "Whether the event sender is a bot account.",
        type: ComponentInputType.Boolean,
        required: false,
      },
      {
        id: "labels",
        name: "Labels",
        description: "Current issue or pull request label names.",
        type: ComponentInputType.JSON,
        required: false,
      },
      {
        id: "payload",
        name: "GitHub Payload",
        description:
          "Complete verified GitHub event payload. Comment and issue content remains untrusted user input.",
        type: ComponentInputType.JSON,
        required: false,
      },
    ],
    inPorts: [],
    outPorts: [
      {
        id: "success",
        title: "Success",
        description:
          "Continue after a GitHub event matches the filters and sender access requirements.",
      },
    ],
  },
];

const sampleValues: Record<string, string> = {
  event: "issue_comment",
  action: "created",
  repository: "acme/service",
  codeRepositoryId:
    "Connected repository ID, or acme/service for GitHub actions",
  repositoryId: "123456",
  installationId: "123",
  deliveryId: "manual-sample",
  sender: "octocat",
  issueNumber: "42",
  comment: "@oneuptime incident Database unavailable",
  commandArguments: "Database unavailable",
  title: "Database unavailable",
  body: "The production database is unavailable.",
  url: "https://github.com/acme/service/issues/42",
  branch: "main",
  labels: '["incident", "production"]',
  payload:
    '{"action":"created","issue":{"number":42},"comment":{"body":"@oneuptime incident Database unavailable"}}',
};

for (const component of components) {
  component.runWorkflowManuallyArguments = component.returnValues.map(
    (value: ReturnValue): Argument => {
      return {
        ...value,
        required: false,
        placeholder: sampleValues[value.id],
        description:
          value.id === "event"
            ? "Sample event for a manual run. Your workflow actions will execute. As an authorized workflow author, you bypass GitHub delivery, sender, and filter checks for this run; connected repository actions still enforce project access."
            : value.id === "codeRepositoryId"
              ? "For manual tests, enter owner/repository (such as acme/service), or the repository's OneUptime ID. GitHub actions accept either form."
              : `Sample value for this manual run. ${value.description}`,
      };
    },
  );
}

export default components;
