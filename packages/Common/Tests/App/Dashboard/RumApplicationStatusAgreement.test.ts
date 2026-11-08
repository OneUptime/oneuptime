import { describe, expect, test } from "@jest/globals";
import {
  RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES,
  RUM_APPLICATION_RECEIVING_DATA_LABEL,
  RumApplicationStatus,
  RumApplicationStatusInput,
  RumApplicationStatusTone,
  getRumApplicationStatus,
  getRumApplicationStatusWords,
} from "../../../Types/Rum/RumApplicationStatus";
import {
  ResourceConnectionState,
  getResourceConnectionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionState";
import {
  RUM_APPLICATION_IDLE_COPY,
  SERVERLESS_FUNCTION_IDLE_COPY,
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
  getCephClusterConnectionGuide,
  getCloudResourceConnectionGuide,
  getDockerHostConnectionGuide,
  getDockerSwarmClusterConnectionGuide,
  getHostConnectionGuide,
  getIoTFleetConnectionGuide,
  getKubernetesClusterConnectionGuide,
  getPodmanHostConnectionGuide,
  getProxmoxClusterConnectionGuide,
  getRumApplicationConnectionGuide,
  getServerlessFunctionConnectionGuide,
  getStorageArrayConnectionGuide,
  getVMwareVCenterConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import { getRumApplicationStatusPillColor } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumApplicationStatusColor";
import { Gray500, Green, Red } from "../../../Types/BrandColors";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Issue #6191: a RUM application's status pill (RumApplicationStatus) and
 * the connection card under it on its Overview (ResourceConnectionGuideCard,
 * which reads ResourceConnectionState) are two readings of one record. They
 * must never disagree - "Receiving data" above a card telling you to set the
 * app up, or "No recent traffic" with no card saying when data last came.
 * This holds them together over drawn records, pins what the RUM guide's
 * idle copy says, and keeps the idle treatment off the resources whose agent
 * should be connected all the time: there, silence is a fault, and
 * "Disconnected" is the truth.
 */

const CARD_STATE_OF_STATUS: Record<
  RumApplicationStatus,
  ResourceConnectionState
> = {
  [RumApplicationStatus.ReceivingData]: ResourceConnectionState.Connected,
  [RumApplicationStatus.NoRecentTraffic]: ResourceConnectionState.Disconnected,
  [RumApplicationStatus.WaitingForData]: ResourceConnectionState.NeverConnected,
};

const URL: string = "https://oneuptime.example.com";

function textOf(steps: Array<ResourceConnectionGuideStep>): string {
  return steps
    .map((step: ResourceConnectionGuideStep): string => {
      return `${step.title} ${step.description}`;
    })
    .join(" ");
}

describe("the pill and the card read a RUM application the same way", () => {
  test("on the records the product writes", () => {
    const cases: Array<RumApplicationStatusInput> = [
      // Discovered from its first batch.
      { otelCollectorStatus: "connected", lastSeenAt: new Date() },
      // Swept after fifteen quiet minutes.
      {
        otelCollectorStatus: "disconnected",
        lastSeenAt: "2026-11-07T03:00:00.000Z",
      },
      // Added by hand, nothing yet.
      { otelCollectorStatus: undefined, lastSeenAt: undefined },
      { otelCollectorStatus: null, lastSeenAt: null },
    ];

    for (const input of cases) {
      expect({
        input,
        card: getResourceConnectionState({
          status: input.otelCollectorStatus,
          lastSeenAt: input.lastSeenAt,
        }),
      }).toEqual({
        input,
        card: CARD_STATE_OF_STATUS[getRumApplicationStatus(input)],
      });
    }
  });

  test("on 5,000 drawn records, odd values and casings included", () => {
    const random: SeededRandom = seededRandom(61910);
    const statuses: Array<string | null | undefined> = [
      "connected",
      "CONNECTED",
      "Active",
      "disconnected",
      "Disconnected",
      " connected ",
      "",
      "pending",
      null,
      undefined,
    ];

    for (let index: number = 0; index < 5000; index++) {
      const moment: Date = new Date(
        Date.UTC(2021, 0, 1) + random(2000) * 60 * 60 * 1000,
      );
      const lastSeenAt: Date | string | null | undefined = [
        moment,
        moment.toISOString(),
        null,
        undefined,
        "",
        "garbage",
        new Date(NaN),
      ][random(7)];
      const input: RumApplicationStatusInput = {
        otelCollectorStatus: statuses[random(statuses.length)],
        lastSeenAt,
      };

      expect({
        index,
        card: getResourceConnectionState({
          status: input.otelCollectorStatus,
          lastSeenAt: input.lastSeenAt,
        }),
      }).toEqual({
        index,
        card: CARD_STATE_OF_STATUS[getRumApplicationStatus(input)],
      });
    }
  });
});

describe("the list's pill colours", () => {
  test("green while data arrives, grey otherwise, red never", () => {
    expect(getRumApplicationStatusPillColor("positive")).toBe(Green);
    expect(getRumApplicationStatusPillColor("neutral")).toBe(Gray500);

    for (const status of [
      RumApplicationStatus.ReceivingData,
      RumApplicationStatus.NoRecentTraffic,
      RumApplicationStatus.WaitingForData,
    ]) {
      const tone: RumApplicationStatusTone =
        getRumApplicationStatusWords(status).tone;

      expect(getRumApplicationStatusPillColor(tone).toString()).not.toBe(
        Red.toString(),
      );
    }
  });
});

describe("the RUM guide: idle when nobody uses the app", () => {
  const guide: ResourceConnectionGuide =
    getRumApplicationConnectionGuide("storefront-web");

  test("declares itself idle when unused, with the copy its card draws", () => {
    expect(guide.idleCopy).toBe(RUM_APPLICATION_IDLE_COPY);
    expect(RUM_APPLICATION_IDLE_COPY).toEqual({
      title: "No traffic in the last 15 minutes",
      description:
        "OneUptime last heard from this application {{lastHeard}}. It sends data only while people use it, so this is normal when nobody is, such as overnight.",
      checksLabel: "What to check if people are using it",
      waitingDescription:
        "No data has arrived from this application yet. Set up the OpenTelemetry browser or mobile SDK — it takes a few minutes.",
    });
  });

  test("the idle title says the sweep's number of minutes", () => {
    expect(RUM_APPLICATION_IDLE_COPY.title).toContain(
      `${RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES} minutes`,
    );
  });

  test("its description puts when data last arrived in once, and no noun", () => {
    expect(RUM_APPLICATION_IDLE_COPY.description.match(/\{\{\w+\}\}/g)).toEqual(
      ["{{lastHeard}}"],
    );
    expect(RUM_APPLICATION_IDLE_COPY.waitingDescription).not.toMatch(/\{\{/);
    expect(RUM_APPLICATION_IDLE_COPY.title).not.toMatch(/\{\{/);
    expect(RUM_APPLICATION_IDLE_COPY.checksLabel).not.toMatch(/\{\{/);
  });

  test("nothing it says calls the application disconnected", () => {
    expect(JSON.stringify(guide)).not.toMatch(/disconnect/i);
    expect(JSON.stringify(guide)).not.toMatch(/\bConnected\b/);
  });

  test("its last setup step asks for a visit and names the status it switches to", () => {
    const waitStep: ResourceConnectionGuideStep = guide.setupSteps[2]!;

    expect(waitStep.title).toBe("Wait for the first data");
    expect(waitStep.description).toBe(
      "Open your app so it sends its first data, then refresh this page. The application switches to Receiving data.",
    );
    expect(waitStep.description).toContain(
      RUM_APPLICATION_RECEIVING_DATA_LABEL,
    );
    expect(waitStep.code).toBeUndefined();
  });

  test("its checks are for when people are using it: the troubleshooting steps", () => {
    expect(textOf(guide.troubleshootingSteps)).toContain(
      "Data only arrives while people use the app",
    );
  });
});

/*
 * The resources whose agent should be reporting all the time. Nothing
 * arriving from them is a fault - a crashed pod, a stopped collector - so
 * their card says the data stopped and their pill says Disconnected, and
 * none of them may be dressed as idle.
 */
describe("always-on agents keep their stopped card", () => {
  const ALWAYS_ON: Array<[string, ResourceConnectionGuide]> = [
    ["Kubernetes cluster", getKubernetesClusterConnectionGuide("prod")],
    ["Docker host", getDockerHostConnectionGuide("prod")],
    ["Podman host", getPodmanHostConnectionGuide("prod")],
    ["Docker Swarm cluster", getDockerSwarmClusterConnectionGuide("prod", URL)],
    ["Proxmox cluster", getProxmoxClusterConnectionGuide("prod", URL)],
    ["Ceph cluster", getCephClusterConnectionGuide("prod", URL)],
    ["VMware vCenter", getVMwareVCenterConnectionGuide("prod", URL)],
    ["Storage array", getStorageArrayConnectionGuide("prod", URL)],
    ["Host", getHostConnectionGuide("prod")],
    ["IoT fleet", getIoTFleetConnectionGuide("prod")],
    [
      "Cloud environment",
      getCloudResourceConnectionGuide({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ],
  ];

  test.each(ALWAYS_ON)(
    "the %s guide has no idle copy",
    (_name: string, guide: ResourceConnectionGuide) => {
      expect(guide.idleCopy).toBeUndefined();
    },
  );
});

describe("the serverless function guide: idle between invocations", () => {
  /*
   * A function runs only when invoked, so it is quiet between calls too:
   * its card is the idle one, in a function's own words (issue #6269,
   * ServerlessFunctionStatusAgreement) - never the RUM application's,
   * which speak of people using an app.
   */
  test("the serverless function guide is idle between invocations, in its own words", () => {
    for (const cloudPlatform of [undefined, "aws_lambda", "azure_functions"]) {
      const guide: ResourceConnectionGuide =
        getServerlessFunctionConnectionGuide("checkout-handler", cloudPlatform);

      expect(guide.idleCopy).toBe(SERVERLESS_FUNCTION_IDLE_COPY);
    }
    expect(SERVERLESS_FUNCTION_IDLE_COPY).toEqual({
      title: "No invocations in the last 15 minutes",
      description:
        "OneUptime last heard from this function {{lastHeard}}. It sends data only while it runs, so this is normal when nothing invokes it, such as between scheduled runs.",
      checksLabel: "What to check if it should be running",
      waitingDescription:
        "No data has arrived from this function yet. Set up the OpenTelemetry SDK and invoke the function — it takes a few minutes.",
    });
    expect(SERVERLESS_FUNCTION_IDLE_COPY).not.toBe(RUM_APPLICATION_IDLE_COPY);
    expect(JSON.stringify(SERVERLESS_FUNCTION_IDLE_COPY)).not.toMatch(
      /people|visit|traffic/i,
    );
  });
});
