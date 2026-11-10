import { describe, expect, test } from "@jest/globals";
import {
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES,
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
  SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
  ServerlessFunctionStatus,
  ServerlessFunctionStatusInput,
  getServerlessFunctionStatus,
} from "../../../Types/Serverless/ServerlessFunctionStatus";
import {
  ResourceConnectionState,
  getResourceConnectionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionState";
import {
  SERVERLESS_FUNCTION_IDLE_COPY,
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
  getServerlessFunctionConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import fs from "fs";
import path from "path";

/*
 * Issue #6269: a serverless function's status pill (ServerlessFunctionStatus)
 * and the connection card under it on its Overview (ResourceConnectionGuideCard,
 * which reads ResourceConnectionState) are two readings of one record. They
 * must never disagree - "Receiving data" above a card telling you to set the
 * function up, or "No recent invocations" with no card saying when data
 * last came. This holds them together over drawn records, pins what the
 * function guide's idle copy says, and holds the Overview and the list to
 * the status's words.
 */

const CARD_STATE_OF_STATUS: Record<
  ServerlessFunctionStatus,
  ResourceConnectionState
> = {
  [ServerlessFunctionStatus.ReceivingData]: ResourceConnectionState.Connected,
  [ServerlessFunctionStatus.NoRecentInvocations]:
    ResourceConnectionState.Disconnected,
  [ServerlessFunctionStatus.WaitingForData]:
    ResourceConnectionState.NeverConnected,
};

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function dashboardFile(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function textOf(steps: Array<ResourceConnectionGuideStep>): string {
  return steps
    .map((step: ResourceConnectionGuideStep): string => {
      return `${step.title} ${step.description}`;
    })
    .join(" ");
}

describe("the pill and the card read a function the same way", () => {
  test("on the records the product writes", () => {
    const cases: Array<ServerlessFunctionStatusInput> = [
      // Discovered from its first batch (findOrCreateByFunctionIdentifier).
      { otelCollectorStatus: "connected", lastSeenAt: new Date() },
      // Swept after fifteen quiet minutes.
      {
        otelCollectorStatus: "disconnected",
        lastSeenAt: "2026-11-07T03:00:00.000Z",
      },
      // Created through the API, nothing yet.
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
        card: CARD_STATE_OF_STATUS[getServerlessFunctionStatus(input)],
      });
    }
  });

  test("on 5,000 drawn records, odd values and casings included", () => {
    const random: SeededRandom = seededRandom(62690);
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
      const input: ServerlessFunctionStatusInput = {
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
        card: CARD_STATE_OF_STATUS[getServerlessFunctionStatus(input)],
      });
    }
  });
});

describe("the function guide: idle between invocations", () => {
  const guide: ResourceConnectionGuide =
    getServerlessFunctionConnectionGuide("checkout-handler");

  test("declares itself idle when not invoked, on every platform, with the copy its card draws", () => {
    for (const cloudPlatform of [
      undefined,
      null,
      "aws_lambda",
      "gcp_cloud_functions",
      "azure_functions",
      "azure.functions",
    ]) {
      expect(
        getServerlessFunctionConnectionGuide("checkout-handler", cloudPlatform)
          .idleCopy,
      ).toBe(SERVERLESS_FUNCTION_IDLE_COPY);
    }
  });

  test("the idle title says the sweep's number of minutes", () => {
    expect(SERVERLESS_FUNCTION_IDLE_COPY.title).toContain(
      `${SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES} minutes`,
    );
  });

  test("its description puts when data last arrived in once, and no noun", () => {
    expect(
      SERVERLESS_FUNCTION_IDLE_COPY.description.match(/\{\{\w+\}\}/g),
    ).toEqual(["{{lastHeard}}"]);
    expect(SERVERLESS_FUNCTION_IDLE_COPY.waitingDescription).not.toMatch(
      /\{\{/,
    );
    expect(SERVERLESS_FUNCTION_IDLE_COPY.title).not.toMatch(/\{\{/);
    expect(SERVERLESS_FUNCTION_IDLE_COPY.checksLabel).not.toMatch(/\{\{/);
  });

  test("it says why quiet is normal: a function sends data only while it runs", () => {
    expect(SERVERLESS_FUNCTION_IDLE_COPY.description).toContain(
      "only while it runs",
    );
    expect(SERVERLESS_FUNCTION_IDLE_COPY.description).toContain("normal");
    expect(SERVERLESS_FUNCTION_IDLE_COPY.waitingDescription).toContain(
      "invoke the function",
    );
  });

  test("nothing it says calls the function disconnected, or connected", () => {
    for (const cloudPlatform of [undefined, "azure_functions"]) {
      const text: string = JSON.stringify(
        getServerlessFunctionConnectionGuide("checkout-handler", cloudPlatform),
      );

      expect(text).not.toMatch(/disconnect/i);
      expect(text).not.toMatch(/\bConnected\b/);
    }
  });

  test("its last setup step asks for an invocation and names the status it switches to", () => {
    const waitStep: ResourceConnectionGuideStep = guide.setupSteps[2]!;

    expect(waitStep.title).toBe("Deploy and invoke it");
    expect(waitStep.description).toBe(
      "Data is sent when the function runs. Invoke it once, then refresh this page after a few minutes. The function switches to Receiving data once its first data arrives.",
    );
    expect(waitStep.description).toContain(
      SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
    );
    expect(waitStep.code).toBeUndefined();
  });

  test("its checks, for a function that should be running, start with whether it is invoked", () => {
    expect(guide.troubleshootingSteps[0]!.title).toBe(
      "Check it is being invoked",
    );
    expect(textOf(guide.troubleshootingSteps)).toContain(
      "A function only sends data while it runs",
    );
  });
});

/*
 * Every place that draws a function's status reads it from
 * ServerlessFunctionStatus - the list and the Overview - and none draws the
 * stored value or the old words.
 */
describe("the pages draw the status's words", () => {
  test("the list's Status column draws the status, never Connected or Disconnected", () => {
    const list: string = dashboardFile(
      "Pages/Serverless/ServerlessFunctions.tsx",
    );

    expect(list).toContain("describeServerlessFunctionStatus({");
    expect(list).toContain("text={status.label}");
    expect(list).toContain("tooltip={status.description}");
    expect(list).toContain(
      "color={getServerlessFunctionStatusPillColor(status.tone)}",
    );
    // No pill text of the old words.
    expect(list).not.toMatch(/text=\{[^}]*"(?:Connected|Disconnected)"/);
    // No colour of its own, red included: the status's tone picks it.
    expect(list).not.toContain('from "Common/Types/BrandColors"');
  });

  test("the Overview hands its hero the status's words, tone and hover", () => {
    const overview: string = dashboardFile(
      "Pages/Serverless/View/Overview.tsx",
    );

    expect(overview).toContain("describeServerlessFunctionStatus({");
    expect(overview).toContain("statusLabel={status.label}");
    expect(overview).toContain("statusTone={status.tone}");
    expect(overview).toContain("statusDescription={status.description}");
  });

  test("the quiet label is the one the docs and the setup guide name", () => {
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL).toBe(
      "No recent invocations",
    );
    expect(
      dashboardFile("Components/Serverless/ServerlessSetupGuide.ts"),
    ).toContain(`**${SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL}**`);
  });
});
