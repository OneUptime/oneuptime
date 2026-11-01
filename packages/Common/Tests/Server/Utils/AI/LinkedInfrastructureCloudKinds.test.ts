import { describe, expect, test } from "@jest/globals";
import {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import LinkedInfrastructureContext, {
  CLOUD_ENVIRONMENT_NOUN,
  LinkedInfrastructure,
  LinkedInfrastructureResource,
  describeLinkedResource,
} from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";

/*
 * Contract under test - what an investigation's starting context calls an
 * incident's cloud rows (LinkedInfrastructureContext), since Cloud and App
 * Platforms became two products (#5488):
 *
 *  - an App Platforms environment (ECS on Fargate in one account and
 *    region, a Cloud Run region, ...) is a "Cloud environment": a place
 *    apps run, not one resource;
 *  - a resource of a connected account stays a "Cloud resource", and so
 *    does a cloud row whose kind was not read;
 *  - the kind travels with the row from the linked resources, so the
 *    alerts on it are named the same way;
 *  - the id the tools take is the same for both: query_resource_telemetry
 *    reads either by its CloudResource id.
 */

const ENVIRONMENT_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000f1";
const RESOURCE_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000f2";
const OLD_ROW_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000f3";
const HOST_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000f4";
const DECLARED_AT: Date = new Date("2026-10-30T09:00:00.000Z");

const ENVIRONMENT: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.CloudResource,
  id: ENVIRONMENT_ID,
  name: "checkout · us-east-1",
  cloudResourceKind: CloudResourceKind.Environment,
};

const RESOURCE: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.CloudResource,
  id: RESOURCE_ID,
  name: "orders-db",
  cloudResourceKind: CloudResourceKind.Resource,
};

const OLD_ROW: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.CloudResource,
  id: OLD_ROW_ID,
  name: "legacy",
};

describe("what the context calls a cloud row", () => {
  test("an environment is a Cloud environment", () => {
    expect(CLOUD_ENVIRONMENT_NOUN).toBe("Cloud environment");
    expect(describeLinkedResource(ENVIRONMENT)).toBe(
      'Cloud environment "checkout · us-east-1"',
    );
  });

  test("a resource, and a row whose kind was not read, are Cloud resources", () => {
    expect(describeLinkedResource(RESOURCE)).toBe('Cloud resource "orders-db"');
    expect(describeLinkedResource(OLD_ROW)).toBe('Cloud resource "legacy"');
  });

  test("an environment without a name is still named for what it is", () => {
    expect(describeLinkedResource({ ...ENVIRONMENT, name: "  " })).toBe(
      "Cloud environment",
    );
  });

  test("a kind on any other resource changes nothing", () => {
    expect(
      describeLinkedResource({
        type: LinkedAffectedResourceType.Host,
        id: HOST_ID,
        name: "web-1",
        cloudResourceKind: CloudResourceKind.Environment,
      }),
    ).toBe('Host "web-1"');
  });
});

describe("the kind travels with the row", () => {
  test("keepInfrastructure keeps a cloud row's kind, and adds none", () => {
    const kept: Array<LinkedInfrastructureResource> =
      LinkedInfrastructureContext.keepInfrastructure([
        ENVIRONMENT,
        RESOURCE,
        OLD_ROW,
      ]);

    expect(kept).toEqual([
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
    expect("cloudResourceKind" in kept[2]!).toBe(false);
  });

  test("the context section names each with the id the tools take, and the alerts on them the same way", () => {
    const resources: Array<LinkedInfrastructureResource> =
      LinkedInfrastructureContext.keepInfrastructure([ENVIRONMENT, RESOURCE]);
    const data: LinkedInfrastructure = {
      subjectKind: "incident",
      subjectCreatedAt: DECLARED_AT,
      resources,
      alerts: [
        {
          id: "0193c0de-dddd-4aaa-8bbb-0000000000a1",
          alertNumber: 7,
          title: "checkout 5xx",
          severityName: "Critical",
          stateName: "Created",
          isOpen: true,
          openedAt: new Date(DECLARED_AT.getTime() - 4 * 60 * 1000),
          resources: [resources[0]!],
        },
      ],
      hasMoreAlerts: false,
      windowStart: new Date(DECLARED_AT.getTime() - 30 * 60 * 1000),
      readAt: DECLARED_AT,
    };

    const section: string =
      LinkedInfrastructureContext.buildContextSection(data);

    expect(section).toContain(
      `- Cloud environment "checkout · us-east-1" (resourceType: CloudResource, resourceId: ${ENVIRONMENT_ID})`,
    );
    expect(section).toContain(
      `- Cloud resource "orders-db" (resourceType: CloudResource, resourceId: ${RESOURCE_ID})`,
    );
    expect(section).toContain(
      'Alert #7 "checkout 5xx" on Cloud environment "checkout · us-east-1"',
    );
  });
});
