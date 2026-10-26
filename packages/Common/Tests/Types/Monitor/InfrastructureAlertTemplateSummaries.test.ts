import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { getAllCephAlertTemplates } from "../../../Types/Monitor/CephAlertTemplates";
import { getAllDockerAlertTemplates } from "../../../Types/Monitor/DockerAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getAllHostAlertTemplates } from "../../../Types/Monitor/HostAlertTemplates";
import { getAllIoTAlertTemplates } from "../../../Types/Monitor/IotAlertTemplates";
import { getAllKubernetesAlertTemplates } from "../../../Types/Monitor/KubernetesAlertTemplates";
import { getAllKubernetesEventAlertTemplates } from "../../../Types/Monitor/KubernetesEventAlertTemplates";
import { getAllPodmanAlertTemplates } from "../../../Types/Monitor/PodmanAlertTemplates";
import { getAllProxmoxAlertTemplates } from "../../../Types/Monitor/ProxmoxAlertTemplates";
import { getAllStorageArrayAlertTemplates } from "../../../Types/Monitor/StorageArrayAlertTemplates";
import { getAllVMwareAlertTemplates } from "../../../Types/Monitor/VMwareAlertTemplates";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * Every infrastructure alert template says in one plain sentence when it
 * fires (`summary`). The template picker on Create Monitor and a resource's
 * Recommendations list show that sentence on each card; the full
 * `description` - how the value is computed, which metric it reads, the
 * caveats - is shown once a template is picked (or "Show more" is pressed).
 *
 * The descriptions ran to 509 characters, metric names and formulas
 * included, seventeen to a screen. These hold the short line to what makes
 * it worth reading at a glance, and to the facts of the template it sits on.
 */

interface SummarisedTemplate {
  id: string;
  name: string;
  summary: string;
  description: string;
  getMonitorStep: (args: never) => MonitorStep;
}

interface Catalog {
  name: string;
  resourceType: MonitorRecommendationResourceType;
  templates: Array<SummarisedTemplate>;
}

const CATALOGS: Array<Catalog> = [
  {
    name: "Host",
    resourceType: MonitorRecommendationResourceType.Host,
    templates: getAllHostAlertTemplates(),
  },
  {
    name: "Docker",
    resourceType: MonitorRecommendationResourceType.Docker,
    templates: getAllDockerAlertTemplates(),
  },
  {
    name: "Podman",
    resourceType: MonitorRecommendationResourceType.Podman,
    templates: getAllPodmanAlertTemplates(),
  },
  {
    name: "Docker Swarm",
    resourceType: MonitorRecommendationResourceType.DockerSwarm,
    templates: getAllDockerSwarmAlertTemplates(),
  },
  {
    name: "Kubernetes",
    resourceType: MonitorRecommendationResourceType.Kubernetes,
    // Its metric templates, and its warning events' Logs monitor.
    templates: [
      ...getAllKubernetesAlertTemplates(),
      ...getAllKubernetesEventAlertTemplates(),
    ],
  },
  {
    name: "Proxmox",
    resourceType: MonitorRecommendationResourceType.Proxmox,
    templates: getAllProxmoxAlertTemplates(),
  },
  {
    name: "VMware",
    resourceType: MonitorRecommendationResourceType.VMware,
    templates: getAllVMwareAlertTemplates(),
  },
  {
    name: "Ceph",
    resourceType: MonitorRecommendationResourceType.Ceph,
    templates: getAllCephAlertTemplates(),
  },
  {
    name: "Storage Array",
    resourceType: MonitorRecommendationResourceType.StorageArray,
    templates: getAllStorageArrayAlertTemplates(),
  },
  {
    name: "IoT",
    resourceType: MonitorRecommendationResourceType.IoTDevice,
    templates: getAllIoTAlertTemplates(),
  },
];

// Short enough to read in one line of a two-column card grid.
const MAX_SUMMARY_LENGTH: number = 80;

// A metric or attribute name: snake_case, or a dotted lower-case path.
const SNAKE_CASE_NAME: RegExp = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;
const DOTTED_NAME: RegExp = /\b[a-z][a-z0-9]*\.[a-z][a-z0-9_.]*\b/;
const NUMBER: RegExp = /-?\d+(?:\.\d+)?/g;

// The args every catalog's builder reads, under each catalog's own name.
const STEP_ARGS: Record<string, unknown> = {
  hostIdentifier: "host-01",
  clusterIdentifier: "cluster-01",
  vcenterIdentifier: "vcenter-01",
  arrayIdentifier: "array-01",
  fleetIdentifier: "fleet-01",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Summary check",
};

type TemplateCase = [string, SummarisedTemplate];

const TEMPLATE_CASES: Array<TemplateCase> = CATALOGS.flatMap(
  (catalog: Catalog): Array<TemplateCase> => {
    return catalog.templates.map(
      (template: SummarisedTemplate): TemplateCase => {
        return [`${catalog.name} / ${template.id}`, template];
      },
    );
  },
);

describe("Infrastructure alert template summaries", () => {
  test("every infrastructure catalog is covered", () => {
    expect(TEMPLATE_CASES.length).toBeGreaterThanOrEqual(117);

    for (const catalog of CATALOGS) {
      expect({
        catalog: catalog.name,
        hasTemplates: catalog.templates.length > 0,
      }).toEqual({ catalog: catalog.name, hasTemplates: true });
    }
  });

  test.each(TEMPLATE_CASES)(
    "%s has a one-line summary",
    (_label: string, template: SummarisedTemplate) => {
      const summary: string = template.summary;

      expect(typeof summary).toBe("string");
      expect(summary).toBe(summary.trim());
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);

      // A sentence, not a heading: it ends with a full stop.
      expect(summary.endsWith(".")).toBe(true);
      expect(summary).not.toContain("\n");
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s says when it fires in plain words",
    (_label: string, template: SummarisedTemplate) => {
      const summary: string = template.summary;

      // Not the name again, and not the old "Alert when ..." preamble.
      expect(summary.toLowerCase()).not.toBe(`${template.name.toLowerCase()}.`);
      expect(summary.startsWith("Alert ")).toBe(false);

      // No metric names, formulas or code: those stay in the description.
      expect(summary).not.toMatch(SNAKE_CASE_NAME);
      expect(summary).not.toMatch(DOTTED_NAME);
      expect(summary).not.toContain("`");
      expect(summary).not.toContain("÷");
      expect(summary).not.toContain("×");
      expect(summary).not.toContain(" = ");
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s states only numbers its template uses",
    (_label: string, template: SummarisedTemplate) => {
      const step: MonitorStep = template.getMonitorStep(STEP_ARGS as never);
      const facts: string = `${template.description} ${JSON.stringify(step)}`;

      for (const number of template.summary.match(NUMBER) || []) {
        expect({
          template: template.id,
          number,
          found: facts.includes(number),
        }).toEqual({ template: template.id, number, found: true });
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s keeps its full description for the details",
    (_label: string, template: SummarisedTemplate) => {
      expect(template.description.length).toBeGreaterThan(0);

      if (template.description.length > MAX_SUMMARY_LENGTH) {
        expect(template.summary.length).toBeLessThan(
          template.description.length,
        );
      }
    },
  );

  test("templates with different names never share a summary", () => {
    for (const catalog of CATALOGS) {
      const nameBySummary: Map<string, string> = new Map();

      for (const template of catalog.templates) {
        const earlierName: string | undefined = nameBySummary.get(
          template.summary,
        );

        if (earlierName !== undefined) {
          expect({
            catalog: catalog.name,
            summary: template.summary,
            name: template.name,
          }).toEqual({
            catalog: catalog.name,
            summary: template.summary,
            name: earlierName,
          });
        }

        nameBySummary.set(template.summary, template.name);
      }
    }
  });

  test("a resource's recommendations carry each template's summary", () => {
    for (const catalog of CATALOGS) {
      const recommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getAllPossibleRecommendations(
          catalog.resourceType,
        );

      expect(recommendations.length).toBe(catalog.templates.length);

      for (const template of catalog.templates) {
        const recommendation: MonitorRecommendation | undefined =
          recommendations.find((candidate: MonitorRecommendation): boolean => {
            return candidate.templateId === template.id;
          });

        expect(recommendation?.summary).toBe(template.summary);
        expect(recommendation?.description).toBe(template.description);
      }
    }
  });
});
