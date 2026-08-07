import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
);

function readChangeStateSource(component: string): string {
  return fs
    .readFileSync(
      path.join(DASHBOARD_SRC, component, "ChangeState.tsx"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function actionBlocksForId(source: string, id: string): Array<string> {
  return Array.from(
    source.matchAll(
      new RegExp(`\\{[^{}]*id: "${escapeRegExp(id)}"[^{}]*\\}`, "g"),
    ),
  ).map((match: RegExpMatchArray) => {
    return match[0];
  });
}

function expectAction(
  actionBlock: string,
  expected: {
    icon: string;
    style: string;
  },
): void {
  expect(actionBlock).toContain(`icon: IconProp.${expected.icon}`);
  expect(actionBlock).toContain(
    `buttonStyle: ButtonStyleType.${expected.style}`,
  );
  expect(actionBlock).not.toContain("color:");
}

describe("event detail action configuration", () => {
  test.each([
    {
      component: "Incident",
      acknowledgeId: "incident-acknowledge-btn",
      resolveId: "incident-resolve-btn",
    },
    {
      component: "Alert",
      acknowledgeId: "alert-acknowledge-btn",
      resolveId: "alert-resolve-btn",
    },
  ])(
    "$component keeps acknowledge primary and promotes resolve only after acknowledgement",
    ({
      component,
      acknowledgeId,
      resolveId,
    }: {
      component: string;
      acknowledgeId: string;
      resolveId: string;
    }) => {
      const source: string = readChangeStateSource(component);
      const acknowledgeActions: Array<string> = actionBlocksForId(
        source,
        acknowledgeId,
      );
      const resolveActions: Array<string> = actionBlocksForId(
        source,
        resolveId,
      );

      expect(acknowledgeActions).toHaveLength(1);
      expectAction(acknowledgeActions[0]!, {
        icon: "Check",
        style: "PRIMARY",
      });

      expect(resolveActions).toHaveLength(2);
      expectAction(resolveActions[0]!, {
        icon: "CheckCircle",
        style: "OUTLINE",
      });
      expectAction(resolveActions[1]!, {
        icon: "CheckCircle",
        style: "PRIMARY",
      });
    },
  );

  test("scheduled maintenance keeps ongoing primary and promotes complete once ongoing", () => {
    const source: string = readChangeStateSource("ScheduledMaintenance");
    const ongoingActions: Array<string> = actionBlocksForId(
      source,
      "sm-mark-ongoing-btn",
    );
    const completeActions: Array<string> = actionBlocksForId(
      source,
      "sm-mark-complete-btn",
    );

    expect(ongoingActions).toHaveLength(1);
    expectAction(ongoingActions[0]!, {
      icon: "Clock",
      style: "PRIMARY",
    });

    expect(completeActions).toHaveLength(2);
    expectAction(completeActions[0]!, {
      icon: "CheckCircle",
      style: "OUTLINE",
    });
    expectAction(completeActions[1]!, {
      icon: "CheckCircle",
      style: "PRIMARY",
    });
  });
});
