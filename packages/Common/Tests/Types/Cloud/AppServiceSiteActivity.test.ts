import { describe, expect, test } from "@jest/globals";
import {
  APP_SERVICE_MAX_DEPLOYMENTS,
  APP_SERVICE_MAX_INSTANCES,
  APP_SERVICE_MAX_TEXT_LENGTH,
  AppServiceDeploymentStatus,
  AppServiceInstanceState,
  AppServiceSiteActivity,
  AppServiceSiteDeployment,
  AppServiceSiteReadError,
  getAppServiceCurrentDeployment,
  getAppServiceRunningInstances,
  readAppServiceDeployments,
  readAppServiceDeploymentStatus,
  readAppServiceImage,
  readAppServiceInstances,
  readAppServiceSiteActivity,
} from "../../../Types/Cloud/AppServiceSiteActivity";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * WHAT AZURE SAYS OF AN APP SERVICE APP'S INSTANCES AND DEPLOYMENTS
 * (#10294), READ FROM RESOURCE MANAGER'S OWN ANSWERS.
 *
 * An App Service app whose telemetry names no instance and no version read
 * "Not reported" and "No revision reported yet", though Azure knows both.
 * These answers are shaped as Resource Manager writes them ("Web Apps -
 * List Instance Identifiers", "List Deployments", "Get Configuration"):
 * the reader keeps only the fields it names, each bounded, and says what
 * runs - the instances not stopped, the deployment that is active.
 */

const SITE_ID: string =
  "/subscriptions/d6252cc9-f01c-428b-924d-9896199f9a13/resourceGroups/rg-monitoring/providers/Microsoft.Web/sites/azure-monitor-collector-northcentralus";

// Two instances as WEBSITE_INSTANCE_ID names them: 64 hexadecimal characters.
const INSTANCE_A: string =
  "8f0a3d1c2b4e6f8a0c2e4a6b8d0f1e3c5a7b9d1f3e5c7a9b1d3f5e7c9a1b3d5e";
const INSTANCE_B: string =
  "1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d";

// "Web Apps - List Instance Identifiers", as Resource Manager answers it.
const INSTANCES_ANSWER: JSONObject = {
  value: [
    {
      id: `${SITE_ID}/instances/${INSTANCE_A}`,
      name: INSTANCE_A,
      type: "Microsoft.Web/sites/instances",
      properties: {
        state: "READY",
        statusUrl: `https://azure-monitor-collector-northcentralus.scm.azurewebsites.net/api/vfs/site/instances/${INSTANCE_A}`,
        detectorUrl: "https://portal.azure.com/...",
        consoleUrl: "https://portal.azure.com/...",
        healthCheckUrl: null,
      },
    },
    {
      id: `${SITE_ID}/instances/${INSTANCE_B}`,
      name: `azure-monitor-collector-northcentralus/${INSTANCE_B}`,
      type: "Microsoft.Web/sites/instances",
      properties: { state: "STOPPED" },
    },
  ],
  nextLink: null,
};

// "Web Apps - List Deployments": a GitHub Actions ZIP deploy and an older failed one.
const DEPLOYMENTS_ANSWER: JSONObject = {
  value: [
    {
      id: `${SITE_ID}/deployments/0c8f1d2e-3b4a-4c5d-9e6f-7a8b9c0d1e2f`,
      name: "azure-monitor-collector-northcentralus/0c8f1d2e-3b4a-4c5d-9e6f-7a8b9c0d1e2f",
      type: "Microsoft.Web/sites/deployments",
      properties: {
        status: 3,
        message: "Deploy failed: npm ci exited with 1",
        author: "N/A",
        deployer: "GITHUB_ZIP_DEPLOY",
        author_email: "N/A",
        start_time: "2026-11-19T08:01:02.1234567Z",
        end_time: "2026-11-19T08:02:10.7654321Z",
        active: false,
        details:
          "https://azure-monitor-collector-northcentralus.scm.azurewebsites.net/api/deployments/0c8f/log",
      },
    },
    {
      id: `${SITE_ID}/deployments/4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b`,
      name: "azure-monitor-collector-northcentralus/4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
      type: "Microsoft.Web/sites/deployments",
      properties: {
        status: 4,
        message: "Merge pull request #212 from ops/collector-config",
        author: "Ops Bot",
        deployer: "GitHub",
        author_email: "ops@example.com",
        start_time: "2026-11-20T09:31:12.6544526Z",
        end_time: "2026-11-20T09:31:45.2321301Z",
        active: true,
      },
    },
    {
      id: `${SITE_ID}/deployments/temp-a1b2c3`,
      name: "azure-monitor-collector-northcentralus/temp-a1b2c3",
      type: "Microsoft.Web/sites/deployments",
      // A deployment Kudu has not started: its times are its zero time.
      properties: {
        status: 0,
        start_time: "0001-01-01T00:00:00",
        end_time: "0001-01-01T00:00:00",
        active: false,
      },
    },
  ],
};

describe("instances, as Resource Manager lists them", () => {
  test("each is its WEBSITE_INSTANCE_ID, with its state, whether ARM names it alone or under its site", () => {
    expect(
      readAppServiceInstances(INSTANCES_ANSWER["value"] as Array<JSONValue>),
    ).toEqual([
      { id: INSTANCE_A, state: AppServiceInstanceState.Ready },
      { id: INSTANCE_B, state: AppServiceInstanceState.Stopped },
    ]);
  });

  test("an instance with no name is read from its id; one with neither is passed over", () => {
    expect(
      readAppServiceInstances([
        { id: `${SITE_ID}/instances/${INSTANCE_A}` },
        { properties: { state: "READY" } },
        "not an object",
        null,
      ]),
    ).toEqual([{ id: INSTANCE_A, state: AppServiceInstanceState.Unknown }]);
  });

  test("an instance listed twice, in two cases, is one; a state Azure does not document is unknown", () => {
    expect(
      readAppServiceInstances([
        { name: INSTANCE_A, properties: { state: "ready" } },
        { name: INSTANCE_A.toUpperCase(), properties: { state: "READY" } },
        { name: INSTANCE_B, properties: { state: "SWAPPING" } },
      ]),
    ).toEqual([
      { id: INSTANCE_A, state: AppServiceInstanceState.Ready },
      { id: INSTANCE_B, state: AppServiceInstanceState.Unknown },
    ]);
  });

  test("at most a bounded number are kept", () => {
    const many: Array<JSONValue> = [];

    for (
      let index: number = 0;
      index < APP_SERVICE_MAX_INSTANCES + 25;
      index++
    ) {
      many.push({ name: `instance-${index}`, properties: { state: "READY" } });
    }

    expect(readAppServiceInstances(many)).toHaveLength(
      APP_SERVICE_MAX_INSTANCES,
    );
  });

  test("the running ones are those not stopped: ready, or of a state Azure does not say", () => {
    expect(
      getAppServiceRunningInstances([
        { id: "a", state: AppServiceInstanceState.Ready },
        { id: "b", state: AppServiceInstanceState.Stopped },
        { id: "c", state: AppServiceInstanceState.Unknown },
      ]).map((instance: { id: string }): string => {
        return instance.id;
      }),
    ).toEqual(["a", "c"]);
    expect(getAppServiceRunningInstances(null)).toEqual([]);
  });
});

describe("deployments, as Kudu keeps them through Resource Manager", () => {
  test("each with its id, outcome, author, deployer, message and times, newest first", () => {
    const deployments: Array<AppServiceSiteDeployment> =
      readAppServiceDeployments(
        DEPLOYMENTS_ANSWER["value"] as Array<JSONValue>,
      );

    expect(
      deployments.map((deployment: AppServiceSiteDeployment) => {
        return [deployment.id, deployment.status, deployment.active];
      }),
    ).toEqual([
      [
        "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
        AppServiceDeploymentStatus.Succeeded,
        true,
      ],
      [
        "0c8f1d2e-3b4a-4c5d-9e6f-7a8b9c0d1e2f",
        AppServiceDeploymentStatus.Failed,
        false,
      ],
      ["temp-a1b2c3", AppServiceDeploymentStatus.Pending, false],
    ]);

    expect(deployments[0]).toEqual({
      id: "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
      status: AppServiceDeploymentStatus.Succeeded,
      active: true,
      author: "Ops Bot",
      deployer: "GitHub",
      message: "Merge pull request #212 from ops/collector-config",
      startTime: "2026-11-20T09:31:12.654Z",
      endTime: "2026-11-20T09:31:45.232Z",
    });
  });

  test("Kudu's zero time is no time", () => {
    const pending: AppServiceSiteDeployment | undefined =
      readAppServiceDeployments(
        DEPLOYMENTS_ANSWER["value"] as Array<JSONValue>,
      ).find((deployment: AppServiceSiteDeployment): boolean => {
        return deployment.id === "temp-a1b2c3";
      });

    expect(pending?.startTime).toBeNull();
    expect(pending?.endTime).toBeNull();
  });

  test("Kudu's statuses: pending, building and deploying, failed, succeeded, and anything else", () => {
    expect(
      (
        [0, 1, 2, 3, 4, 5, 6, "4", "x", null, undefined] as Array<
          JSONValue | undefined
        >
      ).map((status: JSONValue | undefined): AppServiceDeploymentStatus => {
        return readAppServiceDeploymentStatus(status);
      }),
    ).toEqual([
      AppServiceDeploymentStatus.Pending,
      AppServiceDeploymentStatus.InProgress,
      AppServiceDeploymentStatus.InProgress,
      AppServiceDeploymentStatus.Failed,
      AppServiceDeploymentStatus.Succeeded,
      AppServiceDeploymentStatus.Unknown,
      AppServiceDeploymentStatus.Unknown,
      AppServiceDeploymentStatus.Succeeded,
      AppServiceDeploymentStatus.Unknown,
      AppServiceDeploymentStatus.Unknown,
      AppServiceDeploymentStatus.Unknown,
    ]);
  });

  test("a long message is cut, and the newest are kept, whatever order Azure lists them in", () => {
    const random: SeededRandom = seededRandom(10294);
    const listed: Array<JSONValue> = [];

    for (
      let index: number = 0;
      index < APP_SERVICE_MAX_DEPLOYMENTS + 10;
      index++
    ) {
      listed.push({
        name: `site/deployment-${String(index).padStart(2, "0")}`,
        properties: {
          status: 4,
          message: "x".repeat(APP_SERVICE_MAX_TEXT_LENGTH + 50),
          end_time: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
        },
      });
    }

    const deployments: Array<AppServiceSiteDeployment> =
      readAppServiceDeployments(shuffled(listed, random));

    expect(deployments).toHaveLength(APP_SERVICE_MAX_DEPLOYMENTS);
    expect(deployments[0]?.id).toBe(
      `deployment-${String(APP_SERVICE_MAX_DEPLOYMENTS + 9).padStart(2, "0")}`,
    );
    expect(deployments[0]?.message).toHaveLength(APP_SERVICE_MAX_TEXT_LENGTH);
  });

  test("what runs now: the active one, else the newest that succeeded, else none", () => {
    const deployments: Array<AppServiceSiteDeployment> =
      readAppServiceDeployments(
        DEPLOYMENTS_ANSWER["value"] as Array<JSONValue>,
      );

    expect(getAppServiceCurrentDeployment(deployments)?.id).toBe(
      "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
    );

    const noneActive: Array<AppServiceSiteDeployment> = deployments.map(
      (deployment: AppServiceSiteDeployment): AppServiceSiteDeployment => {
        return { ...deployment, active: false };
      },
    );

    expect(getAppServiceCurrentDeployment(noneActive)?.id).toBe(
      "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
    );
    expect(
      getAppServiceCurrentDeployment(
        noneActive.filter((deployment: AppServiceSiteDeployment) => {
          return deployment.status !== AppServiceDeploymentStatus.Succeeded;
        }),
      ),
    ).toBeNull();
    expect(getAppServiceCurrentDeployment([])).toBeNull();
    expect(getAppServiceCurrentDeployment(undefined)).toBeNull();
  });
});

describe("the image a container app runs, from its configuration", () => {
  test("a Docker app's linuxFxVersion or windowsFxVersion names it", () => {
    expect(
      readAppServiceImage({
        properties: {
          linuxFxVersion: "DOCKER|otel/opentelemetry-collector-contrib:0.118.0",
        },
      }),
    ).toBe("otel/opentelemetry-collector-contrib:0.118.0");
    expect(
      readAppServiceImage({
        properties: {
          linuxFxVersion: "",
          windowsFxVersion: "DOCKER|myregistry.azurecr.io/checkout:1.4.2",
        },
      }),
    ).toBe("myregistry.azurecr.io/checkout:1.4.2");
  });

  test("a code app's stack and a Compose file name no image", () => {
    expect(
      readAppServiceImage({ properties: { linuxFxVersion: "NODE|20-lts" } }),
    ).toBeNull();
    expect(
      readAppServiceImage({
        properties: { linuxFxVersion: "COMPOSE|dmVyc2lvbjogJzMnCg==" },
      }),
    ).toBeNull();
    expect(readAppServiceImage({ properties: {} })).toBeNull();
    expect(readAppServiceImage(null)).toBeNull();
  });
});

describe("a read, as the page reads it back", () => {
  test("what the server answered comes back whole", () => {
    const activity: AppServiceSiteActivity = {
      readAt: "2026-11-20T12:00:00.000Z",
      instances: {
        items: [{ id: INSTANCE_A, state: AppServiceInstanceState.Ready }],
      },
      deployments: {
        items: readAppServiceDeployments(
          DEPLOYMENTS_ANSWER["value"] as Array<JSONValue>,
        ),
      },
      image: "myregistry.azurecr.io/checkout:1.4.2",
    };

    expect(
      readAppServiceSiteActivity(JSON.parse(JSON.stringify(activity))),
    ).toEqual(activity);
  });

  test("a part that could not be read keeps why; one that says nothing known is a failure", () => {
    expect(
      readAppServiceSiteActivity({
        readAt: "2026-11-20T12:00:00.000Z",
        instances: { items: null, error: "no-access" },
        deployments: { items: null, error: "something-new" },
        image: null,
      }),
    ).toEqual({
      readAt: "2026-11-20T12:00:00.000Z",
      instances: { items: null, error: AppServiceSiteReadError.NoAccess },
      deployments: { items: null, error: AppServiceSiteReadError.Failed },
      image: null,
    });
  });

  test("anything that is not a read is none", () => {
    expect(readAppServiceSiteActivity(null)).toBeNull();
    expect(readAppServiceSiteActivity("text")).toBeNull();
    expect(readAppServiceSiteActivity({ instances: [] })).toBeNull();
  });
});
