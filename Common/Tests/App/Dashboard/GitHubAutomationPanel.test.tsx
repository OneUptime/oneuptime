import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import GitHubAutomationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/CodeRepository/GitHubAutomationPanel";
import Route from "../../../Types/API/Route";
import { getWorkflowTemplate } from "../../../Types/Workflow/Templates";

afterEach(cleanup);

const renderPanel: (configured?: boolean) => ReturnType<typeof jest.fn> = (
  configured: boolean = true,
): ReturnType<typeof jest.fn> => {
  const selectTemplate: ReturnType<typeof jest.fn> = jest.fn();
  render(
    <GitHubAutomationPanel
      isGitHubAppConfigured={configured}
      workflowsRoute={Route.fromString("/dashboard/project-a/workflows")}
      onSelectTemplate={selectTemplate}
    />,
  );
  return selectTemplate;
};

describe("GitHub automation onboarding", () => {
  test("explains event workflows and requires explicit enablement", () => {
    renderPanel();
    expect(
      screen.getByRole("region", { name: "GitHub automation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Comments")).toBeInTheDocument();
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Pull requests")).toBeInTheDocument();
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.getByText("CI & releases")).toBeInTheDocument();
    expect(screen.getByText(/Templates start switched off/)).toHaveTextContent(
      /verify the author's current repository write access/,
    );
    expect(screen.getByText(/Templates start switched off/)).toHaveTextContent(
      /ignore bots/,
    );
  });

  test.each([
    ["Declare an incident from a comment", "github-comment-incident"],
    ["Escalate a labeled issue", "github-labeled-issue-incident"],
    ["Track incident follow-up in GitHub", "incident-created-github-issue"],
  ])(
    "%s opens the corresponding real template",
    (name: string, templateId: string) => {
      const selectTemplate: ReturnType<typeof jest.fn> = renderPanel();
      expect(getWorkflowTemplate(templateId)).not.toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: `Use template: ${name}` }),
      );
      expect(selectTemplate).toHaveBeenCalledTimes(1);
      expect(selectTemplate).toHaveBeenCalledWith(templateId);
    },
  );

  test("does not start a workflow just by showing the onboarding panel", () => {
    const selectTemplate: ReturnType<typeof jest.fn> = renderPanel();
    expect(selectTemplate).not.toHaveBeenCalled();
  });

  test("uses the current project's workflow route", () => {
    renderPanel();
    expect(
      screen.getByRole("link", { name: "View workflows" }),
    ).toHaveAttribute("href", "/dashboard/project-a/workflows");
  });

  test("keeps setup guidance discoverable and distinguishes conversation from review comments", () => {
    renderPanel();
    const disclosure: HTMLElement | null = screen
      .getByText("Set up event subscriptions and test your connection")
      .closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(
      screen.getByText("Set up event subscriptions and test your connection"),
    );
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("Issue comment")).toBeInTheDocument();
    expect(screen.getByText("Pull request review comment")).toBeInTheDocument();
    expect(
      screen.getByText(/Existing installations must approve/),
    ).toBeInTheDocument();
    expect(screen.getByText("Recent Deliveries")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Read the GitHub integration guide" }),
    ).toHaveAttribute("href", "/docs/integrations/github");
  });

  test("offers setup and draft templates when this server's GitHub App is missing", () => {
    renderPanel(false);
    expect(
      screen.getByText("Configure the GitHub App to receive events"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Set up event subscriptions and test your connection"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Use template:/ }),
    ).toHaveLength(3);
  });
});
