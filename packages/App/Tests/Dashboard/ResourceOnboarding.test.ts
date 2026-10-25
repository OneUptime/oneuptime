import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import {
  RESOURCE_CONNECTION_CLOCK_MARGIN_MS,
  RESOURCE_CONNECTION_POLL_INTERVAL_MS,
  RESOURCE_NAME_MAX_LENGTH,
  getResourceConnectionWatchStart,
  getSuggestedResourceName,
  hasReportedSince,
  isSameResourceName,
  pickConnectedRecord,
  toResourceName,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceOnboarding";
import { shellQuote } from "../../FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  SeededRandom,
  seededRandom,
} from "../../../Common/Tests/Helpers/SeededRandom";
import { generatedTexts } from "../../../Common/Tests/Helpers/GeneratedTexts";

/*
 * Adding a resource the way a host is added (Components/ResourceOnboarding):
 * the list's Add button opens the resource's setup guide in a dialog, the
 * guide asks for the name the agent is told and writes it into every
 * command, and its last step watches for the resource to connect. An empty
 * list shows the same guide as its first-run card. "Make software as simple
 * as possible to use" - so the hand-typed create form of every resource
 * that registers itself is gone: a record typed in by hand only waited for
 * data nothing sent, and a name that did not match registered a second one.
 *
 * App has no renderer: the React-free rules are called, and the pages and
 * configs are read as text. Common's ResourceOnboarding test renders them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Comments out, whitespace squashed: the code as prettier may wrap it.
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

// What every command takes as it is, with no quoting.
const COMMAND_SAFE_NAME: RegExp =
  /^[A-Za-z0-9_]([A-Za-z0-9._-]*[A-Za-z0-9_])?$/;

describe("the name the commands carry", () => {
  type Case = [string, string];

  const CASES: Array<Case> = [
    ["my-cluster", "my-cluster"],
    ["prod_us.east-1", "prod_us.east-1"],
    ["Prod East 1", "Prod-East-1"],
    ["  prod  ", "prod"],
    ["prod   east", "prod-east"],
    ["prod - east", "prod-east"],
    ["prod / east", "prod-east"],
    ["prod.  east", "prod.east"],
    ["-prod-", "prod"],
    ["..prod..", "prod"],
    ["--- ---", ""],
    ["prod,east=1", "prod-east-1"],
    ['prod"east', "prod-east"],
    ["prod'east", "prod-east"],
    ["prod$(rm -rf)", "prod-rm-rf"],
    ["prod`id`", "prod-id"],
    ["prod\teast\nwest", "prod-east-west"],
    ["Zürich", "Zurich"],
    ["São Paulo", "Sao-Paulo"],
    ["Ångström Lab", "Angstrom-Lab"],
    ["クラスター", ""],
    ["prod 🚀 east", "prod-east"],
    ["", ""],
    ["   ", ""],
  ];

  test.each(CASES)("%j is %j", (typed: string, expected: string) => {
    expect(toResourceName(typed)).toBe(expected);
  });

  test("keeps the case it was typed in: ingest keeps a cluster's casing", () => {
    expect(toResourceName("Prod-East")).toBe("Prod-East");
  });

  test(`is at most ${RESOURCE_NAME_MAX_LENGTH} characters, and does not end in the dash it was cut at`, () => {
    const long: string = toResourceName(`${"a".repeat(99)} bcd`);

    expect(long).toBe("a".repeat(99));
    expect(toResourceName("x".repeat(500))).toHaveLength(
      RESOURCE_NAME_MAX_LENGTH,
    );
  });

  test("reads only the start of a paste, however long it is", () => {
    // Five megabytes on one line: a screenshot's base64, pasted by mistake.
    const paste: string = `cluster ${"QUJD".repeat(1_310_720)}`;
    const startedAt: number = Date.now();

    const name: string = toResourceName(paste);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(name.startsWith("cluster-QUJD")).toBe(true);
    expect(name).toHaveLength(RESOURCE_NAME_MAX_LENGTH);
  });

  /*
   * Whatever is typed, the name is one every command takes as it is: a
   * shell word, a `--set` value (no comma), an env file line, a YAML value
   * and an OTEL_RESOURCE_ATTRIBUTES value (no comma, no "=").
   */
  const ALPHABET: ReadonlyArray<string> = [
    "a",
    "Z",
    "7",
    "-",
    ".",
    "_",
    " ",
    "  ",
    "\t",
    ",",
    "=",
    "/",
    '"',
    "'",
    "`",
    "$",
    "\\",
    "é",
    "ß",
    "日",
    "🚀",
    "--",
    "..",
  ];

  const TEXTS: Array<string> = generatedTexts(5000, 4242, ALPHABET);

  test("is always empty or a name every command takes as it is", () => {
    for (const typed of TEXTS) {
      const name: string = toResourceName(typed);

      if (name === "") {
        continue;
      }

      expect({ typed, name, safe: COMMAND_SAFE_NAME.test(name) }).toEqual({
        typed,
        name,
        safe: true,
      });
      expect(shellQuote(name)).toBe(name);
    }
  });

  test("is what it is once made: making it again changes nothing", () => {
    for (const typed of TEXTS) {
      const name: string = toResourceName(typed);
      expect(toResourceName(name)).toBe(name);
    }
  });

  test("never adds two dashes in a row where it replaced something", () => {
    const random: SeededRandom = seededRandom(91);

    for (let i: number = 0; i < 2000; i++) {
      const typed: string = `a${" ,$".repeat(random(4) + 1)}b`;
      expect(toResourceName(typed)).toBe("a-b");
    }
  });
});

describe("the name the guide starts with", () => {
  type Case = [Array<string | null | undefined>, string];

  const CASES: Array<Case> = [
    [[], "my-cluster"],
    [["prod-east"], "my-cluster"],
    [["my-cluster"], "my-cluster-2"],
    [["MY-CLUSTER"], "my-cluster-2"],
    [[" my-cluster "], "my-cluster-2"],
    [["my-cluster", "my-cluster-2"], "my-cluster-3"],
    [["my-cluster", "my-cluster-3"], "my-cluster-2"],
    [[null, undefined, ""], "my-cluster"],
  ];

  test.each(CASES)(
    "next to %j is %j",
    (taken: Array<string | null | undefined>, expected: string) => {
      expect(
        getSuggestedResourceName({
          example: "my-cluster",
          existingNames: taken,
        }),
      ).toBe(expected);
    },
  );

  test("is always a name the commands take as it is", () => {
    const name: string = getSuggestedResourceName({
      example: "my-docker-host",
      existingNames: Array.from({ length: 30 }, (_: unknown, i: number) => {
        return i === 0 ? "my-docker-host" : `my-docker-host-${i + 1}`;
      }),
    });

    expect(name).toBe("my-docker-host-31");
    expect(toResourceName(name)).toBe(name);
  });
});

describe("one resource's name", () => {
  test("matches without regard to case or surrounding spaces, as ingest finds it", () => {
    expect(isSameResourceName("Prod", "prod")).toBe(true);
    expect(isSameResourceName(" prod ", "PROD")).toBe(true);
    expect(isSameResourceName("prod", "prod-2")).toBe(false);
  });

  test("never matches nothing", () => {
    expect(isSameResourceName("", "")).toBe(false);
    expect(isSameResourceName("  ", "  ")).toBe(false);
    expect(isSameResourceName(undefined, "prod")).toBe(false);
    expect(isSameResourceName("prod", null)).toBe(false);
  });
});

describe("the resource the last step was waiting for", () => {
  interface Row {
    id: string;
    name: string;
  }

  const getName: (row: Row) => string = (row: Row): string => {
    return row.name;
  };

  test("is the one with the guide's name, wherever it is in the list", () => {
    const rows: Array<Row> = [
      { id: "1", name: "staging" },
      { id: "2", name: "Prod-East" },
    ];

    expect(
      pickConnectedRecord({ records: rows, name: "prod-east", getName })?.id,
    ).toBe("2");
  });

  test("is the newest when none has the guide's name: the command may have been edited", () => {
    const rows: Array<Row> = [
      { id: "1", name: "renamed-by-hand" },
      { id: "2", name: "older" },
    ];

    expect(
      pickConnectedRecord({ records: rows, name: "prod", getName })?.id,
    ).toBe("1");
    expect(pickConnectedRecord({ records: rows, getName })?.id).toBe("1");
  });

  test("is nothing while nothing has connected", () => {
    expect(
      pickConnectedRecord<Row>({ records: [], name: "prod", getName }),
    ).toBeUndefined();
  });
});

describe("a resource the project had, reporting again", () => {
  const then: Date = new Date("2026-10-25T10:00:00.000Z");

  test("has, once its lastSeenAt is later than when the guide looked it up", () => {
    expect(
      hasReportedSince({
        lastSeenAtThen: then,
        lastSeenAtNow: new Date("2026-10-25T10:00:01.000Z"),
      }),
    ).toBe(true);
  });

  test("has not while its lastSeenAt is the one it had", () => {
    expect(
      hasReportedSince({ lastSeenAtThen: then, lastSeenAtNow: then }),
    ).toBe(false);
    expect(
      hasReportedSince({
        lastSeenAtThen: then,
        lastSeenAtNow: "2026-10-25T09:00:00.000Z",
      }),
    ).toBe(false);
  });

  test("has, once one that never reported reports", () => {
    expect(
      hasReportedSince({ lastSeenAtThen: null, lastSeenAtNow: then }),
    ).toBe(true);
  });

  test("has not while it has still never reported", () => {
    expect(
      hasReportedSince({ lastSeenAtThen: then, lastSeenAtNow: null }),
    ).toBe(false);
    expect(
      hasReportedSince({ lastSeenAtThen: null, lastSeenAtNow: undefined }),
    ).toBe(false);
    expect(
      hasReportedSince({ lastSeenAtThen: null, lastSeenAtNow: "not a date" }),
    ).toBe(false);
  });
});

describe("the watch's timing", () => {
  test("asks every five seconds", () => {
    expect(RESOURCE_CONNECTION_POLL_INTERVAL_MS).toBe(5000);
  });

  test("counts what registered up to two minutes before the guide opened: the server's clock may be behind", () => {
    const since: Date = new Date("2026-10-25T10:00:00.000Z");

    expect(RESOURCE_CONNECTION_CLOCK_MARGIN_MS).toBe(120000);
    expect(getResourceConnectionWatchStart(since).toISOString()).toBe(
      "2026-10-25T09:58:00.000Z",
    );
  });

  test("the rules are React-free and read no API", () => {
    const rules: string = read(
      "Components/ResourceOnboarding/ResourceOnboarding.ts",
    );

    expect(rules).not.toMatch(/from "react"/);
    expect(rules).not.toContain("ModelAPI");
  });
});

/*
 * Every resource that registers itself when its agent first reports, with
 * its list page, its onboarding config and what the config says.
 */
interface AddedByGuide {
  label: string;
  page: string;
  config: string;
  constant: string;
  modelType: { new (): BaseModel };
  card: string;
  // The column the agent's name lands in, where the guide asks for one.
  nameField?: string | undefined;
  nameProp?: string | undefined;
}

const ADDED_BY_GUIDE: Array<AddedByGuide> = [
  {
    label: "Kubernetes clusters",
    page: "Pages/Kubernetes/Clusters.tsx",
    config: "Components/Kubernetes/KubernetesClusterOnboarding.tsx",
    constant: "KUBERNETES_CLUSTER_ONBOARDING",
    modelType: KubernetesCluster,
    card: "KubernetesDocumentationCard",
    nameField: "clusterIdentifier",
    nameProp: "clusterName",
  },
  {
    label: "Docker hosts",
    page: "Pages/Docker/Hosts.tsx",
    config: "Components/Docker/DockerHostOnboarding.tsx",
    constant: "DOCKER_HOST_ONBOARDING",
    modelType: DockerHost,
    card: "DockerDocumentationCard",
    nameField: "hostIdentifier",
    nameProp: "hostName",
  },
  {
    label: "Podman hosts",
    page: "Pages/Podman/Hosts.tsx",
    config: "Components/Podman/PodmanHostOnboarding.tsx",
    constant: "PODMAN_HOST_ONBOARDING",
    modelType: PodmanHost,
    card: "PodmanDocumentationCard",
    nameField: "hostIdentifier",
    nameProp: "hostName",
  },
  {
    label: "Docker Swarm clusters",
    page: "Pages/DockerSwarm/Clusters.tsx",
    config: "Components/DockerSwarm/DockerSwarmClusterOnboarding.tsx",
    constant: "DOCKER_SWARM_CLUSTER_ONBOARDING",
    modelType: DockerSwarmCluster,
    card: "DockerSwarmDocumentationCard",
    nameField: "name",
    nameProp: "clusterName",
  },
  {
    label: "Proxmox clusters",
    page: "Pages/Proxmox/Clusters.tsx",
    config: "Components/Proxmox/ProxmoxClusterOnboarding.tsx",
    constant: "PROXMOX_CLUSTER_ONBOARDING",
    modelType: ProxmoxCluster,
    card: "ProxmoxDocumentationCard",
    nameField: "name",
    nameProp: "clusterName",
  },
  {
    label: "Ceph clusters",
    page: "Pages/Ceph/Clusters.tsx",
    config: "Components/Ceph/CephClusterOnboarding.tsx",
    constant: "CEPH_CLUSTER_ONBOARDING",
    modelType: CephCluster,
    card: "CephDocumentationCard",
    nameField: "name",
    nameProp: "clusterName",
  },
  {
    label: "Storage arrays",
    page: "Pages/StorageArray/StorageArrays.tsx",
    config: "Components/StorageArray/StorageArrayOnboarding.tsx",
    constant: "STORAGE_ARRAY_ONBOARDING",
    modelType: StorageArray,
    card: "StorageArrayDocumentationCard",
    nameField: "name",
    nameProp: "arrayName",
  },
  {
    label: "IoT fleets",
    page: "Pages/IoT/Fleets.tsx",
    config: "Components/IoT/IoTFleetOnboarding.tsx",
    constant: "IOT_FLEET_ONBOARDING",
    modelType: IoTFleet,
    card: "IoTDocumentationCard",
    nameField: "name",
    nameProp: "fleetName",
  },
  {
    label: "Serverless functions",
    page: "Pages/Serverless/ServerlessFunctions.tsx",
    config: "Components/Serverless/ServerlessFunctionOnboarding.tsx",
    constant: "SERVERLESS_FUNCTION_ONBOARDING",
    modelType: ServerlessFunction,
    card: "ServerlessDocumentationCard",
  },
  {
    label: "Cloud environments",
    page: "Pages/Cloud/CloudResources.tsx",
    config: "Components/Cloud/CloudEnvironmentOnboarding.tsx",
    constant: "CLOUD_ENVIRONMENT_ONBOARDING",
    modelType: CloudResource,
    card: "CloudDocumentationCard",
  },
];

describe.each(ADDED_BY_GUIDE)("$label", (resource: AddedByGuide) => {
  const page: string = code(resource.page);
  const config: string = code(resource.config);

  test("are added from the Add button: the guide in a dialog, not a form", () => {
    expect(page).toContain("isCreateable={false}");
    expect(page).toContain("formFields={[]}");
    expect(page).not.toContain("getIdentityFormField");
    expect(page).not.toContain("getDisplayNameFormField");
    expect(page).not.toContain("onCreateSuccess");
    expect(page).toContain(
      `buttons: [ { title: ${resource.constant}.addTitle, icon: IconProp.Add, buttonStyle: ButtonStyleType.NORMAL,`,
    );
    expect(page).toContain(
      `<AddResourceModal onboarding={${resource.constant}}`,
    );
  });

  test("show the same live guide as the empty list's first-run card", () => {
    expect(page).toContain(
      `{firstRecordWatch.count === 0 && ( <AddResourceGuide onboarding={${resource.constant}} title={${resource.constant}.firstRunTitle} description={FIRST_RUN_GUIDE_DESCRIPTION}`,
    );
  });

  test("read the new one at once when it connects, from the dialog or the card", () => {
    expect(page).toContain(
      "refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}",
    );
    expect(page).toContain("firstRecordWatch.onRecordCreated();");
  });

  test("say what they are in translation keys", () => {
    for (const key of ["addTitle", "addDescription", "firstRunTitle"]) {
      expect(config).toMatch(new RegExp(`${key}: translationKey\\( ?"`));
    }
    expect(config).toMatch(/viewText: translationKey\( ?"View /);
    expect(config).toMatch(/addTitle: translationKey\( ?"Add /);
    // The empty list's card keeps the title it had in every language.
    expect(config).toMatch(
      /firstRunTitle: translationKey\( ?"Getting Started with /,
    );
  });

  test("draw their own guide, framed by the Add guide", () => {
    expect(config).toContain(`modelType: ${resource.modelType.name},`);
    expect(config).toContain(`<${resource.card} title={props.title}`);
    expect(config).toContain("isBare={props.isBare}");
    expect(config).toContain("inputs={props.inputs}");
    expect(config).toContain("lastStep={props.lastStep}");
  });

  if (resource.nameField) {
    test("ask for the name the agent is told, and write it into the commands", () => {
      expect(config).toContain(`field: "${resource.nameField}",`);
      expect(config).toMatch(/label: translationKey\( ?"[A-Z][a-z]* name"/);
      expect(config).toContain(`${resource.nameProp}={props.name}`);
    });

    test("the name lands in a column the model has", () => {
      expect(new resource.modelType().hasColumn(resource.nameField!)).toBe(
        true,
      );
    });
  } else {
    test("ask for no name: it names itself", () => {
      expect(config).not.toContain("name: {");
    });
  }
});

describe("the cloud environments the guide waits for", () => {
  test("are environments, not the resources a cloud's monitoring API reports", () => {
    expect(code("Components/Cloud/CloudEnvironmentOnboarding.tsx")).toContain(
      "query: { cloudResourceKind: CloudResourceKind.Environment, } as Query<BaseModel>,",
    );
  });
});

describe("resources added with a form", () => {
  test("a database's agent guide opens once it is saved, and waits for its engine metrics", () => {
    const page: string = code("Pages/Database/Databases.tsx");
    const modal: string = code(
      "Components/DatabaseServer/DatabaseAddedModal.tsx",
    );

    expect(page).toContain("isCreateable={true}");
    expect(page).toContain(
      "if (item._id && modalType !== ModalType.Edit) { setAddedDatabase({",
    );
    expect(page).toContain("<DatabaseAddedModal databaseId={addedDatabase.id}");
    expect(modal).toContain(
      "fetchDatabaseDocumentationTarget(props.databaseId)",
    );
    expect(modal).toContain(
      "seenField={target ? getDatabaseDataArrivedField(target) : undefined}",
    );
    expect(modal).toContain("database={target || undefined}");
  });

  /*
   * A RUM application keeps its form: its labels, owners and replay policy
   * can be in place before the first visitor, whose session it records.
   */
  test("a RUM application's guide opens once it is saved, with its name as the snippet's service.name", () => {
    const page: string = code("Pages/Rum/RumApplications.tsx");
    const modal: string = code("Components/Rum/RumApplicationAddedModal.tsx");

    expect(page).toContain("isCreateable={true}");
    expect(page).toContain(
      "if (item._id && modalType !== ModalType.Edit) { setAddedApplication({",
    );
    expect(page).toContain(
      "<RumApplicationAddedModal applicationId={addedApplication.id}",
    );
    expect(modal).toContain("recordId={props.applicationId}");
    expect(modal).toContain("appName={props.appIdentifier}");
  });

  test("a queue's guide opens once it is saved", () => {
    const page: string = code("Pages/MessageQueue/MessageQueues.tsx");
    const modal: string = code(
      "Pages/MessageQueue/Utils/MessageQueueAddedModal.tsx",
    );

    expect(page).toContain("isCreateable={true}");
    expect(page).toContain(
      "if (item._id && modalType !== ModalType.Edit) { setAddedQueue({",
    );
    expect(page).toContain("<MessageQueueAddedModal queueId={addedQueue.id}");
    expect(modal).toContain("fetchMessageQueueDocumentation(props.queueId)");
    expect(modal).toContain("queue={queue?.target}");
  });

  test("a vCenter connected through a probe opens on its page, where its first collection shows", () => {
    const page: string = code("Pages/VMware/VCenters.tsx");

    expect(page).toContain('createVerb="Connect"');
    expect(page).toContain(
      "if (item._id && modalType !== ModalType.Edit) { Navigation.navigate( RouteUtil.populateRouteParams( RouteMap[PageMap.VMWARE_VCENTER_VIEW] as Route,",
    );
  });

  test("the Documentation tabs read their guide's target the same way", () => {
    expect(code("Pages/Database/View/Documentation.tsx")).toContain(
      "await fetchDatabaseDocumentationTarget(modelId);",
    );
    expect(code("Pages/MessageQueue/View/Documentation.tsx")).toContain(
      "await fetchMessageQueueDocumentation(modelId);",
    );
  });
});

describe("the shared setup guide card", () => {
  test("draws the Add guide's inputs above the steps, not as a step: the guides count their steps", () => {
    const card: string = code("Components/SetupGuide/SetupGuideCard.tsx");
    const inputsAt: number = card.indexOf("{props.inputs}");

    expect(inputsAt).toBeGreaterThan(card.indexOf("<SetupGuideOptionPicker"));
    expect(inputsAt).toBeLessThan(
      card.indexOf("<SetupGuideSteps steps={steps} />"),
    );
  });

  test("every resource guide card hands the frame on", () => {
    for (const card of [
      "Components/Kubernetes/DocumentationCard.tsx",
      "Components/Docker/DocumentationCard.tsx",
      "Components/Podman/DocumentationCard.tsx",
      "Components/DockerSwarm/DocumentationCard.tsx",
      "Components/Proxmox/DocumentationCard.tsx",
      "Components/Ceph/DocumentationCard.tsx",
      "Components/StorageArray/DocumentationCard.tsx",
      "Components/IoT/DocumentationCard.tsx",
      "Components/VMware/DocumentationCard.tsx",
      "Components/Serverless/ServerlessDocumentationCard.tsx",
      "Components/Cloud/CloudDocumentationCard.tsx",
      "Components/Rum/RumDocumentationCard.tsx",
      "Components/DatabaseServer/DocumentationCard.tsx",
      "Pages/MessageQueue/Utils/MessageQueueDocumentationCard.tsx",
    ]) {
      const source: string = code(card);

      expect({
        card,
        extends: source.includes("extends SetupGuideFrameProps {"),
      }).toEqual({
        card,
        extends: true,
      });
      expect(source).toContain(
        "isBare={props.isBare} inputs={props.inputs} lastStep={props.lastStep}",
      );
    }
  });
});
