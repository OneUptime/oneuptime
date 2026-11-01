import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * A list of names in a Persian sentence is joined with the Persian comma
 * ("، "), as Persian writes it: the products menu's folded category, a
 * lock's "You need one of these roles: ..." and the facet sidebar's hidden
 * filters each joined theirs with a Latin comma. Each now joins with the
 * comma of the script its names are written in (ListSeparator): names left
 * in English keep the English comma, as ListSeparator does for any list a
 * locale has not translated yet.
 */

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import NavBarCategoryToggle from "../../../UI/Components/Navbar/NavBarCategoryToggle";
import HiddenFacetsFooter from "../../../UI/Components/TelemetryViewer/components/HiddenFacetsFooter";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import Project from "../../../Models/DatabaseModels/Project";
import {
  ARABIC_LIST_SEPARATOR,
  LIST_SEPARATOR,
} from "../../../UI/Utils/ListSeparator";

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const PERSIAN: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DASHBOARD_LOCALES, "fa.json"), "utf-8"),
) as Record<string, string>;

const persian: Translator = createTranslator((text: string): string => {
  return PERSIAN[text] ?? text;
}, "fa");

afterEach(() => {
  cleanup();
});

describe("the products menu's folded category", () => {
  test("Persian names are joined with the Persian comma", () => {
    const names: Array<string> = ["Incidents", "Alerts", "Monitors"].map(
      (name: string): string => {
        return PERSIAN[name] as string;
      },
    );

    render(
      <NavBarCategoryToggle
        title={PERSIAN["Infrastructure"] as string}
        itemTitles={names}
        isOpen={false}
        onToggle={() => {}}
      />,
    );

    expect(
      screen.getByText(names.join(ARABIC_LIST_SEPARATOR)),
    ).toBeInTheDocument();
    expect(names.join(ARABIC_LIST_SEPARATOR)).toBe(
      "حوادث، هشدارها، مانیتورها",
    );
  });

  test("English names keep the English comma", () => {
    render(
      <NavBarCategoryToggle
        title="Infrastructure"
        itemTitles={["Hosts", "Kubernetes", "Docker"]}
        isOpen={false}
        onToggle={() => {}}
      />,
    );

    expect(
      screen.getByText(["Hosts", "Kubernetes", "Docker"].join(LIST_SEPARATOR)),
    ).toBeInTheDocument();
  });
});

describe("a lock's last sentence", () => {
  test("roles the Persian file names are joined with the Persian comma", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new ExternalMcpServer().getCreatePermissions(),
        persian,
      ),
    ).toBe(
      (PERSIAN["You need one of these roles: {{roles}}."] as string).replace(
        "{{roles}}",
        [PERSIAN["Project Owner"], PERSIAN["Project Admin"]].join(
          ARABIC_LIST_SEPARATOR,
        ),
      ),
    );
  });

  test("permission titles the Persian file has no words for keep the English comma", () => {
    const sentence: string = PermissionGate.getNeededPermissionsSentence(
      new Project().getUpdatePermissions(),
      persian,
    );

    expect(sentence).toContain("Manage Billing, Edit Project");
    expect(sentence).not.toContain("،");
  });
});

describe("the facet sidebar's hidden filters", () => {
  test("their names, in Persian, are joined with the Persian comma", () => {
    render(
      <HiddenFacetsFooter
        hiddenCount={2}
        hiddenTitles={[
          PERSIAN["Incidents"] as string,
          PERSIAN["Alerts"] as string,
        ]}
        isShowingHidden={true}
        onToggle={() => {}}
      />,
    );

    const footer: HTMLElement = screen.getByTestId(
      "facet-sidebar-hidden-footer",
    );
    const titled: Element | null = footer.querySelector(
      `[title="${PERSIAN["Incidents"]}${ARABIC_LIST_SEPARATOR}${PERSIAN["Alerts"]}"]`,
    );

    expect(titled).not.toBeNull();
  });
});
