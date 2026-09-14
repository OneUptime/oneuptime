import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import InventoryItemSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/View/SideMenu";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionRoot,
  sectionTitlesInOrder,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

const ITEM_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";
const ITEM_PATH: string = `/dashboard/${PROJECT_ID}/inventory/item/${ITEM_ID}`;
const AUDIT_LOGS_PATH: string = `${ITEM_PATH}/audit-logs`;

async function renderInventoryItemMenu(): Promise<void> {
  await renderMenu(<InventoryItemSideMenu modelId={new ObjectID(ITEM_ID)} />);
}

describe("Inventory item side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(AUDIT_LOGS_PATH);
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the item sections in their expected order", async () => {
    await renderInventoryItemMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Item",
      "Telemetry",
      "Operations",
      "Advanced",
    ]);
  });

  test("keeps the unchanged item and telemetry destinations intact", async () => {
    await renderInventoryItemMenu();

    expect(linksIn("Item")).toEqual([
      { title: "Overview", href: ITEM_PATH },
      { title: "Connections", href: `${ITEM_PATH}/relationships` },
      { title: "Custom Fields", href: `${ITEM_PATH}/custom-fields` },
    ]);
    expect(linksIn("Telemetry")).toEqual([
      { title: "Logs", href: `${ITEM_PATH}/logs` },
      { title: "Traces", href: `${ITEM_PATH}/traces` },
      { title: "Metrics", href: `${ITEM_PATH}/metrics` },
      { title: "Performance Profiles", href: `${ITEM_PATH}/profiles` },
      { title: "Exceptions", href: `${ITEM_PATH}/exceptions` },
    ]);
  });

  test("Operations contains only live operational activity", async () => {
    await renderInventoryItemMenu();

    expect(linksIn("Operations")).toEqual([
      { title: "Incidents", href: `${ITEM_PATH}/incidents` },
      { title: "Alerts", href: `${ITEM_PATH}/alerts` },
      {
        title: "Scheduled Maintenance",
        href: `${ITEM_PATH}/scheduled-maintenance`,
      },
    ]);
  });

  test("Advanced contains Settings, Audit Logs, and Delete Item in order", async () => {
    await renderInventoryItemMenu();

    expect(linksIn("Advanced")).toEqual([
      { title: "Settings", href: `${ITEM_PATH}/settings` },
      { title: "Audit Logs", href: AUDIT_LOGS_PATH },
      { title: "Delete Item", href: `${ITEM_PATH}/delete` },
    ]);
    expect(iconCountIn("Advanced")).toBe(3);
  });

  test("lists every destination exactly once and fully populates its route", async () => {
    await renderInventoryItemMenu();

    const hrefs: Array<string> = hrefsInMenu();
    const titles: Array<string> = titlesInMenu();

    expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    expect(titles).toEqual(Array.from(new Set(titles)));
    expect(
      hrefs.filter((href: string): boolean => {
        return href === AUDIT_LOGS_PATH;
      }),
    ).toHaveLength(1);
    expect(
      titles.filter((title: string): boolean => {
        return title === "Audit Logs";
      }),
    ).toHaveLength(1);

    hrefs.forEach((href: string) => {
      expect(href).toContain(ITEM_PATH);
      expect(href).not.toContain(":projectId");
      expect(href).not.toContain(":modelId");
    });
  });

  test("marks Audit Logs active in the expanded Advanced section", async () => {
    await renderInventoryItemMenu();

    const auditLogAnchor: HTMLAnchorElement | undefined = Array.from(
      sectionRoot("Advanced").querySelectorAll<HTMLAnchorElement>("a"),
    ).find((anchor: HTMLAnchorElement): boolean => {
      return anchor.getAttribute("href") === AUDIT_LOGS_PATH;
    });

    expect(auditLogAnchor).toBeDefined();
    expect(auditLogAnchor).toHaveClass("bg-indigo-50", "text-indigo-700");
    expect(isExpanded("Advanced")).toBe(true);
  });

  test("the mobile summary names Audit Logs as an Advanced page", async () => {
    setViewportWidth(MOBILE_WIDTH);

    await renderInventoryItemMenu();

    expect(mobileSummaryText()).toContain("Advanced / Audit Logs");
  });

  test("all rendered links retain a visible label and icon", async () => {
    await renderInventoryItemMenu();

    sectionTitlesInOrder().forEach((sectionTitle: string) => {
      const links: Array<MenuLink> = linksIn(sectionTitle);

      expect(iconCountIn(sectionTitle)).toBe(links.length);
      links.forEach((link: MenuLink) => {
        expect(link.title).not.toBe("");
      });
    });
  });
});
