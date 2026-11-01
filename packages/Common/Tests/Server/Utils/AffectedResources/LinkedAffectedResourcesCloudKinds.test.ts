import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import Incident from "../../../../Models/DatabaseModels/Incident";
import URL from "../../../../Types/API/URL";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - an incident's or alert's cloud rows, named and
 * linked as their own product does (LinkedAffectedResources), since Cloud
 * and App Platforms became two products (#5488):
 *
 *  - the cloud rows are read with their kind; no other relation is;
 *  - an App Platforms environment is a "Cloud Environment" linked to its
 *    page in App Platforms; a resource of a connected account a "Cloud
 *    Resource" linked to its page in Cloud;
 *  - a cloud row whose kind was not read reads as before: "Cloud Resource",
 *    linked to Cloud's page, which forwards an environment;
 *  - no other kind of resource is touched.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000002",
);
const ENVIRONMENT_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000e1";
const RESOURCE_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000e2";
const OLD_ROW_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000e3";
const HOST_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000e4";

function lines(resources: Array<LinkedAffectedResource>): Array<string> {
  return LinkedAffectedResources.getMarkdownLines({
    dashboardUrl: URL.fromString(DASHBOARD),
    projectId: PROJECT_ID,
    resources,
  }).map((line: MarkdownText): string => {
    return line.toString();
  });
}

describe("reading the cloud rows", () => {
  test("cloud rows are read with their kind, and no other relation is", async () => {
    const selects: Array<JSONObject> = [];

    await LinkedAffectedResources.readForIncident({
      service: {
        findAllBy: async (args: unknown): Promise<Array<Incident>> => {
          selects.push((args as { select: JSONObject }).select);
          return [];
        },
      },
      projectId: PROJECT_ID,
      incidentId: RECORD_ID,
    });

    const cloud: JSONObject | undefined = selects.find((select: JSONObject) => {
      return "cloudResources" in select;
    });

    expect(cloud?.["cloudResources"]).toEqual({
      _id: true,
      name: true,
      projectId: true,
      cloudResourceKind: true,
    });

    for (const select of selects) {
      for (const [column, value] of Object.entries(select)) {
        if (column === "cloudResources" || typeof value !== "object") {
          continue;
        }

        expect((value as JSONObject)["cloudResourceKind"]).toBeUndefined();
      }
    }
  });

  test("a cloud row's kind is kept with it; a host has none", () => {
    const resources: Array<LinkedAffectedResource> =
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: PROJECT_ID,
            cloudResources: [
              {
                _id: ENVIRONMENT_ID,
                name: "checkout · us-east-1",
                projectId: PROJECT_ID,
                cloudResourceKind: CloudResourceKind.Environment,
              },
              {
                _id: RESOURCE_ID,
                name: "orders-db",
                projectId: PROJECT_ID,
                cloudResourceKind: CloudResourceKind.Resource,
              },
              {
                _id: OLD_ROW_ID,
                name: "legacy",
                projectId: PROJECT_ID,
              },
            ],
            hosts: [
              {
                _id: HOST_ID,
                name: "web-1",
                projectId: PROJECT_ID,
                cloudResourceKind: CloudResourceKind.Resource,
              },
            ],
          },
        ],
      });

    expect(resources).toEqual([
      {
        type: LinkedAffectedResourceType.Host,
        id: HOST_ID,
        name: "web-1",
      },
      {
        type: LinkedAffectedResourceType.CloudResource,
        id: ENVIRONMENT_ID,
        name: "checkout · us-east-1",
        cloudResourceKind: CloudResourceKind.Environment,
      },
      {
        type: LinkedAffectedResourceType.CloudResource,
        id: RESOURCE_ID,
        name: "orders-db",
        cloudResourceKind: CloudResourceKind.Resource,
      },
      {
        type: LinkedAffectedResourceType.CloudResource,
        id: OLD_ROW_ID,
        name: "legacy",
      },
    ]);
  });
});

describe("naming and linking each cloud row in its own product", () => {
  test("an environment is a Cloud Environment of App Platforms", () => {
    expect(
      lines([
        {
          type: LinkedAffectedResourceType.CloudResource,
          id: ENVIRONMENT_ID,
          name: "checkout · us-east-1",
          cloudResourceKind: CloudResourceKind.Environment,
        },
      ]),
    ).toEqual([
      `- [Cloud Environment checkout · us-east-1](${DASHBOARD}/${PROJECT_ID.toString()}/app-platforms/${ENVIRONMENT_ID})`,
    ]);
  });

  test("a resource is a Cloud Resource of Cloud", () => {
    expect(
      lines([
        {
          type: LinkedAffectedResourceType.CloudResource,
          id: RESOURCE_ID,
          name: "orders-db",
          cloudResourceKind: CloudResourceKind.Resource,
        },
      ]),
    ).toEqual([
      `- [Cloud Resource orders-db](${DASHBOARD}/${PROJECT_ID.toString()}/cloud/${RESOURCE_ID})`,
    ]);
  });

  test("a row whose kind was not read reads as before, through Cloud's page", () => {
    expect(
      lines([
        {
          type: LinkedAffectedResourceType.CloudResource,
          id: OLD_ROW_ID,
          name: "legacy",
        },
      ]),
    ).toEqual([
      `- [Cloud Resource legacy](${DASHBOARD}/${PROJECT_ID.toString()}/cloud/${OLD_ROW_ID})`,
    ]);
  });

  test("the label and link helpers say the same", () => {
    const environment: LinkedAffectedResource = {
      type: LinkedAffectedResourceType.CloudResource,
      id: ENVIRONMENT_ID,
      name: "checkout",
      cloudResourceKind: CloudResourceKind.Environment,
    };

    expect(LinkedAffectedResources.getLabel(environment)).toBe(
      "Cloud Environment",
    );
    expect(
      LinkedAffectedResources.getDashboardUrl({
        dashboardUrl: URL.fromString(DASHBOARD),
        projectId: PROJECT_ID,
        resource: environment,
      }).toString(),
    ).toBe(
      `${DASHBOARD}/${PROJECT_ID.toString()}/app-platforms/${ENVIRONMENT_ID}`,
    );
  });

  test("no other kind of resource is touched", () => {
    expect(
      LinkedAffectedResources.getLabel({
        type: LinkedAffectedResourceType.Host,
        id: HOST_ID,
        name: "web-1",
        cloudResourceKind: CloudResourceKind.Environment,
      }),
    ).toBe("Host");
    expect(
      LinkedAffectedResources.getDashboardUrl({
        dashboardUrl: URL.fromString(DASHBOARD),
        projectId: PROJECT_ID,
        resource: {
          type: LinkedAffectedResourceType.Host,
          id: HOST_ID,
          name: "web-1",
          cloudResourceKind: CloudResourceKind.Environment,
        },
      }).toString(),
    ).toBe(`${DASHBOARD}/${PROJECT_ID.toString()}/host/${HOST_ID}`);
  });
});
