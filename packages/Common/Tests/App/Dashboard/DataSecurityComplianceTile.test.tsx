import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ComplianceFrameworkTile, {
  getComplianceTileNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/ComplianceFrameworkTile";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { DataSecurityComplianceFramework } from "../../../Types/DataSecurity/DataSecurityApiTypes";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * ONE FRAMEWORK ON DATA SECURITY'S COMPLIANCE PAGE
 * (Components/DataSecurity/ComplianceFrameworkTile).
 *
 * A framework with no score said "Not evaluated" in large figures and then
 * "No requirement failing", which read as a pass: HIPAA on a project with no
 * health data, or every framework on a project whose stores were not read
 * yet. It now says why it has no score, quieter than a score, and its full
 * name - cut to one line - reads whole under the pointer.
 */

afterEach(() => {
  cleanup();
});

function framework(
  data: Partial<DataSecurityComplianceFramework>,
): DataSecurityComplianceFramework {
  return {
    framework: ComplianceFramework.GDPR,
    fullName: "EU General Data Protection Regulation",
    scope: "Personal data of people in the EU.",
    score: 57,
    storesInScope: 3,
    requirements: [],
    ...data,
  };
}

const FAILING: DataSecurityComplianceFramework["requirements"][number] = {
  requirement: "Art. 32",
  title: "Security of processing",
  status: ComplianceRequirementStatus.Failing,
  checkIds: ["public-read"],
  failingIssueCount: 1,
};

const PASSING: DataSecurityComplianceFramework["requirements"][number] = {
  requirement: "Art. 30",
  title: "Records of processing activities",
  status: ComplianceRequirementStatus.Passing,
  checkIds: [],
  failingIssueCount: 0,
};

describe("what a framework's last line says", () => {
  test("no store holds the data a framework protects: it says so, never 'No requirement failing'", () => {
    expect(
      getComplianceTileNote(framework({ score: null, storesInScope: 0 }), 0),
    ).toEqual({
      text: "No store holds the data it protects",
      isFailing: false,
    });
  });

  test("its stores are in scope but not read yet: it says so", () => {
    expect(
      getComplianceTileNote(framework({ score: null, storesInScope: 2 }), 0),
    ).toEqual({ text: "Its stores are not read yet", isFailing: false });
  });

  test("a score with requirements failing says how many; one with none failing says so", () => {
    expect(getComplianceTileNote(framework({ score: 57 }), 3)).toEqual({
      text: "",
      isFailing: true,
    });
    expect(getComplianceTileNote(framework({ score: 100 }), 0)).toEqual({
      text: "No requirement failing",
      isFailing: false,
    });
  });
});

describe("the tile", () => {
  test("a framework without a score says why, quieter than a score", () => {
    render(
      <ComplianceFrameworkTile
        framework={framework({
          framework: ComplianceFramework.HIPAA,
          fullName: "HIPAA Security Rule",
          score: null,
          storesInScope: 0,
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    const tile: HTMLElement = screen.getByTestId(
      "data-security-compliance-framework",
    );

    expect(tile).toHaveTextContent("Not evaluated");
    expect(tile).toHaveTextContent("No store holds the data it protects");
    expect(tile).not.toHaveTextContent("No requirement failing");
    expect(screen.getByText("Not evaluated")).toHaveClass("text-base");
    expect(screen.getByText("Not evaluated")).not.toHaveClass("text-2xl");
  });

  test("a scored framework shows its score large, and how many requirements fail", () => {
    render(
      <ComplianceFrameworkTile
        framework={framework({ requirements: [FAILING, PASSING] })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    const tile: HTMLElement = screen.getByTestId(
      "data-security-compliance-framework",
    );

    expect(tile).toHaveTextContent("57%");
    expect(tile).toHaveTextContent("1 requirement failing");
    expect(screen.getByText("57%")).toHaveClass("text-2xl");
  });

  test("a full name cut to one line reads whole under the pointer", () => {
    render(
      <ComplianceFrameworkTile
        framework={framework({
          framework: ComplianceFramework.CCPA,
          fullName:
            "California Consumer Privacy Act, as amended by the California Privacy Rights Act",
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "California Consumer Privacy Act, as amended by the California Privacy Rights Act",
      ),
    ).toHaveAttribute(
      "title",
      "California Consumer Privacy Act, as amended by the California Privacy Rights Act",
    );
  });
});
