import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listSourceFiles } from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  MIN_SCANNED_FORMS,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../../Models/DatabaseModels/Service";
import StorageArray from "../../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";

/*
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Depending on the product, a resource's details were edited in zero, one or
 * two places. A Kubernetes, Proxmox or VMware cluster's name and description
 * in its Overview's details card and again on its Settings page - the
 * cluster name only on the Overview. A network site's seven fields in a
 * wizard on its Overview, another on its Settings page and a third from the
 * sites list; a network device's in two wizards. A service's tech stack and
 * a repository's main branch on two pages each. A Runner from its list and
 * its own page. And a host, a Docker or Podman host, a Ceph cluster, a cloud
 * environment, a serverless function or a RUM application nowhere at all: a
 * host discovered as "ip-10-0-3-17" could never be renamed or described.
 *
 * Now every resource telemetry discovers is edited in one place, the first
 * card of its Settings page (Dashboard Components/TelemetryResource/
 * ResourceDetailsCard): the name, the description, the labels and - folded
 * under Advanced, when a person may change it at all - what its telemetry is
 * matched on. Its Overview shows them read-only with an "Edit in Settings"
 * link (EditInSettingsLink). Network sites and devices are edited on their
 * Settings pages, a service's tech stack and a repository's main branch on
 * theirs, a Runner on its own page.
 *
 * This guard keeps it so, for these and for every form written later:
 *
 *   - no record's name, description, labels, title, identity or the other
 *     details listed below is edited from two forms anywhere in the
 *     Dashboard (a list's row Edit included);
 *   - each discovered resource's details card is the first card on its
 *     Settings page, the only one for its model, with the identity the
 *     model's update permissions allow and help that says what a change
 *     does;
 *   - each Overview that shows those details links to that Settings page;
 *   - the wording is the create forms': "Display Name" beside "Host Name
 *     (host.name)", never "Host Identifier".
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const DASHBOARD_DIR: string = path.join(REPOSITORY_ROOT, DASHBOARD);

const PAGES: string = `${DASHBOARD}/Pages`;

const DETAILS_CARD: string = "ResourceDetailsCard";

const EDIT_IN_SETTINGS_LINK: string = "EditInSettingsLink";

/*
 * The details a record is known by: what it is called and described as, its
 * labels, what its telemetry is matched on, and the other columns a details
 * card used to repeat.
 */
const DETAIL_KEYS: ReadonlySet<string> = new Set<string>([
  "name",
  "displayName",
  "title",
  "description",
  "labels",
  "hostIdentifier",
  "clusterIdentifier",
  "appIdentifier",
  "functionIdentifier",
  "resourceIdentifier",
  "cloudPlatform",
  "cloudAccountId",
  "cloudRegion",
  "techStack",
  "mainBranchName",
  "repositoryHostedAt",
  "organizationName",
  "repositoryName",
  "networkSiteType",
  "parentSite",
  "address",
  "latitude",
  "longitude",
  "site",
  "hostname",
  "macAddress",
]);

const TABLE_HOSTS: ReadonlySet<string> = new Set<string>([
  "ModelTable",
  "RuleTable",
  "LabelRuleTable",
]);

// One form that writes a detail of a record that already exists.
interface EditPlace {
  model: string;
  key: string;
  file: string;
  line: number;
  form: string;
}

function describePlace(place: EditPlace): string {
  return `${place.file}:${place.line} ${place.form}`;
}

/*
 * The details an existing record's form edits. Create-only forms add a
 * record (a list's Create, a ModelForm or dialog of FormType.Create), and
 * DuplicateModel makes a copy, so neither is a second place to change one:
 * a table counts only when it offers its Edit form, with the fields that
 * form shows. BasicForm and BasicFormModal save through code of their own
 * and name no model.
 */
function editPlacesOf(form: FormFacts): Array<EditPlace> {
  if (!form.modelType) {
    return [];
  }

  if (
    form.host === "DuplicateModel" ||
    form.host === "BasicForm" ||
    form.host === "BasicFormModal"
  ) {
    return [];
  }

  const isTable: boolean = TABLE_HOSTS.has(form.host);

  if (isTable && !form.hasEditForm) {
    return [];
  }

  if (
    (form.host === "ModelForm" || form.host === "ModelFormModal") &&
    form.hasCreateForm === true
  ) {
    return [];
  }

  const keys: Set<string> = new Set<string>();

  for (const field of form.fields) {
    if (field.isNeverShown || (isTable && field.isCreateOnly)) {
      continue;
    }

    if (DETAIL_KEYS.has(field.key)) {
      keys.add(field.key);
    }
  }

  return Array.from(keys).map((key: string): EditPlace => {
    return {
      model: form.modelType!.name,
      key: key,
      file: form.file,
      line: form.line,
      form: form.label,
    };
  });
}

/*
 * ---------------------------------------------------------------------------
 * The details cards, read from the source
 * ---------------------------------------------------------------------------
 */

interface DetailsCardUse {
  file: string;
  line: number;
  // The model, as the modelType attribute names it.
  model: string;
  title: string | null;
  nameTitle: string | null;
  nameDescription: string | null;
  identityColumns: Array<string>;
  // The help each identity column carries, by column.
  identityDescriptions: Record<string, string>;
  // Drawn first on its page: no card before it.
  isFirstOnPage: boolean;
}

function stringOf(node: ts.Node | undefined): string | null {
  if (!node) {
    return null;
  }

  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }

  if (ts.isJsxExpression(node) && node.expression) {
    return stringOf(node.expression);
  }

  return null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name
    ) {
      return property.initializer;
    }
  }

  return undefined;
}

function attributeExpression(
  attributes: ts.JsxAttributes,
  name: string,
): ts.Expression | undefined {
  for (const attribute of attributes.properties) {
    if (
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText() === name &&
      attribute.initializer
    ) {
      if (ts.isJsxExpression(attribute.initializer)) {
        return attribute.initializer.expression;
      }

      return attribute.initializer as ts.Expression;
    }
  }

  return undefined;
}

// The elements drawn beside one another: JSX children, comments and blanks left out.
function elementSiblings(node: ts.Node): Array<ts.Node> {
  const parent: ts.Node = node.parent;

  if (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) {
    return [node];
  }

  return parent.children.filter((child: ts.JsxChild): boolean => {
    return ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child);
  });
}

function readDetailsCardUses(
  file: string,
  source: string,
): Array<DetailsCardUse> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const uses: Array<DetailsCardUse> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceFile) === DETAILS_CARD
    ) {
      const modelType: ts.Expression | undefined = attributeExpression(
        node.attributes,
        "modelType",
      );
      const nameField: ts.Expression | undefined = attributeExpression(
        node.attributes,
        "nameField",
      );
      const identityFields: ts.Expression | undefined = attributeExpression(
        node.attributes,
        "identityFields",
      );

      const identityColumns: Array<string> = [];
      const identityDescriptions: Record<string, string> = {};

      if (identityFields && ts.isArrayLiteralExpression(identityFields)) {
        for (const element of identityFields.elements) {
          if (!ts.isObjectLiteralExpression(element)) {
            continue;
          }

          const column: string | null = stringOf(
            objectProperty(element, "column"),
          );

          if (column) {
            identityColumns.push(column);
            identityDescriptions[column] =
              stringOf(objectProperty(element, "description")) || "";
          }
        }
      }

      const siblings: Array<ts.Node> = elementSiblings(node);

      uses.push({
        file: file,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        model: modelType && ts.isIdentifier(modelType) ? modelType.text : "",
        title: stringOf(attributeExpression(node.attributes, "title")),
        nameTitle:
          nameField && ts.isObjectLiteralExpression(nameField)
            ? stringOf(objectProperty(nameField, "title"))
            : null,
        nameDescription:
          nameField && ts.isObjectLiteralExpression(nameField)
            ? stringOf(objectProperty(nameField, "description"))
            : null,
        identityColumns: identityColumns,
        identityDescriptions: identityDescriptions,
        isFirstOnPage: siblings[0] === node,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return uses;
}

/*
 * The place each details card is: its model's name, description and labels,
 * and each identity column a person may change - the ones the card offers
 * under Advanced (ResourceDetailsCard.isResourceColumnEditable).
 */
function editPlacesOfCard(use: DetailsCardUse): Array<EditPlace> {
  const modelType: { new (): BaseModel } | undefined = MODEL_TYPES[use.model];

  const keys: Array<string> = ["name", "description", "labels"];

  for (const column of use.identityColumns) {
    if (!modelType || isEditableColumn(modelType, column)) {
      keys.push(column);
    }
  }

  return keys.map((key: string): EditPlace => {
    return {
      model: use.model,
      key: key,
      file: use.file,
      line: use.line,
      form: DETAILS_CARD,
    };
  });
}

function isEditableColumn(
  modelType: { new (): BaseModel },
  column: string,
): boolean {
  const update: Array<unknown> | undefined =
    new modelType().getColumnAccessControlFor(column)?.update as
      | Array<unknown>
      | undefined;

  return Array.isArray(update) && update.length > 0;
}

/*
 * ---------------------------------------------------------------------------
 * What each discovered resource should look like
 * ---------------------------------------------------------------------------
 */

const MODEL_TYPES: Record<string, { new (): BaseModel }> = {
  Host: Host,
  DockerHost: DockerHost,
  PodmanHost: PodmanHost,
  KubernetesCluster: KubernetesCluster,
  RumApplication: RumApplication,
  ServerlessFunction: ServerlessFunction,
  CloudResource: CloudResource,
  CephCluster: CephCluster,
  ProxmoxCluster: ProxmoxCluster,
  VMwareVCenter: VMwareVCenter,
  StorageArray: StorageArray,
  DockerSwarmCluster: DockerSwarmCluster,
  IoTFleet: IoTFleet,
  Service: Service,
};

interface DiscoveredResource {
  model: string;
  settingsPage: string;
  // The resource's Settings page key in PageMap.
  settingsPageKey: string;
  /*
   * The page that shows its details read-only, and links to Settings; null
   * where the Overview shows no details card.
   */
  overviewPage: string | null;
  /*
   * What its telemetry is matched on when that is not its name, shown on
   * the card; the columns a person may change are editable under Advanced.
   */
  identity: Array<string>;
  editableIdentity: Array<string>;
}

const identified: (
  model: string,
  folder: string,
  overview: string,
  pageKey: string,
  identity: Array<string>,
  editableIdentity: Array<string>,
) => DiscoveredResource = (
  model: string,
  folder: string,
  overview: string,
  pageKey: string,
  identity: Array<string>,
  editableIdentity: Array<string>,
): DiscoveredResource => {
  return {
    model: model,
    settingsPage: `${PAGES}/${folder}/View/Settings.tsx`,
    settingsPageKey: pageKey,
    overviewPage: `${PAGES}/${folder}/View/${overview}`,
    identity: identity,
    editableIdentity: editableIdentity,
  };
};

const matchedOnName: (
  model: string,
  folder: string,
  overview: string | null,
  pageKey: string,
) => DiscoveredResource = (
  model: string,
  folder: string,
  overview: string | null,
  pageKey: string,
): DiscoveredResource => {
  return {
    model: model,
    settingsPage: `${PAGES}/${folder}/View/Settings.tsx`,
    settingsPageKey: pageKey,
    overviewPage: overview ? `${PAGES}/${folder}/View/${overview}` : null,
    identity: [],
    editableIdentity: [],
  };
};

export const DISCOVERED_RESOURCES: Array<DiscoveredResource> = [
  identified(
    "Host",
    "Host",
    "Overview.tsx",
    "HOST_VIEW_SETTINGS",
    ["hostIdentifier"],
    ["hostIdentifier"],
  ),
  identified(
    "DockerHost",
    "Docker",
    "Overview.tsx",
    "DOCKER_HOST_VIEW_SETTINGS",
    ["hostIdentifier"],
    ["hostIdentifier"],
  ),
  identified(
    "PodmanHost",
    "Podman",
    "Overview.tsx",
    "PODMAN_HOST_VIEW_SETTINGS",
    ["hostIdentifier"],
    ["hostIdentifier"],
  ),
  identified(
    "KubernetesCluster",
    "Kubernetes",
    "Index.tsx",
    "KUBERNETES_CLUSTER_VIEW_SETTINGS",
    ["clusterIdentifier"],
    ["clusterIdentifier"],
  ),
  identified(
    "RumApplication",
    "Rum",
    "Overview.tsx",
    "RUM_APPLICATION_VIEW_SETTINGS",
    ["appIdentifier"],
    [],
  ),
  identified(
    "ServerlessFunction",
    "Serverless",
    "Overview.tsx",
    "SERVERLESS_FUNCTION_VIEW_SETTINGS",
    ["functionIdentifier"],
    [],
  ),
  identified(
    "CloudResource",
    "Cloud",
    "Overview.tsx",
    "CLOUD_RESOURCE_VIEW_SETTINGS",
    ["cloudPlatform", "cloudAccountId", "cloudRegion"],
    [],
  ),
  matchedOnName(
    "CephCluster",
    "Ceph",
    "Index.tsx",
    "CEPH_CLUSTER_VIEW_SETTINGS",
  ),
  matchedOnName(
    "ProxmoxCluster",
    "Proxmox",
    "Index.tsx",
    "PROXMOX_CLUSTER_VIEW_SETTINGS",
  ),
  matchedOnName(
    "VMwareVCenter",
    "VMware",
    "Index.tsx",
    "VMWARE_VCENTER_VIEW_SETTINGS",
  ),
  matchedOnName(
    "StorageArray",
    "StorageArray",
    "Index.tsx",
    "STORAGE_ARRAY_VIEW_SETTINGS",
  ),
  matchedOnName(
    "DockerSwarmCluster",
    "DockerSwarm",
    null,
    "DOCKER_SWARM_CLUSTER_VIEW_SETTINGS",
  ),
  matchedOnName("IoTFleet", "IoT", null, "IOT_FLEET_VIEW_SETTINGS"),
  matchedOnName("Service", "Service", "Index.tsx", "SERVICE_VIEW_SETTINGS"),
];

/*
 * The other records whose details had two homes, and the one each keeps.
 */
interface OnePlace {
  model: string;
  keys: Array<string>;
  file: string;
}

export const OTHER_ONE_PLACES: Array<OnePlace> = [
  {
    // Site Settings; the Overview links there, the sites list only creates.
    model: "NetworkSite",
    keys: [
      "networkSiteType",
      "name",
      "description",
      "parentSite",
      "address",
      "latitude",
      "longitude",
    ],
    file: `${PAGES}/NetworkSite/View/Settings.tsx`,
  },
  {
    /*
     * Device Settings, which took the site and the labels from the
     * Overview. (The MAC address comes from a helper the scan does not key.)
     */
    model: "NetworkDevice",
    keys: ["name", "description", "site", "labels", "hostname"],
    file: `${PAGES}/NetworkDevice/View/Settings.tsx`,
  },
  {
    model: "Service",
    keys: ["techStack"],
    file: `${PAGES}/Service/View/Settings.tsx`,
  },
  {
    model: "CodeRepository",
    keys: ["mainBranchName"],
    file: `${PAGES}/CodeRepository/View/Settings.tsx`,
  },
  {
    // A repository's page is its details; its Settings are its AI fix runs'.
    model: "CodeRepository",
    keys: ["name", "description", "labels"],
    file: `${PAGES}/CodeRepository/View/Index.tsx`,
  },
  {
    // The Runner Details card on a Runner's page; the list only creates.
    model: "Runner",
    keys: ["name", "description", "labels"],
    file: `${PAGES}/Runbook/Runners/RunnerView.tsx`,
  },
];

/*
 * Overviews of records that are not discovered resources but used to edit
 * their details too, and the Settings page each links to now.
 */
const OTHER_OVERVIEW_LINKS: Array<{ overviewPage: string; pageKey: string }> = [
  {
    overviewPage: `${PAGES}/NetworkSite/View/Index.tsx`,
    pageKey: "NETWORK_SITE_VIEW_SETTINGS",
  },
  {
    overviewPage: `${PAGES}/NetworkDevice/View/Index.tsx`,
    pageKey: "NETWORK_DEVICE_VIEW_SETTINGS",
  },
];

// The words a list, an Overview or a form used before the create forms' wording.
const RETIRED_IDENTITY_TITLES: Array<string> = [
  "Host Identifier",
  "Cluster Identifier",
  "App Identifier",
  "Function Identifier",
];

/*
 * ---------------------------------------------------------------------------
 * The scan
 * ---------------------------------------------------------------------------
 */

const DASHBOARD_FILES: Array<string> = listSourceFiles(DASHBOARD_DIR).filter(
  (file: string): boolean => {
    return !file.includes(`${path.sep}Locales${path.sep}`);
  },
);

const FORMS: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: DASHBOARD_FILES,
});

function toRepositoryPath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

const DETAILS_CARD_USES: Array<DetailsCardUse> = DASHBOARD_FILES.flatMap(
  (file: string): Array<DetailsCardUse> => {
    const source: string = fs.readFileSync(file, "utf8");

    if (!source.includes(`<${DETAILS_CARD}`)) {
      return [];
    }

    return readDetailsCardUses(toRepositoryPath(file), source);
  },
);

const EDIT_PLACES: Array<EditPlace> = [
  ...FORMS.flatMap(editPlacesOf),
  ...DETAILS_CARD_USES.flatMap(editPlacesOfCard),
];

function placesOf(model: string, key: string): Array<EditPlace> {
  return EDIT_PLACES.filter((place: EditPlace): boolean => {
    return place.model === model && place.key === key;
  });
}

function readCode(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

// Comments out: what the code says, not what a comment says about it.
function readCodeWithoutComments(file: string): string {
  return readCode(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

describe("where a record's details are edited", () => {
  test("is read from every Dashboard form and details card", () => {
    expect(FORMS.length).toBeGreaterThanOrEqual(MIN_SCANNED_FORMS);
    expect(DETAILS_CARD_USES).toHaveLength(DISCOVERED_RESOURCES.length);
    // The scan sees a details card on a page the way the guard expects.
    expect(placesOf("Monitor", "name").length).toBe(1);
  });

  test("is one place for every record: no detail is edited from two forms", () => {
    const byDetail: Map<string, Array<EditPlace>> = new Map<
      string,
      Array<EditPlace>
    >();

    for (const place of EDIT_PLACES) {
      const detail: string = `${place.model}.${place.key}`;
      byDetail.set(detail, [...(byDetail.get(detail) || []), place]);
    }

    const twice: Array<string> = [];

    for (const [detail, places] of byDetail) {
      if (places.length > 1) {
        twice.push(`${detail}: ${places.map(describePlace).join(" and ")}`);
      }
    }

    expect(twice).toEqual([]);
  });

  test("counts a table's row Edit as a place, and its Create form as none", () => {
    const table: Array<FormFacts> = scanFormFiles({
      repositoryRoot: "/repo",
      files: ["/repo/Page.tsx"],
      fileSystem: {
        readFile: (filePath: string): string | null => {
          if (filePath !== "/repo/Page.tsx") {
            return null;
          }

          return `import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
            import Thing from "Common/Models/DatabaseModels/Thing";
            const Page = () => <>
              <ModelTable modelType={Thing} name="Editable" isCreateable={true} isEditable={true} formFields={[{ field: { name: true }, title: "Name" }, { field: { description: true }, title: "Description", doNotShowWhenEditing: true }]} />
              <ModelTable modelType={Thing} name="Create only" isCreateable={true} isEditable={false} formFields={[{ field: { name: true }, title: "Name" }]} />
            </>;`;
        },
      },
    });

    expect(
      table.flatMap(editPlacesOf).map((place: EditPlace): string => {
        return `${place.form}: ${place.key}`;
      }),
    ).toEqual(["ModelTable: Editable: name"]);
  });
});

describe.each(DISCOVERED_RESOURCES)(
  "$model's details",
  (resource: DiscoveredResource) => {
    const uses: Array<DetailsCardUse> = DETAILS_CARD_USES.filter(
      (use: DetailsCardUse): boolean => {
        return use.model === resource.model;
      },
    );

    test("are one details card, the first card on its Settings page", () => {
      expect(
        uses.map((use: DetailsCardUse): string => {
          return use.file;
        }),
      ).toEqual([resource.settingsPage]);
      expect(uses[0]!.isFirstOnPage).toBe(true);
      expect(uses[0]!.title).toMatch(/ Details$/);
    });

    test("are its name, description and labels, edited there and nowhere else", () => {
      for (const key of ["name", "description", "labels"]) {
        expect(
          placesOf(resource.model, key).map((place: EditPlace): string => {
            return `${place.file} ${place.form}`;
          }),
        ).toEqual([`${resource.settingsPage} ${DETAILS_CARD}`]);
      }
    });

    test("show what its telemetry is matched on, editable only where the server allows it", () => {
      const modelType: { new (): BaseModel } = MODEL_TYPES[resource.model]!;
      const use: DetailsCardUse = uses[0]!;

      expect(use.identityColumns).toEqual(resource.identity);

      expect(
        resource.identity.filter((column: string): boolean => {
          return isEditableColumn(modelType, column);
        }),
      ).toEqual(resource.editableIdentity);

      for (const column of resource.identity) {
        expect(
          placesOf(resource.model, column).map((place: EditPlace): string => {
            return `${place.file} ${place.form}`;
          }),
        ).toEqual(
          resource.editableIdentity.includes(column)
            ? [`${resource.settingsPage} ${DETAILS_CARD}`]
            : [],
        );
      }
    });

    test("say what changing what telemetry is matched on does", () => {
      const use: DetailsCardUse = uses[0]!;

      if (resource.identity.length > 0) {
        // The name is free text: renaming it moves nothing.
        expect(use.nameTitle).toBe("Display Name");
        expect(use.nameDescription).toContain("renaming is safe");
      } else {
        // The name is what telemetry is matched on.
        expect(use.nameTitle).toBe("Name");
        expect(use.nameDescription).toMatch(/^Must match the [\w.]+ /);
        expect(use.nameDescription).toContain("creates a new");
      }

      for (const column of resource.editableIdentity) {
        expect(use.identityDescriptions[column]).toContain(
          "telemetry that still reports the old name creates a new",
        );
      }
    });

    if (resource.overviewPage) {
      test("are shown read-only on its Overview, which links to Settings", () => {
        expect(
          linksToSettings(resource.overviewPage!, resource.settingsPageKey),
        ).toBe(true);
      });
    }
  },
);

/*
 * The Overview's link: an EditInSettingsLink to this resource's Settings
 * page, or a ResourceOverview given it as its settingsRoute.
 */
function linksToSettings(file: string, pageKey: string): boolean {
  const code: string = readCodeWithoutComments(file).replace(/\s+/g, " ");
  const settingsPage: RegExp = new RegExp(`PageMap\\.${pageKey}\\b`);

  const linkStart: number = code.indexOf(`<${EDIT_IN_SETTINGS_LINK}`);

  if (linkStart >= 0) {
    const link: string = code.slice(linkStart, code.indexOf("/>", linkStart));
    return settingsPage.test(link);
  }

  const overviewStart: number = code.indexOf("settingsRoute={");

  if (overviewStart >= 0) {
    const route: string = code.slice(
      overviewStart,
      code.indexOf("}", code.indexOf(")", overviewStart)) + 1,
    );
    return settingsPage.test(route);
  }

  return false;
}

describe("the other records whose details had two homes", () => {
  test.each(OTHER_ONE_PLACES)(
    "$model: $keys are edited only in $file",
    (onePlace: OnePlace) => {
      for (const key of onePlace.keys) {
        expect({
          key: key,
          places: placesOf(onePlace.model, key).map(
            (place: EditPlace): string => {
              return place.file;
            },
          ),
        }).toEqual({ key: key, places: [onePlace.file] });
      }
    },
  );

  test.each(OTHER_OVERVIEW_LINKS)(
    "$overviewPage shows them read-only and links to Settings",
    (link: { overviewPage: string; pageKey: string }) => {
      expect(linksToSettings(link.overviewPage, link.pageKey)).toBe(true);
    },
  );

  test("a repository's host, organization and name are the GitHub App's: shown, never edited", () => {
    for (const column of [
      "repositoryHostedAt",
      "organizationName",
      "repositoryName",
    ]) {
      expect(isEditableColumn(CodeRepository, column)).toBe(false);
      expect(placesOf("CodeRepository", column)).toEqual([]);
    }
  });
});

describe("the wording", () => {
  test("names what telemetry is matched on the way the create forms do, never 'Identifier'", () => {
    const found: Array<string> = [];

    for (const file of DASHBOARD_FILES) {
      const code: string = readCodeWithoutComments(toRepositoryPath(file));

      for (const title of RETIRED_IDENTITY_TITLES) {
        if (code.includes(`"${title}`)) {
          found.push(`${toRepositoryPath(file)}: "${title}"`);
        }
      }
    }

    expect(found).toEqual([]);
  });
});
