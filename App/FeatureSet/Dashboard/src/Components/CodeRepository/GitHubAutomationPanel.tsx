import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isGitHubAppConfigured: boolean;
  workflowsRoute: Route;
  onSelectTemplate: (templateId: string) => void;
}

interface Starter {
  id: string;
  title: string;
  description: string;
  event: string;
  result: string;
}

const starters: Array<Starter> = [
  {
    id: "github-comment-incident",
    title: "Declare an incident from a comment",
    description:
      "Comment @oneuptime incident with a title on an issue or pull request. Create an incident and reply with its link.",
    event: "GitHub comment",
    result: "Incident + reply",
  },
  {
    id: "github-labeled-issue-incident",
    title: "Escalate a labeled issue",
    description:
      "Apply your incident label to a GitHub issue to bring it into your team's incident response process.",
    event: "Issue labeled",
    result: "OneUptime incident",
  },
  {
    id: "incident-created-github-issue",
    title: "Track incident follow-up in GitHub",
    description:
      "Open a GitHub issue when a OneUptime incident is declared, with a link back to the incident.",
    event: "Incident created",
    result: "GitHub issue",
  },
];

const GitHubAutomationPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Card
      title="Put GitHub events to work"
      description="Connect comments, issues, pull requests, and CI events to your team's response. Choose what should happen with a workflow."
      rightElement={
        <Link
          to={props.workflowsRoute}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          View workflows
        </Link>
      }
    >
      <section aria-label="GitHub automation">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {[
            "Comments",
            "Issues",
            "Pull requests",
            "Reviews",
            "CI & releases",
          ].map((event: string): ReactElement => {
            return (
              <span
                key={event}
                className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
              >
                {event}
              </span>
            );
          })}
          <span className="text-xs text-gray-500">
            Powered by your GitHub App
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {starters.map((starter: Starter): ReactElement => {
            return (
              <div
                key={starter.id}
                className="flex flex-col rounded-lg border border-gray-200 bg-white p-5"
              >
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500">
                  <span>{starter.event}</span>
                  <span aria-hidden="true">→</span>
                  <span className="text-indigo-600">{starter.result}</span>
                </div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {starter.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-gray-500">
                  {starter.description}
                </p>
                <button
                  type="button"
                  aria-label={`Use template: ${starter.title}`}
                  onClick={() => {
                    props.onSelectTemplate(starter.id);
                  }}
                  className="mt-4 w-fit rounded-md text-sm font-semibold text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Use template <span aria-hidden="true">→</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3">
          <Icon
            icon={IconProp.ShieldCheck}
            className="mt-0.5 h-4 w-4 text-gray-500"
          />
          <p className="text-sm leading-6 text-gray-600">
            Templates start switched off. Choose a repository, review the steps,
            then enable your workflow. Comment commands ignore bots and verify
            the author&apos;s current repository write access by default.
          </p>
        </div>

        <details className="mt-5 rounded-lg border border-gray-200">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-800 focus-visible:outline-indigo-500">
            {props.isGitHubAppConfigured
              ? "Set up event subscriptions and test your connection"
              : "Configure the GitHub App to receive events"}
          </summary>
          <div className="border-t border-gray-200 px-5 py-4 text-sm leading-6 text-gray-600">
            <ol className="list-decimal space-y-2 pl-4">
              <li>
                Connect your GitHub App to this project and give it access to
                the repositories your workflows will use.
              </li>
              <li>
                In the GitHub App&apos;s{" "}
                <strong>Permissions &amp; events</strong>, subscribe to the
                events you need. Comments on issues and pull request
                conversations use <strong>Issue comment</strong>. Inline review
                comments use <strong>Pull request review comment</strong>.
              </li>
              <li>
                Grant Issues and Pull requests read/write access for replies and
                updates. Existing installations must approve any new permissions
                in GitHub.
              </li>
              <li>
                Enable a workflow and send a matching event in a test
                repository. Check GitHub&apos;s{" "}
                <strong>Recent Deliveries</strong>, then the workflow&apos;s{" "}
                <strong>Logs</strong> in OneUptime.
              </li>
            </ol>
            <Link
              to={Route.fromString("/docs/integrations/github")}
              openInNewTab={true}
              className="mt-4 inline-block font-medium text-indigo-600 hover:underline"
            >
              Read the GitHub integration guide
            </Link>
          </div>
        </details>
      </section>
    </Card>
  );
};

export default GitHubAutomationPanel;
