import Alert from "../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  AFFECTED_RESOURCE_MODELS,
  getAffectedResourceLists,
  getDistinctAffectedResources,
  setAffectedResourcesOnNewRecord,
  toAffectedResourceStub,
} from "../../../../Server/Utils/AffectedResources/AffectedResourceLists";
import { getTableColumn } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKind,
  AiAffectedResourceKindInfo,
  AiAffectedResourceRef,
} from "../../../../Types/AI/AiAffectedResources";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE LISTS OF A NEW INCIDENT OR ALERT, FROM WHAT IT IS ABOUT.
 *
 * Every server path that opens an incident or an alert about a resource it
 * knows - Ask AI's create tools, the security detections, Data Security, a
 * security case's incident and its playbook's paged alert - writes the
 * lists from one place. These hold that place to the models: each kind is
 * its own model's id stub, in the list of the incident and of the alert
 * the vocabulary names (a list both declare), each resource once, and
 * nothing else on the record touched.
 */

const HOST_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_HOST_ID: string = "22222222-2222-4222-8222-222222222222";
const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const CLOUD_ID: string = "55555555-5555-4555-8555-555555555555";

function idsOf(list: unknown): Array<string> {
  return ((list as Array<BaseModel> | undefined) || []).map(
    (row: BaseModel): string => {
      return row.id?.toString() || "";
    },
  );
}

describe("AFFECTED_RESOURCE_MODELS", () => {
  test.each(
    AI_AFFECTED_RESOURCE_KINDS.map(
      (info: AiAffectedResourceKindInfo): [string, AiAffectedResourceKindInfo] => {
        return [info.kind, info];
      },
    ),
  )(
    "%s: its model is what the incident's and the alert's list of it holds",
    (_kind: string, info: AiAffectedResourceKindInfo) => {
      const model: new () => BaseModel = AFFECTED_RESOURCE_MODELS[info.kind];

      for (const record of [new Incident(), new Alert()]) {
        const column: ReturnType<typeof getTableColumn> = getTableColumn(
          record,
          info.relation,
        );

        expect(column?.type).toBe(TableColumnType.EntityArray);

        // A lazy relation (NetworkDevice) names its model through a thunk.
        const listed: unknown = column?.modelType
          ? column.modelType
          : column?.modelTypeThunk?.();

        expect(listed).toBe(model);
      }
    },
  );

  test("there is a model for every kind and for nothing else", () => {
    expect(Object.keys(AFFECTED_RESOURCE_MODELS).sort()).toEqual(
      AI_AFFECTED_RESOURCE_KINDS.map((info: AiAffectedResourceKindInfo) => {
        return info.kind;
      }).sort(),
    );
  });

  test("the module imports models only, never a service: every opening path may import it", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../Server/Utils/AffectedResources/AffectedResourceLists.ts",
      ),
      "utf-8",
    );

    expect(source).not.toContain("/Services/");
  });
});

describe("toAffectedResourceStub", () => {
  test("its kind's model, holding only the id", () => {
    const stub: BaseModel = toAffectedResourceStub(
      AiAffectedResourceKind.NetworkDevice,
      DEVICE_ID,
    );

    expect(stub).toBeInstanceOf(
      AFFECTED_RESOURCE_MODELS[AiAffectedResourceKind.NetworkDevice],
    );
    expect(stub.id?.toString()).toBe(DEVICE_ID);
  });
});

describe("getDistinctAffectedResources", () => {
  test("each resource once, in the order asked, its id lower-cased", () => {
    expect(
      getDistinctAffectedResources([
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.Host, id: HOST_ID.toUpperCase() },
        { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
        { kind: AiAffectedResourceKind.Host, id: OTHER_HOST_ID },
      ]),
    ).toEqual([
      { kind: AiAffectedResourceKind.Host, id: HOST_ID },
      { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
      { kind: AiAffectedResourceKind.Host, id: OTHER_HOST_ID },
    ]);
  });

  test("the same id of two kinds is two resources", () => {
    expect(
      getDistinctAffectedResources([
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.DockerHost, id: HOST_ID },
      ]),
    ).toHaveLength(2);
  });

  test("an entry with no OneUptime ID, or of a kind this build does not know, is left out", () => {
    expect(
      getDistinctAffectedResources([
        { kind: AiAffectedResourceKind.Host, id: "web-1" },
        { kind: AiAffectedResourceKind.Host, id: "" },
        { kind: "Monitor" as AiAffectedResourceKind, id: HOST_ID },
        null as unknown as AiAffectedResourceRef,
        { kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID },
      ]),
    ).toEqual([{ kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID }]);
  });
});

describe("getAffectedResourceLists", () => {
  test("each kind's list, in the order the kinds are listed, only for the kinds named", () => {
    const lists: ReturnType<typeof getAffectedResourceLists> =
      getAffectedResourceLists([
        { kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID },
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.Host, id: OTHER_HOST_ID },
        { kind: AiAffectedResourceKind.NetworkDevice, id: DEVICE_ID },
      ]);

    expect(Object.keys(lists)).toEqual([
      "hosts",
      "networkDevices",
      "cloudResources",
    ]);
    expect(idsOf(lists.hosts)).toEqual([HOST_ID, OTHER_HOST_ID]);
    expect(idsOf(lists.networkDevices)).toEqual([DEVICE_ID]);
    expect(idsOf(lists.cloudResources)).toEqual([CLOUD_ID]);
  });

  test("nothing named, no list", () => {
    expect(getAffectedResourceLists([])).toEqual({});
  });
});

describe("setAffectedResourcesOnNewRecord", () => {
  test("an incident gains a list for each kind named, and returns what it was linked to", () => {
    const incident: Incident = new Incident();
    incident.title = "Brute force on web-1";

    const linked: Array<AiAffectedResourceRef> = setAffectedResourcesOnNewRecord(
      incident,
      [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
      ],
    );

    expect(linked).toEqual([
      { kind: AiAffectedResourceKind.Host, id: HOST_ID },
      { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
    ]);
    expect(idsOf(incident.hosts)).toEqual([HOST_ID]);
    expect(idsOf(incident.kubernetesClusters)).toEqual([CLUSTER_ID]);
    // Nothing else on the record is touched.
    expect(incident.title).toBe("Brute force on web-1");
    expect(incident.monitors).toBeUndefined();
    expect(incident.services).toBeUndefined();
  });

  test("an alert takes them the same way: the two models declare the same lists", () => {
    const alert: Alert = new Alert();

    setAffectedResourcesOnNewRecord(alert, [
      { kind: AiAffectedResourceKind.NetworkDevice, id: DEVICE_ID },
      { kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID },
    ]);

    expect(idsOf(alert.networkDevices)).toEqual([DEVICE_ID]);
    expect(idsOf(alert.cloudResources)).toEqual([CLOUD_ID]);
    expect(alert.monitorId).toBeUndefined();
  });

  test("nothing named leaves every list as it was", () => {
    const incident: Incident = new Incident();
    incident.hosts = [toAffectedResourceStub(AiAffectedResourceKind.Host, HOST_ID) as never];

    expect(setAffectedResourcesOnNewRecord(incident, [])).toEqual([]);
    expect(idsOf(incident.hosts)).toEqual([HOST_ID]);
  });

  test("ObjectID-valued ids are written as the ids they are", () => {
    const incident: Incident = new Incident();
    const id: ObjectID = ObjectID.generate();

    setAffectedResourcesOnNewRecord(incident, [
      { kind: AiAffectedResourceKind.Service, id: id.toString() },
    ]);

    expect(idsOf(incident.services)).toEqual([id.toString()]);
  });
});
