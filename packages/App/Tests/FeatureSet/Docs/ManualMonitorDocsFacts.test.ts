import { readPage } from "./DocsContentSupport";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { PermissionHelper } from "Common/Types/Permission";
import {
  getApiBaseUrl,
  getCurlCommand,
} from "Common/Utils/DeveloperDocs/ApiExamples";
import { ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE } from "Common/Utils/DeveloperDocs/ExampleValues";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Manual Monitor page says about the product, held to the
 * code that makes it true: where the type picker offers Manual, that it is
 * created from the first step with no interval, probes or criteria, that it
 * is not billed as an active monitor, how its status is changed on the
 * Status Timeline and through the API (the endpoint, the fields, the answer
 * to a status it already has), and what an incident does to it.
 *
 * Markdown is not compiled, so nothing else notices when the create form
 * grows a step for Manual, the timeline's form is renamed, or the API moves.
 * MonitorChecksDocsTranslations holds the translations to this page.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const CREATE_PAGE_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/Create.tsx";
const MONITOR_VIEW_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu.tsx";
const STATUS_TIMELINE_PAGE_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline.tsx";
const MONITORS_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx";
const MONITOR_STATUS_SETTINGS_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorStatus.tsx";
const MODEL_TABLE_FILE: string =
  "Common/UI/Components/ModelTable/BaseModelTable.tsx";
const TIMELINE_SERVICE_FILE: string =
  "Common/Server/Services/MonitorStatusTimelineService.ts";
const INCIDENT_SERVICE_FILE: string = "Common/Server/Services/IncidentService.ts";
const INCIDENT_STATE_TIMELINE_SERVICE_FILE: string =
  "Common/Server/Services/IncidentStateTimelineService.ts";
const ACTIVE_MONITORING_PLAN_FILE: string =
  "Common/Server/Types/Billing/MeteredPlan/ActiveMonitoringMeteredPlan.ts";

const PAGE: string = "monitor/manual-monitor";

const FENCE: RegExp = /```bash\n([\s\S]*?)\n```/;
const DATA_LINE: RegExp = /-d '([^']+)'/;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

const page: string = readPage("en", PAGE);

/*
 * The source between `start` and the first `end` after it - the body of a
 * function, from its name to the next declaration.
 */
function sourceBetween(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = source.indexOf(end, from + start.length);

  return source.slice(from, to < 0 ? undefined : to);
}

// The body of one heading's section, up to the next heading.
function section(heading: string): string {
  const start: number = page.indexOf(`${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = page.slice(start + heading.length + 1);
  const next: RegExpMatchArray | null = rest.match(new RegExp("^#{1,3} ", "m"));

  return next && next.index !== undefined ? rest.slice(0, next.index) : rest;
}

describe("creating a manual monitor", () => {
  it("is picked under Other, behind More monitor types", () => {
    const category: MonitorTypeCategory | undefined =
      MonitorTypeHelper.getMonitorTypeCategories().find(
        (candidate: MonitorTypeCategory): boolean => {
          return candidate.monitorTypes.includes(MonitorType.Manual);
        },
      );

    expect(
      MonitorTypeHelper.getCommonMonitorTypes().includes(MonitorType.Manual),
    ).toBe(false);
    expect(category?.label).toBe("Other");
    expect(page).toContain(
      `click **More monitor types** and pick **${MonitorTypeHelper.getTitle(MonitorType.Manual)}** under **${category!.label}**.`,
    );
  });

  it("has no monitoring interval, probes or criteria", () => {
    expect(MonitorTypeHelper.doesMonitorTypeHaveInterval(MonitorType.Manual)).toBe(
      false,
    );
    expect(MonitorTypeHelper.isProbableMonitor(MonitorType.Manual)).toBe(false);
    expect(MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.Manual)).toBe(
      false,
    );
    expect(page).toContain(
      "A manual monitor has no monitoring interval, probes or criteria.",
    );
  });

  it("is created from the first step, with the description folded under More fields", () => {
    const create: string = readRepoFile(CREATE_PAGE_FILE);
    const steps: string = sourceBetween(create, "steps={[", "]}");

    // The Criteria step is skipped for Manual, Probes & Interval by the interval.
    expect(steps).toContain('title: "Monitor Info"');
    expect(steps).toContain(
      'title: "Criteria",\n                  id: "criteria",\n                  showIf: (values: FormValues<Monitor>) => {\n                    return values.monitorType !== MonitorType.Manual;',
    );
    expect(steps).toContain('title: "Probes & Interval"');
    expect(steps).toContain("return MonitorTypeHelper.doesMonitorTypeHaveInterval(");

    const description: string = sourceBetween(
      create,
      "field: {\n                    description: true,",
      "},\n                /*",
    );

    expect(description).toContain("collapsibleSection: MONITOR_INFO_MORE_FIELDS,");
    expect(create).toContain(
      "const MONITOR_INFO_MORE_FIELDS: FormFieldCollapsibleSection<Monitor> =\n  getAdvancedFormSection<Monitor>();",
    );
    expect(page).toContain(
      "Enter a **Name** — and a **Description** under **More fields**, if you like — then click **Create Monitor**.",
    );
    expect(page).toContain("it is created from this first step.");
  });

  it("is not an active monitor, so it adds nothing to the bill", () => {
    expect(MonitorTypeHelper.isBilledAsActiveMonitor(MonitorType.Manual)).toBe(
      false,
    );
    expect(readRepoFile(ACTIVE_MONITORING_PLAN_FILE)).toContain(
      "monitorType: QueryHelper.notEquals(MonitorType.Manual),",
    );
    expect(page).toContain(
      "A Manual monitor is not an active monitor, so on OneUptime Cloud it adds nothing to your bill.",
    );
  });
});

describe("changing its status in the dashboard", () => {
  const dashboard: string = section("### In the dashboard");

  it("starts on the Status Timeline, which every monitor's menu has", () => {
    const menu: string = readRepoFile(MONITOR_VIEW_MENU_FILE);
    const overview: string = sourceBetween(
      menu,
      "// Overview section items",
      "// Activity section items",
    );

    // Not behind a monitor-type condition.
    expect(overview).toContain('title: "Status Timeline",');
    expect(overview).not.toContain("isManualMonitor");
    expect(dashboard).toContain(
      "Open the monitor and click **Status Timeline** in its side menu.",
    );
  });

  it("creates a status event with the button the timeline draws", () => {
    const timeline: string = readRepoFile(STATUS_TIMELINE_PAGE_FILE);
    const singularName: string = new MonitorStatusTimeline().singularName!;

    expect(singularName).toBe("Monitor Status Event");
    expect(timeline).toContain("isCreateable={true}");
    // ModelTable's create button and the dialog's submit: "Create {{itemName}}".
    expect(readRepoFile(MODEL_TABLE_FILE)).toContain(
      'Create: translationKey("Create {{itemName}}"),',
    );
    expect(dashboard).toContain(`Click **Create ${singularName}**.`);
    expect(dashboard).toContain(
      `4. Click **Create ${singularName}**. The new status shows`,
    );
  });

  it("asks for the status and when it starts, now by default", () => {
    const timeline: string = readRepoFile(STATUS_TIMELINE_PAGE_FILE);
    const fields: string = sourceBetween(timeline, "formFields={[", "]}");

    expect(fields).toContain('title: "Monitor Status",');
    expect(fields).toContain('title: "Starts At",');
    expect(fields).toContain(
      "getDefaultValue: () => {\n              return OneUptimeDate.getCurrentDate();",
    );
    expect(dashboard).toContain(
      "Pick the **Monitor Status**. **Starts At** is now; set an earlier time if the change happened earlier.",
    );
  });

  it("lets the people who can change monitors create the event", () => {
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      new MonitorStatusTimeline().getCreatePermissions(),
    );

    // The roles that can create monitors can also set their status.
    for (const role of [
      "Project Owner",
      "Project Admin",
      "Project Member",
      "Monitor Admin",
      "Monitor Member",
    ]) {
      expect({ role, can: titles.includes(role) }).toEqual({ role, can: true });
    }
  });
});

describe("changing its status through the API", () => {
  const api: string = section("### Through the API");
  const command: string = (FENCE.exec(api)?.[1] as string) || "";
  const body: { data: Record<string, string> } = JSON.parse(
    (DATA_LINE.exec(command)?.[1] as string) || "{}",
  );

  it("posts to the monitor status timeline's create endpoint", () => {
    const model: MonitorStatusTimeline = new MonitorStatusTimeline();
    const url: string = `${getApiBaseUrl("https://oneuptime.com")}${model
      .getCrudApiPath()!
      .toString()}`;

    expect(url).toBe("https://oneuptime.com/api/monitor-status-timeline");
    expect(command.split("\n")[0]).toBe(`curl -X POST ${url} \\`);
  });

  it("sends the API key and the JSON the way the Developer pages' commands do", () => {
    const reference: string = getCurlCommand({
      method: "POST",
      url: "https://oneuptime.com/api/monitor-status-timeline",
      body: { data: {} },
    });
    const header: string = `-H "ApiKey: $${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}"`;

    expect(reference).toContain(header);
    expect(command).toContain(header);
    expect(reference).toContain('-H "Content-Type: application/json"');
    expect(command).toContain('-H "Content-Type: application/json"');
    expect(api).toContain("in the `ApiKey` header");
  });

  it("names fields the model has, and only the two a new event needs", () => {
    const model: MonitorStatusTimeline = new MonitorStatusTimeline();

    expect(Object.keys(body.data).sort()).toEqual(
      ["monitorId", "monitorStatusId"].sort(),
    );

    for (const field of [...Object.keys(body.data), "startsAt"]) {
      expect({ field, column: model.hasColumn(field) }).toEqual({
        field,
        column: true,
      });
      expect(api).toContain(`\`${field}\``);
    }
  });

  it("starts the change now when startsAt is left out", () => {
    const service: string = readRepoFile(TIMELINE_SERVICE_FILE);

    expect(service).toContain(
      "if (!createBy.data.startsAt) {\n      createBy.data.startsAt = OneUptimeDate.getCurrentDate();",
    );
    expect(api).toContain("`startsAt` is optional. Left out, the change starts now.");
  });

  it("quotes the refusal of a status the monitor already has", () => {
    const service: string = readRepoFile(TIMELINE_SERVICE_FILE);
    const message: string = "Monitor Status cannot be same as previous status.";

    expect(service).toContain(
      `export const MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE: string =\n  "${message}";`,
    );
    expect(service).toContain(
      "throw new BadDataException(\n          MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,",
    );
    expect(api).toContain(`\`${message}\``);
  });

  it("sends readers to the status's Show ID, on the Monitor Status settings page", () => {
    expect(readRepoFile(MONITOR_STATUS_SETTINGS_FILE)).toContain(
      "showViewIdButton={true}",
    );
    expect(readRepoFile(MONITORS_MENU_FILE)).toContain('title: "Monitor Status",');
    expect(readRepoFile(MODEL_TABLE_FILE)).toContain('title: tx("Show ID"),');
    expect(api).toContain(
      "on **Monitors → Settings → Monitor Status**, pick **Show ID** in that status's row.",
    );
  });
});

describe("incidents on a manual monitor", () => {
  const incidents: string = section("## Incidents and Alerts");

  it("sets the status back to operational when the incident is resolved, unless another is open", () => {
    const resolve: string = readRepoFile(INCIDENT_STATE_TIMELINE_SERVICE_FILE);
    const giveBack: string = sourceBetween(
      readRepoFile(INCIDENT_SERVICE_FILE),
      "public async markMonitorsActiveForMonitoring(",
      "protected override async onBeforeDelete(",
    );

    expect(resolve).toContain("await IncidentService.markMonitorsActiveForMonitoring(");
    expect(giveBack).toContain("isOperationalState: true,");
    expect(giveBack).toContain("await this.doesMonitorHaveActiveIncidents(");
    expect(incidents).toContain(
      "resolving it sets the monitor back to operational, unless another incident on it is still open",
    );
    expect(incidents).toContain(
      "(/docs/incidents/declaring-incidents#step-2-resources-affected)",
    );
  });
});
