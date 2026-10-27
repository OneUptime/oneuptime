import AIToolbox from "../../../Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AFFECTED_RESOURCES_ARGUMENT_NAME } from "../../../Server/Utils/AI/Toolbox/AffectedResourceLinks";
import { REMEDIATION_LINK_COLUMNS } from "../../../Server/Services/AutoRemediationRuleEngineService";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKindInfo,
} from "../../../Types/AI/AiAffectedResources";
import { JSONObject } from "../../../Types/JSON";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN INCIDENT OR ALERT IS LINKED TO IS WHAT ONEUPTIME AI FIXES (#5293).
 *
 * Three places have to agree, or an incident is linked to something no fix
 * reads - or a fix reads something nothing links:
 *
 *   A. The lists auto-remediation finds what to fix through - a Kubernetes
 *      cluster's (KubernetesClusterAiAccessService) and each resource with
 *      an AI agent's (ResourceAiAccessService's subjectRelation) - are the
 *      lists OneUptime AI links and calls fixable
 *      (Types/AI/AiAffectedResources), and the lists whose writes make it
 *      try again (REMEDIATION_LINK_COLUMNS).
 *   B. Every update of an incident or alert hands what it wrote to the
 *      engine (onSubjectUpdated), from the service's own onUpdateSuccess:
 *      the Affected Resources Edit, the AI tools and the API alike.
 *   C. Every AI tool that creates an incident or an alert links what it is
 *      about: it takes affectedResources and writes the page's resource out
 *      before approval (prepareMutation) - create_incident and, since #5301,
 *      create_alert.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(COMMON_ROOT, relativePath), "utf8");
}

const FIXABLE_RELATIONS: Array<string> = AI_AFFECTED_RESOURCE_KINDS.filter(
  (info: AiAffectedResourceKindInfo): boolean => {
    return info.isFixedByOneUptimeAi;
  },
).map((info: AiAffectedResourceKindInfo): string => {
  return info.relation;
});

const SUBJECT_RELATION_PATTERN: RegExp = /subjectRelation: "(\w+)"/g;

describe("A: the lists a fix reads are the lists OneUptime AI links", () => {
  test("the resources with an AI agent are read through exactly the fixable lists, the cluster list aside", () => {
    const source: string = readSource(
      "Server/Services/ResourceAiAccessService.ts",
    );
    const read: Array<string> = [];

    for (const match of source.matchAll(SUBJECT_RELATION_PATTERN)) {
      read.push(match[1]!);
    }

    expect(read.length).toBeGreaterThan(0);
    expect(read.sort()).toEqual(
      FIXABLE_RELATIONS.filter((relation: string): boolean => {
        return relation !== "kubernetesClusters";
      }).sort(),
    );
  });

  test("the clusters are read through the incident's and the alert's cluster list", () => {
    const source: string = readSource(
      "Server/Services/KubernetesClusterAiAccessService.ts",
    );

    expect(source).toContain("kubernetesClusters: { _id: true }");
    expect(FIXABLE_RELATIONS).toContain("kubernetesClusters");
  });

  test("writing any fixable list - or the monitors a fix falls back to - makes OneUptime AI try again", () => {
    for (const relation of FIXABLE_RELATIONS) {
      expect(REMEDIATION_LINK_COLUMNS).toContain(relation);
    }

    for (const monitorReference of ["monitors", "monitor", "monitorId"]) {
      expect(REMEDIATION_LINK_COLUMNS).toContain(monitorReference);
    }
  });
});

// The text of a class's method, by name.
function methodText(
  source: string,
  fileName: string,
  methodName: string,
): string {
  const file: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found: string = "";

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      node.name.getText(file) === methodName
    ) {
      found = node.getText(file);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

describe("B: every update hands what it wrote to the engine", () => {
  test.each([
    ["Server/Services/IncidentService.ts", "incidentId: incidentId"],
    ["Server/Services/AlertService.ts", "alertId: alertId"],
  ])(
    "%s's onUpdateSuccess asks AutoRemediationRuleEngineService.onSubjectUpdated",
    (file: string, subject: string) => {
      const hook: string = methodText(
        readSource(file),
        path.basename(file),
        "onUpdateSuccess",
      );

      expect(hook.length).toBeGreaterThan(0);

      const start: number = hook.indexOf(
        "AutoRemediationRuleEngineService.onSubjectUpdated(",
      );
      expect(start).toBeGreaterThan(-1);

      const call: string = hook.substring(start, start + 400);
      expect(call).toContain(subject);
      expect(call).toContain("written:");
      // Never awaited: an edit does not wait for a fix to start.
      expect(hook.substring(Math.max(0, start - 20), start)).not.toContain(
        "await",
      );
      expect(call).toContain(".catch(");
    },
  );
});

describe("C: every AI tool that creates an incident or an alert links what it is about", () => {
  const TOOLBOX_DIRECTORY: string = path.join(
    COMMON_ROOT,
    "Server/Utils/AI/Toolbox",
  );

  // The toolbox files that create an incident or an alert.
  const creatingFiles: Array<string> = fs
    .readdirSync(TOOLBOX_DIRECTORY)
    .filter((name: string): boolean => {
      if (!name.endsWith(".ts")) {
        return false;
      }

      const source: string = fs.readFileSync(
        path.join(TOOLBOX_DIRECTORY, name),
        "utf8",
      );

      return (
        source.includes("IncidentService.create(") ||
        source.includes("AlertService.create(")
      );
    });

  test("the scan finds create_incident's file and create_alert's", () => {
    expect(creatingFiles).toContain("IncidentWriteTools.ts");
    expect(creatingFiles).toContain("AlertWriteTools.ts");
  });

  const creatingTools: Array<ObservabilityTool> = AIToolbox.getTools().filter(
    (tool: ObservabilityTool): boolean => {
      return tool.name === "create_incident" || tool.name === "create_alert";
    },
  );

  test("create_incident and create_alert are both of them", () => {
    expect(
      creatingTools
        .map((tool: ObservabilityTool): string => {
          return tool.name;
        })
        .sort(),
    ).toEqual(["create_alert", "create_incident"]);
  });

  test.each(
    creatingTools.map(
      (tool: ObservabilityTool): [string, ObservabilityTool] => {
        return [tool.name, tool];
      },
    ),
  )(
    "%s takes affectedResources and writes the page's resource out before approval",
    (_name: string, tool: ObservabilityTool) => {
      const properties: JSONObject = (tool.inputSchema["properties"] ||
        {}) as JSONObject;

      expect(properties[AFFECTED_RESOURCES_ARGUMENT_NAME]).toBeDefined();
      expect(tool.isMutation).toBe(true);
      expect(typeof tool.prepareMutation).toBe("function");
      // Linking is never what makes a declaration fail.
      expect(tool.inputSchema["required"]).not.toContain(
        AFFECTED_RESOURCES_ARGUMENT_NAME,
      );
    },
  );

  test("every toolbox file that creates an incident or an alert links through AffectedResourceLinks", () => {
    for (const file of creatingFiles) {
      const source: string = fs.readFileSync(
        path.join(TOOLBOX_DIRECTORY, file),
        "utf8",
      );

      expect({
        file,
        links: source.includes("AffectedResourceLinks.setOnRecord("),
      }).toEqual({
        file,
        links: true,
      });
    }
  });
});
