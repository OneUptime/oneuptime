import { describe, expect, test } from "@jest/globals";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import VMUtil from "../../../Server/Utils/VM/VMAPI";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { JSONObject } from "../../../Types/JSON";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { ComponentType } from "../../../Types/Workflow/Component";
import { ConditionOperator } from "../../../Types/Workflow/Components/Condition";
import {
  WorkflowTemplate,
  WorkflowTemplateCategory,
  buildGraphForTemplate,
  getWorkflowTemplate,
} from "../../../Types/Workflow/Templates";
import ResourceCommandPolicy from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The template a person starts a workflow fix from. Its worth is in what it asks for being
 * a change OneUptime would really propose, about the alert it really listens for: so the
 * command is held to the policy itself and the title to the alert template's own words.
 */

const TEMPLATE_ID: string = "openstack-compute-down-propose-disabling";
const HOST_REFERENCE: string =
  "{{local.components.alert-on-create-1.returnValues.model.seriesLabels.hostname}}";

interface Node {
  metadataId: string;
  componentType: ComponentType;
  arguments: JSONObject;
}

function nodes(): Array<Node> {
  const graph: JSONObject = buildGraphForTemplate(TEMPLATE_ID, () => {
    return "id";
  }) as JSONObject;

  return (graph["nodes"] as Array<JSONObject>).map((node: JSONObject): Node => {
    return node["data"] as unknown as Node;
  });
}

function step(metadataId: string): Node {
  return nodes().find((node: Node): boolean => {
    return node.metadataId === metadataId;
  }) as Node;
}

describe("Propose taking a failing OpenStack compute service out of scheduling", () => {
  test("is offered among the alert templates", () => {
    const template: WorkflowTemplate | null = getWorkflowTemplate(TEMPLATE_ID);

    expect(template?.category).toBe(WorkflowTemplateCategory.Alerts);
    expect(template?.workflowDescription).toContain(
      "Nothing changes until someone approves it.",
    );
  });

  test("starts from an alert, and asks for what the step reads of it", () => {
    const trigger: Node = step("alert-on-create");

    expect(trigger.componentType).toBe(ComponentType.Trigger);

    const select: JSONObject = trigger.arguments["select"] as JSONObject;

    expect(select["_id"]).toBe(true);
    expect(select["title"]).toBe(true);
    expect(select["seriesLabels"]).toBe(true);
  });

  test("only goes on for the alert it is about, by that alert's own words", () => {
    const check: Node = step(ComponentID.IfElse);

    expect(check.arguments["operator"]).toBe(ConditionOperator.Contains);

    const alert: OpenStackAlertTemplate = getAllOpenStackAlertTemplates().find(
      (template: OpenStackAlertTemplate): boolean => {
        return template.id === "openstack-compute-service-down";
      },
    ) as OpenStackAlertTemplate;
    const step_: string = JSON.stringify(
      alert.getMonitorStep({
        cloudIdentifier: "production",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Test Cloud",
      }),
    );

    expect(check.arguments["input-2"]).toBe("[OpenStack] Compute Service Down");
    expect(step_).toContain(
      `${check.arguments["input-2"] as string} - Test Cloud`,
    );
    // It reads the host from a label the alert's own series is grouped by.
    expect(step_).toContain("hostname");
  });

  test("proposes a riskier change the policy takes, once the host is filled in", () => {
    const propose: Node = step(ComponentID.OpenStackProposeFix);
    const command: string = propose.arguments["command"] as string;

    expect(command).toContain(HOST_REFERENCE);

    const policy: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.OpenStackCloud,
        command: command.split(HOST_REFERENCE).join("compute-01"),
      });

    expect(policy.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(propose.arguments["alert-id"]).toBe(
      "{{local.components.alert-on-create-1.returnValues.model._id}}",
    );
  });

  test("the host comes out of the alert as the trigger really hands it on", () => {
    const alert: Alert = new Alert();

    alert._id = "55555555-5555-4555-8555-555555555555";
    alert.title = "[OpenStack] Compute Service Down - Test Cloud";
    alert.seriesLabels = {
      hostname: "compute-01",
      service: "nova-compute",
      adminState: "enabled",
    };

    const command: string = VMUtil.replaceValueInPlace(
      {
        local: {
          components: {
            "alert-on-create-1": {
              returnValues: { model: BaseModel.toJSON(alert, Alert) },
            },
          },
        },
      },
      step(ComponentID.OpenStackProposeFix).arguments["command"] as string,
      false,
    ) as string;

    expect(command).toBe(
      'openstack compute service set --disable --disable-reason "Reported down to OneUptime" compute-01 nova-compute',
    );
    expect(
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.OpenStackCloud,
        command,
      }).tier,
    ).toBe(ResourceCommandTier.RiskyWrite);
  });

  test.each([
    ["a second command", "compute-01; openstack server delete x"],
    ["a flag", "--down"],
    ["nothing", ""],
    ["a word with a space", "compute 01"],
  ])(
    "with %s where the host goes, the policy refuses what it comes to",
    (_name: string, host: string) => {
      const command: string = (
        step(ComponentID.OpenStackProposeFix).arguments["command"] as string
      )
        .split(HOST_REFERENCE)
        .join(host);

      expect(
        ResourceCommandPolicy.evaluateCommand({
          resourceType: AiResourceType.OpenStackCloud,
          command,
        }).tier,
      ).toBe(ResourceCommandTier.Denied);
    },
  );

  test("has no step that makes a change", () => {
    const metadataIds: Array<string> = nodes().map((node: Node): string => {
      return node.metadataId;
    });

    expect(metadataIds).toEqual([
      "alert-on-create",
      ComponentID.IfElse,
      ComponentID.OpenStackProposeFix,
    ]);
  });
});
