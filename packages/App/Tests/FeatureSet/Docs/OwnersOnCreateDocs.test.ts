import Alert from "Common/Models/DatabaseModels/Alert";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OwnerNotificationDeliveries from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import {
  OWNER_TEAMS_ON_CREATE_KEY,
  OWNER_USERS_ON_CREATE_KEY,
  TABLES_TAKING_OWNERS_ON_CREATE,
} from "Common/Types/Database/OwnersOnCreate";
import ComponentMetadata, { Argument } from "Common/Types/Workflow/Component";
import BaseModelComponents from "Common/Types/Workflow/Components/BaseModel";
import { drawnStepName } from "./DocsWorkflowStepNames";
import { generateToolsForDatabaseModel } from "../../../FeatureSet/MCP/Tools/ToolGenerator";
import { McpToolInfo } from "../../../FeatureSet/MCP/Types/McpTypes";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS ON THE OWNERS A CREATE HANDS OVER, AND ON A STOP PART WAY
 * (#8198, #8199).
 *
 * An incident's or an alert's owners hear it was created about a minute
 * after the create, every owner it has by then. The create itself takes
 * the owners it starts with: the REST create in miscDataProps, a
 * workflow's Create One Incident and Create One Alert as Owner Users and
 * Owner Teams, and the MCP server's create tools as ownerUsers and
 * ownerTeams. And every owner notification job of an incident or an alert
 * writes whom it is to tell before it tells anyone, so the owners a stopped
 * worker had not got to yet are told by a later run, and nobody twice. The
 * alerts, declaring, workflow, MCP and owners pages say so in every
 * language; Markdown is not compiled, so these tests are what notices when
 * the pages and the code part ways.
 */

type ModelClass = { new (): DatabaseBaseModel };

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");

const ALERTS: string = "alerts/index";
const DECLARING: string = "incidents/declaring-incidents";
const COMPONENTS: string = "workflows/components";
const MCP: string = "ai/mcp-server";
const OWNERS: string = "incidents/notes-owners-and-feed";
const SETTINGS: string = "notifications/notification-settings";

const OWNER_SETTINGS: Array<string> = ["Owner Users", "Owner Teams"];

const JOBS: Array<string> = [
  "SendCreatedResourceNotification",
  "SendStateChangeNotification",
  "SendNotePostedNotification",
  "SendOwnerAddedNotification",
  "SendUnresolvedReminderNotification",
];

// The words each language says "a few minutes late" with.
const A_FEW_MINUTES: Record<string, RegExp> = {
  en: /a few minutes late/,
  da: /et par minutter/,
  de: /ein paar Minuten/,
  es: /unos minutos/,
  fa: /چند دقیقه/,
  fr: /quelques minutes/,
  hi: /कुछ मिनट/,
  it: /qualche minuto/,
  ja: /数分遅れ/,
  ko: /몇 분 늦게/,
  nl: /een paar minuten/,
  no: /noen minutter/,
  pt: /alguns minutos/,
  ru: /несколько минут/,
  sv: /några minuter/,
  "zh-CN": /晚几分钟/,
  "zh-TW": /晚幾分鐘/,
};

function createStep(modelType: ModelClass): ComponentMetadata {
  const model: DatabaseBaseModel = new modelType();
  const step: ComponentMetadata | undefined = BaseModelComponents.getComponents(
    model,
  ).find((component: ComponentMetadata): boolean => {
    return component.title === `Create One ${model.singularName}`;
  });

  expect(step).toBeDefined();

  return step!;
}

function settingsOf(step: ComponentMetadata): Array<string> {
  return step.arguments.map((argument: Argument): string => {
    return argument.name;
  });
}

function createTool(modelType: ModelClass): McpToolInfo {
  const tool: McpToolInfo | undefined = generateToolsForDatabaseModel(
    new modelType(),
    modelType,
  ).tools.find((each: McpToolInfo): boolean => {
    return each.name.startsWith("create_");
  });

  expect(tool).toBeDefined();

  return tool!;
}

// The section under a heading, up to the next heading of its level or above.
function section(page: string, heading: string): string {
  const start: number = page.indexOf(`${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const level: string = heading.slice(0, heading.indexOf(" ") + 1);
  const rest: string = page.slice(start + heading.length + 1);
  const next: RegExpMatchArray | null = rest.match(
    new RegExp(`\\n#{1,${level.trim().length}} `),
  );

  return next ? rest.slice(0, next.index) : rest;
}

// The line of a page holding a marker, which every language keeps as written.
function lineWith(language: string, page: string, marker: string): string {
  const lines: Array<string> = readPage(language, page)
    .split("\n")
    .filter((line: string): boolean => {
      return line.includes(marker);
    });

  expect([language, page, marker, lines.length]).toEqual([
    language,
    page,
    marker,
    1,
  ]);

  return lines[0]!;
}

describe("the docs on the owners an incident's or an alert's create hands over", () => {
  test("the create takes them as the pages name them, and only an incident's and an alert's", () => {
    expect(OWNER_USERS_ON_CREATE_KEY).toBe("ownerUsers");
    expect(OWNER_TEAMS_ON_CREATE_KEY).toBe("ownerTeams");
    expect([...TABLES_TAKING_OWNERS_ON_CREATE].sort()).toEqual([
      "Alert",
      "Incident",
    ]);

    // The REST create the alerts page sends them to.
    expect(new Alert().getCrudApiPath()?.toString()).toBe("/alert");
    expect(new Incident().getCrudApiPath()?.toString()).toBe("/incident");

    // The workflow steps' settings, by the names the pages give them.
    expect(createStep(Alert).title).toBe("Create One Alert");
    expect(createStep(Incident).title).toBe("Create One Incident");

    for (const modelType of [Alert, Incident]) {
      expect(settingsOf(createStep(modelType))).toEqual(
        expect.arrayContaining(OWNER_SETTINGS),
      );
    }

    for (const setting of OWNER_SETTINGS) {
      expect(settingsOf(createStep(Monitor))).not.toContain(setting);
    }

    // The MCP server's create tools, by the names the pages give them.
    expect(createTool(Alert).name).toBe("create_alert");
    expect(createTool(Incident).name).toBe("create_incident");

    for (const modelType of [Alert, Incident]) {
      expect(
        Object.keys(createTool(modelType).inputSchema.properties!),
      ).toEqual(expect.arrayContaining(["ownerUsers", "ownerTeams"]));
    }

    expect(
      Object.keys(createTool(Monitor).inputSchema.properties!),
    ).not.toContain("ownerUsers");
  });

  test("the English alerts page says when the owners hear of it, and how a create hands them over", () => {
    const page: string = readPage("en", ALERTS);

    expect(page).toContain(
      "A background job tells the alert's owners about a minute after it is created, every owner it has by then, and the **On Create Alert** workflow trigger starts any workflow built on it.",
    );
    expect(page).toContain(
      'over the API, send their ids in `miscDataProps`, as `{ "ownerUsers": ["<user id>"], "ownerTeams": ["<team id>"] }`, with `POST /api/alert`; in a workflow, pick them under **Owner Users** and **Owner Teams** of **Create One Alert**; over MCP, pass `ownerUsers` and `ownerTeams` to `create_alert`.',
    );
    expect(page).toContain(
      "A request whose caller may not add those owners is refused before anything is saved.",
    );
  });

  test("the English declaring page names the workflow step's settings and the MCP tool's inputs", () => {
    expect(readPage("en", DECLARING)).toContain(
      "A workflow's **Create One Incident** step takes them under **Owner Users** and **Owner Teams**, and the MCP server's `create_incident` tool as `ownerUsers` and `ownerTeams`.",
    );
  });

  test("the English workflow page explains the settings after the resources a record is about", () => {
    const page: string = readPage("en", COMPONENTS);
    const owners: string = section(page, "### Who owns it from the start");

    expect(page.indexOf("### Linking the resources it is about")).toBeLessThan(
      page.indexOf("### Who owns it from the start"),
    );
    expect(page.indexOf("### Who owns it from the start")).toBeLessThan(
      page.indexOf("## Working with records"),
    );
    expect(owners).toContain(
      "**Create One Incident** and **Create One Alert** have **Owner Users** and **Owner Teams** settings",
    );
    expect(owners).toContain(
      "a user's ID or email address, a team's ID, several separated by commas, or a list.",
    );
    expect(owners).toContain(
      "The step asks whether it may add them, as a Project Admin of the workflow's project, before the record is saved: owners it may not add refuse the create.",
    );
    expect(owners).toContain(
      "Somebody who is not a member of the project, or a team that is not one of the project's, is left out, and the run log says so: the record is still created.",
    );
  });

  test("the English MCP page says which create tools take owners", () => {
    expect(readPage("en", MCP)).toContain(
      "`create_incident` and `create_alert` also take `ownerUsers` and `ownerTeams`: the IDs of the users and teams who own the record from the start, who are told it was created.",
    );
  });

  test("every language names the inputs as written, and the settings as its Dashboard draws them", () => {
    for (const language of DOCS_LANGUAGES) {
      const labels: Array<string> = OWNER_SETTINGS.map(
        (setting: string): string => {
          return `**${drawnDashboardLabel(language, setting)}**`;
        },
      );

      const handOver: string = lineWith(language, ALERTS, "`miscDataProps`");

      for (const written of [
        "`POST /api/alert`",
        "`ownerUsers`",
        "`ownerTeams`",
        "`create_alert`",
        `**${drawnStepName(language, "Create One Alert")}**`,
        ...labels,
      ]) {
        expect([language, written, handOver.includes(written)]).toEqual([
          language,
          written,
          true,
        ]);
      }

      const declaring: string = lineWith(
        language,
        DECLARING,
        "`POST /api/incident/owner-rule-preview`",
      );

      for (const written of [
        `**${drawnStepName(language, "Create One Incident")}**`,
        "`create_incident`",
        ...labels,
      ]) {
        expect([language, written, declaring.includes(written)]).toEqual([
          language,
          written,
          true,
        ]);
      }

      const settings: string = lineWith(language, COMPONENTS, labels[0]!);

      for (const written of [
        `**${drawnStepName(language, "Create One Incident")}**`,
        `**${drawnStepName(language, "Create One Alert")}**`,
        ...labels,
      ]) {
        expect([language, written, settings.includes(written)]).toEqual([
          language,
          written,
          true,
        ]);
      }

      const tools: string = lineWith(language, MCP, "`count_spans`");

      for (const written of [
        "`create_incident`",
        "`create_alert`",
        "`ownerUsers`",
        "`ownerTeams`",
      ]) {
        expect([language, written, tools.includes(written)]).toEqual([
          language,
          written,
          true,
        ]);
      }
    }
  });
});

describe("the docs on owners told after a stop part way", () => {
  test("every owner job hands a later run whom a stopped one had not told, a few minutes on", () => {
    const jobsRoot: string = path.join(
      PACKAGES_ROOT,
      "App/FeatureSet/Workers/Jobs",
    );
    // Each resource's owner jobs: of incidents, alerts and the rest (#8509).
    const folders: Array<string> = fs
      .readdirSync(jobsRoot)
      .filter((folder: string): boolean => {
        return folder.endsWith("Owners");
      })
      .sort();

    expect(folders).toEqual([
      "AlertEpisodeOwners",
      "AlertOwners",
      // Services, infrastructure, dashboards, workflows, runbooks, on-call (#9700).
      "CephClusterOwners",
      "CloudResourceOwners",
      "DashboardOwners",
      // Data Observability's tables, pipelines and data stores (#9681).
      "DataAssetOwners",
      "DataPipelineOwners",
      "DataStoreOwners",
      "DatabaseServerOwners",
      "DockerHostOwners",
      "DockerSwarmClusterOwners",
      "HostOwners",
      "IncidentEpisodeOwners",
      "IncidentOwners",
      "IncomingCallPolicyOwners",
      "IoTFleetOwners",
      "KubernetesClusterOwners",
      "MessageQueueOwners",
      // Monitor groups' and Runners', added on their Owners pages (#9758).
      "MonitorGroupOwners",
      "MonitorOwners",
      "NetworkDeviceOwners",
      "OnCallDutyPolicyOwners",
      "OnCallDutyPolicyScheduleOwners",
      "OpenStackCloudOwners",
      "PodmanHostOwners",
      "ProxmoxClusterOwners",
      "RumApplicationOwners",
      "RunbookOwners",
      "RunnerOwners",
      "ScheduledMaintenanceOwners",
      "ServerlessFunctionOwners",
      "ServiceOwners",
      "SloOwners",
      "StatusPageOwners",
      "StorageArrayOwners",
      "VMwareVCenterOwners",
      "WorkflowOwners",
    ]);

    /*
     * The 23 jobs of #9700 are each one call of the shared owner-added job
     * (Workers/Utils/ResourceOwnersAdded), which resumes and tells each
     * once for all of them.
     */
    const sharedJob: string = fs.readFileSync(
      path.join(
        PACKAGES_ROOT,
        "App/FeatureSet/Workers/Utils/ResourceOwnersAdded.ts",
      ),
      "utf8",
    );

    let jobs: number = 0;

    for (const folder of folders) {
      for (const file of fs.readdirSync(path.join(jobsRoot, folder))) {
        const job: string = file.replace(/\.ts$/, "");
        const ownSource: string = fs.readFileSync(
          path.join(jobsRoot, folder, file),
          "utf8",
        );
        const source: string = ownSource.includes("runResourceOwnerAddedJob<")
          ? sharedJob
          : ownSource;

        jobs++;

        expect({
          job: `${folder}/${job}`,
          resumes: source.includes("OwnerNotificationDeliveries.resume("),
          tellsEachOnce: source.includes("delivery.tell("),
        }).toEqual({
          job: `${folder}/${job}`,
          resumes: true,
          tellsEachOnce: true,
        });
      }
    }

    // The owner-added jobs of probes and AI agents, which sit with them.
    for (const file of [
      "Probe/SendOwnerAddedNotification.ts",
      "AIAgent/SendOwnerAddedNotification.ts",
    ]) {
      const source: string = fs.readFileSync(path.join(jobsRoot, file), "utf8");

      jobs++;

      expect({
        job: file,
        resumes: source.includes("OwnerNotificationDeliveries.resume("),
        tellsEachOnce: source.includes("delivery.tell("),
      }).toEqual({ job: file, resumes: true, tellsEachOnce: true });
    }

    // 61, and the monitor group's and the Runner's (#9758).
    expect(jobs).toBe(63);
    // The incident and alert jobs among them, by name.
    expect(JOBS).toHaveLength(5);

    // "A few minutes late": taken up two minutes on, by a job run every minute.
    expect(
      OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
    ).toBeLessThanOrEqual(3);
  });

  test("the English pages say the people not got to yet are told, a few minutes late, and nobody twice", () => {
    const sentence: string =
      "If OneUptime stops while it is sending a notification, the people it had not got to yet get it once OneUptime is back, a few minutes late, and nobody gets it twice.";

    expect(
      section(readPage("en", OWNERS), "## What owners get notified about"),
    ).toContain(sentence);
    expect(
      section(readPage("en", ALERTS), "## Who hears about an alert"),
    ).toContain(sentence);
  });

  test("the notification settings page says it of every record's owners, in every language", () => {
    expect(readPage("en", SETTINGS)).toContain(
      "If OneUptime stops while it is sending an update to a record's owners, the people it had not got to yet get it once OneUptime is back, a few minutes late, and nobody gets it twice.",
    );

    // The owners bullet: the one that says where an update goes, on the English page's line.
    const ownersLine: number = readPage("en", SETTINGS)
      .split("\n")
      .findIndex((line: string): boolean => {
        return line.startsWith("- An update goes to the record's owners:");
      });

    expect(ownersLine).toBeGreaterThan(0);

    for (const language of DOCS_LANGUAGES) {
      const owners: string =
        readPage(language, SETTINGS).split("\n")[ownersLine] || "";

      expect([language, A_FEW_MINUTES[language]!.test(owners)]).toEqual([
        language,
        true,
      ]);
    }
  });

  test("every language says it on both pages", () => {
    expect([...DOCS_LANGUAGES].sort()).toEqual(
      Object.keys(A_FEW_MINUTES).sort(),
    );

    for (const language of DOCS_LANGUAGES) {
      // The paragraph under the table of what owners are notified about.
      const lines: Array<string> = readPage(language, OWNERS).split("\n");
      const lastRow: number = lines.indexOf(
        lineWith(
          language,
          OWNERS,
          "`[Reminder] Incident {number} is still {state} - {title}`",
        ),
      );
      const owners: string = lines[lastRow + 2] || "";
      const alerts: string = readPage(language, ALERTS)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("- **");
        })
        .join("\n");

      expect([
        language,
        A_FEW_MINUTES[language]!.test(owners),
        A_FEW_MINUTES[language]!.test(alerts),
      ]).toEqual([language, true, true]);
    }
  });
});
