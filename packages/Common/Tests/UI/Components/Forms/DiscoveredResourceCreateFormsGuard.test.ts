import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  countFieldRows,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Hosts, Docker and Podman hosts, Kubernetes clusters, RUM applications and
 * serverless functions are matched to their telemetry by one value it
 * carries - host.name, the agent's clusterName, service.name, faas.name -
 * and ingest names each one it discovers after that value. Their create
 * forms asked for a Name AND an "Identifier" that "should match" the
 * attribute, with near-identical placeholders: people decided twice and
 * guessed which box the telemetry used. A cloud environment walked a second
 * "Details" step for a required name whose own help said what discovered
 * environments are called.
 *
 * Now each form asks only for what the telemetry is matched on, titled after
 * the attribute (getIdentityFormField), and the name is an optional Display
 * Name folded under Advanced that follows it (getDisplayNameFormField) -
 * Dashboard Utils/Form/DiscoveredResourceFormFields. The services name a
 * resource created without a name the way ingest would
 * (Server/Utils/Telemetry/DiscoveredResourceCreate).
 *
 * This guard pins each form's shape, keeps every other create form of these
 * models from asking for a name of its own again, and makes a new kind of
 * discovered resource - a service with a findOrCreateBy...Identifier - follow
 * the same rules on the server.
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

const SERVICES: string = "packages/Common/Server/Services";

const IDENTITY_HELPER: string = "getIdentityFormField";

const DISPLAY_NAME_HELPER: string = "getDisplayNameFormField";

const LABELS_HELPER: string = "getLabelsFormField";

interface DiscoveredResource {
  // The model, as its create form's modelType names it.
  model: string;
  listPage: string;
  label: string;
  service: string;
  // What the create form shows open: what the telemetry is matched on.
  open: Array<string>;
  // Titled after the attribute the one identifier must equal.
  identityTitle?: string | undefined;
}

const DISCOVERED_RESOURCES: Array<DiscoveredResource> = [
  {
    model: "Host",
    listPage: `${DASHBOARD}/Pages/Host/Hosts.tsx`,
    label: "ModelTable: Hosts",
    service: "HostService.ts",
    open: ["hostIdentifier"],
    identityTitle: "Host Name (host.name)",
  },
  {
    model: "DockerHost",
    listPage: `${DASHBOARD}/Pages/Docker/Hosts.tsx`,
    label: "ModelTable: Docker Hosts",
    service: "DockerHostService.ts",
    open: ["hostIdentifier"],
    identityTitle: "Host Name (host.name)",
  },
  {
    model: "PodmanHost",
    listPage: `${DASHBOARD}/Pages/Podman/Hosts.tsx`,
    label: "ModelTable: Podman Hosts",
    service: "PodmanHostService.ts",
    open: ["hostIdentifier"],
    identityTitle: "Host Name (host.name)",
  },
  {
    model: "KubernetesCluster",
    listPage: `${DASHBOARD}/Pages/Kubernetes/Clusters.tsx`,
    label: "ModelTable: Kubernetes Clusters",
    service: "KubernetesClusterService.ts",
    open: ["clusterIdentifier"],
    identityTitle: "Cluster Name (clusterName)",
  },
  {
    model: "RumApplication",
    listPage: `${DASHBOARD}/Pages/Rum/RumApplications.tsx`,
    label: "ModelTable: RUM Applications",
    service: "RumApplicationService.ts",
    open: ["appIdentifier"],
    identityTitle: "App Name (service.name)",
  },
  {
    model: "ServerlessFunction",
    listPage: `${DASHBOARD}/Pages/Serverless/ServerlessFunctions.tsx`,
    label: "ModelTable: Serverless Functions",
    service: "ServerlessFunctionService.ts",
    open: ["functionIdentifier"],
    identityTitle: "Function Name (faas.name)",
  },
  {
    model: "CloudResource",
    listPage: `${DASHBOARD}/Pages/Cloud/CloudResources.tsx`,
    label: "ModelTable: Cloud Environments",
    service: "CloudResourceService.ts",
    // Joined into the key (resourceIdentifier) by the page's onBeforeCreate.
    open: ["cloudPlatform", "cloudAccountId", "cloudRegion"],
  },
];

const DISCOVERED_MODELS: ReadonlySet<string> = new Set<string>(
  DISCOVERED_RESOURCES.map((resource: DiscoveredResource): string => {
    return resource.model;
  }),
);

const listPageForms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: DISCOVERED_RESOURCES.map((resource: DiscoveredResource): string => {
    return path.join(REPOSITORY_ROOT, resource.listPage);
  }),
});

type FindFormFunction = (resource: DiscoveredResource) => FormFacts;

const findForm: FindFormFunction = (
  resource: DiscoveredResource,
): FormFacts => {
  const found: Array<FormFacts> = listPageForms.filter(
    (form: FormFacts): boolean => {
      return form.file === resource.listPage && form.label === resource.label;
    },
  );

  if (found.length !== 1) {
    throw new Error(
      `${resource.listPage} should have one form labelled ${resource.label}; found ${found.length}`,
    );
  }

  return found[0]!;
};

type KeysFunction = (fields: Array<FormFieldFacts>) => Array<string>;

const keys: KeysFunction = (fields: Array<FormFieldFacts>): Array<string> => {
  return fields.map((field: FormFieldFacts): string => {
    return field.key;
  });
};

// The fields a Create form shows: the Edit-only ones left out.
type CreateFieldsFunction = (form: FormFacts) => Array<FormFieldFacts>;

const createFields: CreateFieldsFunction = (
  form: FormFacts,
): Array<FormFieldFacts> => {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return !field.isEditOnly && !field.isNeverShown;
  });
};

type ReadCodeFunction = (file: string) => string;

// Comments out: what the code does, not what a comment says about it.
const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
};

type MethodBodyFunction = (code: string, method: string) => string;

// The body of one method, from its name to the next override.
const methodBody: MethodBodyFunction = (
  code: string,
  method: string,
): string => {
  const start: number = code.indexOf(`protected override async ${method}(`);

  if (start < 0) {
    return "";
  }

  const next: number = code.indexOf(
    "protected override async ",
    start + method.length,
  );

  return next < 0 ? code.slice(start) : code.slice(start, next);
};

describe("the create forms of resources that telemetry discovers", () => {
  test("are really read", () => {
    expect(listPageForms.length).toBeGreaterThanOrEqual(
      DISCOVERED_RESOURCES.length,
    );

    for (const resource of DISCOVERED_RESOURCES) {
      expect(findForm(resource).fields.length).toBeGreaterThan(0);
    }
  });

  describe.each(DISCOVERED_RESOURCES)(
    "$label",
    (resource: DiscoveredResource) => {
      const form: FormFacts = findForm(resource);
      const fields: Array<FormFieldFacts> = createFields(form);
      const open: Array<FormFieldFacts> = fields.filter(
        (field: FormFieldFacts): boolean => {
          return field.collapsibleSection === undefined;
        },
      );
      const folded: Array<FormFieldFacts> = fields.filter(
        (field: FormFieldFacts): boolean => {
          return field.collapsibleSection !== undefined;
        },
      );

      test("is one page, every field counted", () => {
        expect(form.uncountableReasons).toEqual([]);
        expect(form.hasSteps).toBe(false);
        // No field is written on a step (a helper's spread reads as null).
        expect(
          keys(
            fields.filter((field: FormFieldFacts): boolean => {
              return typeof field.stepId === "string";
            }),
          ),
        ).toEqual([]);
      });

      test("shows open only what the telemetry is matched on", () => {
        expect(keys(open)).toEqual(resource.open);
      });

      test("folds the display name, the description and the labels, in that order, into one section", () => {
        expect(keys(folded)).toEqual(["name", "description", "labels"]);
        expect(
          new Set(
            folded.map((field: FormFieldFacts): string | undefined => {
              return field.collapsibleSection;
            }),
          ).size,
        ).toBe(1);

        // After everything open: one header at the end of the form.
        expect(keys(fields.slice(open.length))).toEqual(keys(folded));
        expect(countFieldRows(fields)).toBe(resource.open.length + 1);
      });

      test("asks for the display name with the shared field, never a Name of its own", () => {
        const nameFields: Array<FormFieldFacts> = form.fields.filter(
          (field: FormFieldFacts): boolean => {
            return field.key === "name";
          },
        );

        expect(nameFields).toHaveLength(1);
        expect(nameFields[0]!.helper).toBe(DISPLAY_NAME_HELPER);
        expect(nameFields[0]!.title).toBe("Display Name");
        // Its default is the name the form fills in (getDefaultValue).
        expect(nameFields[0]!.hasDefault).toBe(true);
      });

      test("asks for the labels with the shared field", () => {
        expect(
          form.fields.find((field: FormFieldFacts): boolean => {
            return field.key === "labels";
          })?.helper,
        ).toBe(LABELS_HELPER);
      });

      test("never fills the identifier in from anything", () => {
        /*
         * A name is made from the identifier, never the other way round:
         * an identifier that is not exactly what the telemetry reports
         * leaves the resource empty, with no error anywhere.
         */
        for (const field of open) {
          expect(field.hasDefault).toBe(false);
          expect(field.defaultValue).toBeUndefined();
        }
      });

      if (resource.identityTitle) {
        test("asks for its one identifier with the shared field, titled after the attribute", () => {
          expect(open).toHaveLength(1);
          expect(open[0]!.helper).toBe(IDENTITY_HELPER);
          expect(open[0]!.title).toBe(resource.identityTitle);
          // "<What it is> (<the attribute it must equal>)".
          expect(open[0]!.title).toMatch(/^[A-Z][A-Za-z ]+ \([A-Za-z.]+\)$/);
        });

        test("the display name follows that identifier", () => {
          const code: string = readCode(resource.listPage);

          // However Prettier wraps the call.
          const follows: RegExp = new RegExp(
            `getDefaultName: getNameFromIdentityField<${resource.model}>\\( ?"${resource.open[0]}",? ?\\)`,
          );

          expect(code).toMatch(follows);
        });
      }
    },
  );

  test("a cloud environment's display name follows all three values the key is made from", () => {
    const code: string = readCode(
      `${DASHBOARD}/Pages/Cloud/CloudResources.tsx`,
    );

    expect(code).toContain(
      "getDisplayNameFormField<CloudResource>({ getDefaultName: getCloudEnvironmentNameFromFields,",
    );

    for (const key of ["cloudPlatform", "cloudAccountId", "cloudRegion"]) {
      expect(code).toContain(
        `onChange: followWithDisplayName<CloudResource>({ fieldKey: "${key}", getDefaultName: getCloudEnvironmentNameFromFields, })`,
      );
    }
  });

  test("the Docker and Podman forms say the same, each of its own agent", () => {
    const docker: string = readCode(`${DASHBOARD}/Pages/Docker/Hosts.tsx`);
    const podman: string = readCode(`${DASHBOARD}/Pages/Podman/Hosts.tsx`);

    expect(docker).toContain(
      "Exactly as the OneUptime Docker Agent reports it.",
    );
    expect(podman).toContain(
      "Exactly as the OneUptime Podman Agent reports it.",
    );
  });

  test("the display name follows by the rule every name a form fills in follows", () => {
    /*
     * A status page resource's display name and a new ingestion key's name
     * follow a pick the same way (Forms/Utils/FollowPickName), so a typed
     * name is never overwritten here either.
     */
    const helper: string = readCode(
      `${DASHBOARD}/Utils/Form/DiscoveredResourceFormFields.ts`,
    );

    expect(helper).toContain(
      'import { getNameAfterPick } from "Common/UI/Components/Forms/Utils/FollowPickName";',
    );
    expect(helper).toContain("return getNameAfterPick({");
  });
});

describe("every Dashboard form of a discovered resource", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  const createForms: Array<FormFacts> = forms.filter(
    (form: FormFacts): boolean => {
      return (
        form.modelType !== null &&
        DISCOVERED_MODELS.has(form.modelType.name) &&
        form.hasCreateForm !== false
      );
    },
  );

  test("are really read", () => {
    expect(forms.length).toBeGreaterThan(500);
  });

  test("that create one are the list pages' forms, pinned above", () => {
    /*
     * A new way to create one of these - an onboarding step, a quick-add
     * dialog - is held to the same rules: add it to DISCOVERED_RESOURCES
     * once it asks only for what the telemetry is matched on.
     */
    expect(
      createForms
        .map((form: FormFacts): string => {
          return `${form.file} ${form.label}`;
        })
        .sort(),
    ).toEqual(
      DISCOVERED_RESOURCES.map((resource: DiscoveredResource): string => {
        return `${resource.listPage} ${resource.label}`;
      }).sort(),
    );
  });

  test("never show a Name to fill in on create", () => {
    const openNames: Array<string> = createForms
      .filter((form: FormFacts): boolean => {
        return createFields(form).some((field: FormFieldFacts): boolean => {
          return (
            field.key === "name" &&
            (field.collapsibleSection === undefined ||
              field.helper !== DISPLAY_NAME_HELPER)
          );
        });
      })
      .map((form: FormFacts): string => {
        return `${form.file}:${form.line} ${form.label}`;
      });

    expect(openNames).toEqual([]);
  });
});

describe("the services of discovered resources", () => {
  const serviceFiles: Array<string> = fs
    .readdirSync(path.join(REPOSITORY_ROOT, SERVICES))
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    });

  /*
   * A resource ingest finds by an identifier of its own (not by its name, as
   * Ceph, Proxmox, VMware, Docker Swarm and IoT are) is created with
   * findOrCreateBy...Identifier.
   */
  const FINDS_BY_IDENTIFIER: RegExp =
    /public async findOrCreateBy\w*Identifier\(/;

  const discoveringServices: Array<string> = serviceFiles
    .filter((file: string): boolean => {
      return FINDS_BY_IDENTIFIER.test(
        fs.readFileSync(path.join(REPOSITORY_ROOT, SERVICES, file), "utf8"),
      );
    })
    .sort();

  test("are the ones whose create forms are pinned above", () => {
    expect(discoveringServices).toEqual(
      DISCOVERED_RESOURCES.map((resource: DiscoveredResource): string => {
        return resource.service;
      }).sort(),
    );
  });

  test.each(
    DISCOVERED_RESOURCES.map((resource: DiscoveredResource): string => {
      return resource.service;
    }),
  )(
    "%s names a resource created without a name, and refuses a clash in plain words",
    (service: string) => {
      const code: string = readCode(`${SERVICES}/${service}`);

      expect(methodBody(code, "onBeforeCreate")).toContain(
        "DiscoveredResourceCreate.fillName(",
      );
      expect(methodBody(code, "onBeforeCreateUniqueCheck")).toContain(
        "DiscoveredResourceCreate.refuseClash(",
      );
    },
  );
});
