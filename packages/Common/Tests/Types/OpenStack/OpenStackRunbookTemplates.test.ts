import { describe, expect, test } from "@jest/globals";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import { getAllOpenStackControlPlaneAlertTemplates } from "../../../Types/Monitor/OpenStackControlPlaneAlertTemplates";
import {
  OPENSTACK_RUNBOOK_TEMPLATES,
  OpenStackRunbookCheck,
  OpenStackRunbookFix,
  OpenStackRunbookFixTier,
  OpenStackRunbookTemplate,
  buildOpenStackRunbookSteps,
} from "../../../Types/OpenStack/OpenStackRunbookTemplates";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ResourceCommandPolicy from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * A runbook says what to check and which fix it may come to, and a person reads it in the
 * middle of a failure. So every check is held to a read the policy allows and every fix to
 * the tier it claims, against the policy itself: a runbook can't promise what the agent
 * would refuse, and it can't call a riskier change safe.
 */

// What goes where the templates write capitals, as the policy's patterns want it.
function filledIn(command: string): string {
  return command
    .split("SERVER-ID")
    .join("358ee736-ba74-40ba-a354-7ead413c5df6")
    .split("AGENT-ID")
    .join("d7e6c5b4-a392-4180-b6f5-e4d3c2b1a098")
    .split("ROUTER-ID")
    .join("4d955c70-df91-45ae-be57-044f4bcaefec")
    .split("VOLUME-ID")
    .join("6c9d9b3a-7a53-4d7e-8f6a-2a1f5b0c9e11")
    .split("HOST")
    .join("compute-01")
    .split("REASON")
    .join("maintenance");
}

function policyOf(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: AiResourceType.OpenStackCloud,
    command: filledIn(command),
  });
}

const ROWS: Array<[string, OpenStackRunbookTemplate]> =
  OPENSTACK_RUNBOOK_TEMPLATES.map((template: OpenStackRunbookTemplate) => {
    return [template.name, template] as [string, OpenStackRunbookTemplate];
  });

describe("the failures it covers", () => {
  test("the six the issue names", () => {
    expect(
      OPENSTACK_RUNBOOK_TEMPLATES.map((template: OpenStackRunbookTemplate) => {
        return template.id;
      }),
    ).toEqual([
      "openstack-compute-service-down",
      "openstack-instance-stuck",
      "openstack-volume-stuck",
      "openstack-router-without-agent",
      "openstack-rabbitmq-partition",
      "openstack-galera-lost-quorum",
    ]);
  });
});

describe.each(ROWS)(
  "%s",
  (_name: string, template: OpenStackRunbookTemplate) => {
    test("has checks and fixes, and says when it is for", () => {
      expect(template.whenItIsFor.length).toBeGreaterThan(10);
      expect(template.checks.length).toBeGreaterThan(0);
      expect(template.fixes.length).toBeGreaterThan(0);
    });

    test("every check with a command is a read the policy allows", () => {
      for (const check of template.checks) {
        if (check.command === null) {
          continue;
        }

        expect({
          command: check.command,
          tier: policyOf(check.command).tier,
        }).toEqual({ command: check.command, tier: ResourceCommandTier.Read });
      }
    });

    test("every fix is the tier it says, by the policy", () => {
      for (const fix of template.fixes) {
        if (fix.command === null) {
          expect({ fix: fix.title, tier: fix.tier }).toEqual({
            fix: fix.title,
            tier: OpenStackRunbookFixTier.ByHand,
          });
          continue;
        }

        const policy: ResourceCommandPolicyResult = policyOf(fix.command);
        const tier: string =
          policy.requiresHuman === true
            ? OpenStackRunbookFixTier.AlwaysAsks
            : policy.tier === ResourceCommandTier.SafeWrite
              ? OpenStackRunbookFixTier.Safe
              : policy.tier === ResourceCommandTier.RiskyWrite
                ? OpenStackRunbookFixTier.Riskier
                : `not a change: ${policy.tier}`;

        expect({ command: fix.command, tier }).toEqual({
          command: fix.command,
          tier: fix.tier,
        });
      }
    });

    test("every alert it answers is a real template", () => {
      const known: Set<string> = new Set<string>(
        [
          ...getAllOpenStackAlertTemplates(),
          ...getAllOpenStackControlPlaneAlertTemplates(),
        ].map((alert: OpenStackAlertTemplate): string => {
          return alert.id;
        }),
      );

      expect(template.alertTemplateIds.length).toBeGreaterThan(0);

      for (const id of template.alertTemplateIds) {
        expect({ id, known: known.has(id) }).toEqual({ id, known: true });
      }
    });

    test("becomes a runbook of a person's steps, and nothing that runs on its own", () => {
      const steps: Array<RunbookStep> = buildOpenStackRunbookSteps(template);

      expect(steps.length).toBe(template.checks.length + template.fixes.length);

      steps.forEach((step: RunbookStep, index: number): void => {
        expect(step.type).toBe(RunbookStepType.Manual);
        expect(step.order).toBe(index + 1);
        expect(step.id.length).toBeGreaterThan(0);
        expect((step.description || "").length).toBeGreaterThan(0);
      });

      for (const check of template.checks) {
        if (check.command) {
          expect(
            steps.some((step: RunbookStep): boolean => {
              return (step.description || "").includes(
                (check as OpenStackRunbookCheck).command as string,
              );
            }),
          ).toBe(true);
        }
      }

      for (const fix of template.fixes) {
        expect(
          steps.some((step: RunbookStep): boolean => {
            return (step.description || "").includes(
              `Tier: ${(fix as OpenStackRunbookFix).tier}.`,
            );
          }),
        ).toBe(true);
      }
    });
  },
);

describe("what no command reaches", () => {
  test.each([
    ["openstack-volume-stuck"],
    ["openstack-rabbitmq-partition"],
    ["openstack-galera-lost-quorum"],
  ])("%s says a person does it", (id: string) => {
    const template: OpenStackRunbookTemplate | undefined =
      OPENSTACK_RUNBOOK_TEMPLATES.find(
        (candidate: OpenStackRunbookTemplate) => {
          return candidate.id === id;
        },
      );

    expect(
      template?.fixes.every((fix: OpenStackRunbookFix): boolean => {
        return (
          fix.command === null && fix.tier === OpenStackRunbookFixTier.ByHand
        );
      }),
    ).toBe(true);
  });

  test("a dead hypervisor's evacuation always asks", () => {
    const fix: OpenStackRunbookFix | undefined =
      OPENSTACK_RUNBOOK_TEMPLATES[0]?.fixes.find(
        (candidate: OpenStackRunbookFix): boolean => {
          return (candidate.command || "").includes("server evacuate");
        },
      );

    expect(fix?.tier).toBe(OpenStackRunbookFixTier.AlwaysAsks);
  });
});
