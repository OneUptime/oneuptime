import { describe, expect, test } from "@jest/globals";
import {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import IncidentFollowUpCheck, {
  FollowUpCheckContext,
} from "../../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import LinkedInfrastructureContext, {
  CLOUD_ENVIRONMENT_ACTIVITY_KIND,
  CLOUD_ENVIRONMENT_NOUN,
  LinkedInfrastructure,
  LinkedInfrastructureResource,
  describeActivityResourceKind,
  describeLinkedResourceNoun,
  getLinkedResourceActivityKind,
  isLinkedCloudEnvironment,
} from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import {
  AIRunEventResultSummary,
  LinkedInfrastructureActivity,
} from "../../../../Types/AI/AIChatTypes";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";

/*
 * Contract under test - what a run's ACTIVITY calls an App Platforms
 * environment (#5519's follow-up). The starting context and the feeds call
 * an environment a "Cloud environment" since #5488 and #5511, but the
 * activity recorded the table's kind, CloudResource, so the AI card's line
 * said "No open or recent alerts on Cloud resource checkout · us-east-1":
 *
 *  - the linked infrastructure's activity records an environment as
 *    CLOUD_ENVIRONMENT_ACTIVITY_KIND, and words it as a cloud environment
 *    in the English an API reader gets;
 *  - a resource of a connected account, and a cloud row whose kind was not
 *    read, stay CloudResource; every other kind is recorded as it was;
 *  - a follow-up check's activity and its report's first line name the
 *    environment the alert opened on the same way.
 */

const DECLARED_AT: Date = new Date("2026-11-02T09:00:00.000Z");

const ENVIRONMENT: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.CloudResource,
  id: "0193c0de-eeee-4aaa-8bbb-0000000000e1",
  name: "checkout · us-east-1",
  cloudResourceKind: CloudResourceKind.Environment,
};

const RESOURCE: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.CloudResource,
  id: "0193c0de-eeee-4aaa-8bbb-0000000000e2",
  name: "orders-db",
  cloudResourceKind: CloudResourceKind.Resource,
};

const OLD_ROW: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.CloudResource,
  id: "0193c0de-eeee-4aaa-8bbb-0000000000e3",
  name: "legacy",
};

const HOST: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.Host,
  id: "0193c0de-eeee-4aaa-8bbb-0000000000e4",
  name: "web-1",
};

function linkedTo(
  resources: Array<LinkedAffectedResource>,
  alertCount: number = 0,
): LinkedInfrastructure {
  const kept: Array<LinkedInfrastructureResource> =
    LinkedInfrastructureContext.keepInfrastructure(resources);

  return {
    subjectKind: "incident",
    subjectCreatedAt: DECLARED_AT,
    resources: kept,
    alerts: Array.from({ length: alertCount }, (_: unknown, index: number) => {
      return {
        id: `0193c0de-eeee-4aaa-8bbb-0000000001${String(index).padStart(2, "0")}`,
        alertNumber: 40 + index,
        title: "checkout 5xx",
        isOpen: true,
        openedAt: DECLARED_AT,
        resources: [kept[0]!],
      };
    }),
    hasMoreAlerts: false,
    windowStart: new Date(DECLARED_AT.getTime() - 30 * 60 * 1000),
    readAt: DECLARED_AT,
  };
}

function activityOf(data: LinkedInfrastructure): LinkedInfrastructureActivity {
  const note: AIRunEventResultSummary | null =
    LinkedInfrastructureContext.buildActivityNote(data);

  expect(note).not.toBeNull();
  expect(note!.linkedInfrastructure).toBeDefined();

  return note!.linkedInfrastructure!;
}

describe("which rows are environments", () => {
  test("a cloud row whose kind says environment is one; a resource and an unread row are not", () => {
    expect(isLinkedCloudEnvironment(ENVIRONMENT)).toBe(true);
    expect(isLinkedCloudEnvironment(RESOURCE)).toBe(false);
    expect(isLinkedCloudEnvironment(OLD_ROW)).toBe(false);
    // A kind on another type of resource is no environment.
    expect(
      isLinkedCloudEnvironment({
        ...HOST,
        cloudResourceKind: CloudResourceKind.Environment,
      }),
    ).toBe(false);
  });

  test("each is called by its own noun", () => {
    expect(describeLinkedResourceNoun(ENVIRONMENT)).toBe(
      CLOUD_ENVIRONMENT_NOUN,
    );
    expect(describeLinkedResourceNoun(RESOURCE)).toBe("Cloud resource");
    expect(describeLinkedResourceNoun(OLD_ROW)).toBe("Cloud resource");
    expect(describeLinkedResourceNoun(HOST)).toBe("Host");
  });

  test("the activity kind of an environment is its own, every other kind is the row's", () => {
    expect(CLOUD_ENVIRONMENT_ACTIVITY_KIND).toBe("CloudEnvironment");
    // Never a kind the table already has a noun for.
    expect(Object.values(LinkedAffectedResourceType)).not.toContain(
      CLOUD_ENVIRONMENT_ACTIVITY_KIND,
    );
    expect(getLinkedResourceActivityKind(ENVIRONMENT)).toBe(
      CLOUD_ENVIRONMENT_ACTIVITY_KIND,
    );
    expect(getLinkedResourceActivityKind(RESOURCE)).toBe(
      LinkedAffectedResourceType.CloudResource,
    );
    expect(getLinkedResourceActivityKind(OLD_ROW)).toBe(
      LinkedAffectedResourceType.CloudResource,
    );
    expect(getLinkedResourceActivityKind(HOST)).toBe(
      LinkedAffectedResourceType.Host,
    );
  });

  test("an activity kind reads back as its noun", () => {
    expect(describeActivityResourceKind(CLOUD_ENVIRONMENT_ACTIVITY_KIND)).toBe(
      "Cloud environment",
    );
    expect(describeActivityResourceKind("CloudResource")).toBe(
      "Cloud resource",
    );
    expect(describeActivityResourceKind("DockerHost")).toBe("Docker host");
    expect(describeActivityResourceKind("Spaceship")).toBe("Resource");
  });
});

describe("the linked infrastructure's activity", () => {
  test("records an environment as one, beside a resource and an unread row", () => {
    const activity: LinkedInfrastructureActivity = activityOf(
      linkedTo([ENVIRONMENT, RESOURCE, OLD_ROW]),
    );

    expect(activity.resources).toEqual([
      { kind: CLOUD_ENVIRONMENT_ACTIVITY_KIND, name: "checkout · us-east-1" },
      { kind: "CloudResource", name: "orders-db" },
      { kind: "CloudResource", name: "legacy" },
    ]);
  });

  test("its English names the environment as the context does", () => {
    expect(
      LinkedInfrastructureContext.buildActivityNote(
        linkedTo([ENVIRONMENT, RESOURCE]),
      )?.message,
    ).toBe(
      "No open or recent alerts on cloud environment checkout · us-east-1 and cloud resource orders-db",
    );

    expect(
      LinkedInfrastructureContext.buildActivityNote(linkedTo([ENVIRONMENT], 2))
        ?.message,
    ).toBe(
      "Read 2 open or recent alerts on cloud environment checkout · us-east-1",
    );
  });

  test("every other kind reads as it did", () => {
    expect(activityOf(linkedTo([HOST])).resources).toEqual([
      { kind: "Host", name: "web-1" },
    ]);
    expect(
      LinkedInfrastructureContext.buildActivityNote(linkedTo([HOST]))?.message,
    ).toBe("No open or recent alerts on host web-1");
  });

  test("an activity recorded before (an environment as CloudResource) still reads", () => {
    expect(
      LinkedInfrastructureContext.describeActivity({
        resources: [{ kind: "CloudResource", name: "checkout · us-east-1" }],
        alertCount: 0,
        openAlertCount: 0,
        hasMoreAlerts: false,
        lookbackMinutes: 30,
      }),
    ).toBe("No open or recent alerts on cloud resource checkout · us-east-1");
  });
});

describe("a follow-up check on an environment", () => {
  function followUp(resource: LinkedAffectedResource): FollowUpCheckContext {
    return {
      incidentCreatedAt: DECLARED_AT,
      alertId: "0193c0de-eeee-4aaa-8bbb-0000000000ff",
      alertNumber: 12,
      alertTitle: "Tasks restarting",
      alertOpenedAt: new Date(DECLARED_AT.getTime() + 2 * 60 * 1000),
      resources: LinkedInfrastructureContext.keepInfrastructure([resource]),
    };
  }

  test("its activity records the environment's kind and names it", () => {
    const note: AIRunEventResultSummary =
      IncidentFollowUpCheck.buildActivityNote(followUp(ENVIRONMENT));

    expect(note.followUpCheck?.resourceKind).toBe(
      CLOUD_ENVIRONMENT_ACTIVITY_KIND,
    );
    expect(note.followUpCheck?.resourceName).toBe("checkout · us-east-1");
    expect(note.message).toBe(
      "Checking again: alert #12 opened on cloud environment checkout · us-east-1 after the first analysis",
    );
  });

  test("its report's first line says cloud environment, never cloud resource", () => {
    const lead: string = IncidentFollowUpCheck.buildReportLead(
      followUp(ENVIRONMENT),
    ).toString();

    expect(lead).toContain("opened on cloud environment checkout · us-east-1");
    expect(lead.toLowerCase()).not.toContain("cloud resource");
  });

  test("a resource of a connected account is still a cloud resource", () => {
    expect(
      IncidentFollowUpCheck.buildActivityNote(followUp(RESOURCE)).followUpCheck
        ?.resourceKind,
    ).toBe("CloudResource");
    expect(
      IncidentFollowUpCheck.buildReportLead(followUp(RESOURCE)).toString(),
    ).toContain("opened on cloud resource orders-db");
  });
});
