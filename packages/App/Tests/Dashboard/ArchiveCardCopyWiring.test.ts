import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Archive card on the Settings page of a workflow, monitor, status page,
 * dashboard and on-call policy.
 *
 * ArchiveResourceCard's own defaults describe a telemetry resource that
 * "keeps collecting telemetry" while archived - the opposite of what happens
 * to these five, which stop their work. So each Settings page must hand the
 * card every one of its resource's words (ResourceArchiveCopy), and the list
 * to go back to once it is archived. A card missing one prop still renders,
 * with the telemetry sentence in it; this reads the pages and checks every
 * prop is wired.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

interface SettingsPage {
  model: string;
  file: string;
  copy: string;
  listPage: string;
}

const PAGES: Array<SettingsPage> = [
  {
    model: "Workflow",
    file: "Pages/Workflow/View/Settings.tsx",
    copy: "WORKFLOW_ARCHIVE_COPY",
    listPage: "WORKFLOWS",
  },
  {
    model: "Monitor",
    file: "Pages/Monitor/View/Settings.tsx",
    copy: "MONITOR_ARCHIVE_COPY",
    listPage: "MONITORS",
  },
  {
    model: "StatusPage",
    file: "Pages/StatusPages/View/StatusPageSettings.tsx",
    copy: "STATUS_PAGE_ARCHIVE_COPY",
    listPage: "STATUS_PAGES",
  },
  {
    model: "Dashboard",
    file: "Pages/Dashboards/View/Settings.tsx",
    copy: "DASHBOARD_ARCHIVE_COPY",
    listPage: "DASHBOARDS",
  },
  {
    model: "OnCallDutyPolicy",
    file: "Pages/OnCallDuty/OnCallDutyPolicy/Settings.tsx",
    copy: "ON_CALL_POLICY_ARCHIVE_COPY",
    listPage: "ON_CALL_DUTY_POLICIES",
  },
];

const COPY_PROPS: Array<string> = [
  "archiveCardDescription",
  "unarchiveCardDescription",
  "archiveConfirmMessage",
  "unarchiveConfirmMessage",
];

function squash(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

// The `<ArchiveResourceCard<Model> ... />` element, props and all.
function archiveCard(page: SettingsPage): string {
  const source: string = squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, page.file), "utf8"),
  );
  const start: number = source.indexOf(`<ArchiveResourceCard<${page.model}>`);

  if (start === -1) {
    throw new Error(`${page.file} has no ArchiveResourceCard.`);
  }

  const end: number = source.indexOf("/>", start);
  return source.slice(start, end + 2);
}

describe.each(PAGES)("the $model Settings page's Archive card", (page: SettingsPage) => {
  test("is for this resource, named in its words", () => {
    const card: string = archiveCard(page);

    expect(card).toContain(`modelType={${page.model}}`);
    expect(card).toContain("modelId={modelId}");
    expect(card).toContain(`singularName={${page.copy}.singularName}`);
  });

  test.each(COPY_PROPS)("passes the resource's %s, never the telemetry default", (prop: string) => {
    expect(archiveCard(page)).toMatch(
      new RegExp(`${prop}=\\{\\s*${page.copy}\\.${prop}\\s*\\}`),
    );
  });

  test("goes back to the resource's list after archiving", () => {
    expect(archiveCard(page)).toMatch(
      new RegExp(
        `listRoute=\\{RouteUtil\\.populateRouteParams\\(\\s*RouteMap\\[PageMap\\.${page.listPage}\\] as Route,?\\s*\\)\\s*\\}`,
      ),
    );
  });

  test("imports its words from ResourceArchiveCopy", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, page.file),
      "utf8",
    );

    expect(source).toMatch(
      new RegExp(
        `import \\{ ${page.copy} \\} from "[./]+Components/Archive/ResourceArchiveCopy";`,
      ),
    );
  });
});
