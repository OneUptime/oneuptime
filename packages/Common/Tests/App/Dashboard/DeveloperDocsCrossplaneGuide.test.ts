import { describe, expect, test } from "@jest/globals";
import yaml from "js-yaml";
import {
  DEVELOPER_DOCS_GUIDE_COPY,
  DeveloperDocsGuide,
  DeveloperDocsGuideContext,
  DeveloperDocsStep,
  getDeveloperDocsGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_PARENT_PAGES,
  DeveloperDocsPageDefinition,
  DeveloperDocsPageType,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsChildPages,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import {
  DeveloperDocsResource,
  getDeveloperDocsResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import { getDeveloperDocsRecordSelect } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPage";
import { SetupGuideTopic } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Models from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import { CROSSPLANE_RESOURCE_API_VERSION } from "../../../Utils/DeveloperDocs/CrossplaneNames";
import { getCrossplaneKindOf } from "../../../Utils/DeveloperDocs/CrossplaneSchema";
import { getDeveloperDocsPageLookups } from "../../../Utils/DeveloperDocs/PageLookups";
import {
  fixtureRecordId,
  getFixtureLiveData,
} from "../../Utils/DeveloperDocs/DeveloperDocsLiveFixture";

/*
 * The Developer > Crossplane page (#6615), from the guide builders the page
 * renders: beside Terraform in every resource's Developer section, laid out
 * as the Terraform page is - connect, then the resource, then bring in what
 * there is - with manifests written from the model's fields and the
 * provider's kinds (Common/Utils/DeveloperDocs/CrossplaneConfig), never by
 * hand.
 */

const ORIGIN: string = "https://oneuptime.example.com";
const API_KEYS_URL: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/settings/api-keys";
const INCIDENT_ID: string = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";
const CRITICAL: string = fixtureRecordId(
  "IncidentSeverity",
  "Critical Incident",
);

function context(
  overrides: Partial<DeveloperDocsGuideContext>,
): DeveloperDocsGuideContext {
  return {
    resource: getDeveloperDocsResource(Incident),
    scope: DeveloperDocsScope.View,
    oneuptimeUrl: ORIGIN,
    platformVersion: "17.1.0",
    apiKeysUrl: API_KEYS_URL,
    live: getFixtureLiveData(),
    ...overrides,
  };
}

function crossplane(
  overrides: Partial<DeveloperDocsGuideContext>,
): DeveloperDocsGuide {
  return getDeveloperDocsGuide(
    DeveloperDocsPageType.Crossplane,
    context(overrides),
  );
}

function incidentJson(): JSONObject {
  return {
    _id: INCIDENT_ID,
    title: "Checkout requests are failing",
    description: "Customers see an error when they pay.",
    incidentSeverityId: { _type: "ObjectID", value: CRITICAL },
    currentIncidentStateId: {
      _type: "ObjectID",
      value: fixtureRecordId("IncidentState", "Acknowledged"),
    },
  };
}

function incidentRecordGuide(): DeveloperDocsGuide {
  return crossplane({
    record: {
      id: INCIDENT_ID,
      displayName: "Checkout requests are failing",
      json: incidentJson(),
    },
  });
}

function incidentListGuide(): DeveloperDocsGuide {
  return crossplane({
    scope: DeveloperDocsScope.List,
    importTargets: [
      { id: INCIDENT_ID, displayName: "Checkout requests are failing" },
    ],
    totalCount: 1,
  });
}

function stepTitles(guide: DeveloperDocsGuide): Array<string> {
  return guide.steps.map((step: DeveloperDocsStep): string => {
    return step.title;
  });
}

// Every YAML block of a text, each document parsed.
function yamlDocuments(markdown: string): Array<Record<string, unknown>> {
  return Array.from(markdown.matchAll(/```yaml\n([\s\S]*?)\n```/g)).flatMap(
    (match: RegExpMatchArray): Array<Record<string, unknown>> => {
      return yaml.loadAll(match[1] as string) as Array<Record<string, unknown>>;
    },
  );
}

function allMarkdown(guide: DeveloperDocsGuide): string {
  return [
    ...guide.steps.map((step: DeveloperDocsStep): string => {
      return step.markdown || "";
    }),
    ...guide.topics.map((topic: SetupGuideTopic): string => {
      return topic.markdown;
    }),
  ].join("\n");
}

describe("the Crossplane page in the Developer section", () => {
  test("is the second page, beside Terraform, drawn with Crossplane's own mark", () => {
    const pages: Array<DeveloperDocsPageDefinition> = [...DEVELOPER_DOCS_PAGES];

    expect(
      pages.map((page: DeveloperDocsPageDefinition): string => {
        return page.title;
      }),
    ).toEqual(["Terraform", "Crossplane", "API", "CLI", "AI Assistants"]);
    expect(pages[1]).toEqual({
      type: DeveloperDocsPageType.Crossplane,
      title: "Crossplane",
      icon: IconProp.Crossplane,
    });
  });

  test("every page with Developer pages has one, under developer/crossplane", () => {
    for (const parent of DEVELOPER_DOCS_PARENT_PAGES) {
      const keys: Array<string> = getDeveloperDocsChildPages(
        parent.pageKey,
      ).map((child: { key: string }): string => {
        return child.key;
      });

      expect(keys).toContain(`${parent.pageKey}_DEVELOPER_CROSSPLANE`);
    }
  });

  test("fetches every field the record's manifest may carry, and no secret", () => {
    const select: JSONObject = getDeveloperDocsRecordSelect({
      modelType: Monitor,
      page: DeveloperDocsPageType.Crossplane,
      canRead: (): boolean => {
        return true;
      },
    });

    expect(select).toEqual(
      getDeveloperDocsRecordSelect({
        modelType: Monitor,
        page: DeveloperDocsPageType.Terraform,
        canRead: (): boolean => {
          return true;
        },
      }),
    );
    expect(select["monitorSteps"]).toBe(true);
    expect(select["incomingRequestSecretKey"]).toBeUndefined();
  });

  test("looks up the records a record's IDs point at, to name them in comments", () => {
    const lookups: Array<{ modelType: DatabaseBaseModelType }> =
      getDeveloperDocsPageLookups({
        modelType: Incident,
        scope: "view",
        page: "crossplane",
        json: incidentJson(),
      });

    expect(
      lookups.map((lookup: { modelType: DatabaseBaseModelType }): string => {
        return new lookup.modelType().tableName || "";
      }),
    ).toContain("IncidentSeverity");
  });
});

describe("a record's Crossplane page", () => {
  const guide: DeveloperDocsGuide = incidentRecordGuide();

  test("connects, writes the record's manifest, and applies it", () => {
    expect(guide.title).toBe("Crossplane");
    expect(guide.description).toBe(
      DEVELOPER_DOCS_GUIDE_COPY[DeveloperDocsPageType.Crossplane][
        DeveloperDocsScope.View
      ].description,
    );
    expect(stepTitles(guide)).toEqual([
      "Connect Crossplane to OneUptime",
      'Add the incident "Checkout requests are failing"',
      "Apply it",
    ]);
  });

  test("connects once: the package of this release, the API key, a ProviderConfig pointed at this OneUptime", () => {
    const markdown: string = guide.steps[0]?.markdown || "";
    const [provider, providerConfig] = yamlDocuments(markdown);

    expect(provider).toEqual({
      apiVersion: "pkg.crossplane.io/v1",
      kind: "Provider",
      metadata: { name: "provider-oneuptime" },
      spec: { package: "ghcr.io/oneuptime/provider-oneuptime:v17.1.0" },
    });
    expect((providerConfig!["spec"] as Record<string, unknown>)["url"]).toBe(
      ORIGIN,
    );
    expect(markdown).toContain(
      `[Project Settings → Advanced → API Keys](${API_KEYS_URL})`,
    );
    expect(markdown).toContain("permission to manage incidents");
    expect(markdown).toContain('export ONEUPTIME_API_KEY="your-api-key"');
    expect(markdown).toContain('--from-literal=api-key="$ONEUPTIME_API_KEY"');
  });

  test("the record's manifest takes it over by its ID, naming the records its IDs point at", () => {
    const markdown: string = guide.steps[1]?.markdown || "";
    const [manifest] = yamlDocuments(markdown);
    const spec: Record<string, unknown> = manifest!["spec"] as Record<
      string,
      unknown
    >;

    expect(manifest!["apiVersion"]).toBe(CROSSPLANE_RESOURCE_API_VERSION);
    expect(manifest!["kind"]).toBe("Incident");
    expect(manifest!["metadata"]).toEqual({
      name: "checkout-requests-are-failing",
      namespace: "oneuptime",
      annotations: { "crossplane.io/external-name": INCIDENT_ID },
    });
    expect(spec["forProvider"]).toEqual(
      expect.objectContaining({
        title: "Checkout requests are failing",
        incidentSeverityId: CRITICAL,
      }),
    );
    // The state OneUptime moves is never in it (#9985).
    expect(JSON.stringify(spec)).not.toContain("currentIncidentStateId");
    expect(markdown).toContain(
      `incidentSeverityId: ${CRITICAL} # Critical Incident`,
    );
    expect(markdown).toContain(
      "Save it as `checkout-requests-are-failing.yaml`:",
    );
  });

  test("applying it says what happens, deletion included", () => {
    const markdown: string = guide.steps[2]?.markdown || "";

    expect(markdown).toContain(
      "kubectl apply -f checkout-requests-are-failing.yaml\nkubectl -n oneuptime get incident.crossplane.oneuptime.com checkout-requests-are-failing",
    );
    expect(markdown).toContain(
      "Deleting the resource deletes the incident in OneUptime too",
    );
  });

  test("observing it instead is folded away, and changes nothing", () => {
    const topic: SetupGuideTopic | undefined = guide.topics[0];
    const [observe] = yamlDocuments(topic?.markdown || "");

    expect(topic?.title).toBe("Read it without managing it");
    expect(topic?.summary).toBe("The Observe management policy");
    expect(
      (observe!["spec"] as Record<string, unknown>)["managementPolicies"],
    ).toEqual(["Observe"]);
  });

  test("links to the provider's docs", () => {
    expect(guide.links).toEqual([
      { title: "Crossplane provider", url: `${ORIGIN}/docs/crossplane/index` },
      {
        title: "Managing resources",
        url: `${ORIGIN}/docs/crossplane/managing-resources`,
      },
    ]);
  });

  test("a telemetry ingestion key says where its secret arrives, and how to read it", () => {
    const record: TelemetryIngestionKey = new TelemetryIngestionKey();
    record._id = "5a2b3c4d-1234-4b2c-9d8e-0123456789ab";
    record.name = "Collector";
    const markdown: string =
      crossplane({
        resource: getDeveloperDocsResource(TelemetryIngestionKey),
        record: {
          id: record._id,
          displayName: "Collector",
          json: BaseModel.toJSON(record, TelemetryIngestionKey),
        },
      }).steps[1]?.markdown || "";

    expect(markdown).toContain(
      "writeConnectionSecretToRef:\n    name: collector-connection",
    );
    expect(markdown).toContain(
      "kubectl -n oneuptime get secret collector-connection -o jsonpath='{.data.attribute\\.secret_key}' | base64 -d",
    );
  });

  test("a monitor links the steps guide its manifest shares with Terraform", () => {
    const monitor: Monitor = new Monitor();
    monitor._id = "1a2b3c4d-1234-4b2c-9d8e-0123456789ab";
    monitor.name = "Checkout API";

    expect(
      crossplane({
        resource: getDeveloperDocsResource(Monitor),
        record: {
          id: monitor._id,
          displayName: "Checkout API",
          json: BaseModel.toJSON(monitor, Monitor),
        },
      }).links.map((link: { title: string }): string => {
        return link.title;
      }),
    ).toContain("Monitor steps");
  });
});

describe("a list's Crossplane page", () => {
  const guide: DeveloperDocsGuide = incidentListGuide();

  test("connects, creates one, and brings in the ones there are", () => {
    expect(guide.description).toBe(
      DEVELOPER_DOCS_GUIDE_COPY[DeveloperDocsPageType.Crossplane][
        DeveloperDocsScope.List
      ].description,
    );
    expect(stepTitles(guide)).toEqual([
      "Connect Crossplane to OneUptime",
      "Declare an incident",
      "Bring in the incidents you already have",
    ]);
  });

  test("a new incident with the fields most incidents set, from this project, with what each is for", () => {
    const step: DeveloperDocsStep = guide.steps[1]!;
    const [manifest] = yamlDocuments(step.markdown || "");
    const forProvider: Record<string, unknown> = (
      manifest!["spec"] as Record<string, unknown>
    )["forProvider"] as Record<string, unknown>;

    expect(step.description).toBe(
      "The fields most incidents set, filled in from this project.",
    );
    expect(forProvider["incidentSeverityId"]).toBe(CRITICAL);
    expect(step.markdown).toContain("What each field is for:");
    expect(step.markdown).toContain("- `incidentSeverityId` (required):");
    expect(step.markdown).toContain(
      `kubectl apply -f ${(manifest!["metadata"] as Record<string, string>)["name"]}.yaml`,
    );
  });

  test("the ones there are are observed, each by its ID", () => {
    const markdown: string = guide.steps[2]?.markdown || "";
    const documents: Array<Record<string, unknown>> = yamlDocuments(markdown);

    expect(documents).toHaveLength(1);
    expect(
      (documents[0]!["spec"] as Record<string, unknown>)["managementPolicies"],
    ).toEqual(["Observe"]);
    expect(markdown).toContain("kubectl apply -f incident-observed.yaml");
    expect(markdown).toContain("**Developer → Crossplane**");
  });

  test("says when there is nothing to bring in", () => {
    const empty: DeveloperDocsGuide = crossplane({
      scope: DeveloperDocsScope.List,
      importTargets: [],
      totalCount: 0,
    });

    expect(empty.steps[2]?.markdown).toBe(
      "There are no incidents in this project yet.",
    );
  });

  test("says when only the first ones are listed", () => {
    const some: DeveloperDocsGuide = crossplane({
      scope: DeveloperDocsScope.List,
      importTargets: [{ id: INCIDENT_ID, displayName: "One" }],
      totalCount: 250,
    });

    expect(some.steps[2]?.markdown).toContain(
      "each of the first 1 of your 250 incidents",
    );
  });

  test("shows the IDs as references to resources of the namespace, folded away", () => {
    const topic: SetupGuideTopic | undefined = guide.topics.find(
      (item: SetupGuideTopic): boolean => {
        return item.title === "Refer to other resources by name";
      },
    );
    const [references] = yamlDocuments(topic?.markdown || "");

    expect(topic?.summary).toBe("Names instead of IDs");
    expect(
      (references!["spec"] as Record<string, Record<string, unknown>>)[
        "forProvider"
      ]!["incidentSeverityIdRef"],
    ).toEqual({ name: "critical-incident" });
  });
});

describe("every resource's Crossplane pages", () => {
  // The record a view page fetched, at its least: its ID and its name.
  const RECORD: JSONObject = {
    _id: "9a2b3c4d-1234-4b2c-9d8e-0123456789ab",
    name: "Example",
  };

  test.each(
    DEVELOPER_DOCS_PARENT_PAGES.map(
      (parent: DeveloperDocsParentPage): [string, DeveloperDocsParentPage] => {
        return [
          `${parent.tableName} ${parent.scope} ${parent.pageKey}`,
          parent,
        ];
      },
    ),
  )(
    "%s builds, and its YAML reads back",
    (_name: string, parent: DeveloperDocsParentPage) => {
      const modelType: DatabaseBaseModelType = (
        Models as Array<DatabaseBaseModelType>
      ).find((candidate: DatabaseBaseModelType): boolean => {
        return new candidate().tableName === parent.tableName;
      })!;
      const resource: DeveloperDocsResource = {
        ...getDeveloperDocsResource(modelType),
        ...(parent.resourceOptions || {}),
      };
      const guide: DeveloperDocsGuide =
        parent.scope === DeveloperDocsScope.View
          ? crossplane({
              resource,
              record: {
                id: "9a2b3c4d-1234-4b2c-9d8e-0123456789ab",
                displayName: "Example",
                json: RECORD,
              },
            })
          : crossplane({
              resource,
              scope: DeveloperDocsScope.List,
              importTargets: [
                {
                  id: "9a2b3c4d-1234-4b2c-9d8e-0123456789ab",
                  displayName: "Example",
                },
              ],
              totalCount: 1,
            });

      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.steps[0]?.title).toBe("Connect Crossplane to OneUptime");

      const documents: Array<Record<string, unknown>> = yamlDocuments(
        allMarkdown(guide),
      );

      // Every manifest names its kind; a snippet (references) is part of one.
      for (const document of documents) {
        if (document["apiVersion"]) {
          expect(typeof document["kind"]).toBe("string");
        } else {
          expect(Object.keys(document)).toEqual(["spec"]);
        }
      }

      if (!getCrossplaneKindOf(modelType)) {
        expect(guide.notice).toContain(
          "The Crossplane provider has no kind for",
        );
      }
    },
  );

  test("a workflow's record page writes a Workflow", () => {
    const workflow: Workflow = new Workflow();
    workflow._id = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";
    workflow.name = "Send weekly report";

    const markdown: string =
      crossplane({
        resource: getDeveloperDocsResource(Workflow),
        record: {
          id: workflow._id,
          displayName: "Send weekly report",
          json: BaseModel.toJSON(workflow, Workflow),
        },
      }).steps[1]?.markdown || "";

    expect(yamlDocuments(markdown)[0]!["kind"]).toBe("Workflow");
  });
});
