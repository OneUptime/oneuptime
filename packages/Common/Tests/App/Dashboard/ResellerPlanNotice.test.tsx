import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getJestSpyOn } from "../../Spy";
import ResellerPlanNotice from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/ResellerPlanNotice";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import URL from "../../../Types/API/URL";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * What a product page says when the plan a reseller sold leaves the product
 * out (#9129). It was a red error copied into every one of those pages,
 * "Looks like you have bought this plan from a reseller. It did not include
 * telemetry features in your plan. Telemetry features are disabled for this
 * project.", with no way forward. It now says what the plan leaves out, as
 * information, and who to ask: the reseller by name, with their contact when
 * they gave one, and their own Change Plan page when they have one.
 */

const DASHBOARD_PAGES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages",
);

function projectFrom(reseller: Partial<Reseller> | undefined): Project {
  const project: Project = new Project();

  if (reseller) {
    const value: Reseller = new Reseller();
    value.enableTelemetryFeatures = false;
    Object.assign(value, reseller);
    project.reseller = value;
  }

  return project;
}

function sourceFiles(dir: string): Array<string> {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(full);
      }
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
        ? [full]
        : [];
    });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("ResellerPlanNotice", () => {
  it("names the reseller and how to reach them, for a reseller who gave a contact", () => {
    render(
      <ResellerPlanNotice
        project={projectFrom({
          name: "Acme Cloud",
          description: "sales@acme.example",
        })}
        product="Logs"
      />,
    );

    expect(
      screen.getByText("Your plan does not include logs"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Contact Acme Cloud at sales@acme.example to add logs to your plan.",
      ),
    ).toBeInTheDocument();
    // No Change Plan page of theirs, so no button.
    expect(screen.queryByTestId("reseller-plan-notice-change-plan")).toBeNull();
  });

  it("names the reseller alone, for a reseller who gave no contact", () => {
    render(
      <ResellerPlanNotice
        project={projectFrom({ name: "Acme Cloud", description: "  " })}
        product="Traces"
      />,
    );

    expect(
      screen.getByText(
        "Contact Acme Cloud, the company you bought your plan from, to add traces to it.",
      ),
    ).toBeInTheDocument();
  });

  it("still says who to ask when the reseller's name has not loaded", () => {
    render(<ResellerPlanNotice project={projectFrom({})} product="Metrics" />);

    expect(
      screen.getByText(
        "Contact the company you bought your plan from to add metrics to it.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps a name's capitals in the sentence", () => {
    render(
      <ResellerPlanNotice
        project={projectFrom({ name: "Acme Cloud" })}
        product="AI / LLM"
      />,
    );

    expect(
      screen.getByText("Your plan does not include AI / LLM"),
    ).toBeInTheDocument();
  });

  it("opens the reseller's Change Plan page when they have one", () => {
    const navigate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {});

    render(
      <ResellerPlanNotice
        project={projectFrom({
          name: "Acme Cloud",
          description: "sales@acme.example",
          changePlanLink: URL.fromString("https://acme.example/plans"),
        })}
        product="Exceptions"
      />,
    );

    fireEvent.click(screen.getByTestId("reseller-plan-notice-change-plan"));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      "https://acme.example/plans",
    );
    expect(navigate.mock.calls[0]![1]).toEqual({ openInNewTab: true });
  });

  it("is information, not an error", () => {
    const { container } = render(
      <ResellerPlanNotice
        project={projectFrom({ name: "Acme Cloud" })}
        product="Logs"
      />,
    );

    expect(container.querySelector("[class*='red']")).toBeNull();
  });

  it("is the one notice every product page draws, with no copy of the old error left", () => {
    const pages: Array<string> = sourceFiles(DASHBOARD_PAGES);
    const drawing: Array<string> = pages.filter((file: string): boolean => {
      return fs.readFileSync(file, "utf8").includes("<ResellerPlanNotice");
    });

    for (const file of pages) {
      const source: string = fs.readFileSync(file, "utf8");
      expect(source).not.toContain("bought this plan from a reseller");
      expect(source).not.toContain("Telemetry features are disabled");
    }

    // Logs, Traces, Metrics, Exceptions, Profiles, AI / LLM, Security Events, Cloud.
    for (const product of [
      "Logs/Index.tsx",
      "Logs/Insights.tsx",
      "Traces/Index.tsx",
      "Metrics/Index.tsx",
      "Exceptions/Overview.tsx",
      "Exceptions/Unresolved.tsx",
      "Exceptions/Resolved.tsx",
      "Exceptions/Archived.tsx",
      "Profiles/Index.tsx",
      "Llm/Connect.tsx",
      "SecurityEvents/Index.tsx",
      "Cloud/Connect.tsx",
    ]) {
      expect(
        drawing.some((file: string): boolean => {
          return file.endsWith(path.join(...product.split("/")));
        }),
      ).toBe(true);
    }
  });
});
