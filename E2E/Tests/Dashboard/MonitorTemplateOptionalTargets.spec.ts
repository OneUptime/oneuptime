import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  buildUrl,
  createItem,
  getItem,
  getProjectDefaults,
  JSONish,
  ProjectDefaults,
  requestJson,
  toId,
} from "./Helpers/MonitorAlerting";
import {
  Browser,
  APIResponse,
  Locator,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import Hostname from "Common/Types/API/Hostname";
import IP from "Common/Types/IP/IP";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { MonitorStepDomainMonitorUtil } from "Common/Types/Monitor/MonitorStepDomainMonitor";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";

test.describe.configure({ mode: "serial" });

interface TargetScenario {
  type: MonitorType;
  setTarget: (step: JSONish, index: number) => void;
  getTarget: (step: JSONish) => string;
}

const scenarios: Array<TargetScenario> = [
  ...[MonitorType.Website, MonitorType.API, MonitorType.SSLCertificate].map(
    (type: MonitorType): TargetScenario => {
      return {
        type,
        setTarget: (step: JSONish, index: number): void => {
          step["monitorDestination"] = URL.fromString(
            `https://endpoint-${index}.example.com`,
          ).toJSON();
        },
        getTarget: (step: JSONish): string => {
          return step["monitorDestination"]["value"];
        },
      };
    },
  ),
  {
    type: MonitorType.Ping,
    setTarget: (step: JSONish, index: number): void => {
      step["monitorDestination"] = new Hostname(
        `host-${index}.example.com`,
      ).toJSON();
    },
    getTarget: (step: JSONish): string => {
      return step["monitorDestination"]["value"];
    },
  },
  {
    type: MonitorType.IP,
    setTarget: (step: JSONish, index: number): void => {
      step["monitorDestination"] = new IP(`192.0.2.${index}`).toJSON();
    },
    getTarget: (step: JSONish): string => {
      return step["monitorDestination"]["value"];
    },
  },
  {
    type: MonitorType.Port,
    setTarget: (step: JSONish, index: number): void => {
      step["monitorDestination"] = new Hostname(
        `port-${index}.example.com`,
      ).toJSON();
      step["monitorDestinationPort"] = new Port(8000 + index).toJSON();
    },
    getTarget: (step: JSONish): string => {
      return `${step["monitorDestination"]["value"]}:${step["monitorDestinationPort"]["value"]}`;
    },
  },
  {
    type: MonitorType.Domain,
    setTarget: (step: JSONish, index: number): void => {
      step["domainMonitor"] = {
        ...MonitorStepDomainMonitorUtil.getDefault(),
        domainName: `domain-${index}.example.com`,
      };
    },
    getTarget: (step: JSONish): string => {
      return step["domainMonitor"]["domainName"];
    },
  },
];

/*
 * Use wire-format fixtures: MonitorSteps imports TypeORM entities, whose
 * decorators cannot be loaded by Playwright's own TypeScript transformer.
 */
function firstStep(steps: JSONish): JSONish {
  return steps["value"]["monitorStepsInstanceArray"][0]["value"];
}

function firstCriterion(step: JSONish): JSONish {
  return step["monitorCriteria"]["value"]["monitorCriteriaInstanceArray"][0][
    "value"
  ];
}

function buildSteps(defaults: ProjectDefaults, type: MonitorType): JSONish {
  const step: JSONish = {
    id: "shared-template-step",
    requestType: "GET",
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: {
        monitorCriteriaInstanceArray: [
          {
            _type: "MonitorCriteriaInstance",
            value: {
              id: ObjectID.generate().toString(),
              name: "Shared availability criteria",
              description: "A reusable check for every endpoint",
              filterCondition: "All",
              filters: [{ checkOn: "Is Online", filterType: "True" }],
              createIncidents: false,
              createAlerts: false,
              changeMonitorStatus: false,
              incidents: [],
              alerts: [],
            },
          },
        ],
      },
    },
  };
  if (type === MonitorType.Domain) {
    step["domainMonitor"] = MonitorStepDomainMonitorUtil.getDefault();
  }
  return {
    _type: "MonitorSteps",
    value: {
      defaultMonitorStatusId: defaults.operationalMonitorStatusId,
      monitorStepsInstanceArray: [{ _type: "MonitorStep", value: step }],
    },
  };
}

test.describe("Optional monitor template targets", () => {
  let page: Page;
  let projectId: string;
  let defaults: ProjectDefaults;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "Optional Target Templates",
      preferredPlanName: "Growth",
      email: `optional-templates-${Date.now()}@example.test`,
    });
    defaults = await getProjectDefaults({ page, projectId });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  scenarios.forEach((scenario: TargetScenario) => {
    test(`${scenario.type}: saves a targetless template and syncs only supplied targets`, async () => {
      const testInfo: TestInfo = test.info();
      const templateSteps: JSONish = buildSteps(defaults, scenario.type);
      firstStep(templateSteps)["requestTimeoutInMs"] = 17000;
      const template: JSONish = await createItem({
        page,
        projectId,
        path: "/api/monitor-template",
        item: {
          projectId,
          templateName: `${scenario.type} shared criteria`,
          templateDescription:
            "Reusable monitoring checks with per-monitor targets",
          monitorType: scenario.type,
          monitorSteps: templateSteps,
          monitoringInterval: "*/10 * * * *",
          minimumProbeAgreement: 1,
        },
      });
      const templateId: string = toId(template["_id"]);
      const missingTarget: APIResponse = await page.request.post(
        buildUrl("/api/monitor"),
        {
          headers: { tenantid: projectId },
          data: {
            data: {
              projectId,
              name: `${scenario.type} missing target`,
              monitorType: scenario.type,
              monitorTemplateId: templateId,
              monitorSteps: templateSteps,
              monitoringInterval: "*/5 * * * *",
              minimumProbeAgreement: 1,
            },
          },
        },
      );
      expect(missingTarget.status()).toBe(400);
      expect(await missingTarget.text()).toContain("required");
      const monitorIds: Array<string> = [];
      const targets: Array<string> = [];

      for (const index of [1, 2]) {
        const steps: JSONish = JSON.parse(JSON.stringify(templateSteps));
        scenario.setTarget(firstStep(steps), index);
        firstStep(steps)["requestTimeoutInMs"] = 5000;
        firstCriterion(firstStep(steps))["description"] = "Old criteria";
        targets.push(scenario.getTarget(firstStep(steps)));
        const monitor: JSONish = await createItem({
          page,
          projectId,
          path: "/api/monitor",
          item: {
            projectId,
            name: `${scenario.type} endpoint ${index}`,
            monitorType: scenario.type,
            monitorTemplateId: templateId,
            monitorSteps: steps,
            monitoringInterval: "*/5 * * * *",
            minimumProbeAgreement: 1,
          },
        });
        monitorIds.push(toId(monitor["_id"]));
      }

      const result: JSONish = await requestJson({
        page,
        projectId,
        path: `/api/monitor-template/${templateId}/sync-to-linked-monitors`,
        body: { fields: ["monitorSteps"] },
      });
      expect(result["syncedMonitors"]).toBe(2);

      for (let index: number = 0; index < monitorIds.length; index++) {
        const monitor: JSONish = await getItem({
          page,
          projectId,
          path: "/api/monitor",
          id: monitorIds[index]!,
          select: { monitorSteps: true, monitoringInterval: true, name: true },
        });
        const step: JSONish = firstStep(monitor["monitorSteps"]);
        expect(scenario.getTarget(step)).toBe(targets[index]);
        expect(step["requestTimeoutInMs"]).toBe(17000);
        expect(firstCriterion(step)["description"]).toBe(
          "A reusable check for every endpoint",
        );
        expect(monitor["monitoringInterval"]).toBe("*/5 * * * *");
        expect(monitor["name"]).toBe(`${scenario.type} endpoint ${index + 1}`);
      }

      // Supplying a target later is an explicit retarget on single-monitor sync.
      scenario.setTarget(firstStep(templateSteps), 3);
      await requestJson({
        page,
        projectId,
        method: "put",
        path: `/api/monitor-template/${templateId}`,
        body: { data: { monitorSteps: templateSteps } },
      });
      await requestJson({
        page,
        projectId,
        path: `/api/monitor-template/${templateId}/sync-to-monitor/${monitorIds[0]}`,
        body: {},
      });
      const synced: JSONish = await getItem({
        page,
        projectId,
        path: "/api/monitor",
        id: monitorIds[0]!,
        select: { monitorSteps: true, monitoringInterval: true },
      });
      expect(scenario.getTarget(firstStep(synced["monitorSteps"]))).toBe(
        scenario.getTarget(firstStep(templateSteps)),
      );
      expect(synced["monitoringInterval"]).toBe("*/10 * * * *");

      // Clear a previously supplied target, then save and sync again.
      const blankSteps: JSONish = buildSteps(defaults, scenario.type);
      firstStep(blankSteps)["requestTimeoutInMs"] = 21000;
      await requestJson({
        page,
        projectId,
        method: "put",
        path: `/api/monitor-template/${templateId}`,
        body: { data: { monitorSteps: blankSteps } },
      });
      await requestJson({
        page,
        projectId,
        path: `/api/monitor-template/${templateId}/sync-to-monitor/${monitorIds[0]}`,
        body: { fields: ["monitorSteps"] },
      });
      const cleared: JSONish = await getItem({
        page,
        projectId,
        path: "/api/monitor",
        id: monitorIds[0]!,
        select: { monitorSteps: true },
      });
      const clearedStep: JSONish = firstStep(cleared["monitorSteps"]);
      expect(scenario.getTarget(clearedStep)).toBe(
        scenario.getTarget(firstStep(templateSteps)),
      );
      expect(clearedStep["requestTimeoutInMs"]).toBe(21000);

      if (scenario.type === MonitorType.Website) {
        await page.goto(
          buildUrl(
            `/dashboard/${projectId}/monitors/settings/templates/${templateId}`,
          ),
        );
        await expect(
          page.getByText("Monitoring Criteria", { exact: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByText(/Target fields are optional in templates/i).first(),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Edit Criteria", exact: true })
          .click();
        await expect(page.getByTestId("modal")).toBeVisible();
        const destination: Locator = page
          .getByTestId("modal")
          .getByTestId("card")
          .filter({
            has: page.getByRole("heading", {
              name: "Monitor Target",
              exact: true,
            }),
          })
          .getByRole("textbox");
        await expect(destination).toHaveValue("");
        await page.screenshot({
          path: testInfo.outputPath("optional-template-destination.png"),
        });
        await testInfo.attach("Optional template destination", {
          path: testInfo.outputPath("optional-template-destination.png"),
          contentType: "image/png",
        });
        await page.getByTestId("modal-footer-submit-button").click();
        await expect(page.getByTestId("modal")).toBeHidden();
        await page
          .getByRole("button", {
            name: /^Sync Criteria to (?:2 )?Linked Monitors$/,
          })
          .click();
        const syncDialog: Locator = page.getByRole("dialog", {
          name: "Sync Criteria to Linked Monitors",
          exact: true,
        });
        await expect(syncDialog).toBeVisible();
        await expect(
          syncDialog.getByTestId("confirm-modal-description"),
        ).toContainText(
          "Blank target fields keep each monitor's current value",
        );
        await page.screenshot({
          path: testInfo.outputPath("template-sync-preserves-targets.png"),
        });
        await testInfo.attach("Sync preserves blank targets", {
          path: testInfo.outputPath("template-sync-preserves-targets.png"),
          contentType: "image/png",
        });
        await syncDialog.getByTestId("modal-footer-submit-button").click();
        await expect(syncDialog).toBeHidden();
        const resultDialog: Locator = page.getByRole("dialog", {
          name: "Done",
          exact: true,
        });
        await expect(resultDialog).toBeVisible();
        await expect(
          resultDialog.getByTestId("confirm-modal-description"),
        ).toContainText("Synced criteria onto 2 monitors");
        await resultDialog
          .getByRole("button", { name: "OK", exact: true })
          .click();
        await expect(resultDialog).toBeHidden();
      }
    });
  });
});
