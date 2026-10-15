import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (options && typeof options === "object") {
            return (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return typeof options === "string" ? options : key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import RunbookViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/SideMenu";
import { getRunbooksBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import {
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  linksIn,
  renderMenu,
} from "./SideMenuHarness";

/*
 * WHERE THE TRIGGERS PAGE IS.
 *
 * A runbook's schedule and webhook are how it starts on its own, so they
 * sit with how it runs: in the runbook's Basic menu, right after
 * Executions, as "Triggers" - at /runbooks/<id>/triggers, with breadcrumbs
 * Project > Runbooks > View Runbook > Triggers.
 */

const RUNBOOK_ID: string = "2d4f6a8c-1b3e-4c5d-8e7f-9a0b1c2d3e4f";

afterEach(() => {
  cleanup();
});

describe("the runbook's side menu", () => {
  test("names Triggers in Basic, right after Executions, and marks it on its page", async () => {
    const path: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/triggers`;
    goTo(path);

    await renderMenu(
      <MemoryRouter initialEntries={[path]}>
        <RunbookViewSideMenu modelId={new ObjectID(RUNBOOK_ID)} />
      </MemoryRouter>,
    );

    const basic: Array<MenuLink> = linksIn("Basic");

    expect(
      basic.map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Overview", "Steps", "Executions", "Triggers"]);
    expect(basic[3]!.href).toBe(path);
    expect(activeLinkTitles()).toEqual(["Triggers"]);
  });
});

describe("the Triggers page's address and breadcrumbs", () => {
  test("is the runbook's own /triggers", () => {
    expect(RouteMap[PageMap.RUNBOOK_VIEW_TRIGGERS]!.toString()).toBe(
      "/dashboard/:projectId/runbooks/:id/triggers",
    );
  });

  test("reads Project > Runbooks > View Runbook > Triggers", () => {
    const links: Array<Link> | undefined = getRunbooksBreadcrumbs(
      RouteMap[PageMap.RUNBOOK_VIEW_TRIGGERS]!.toString(),
    );

    expect(
      (links || []).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Runbooks", "View Runbook", "Triggers"]);
  });
});
