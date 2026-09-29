import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import EditionPermissions, {
  MIN_ROTATED_SCIM_BEARER_TOKEN_LENGTH,
} from "Common/Server/Types/Database/Permissions/EditionPermission";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import { EnterpriseLicenseStatus } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "Common/Models/DatabaseModels/GlobalSsoProject";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { coerceDateColumnsInJSON } from "Common/Types/Database/DateColumnValue";
import { coerceNumericColumnsInJSON } from "Common/Types/Database/NumericColumnValue";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import {
  MIN_SCIM_BEARER_TOKEN_LENGTH,
  SCIM_BEARER_TOKEN_BYTES,
  buildDisableProviderUpdate,
  buildRotateBearerTokenUpdate,
  generateScimBearerToken,
} from "../../../Dashboard/SSO/TightenOnly/TightenOnlyUpdates";

/*
 * The contract between the Enterprise identity screens and the server, for
 * the two updates the screens send while the license makes configuration
 * read-only (ee/Dashboard/SSO/TightenOnly/TightenOnlyUpdates.ts):
 *
 *   "Disable"             { isEnabled: false }
 *   "Reset Bearer Token"  { bearerToken: <new token> }
 *
 * The server lets an update through without a license only when it is
 * tighten-only (EditionPermissions.isTightenOnlyUpdate). If the two drifted -
 * the UI adding a column, the server renaming one, the minimum token length
 * changing on one side - the screens would offer an action that is answered
 * "license required" in the middle of an incident. This pins them together:
 * the UI's own payload builders against the server's own rule, for every
 * model a screen sends them to, after the same JSON round trip and body
 * handling BaseAPI.updateItem does, and through the full edition check with
 * the license expired and on the Community Edition.
 *
 * Which screen sends which payload to which model is pinned on the UI side,
 * by ee/Tests/UI/Identity/ReadOnlyIncidentActions.test.tsx.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

type ModelType = { new (): BaseModel };

// The models the screens send "Disable" to, and where.
const DISABLE_TARGETS: ReadonlyArray<[string, ModelType]> = [
  ["Settings > SSO", ProjectSSO],
  ["Settings > OIDC", ProjectOIDC],
  ["Status page > SSO", StatusPageSSO],
  ["Status page > OIDC", StatusPageOIDC],
  ["Admin > Global SSO (list and provider page)", GlobalSSO],
  ["Admin > Global OIDC (list and provider page)", GlobalOIDC],
  ["Admin > Global SSO > attached projects", GlobalSSOProject],
  ["Admin > Global OIDC > attached projects", GlobalOIDCProject],
];

// The models the screens send "Reset Bearer Token" to, and where.
const ROTATE_TARGETS: ReadonlyArray<[string, ModelType]> = [
  ["Settings > SCIM", ProjectSCIM],
  ["Status page > SCIM", StatusPageSCIM],
];

const tableNameOf: (modelType: ModelType) => string = (
  modelType: ModelType,
): string => {
  return new modelType().tableName!;
};

/*
 * What BaseAPI.updateItem hands the permission layer for a PUT whose body the
 * UI built as { data: payload }: the JSON round trip of the request, then
 * deserialize, the numeric / date coercions, and the dropped id columns.
 */
const asReceivedByServer: (
  modelType: ModelType,
  payload: JSONObject,
) => JSONObject = (modelType: ModelType, payload: JSONObject): JSONObject => {
  const body: { data: JSONObject } = JSON.parse(
    JSON.stringify({ data: payload }),
  ) as { data: JSONObject };

  const model: BaseModel = new modelType();

  const item: JSONObject = coerceDateColumnsInJSON(
    coerceNumericColumnsInJSON(JSONFunctions.deserialize(body.data), model),
    model,
  );

  delete item["_id"];
  delete item["createdAt"];
  delete item["updatedAt"];

  return item;
};

const USER_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-00000000000a");
const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000b",
);

const callerFor: (modelType: ModelType) => DatabaseCommonInteractionProps = (
  modelType: ModelType,
): DatabaseCommonInteractionProps => {
  // Global providers are only ever written by master admins.
  const tableName: string = tableNameOf(modelType);

  if (tableName.startsWith("Global")) {
    return { userId: USER_ID, isMasterAdmin: true };
  }

  return { userId: USER_ID, tenantId: PROJECT_ID };
};

type Outcome = "allowed" | "refused";

const runEditionCheck: (modelType: ModelType, data: unknown) => Outcome = (
  modelType: ModelType,
  data: unknown,
): Outcome => {
  try {
    EditionPermissions.checkEditionPermissions(
      modelType,
      callerFor(modelType),
      DatabaseRequestType.Update,
      data,
    );

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return "refused";
    }

    throw err;
  }
};

const LICENSE_UNAVAILABLE: ReadonlyArray<[string, () => void]> = [
  [
    "the Community Edition",
    (): void => {
      uninstallEnterpriseModule();
    },
  ],
  ...(["expired", "missing", "invalid"] as Array<EnterpriseLicenseStatus>).map(
    (status: EnterpriseLicenseStatus): [string, () => void] => {
      return [
        `license status "${status}"`,
        (): void => {
          installFakeEnterpriseModule({
            snapshot: createLicenseSnapshotWithStatus(status),
          });
        },
      ];
    },
  ),
];

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

describe("the UI's tighten-only payloads and the server's rule", () => {
  test("the UI asks for the same minimum bearer-token length as the server, and generates longer tokens", () => {
    expect(MIN_SCIM_BEARER_TOKEN_LENGTH).toBe(
      MIN_ROTATED_SCIM_BEARER_TOKEN_LENGTH,
    );
    expect(SCIM_BEARER_TOKEN_BYTES * 2).toBeGreaterThanOrEqual(
      MIN_ROTATED_SCIM_BEARER_TOKEN_LENGTH,
    );
  });

  test("the screens cover exactly the tables the server has tighten-only updates for, each with the column the server lists", () => {
    const serverColumns: ReadonlyMap<
      string,
      ReadonlyArray<string>
    > = EditionPermissions.getTightenOnlyColumns();

    const uiColumns: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const [, modelType] of DISABLE_TARGETS) {
      uiColumns.set(
        tableNameOf(modelType),
        Object.keys(buildDisableProviderUpdate()),
      );
    }

    for (const [, modelType] of ROTATE_TARGETS) {
      uiColumns.set(
        tableNameOf(modelType),
        Object.keys(buildRotateBearerTokenUpdate(generateScimBearerToken())),
      );
    }

    expect(Array.from(uiColumns.keys()).sort()).toEqual(
      Array.from(serverColumns.keys()).sort(),
    );

    for (const [tableName, columns] of uiColumns) {
      expect(columns).toEqual(serverColumns.get(tableName));
    }
  });

  test.each(DISABLE_TARGETS)(
    "%s: Disable's payload is tighten-only for its table, as sent and as received",
    (_screen: string, modelType: ModelType) => {
      const tableName: string = tableNameOf(modelType);
      const payload: JSONObject = buildDisableProviderUpdate();

      expect(EditionPermissions.isTightenOnlyUpdate(tableName, payload)).toBe(
        true,
      );
      expect(
        EditionPermissions.isTightenOnlyUpdate(
          tableName,
          asReceivedByServer(modelType, payload),
        ),
      ).toBe(true);
      expect(asReceivedByServer(modelType, payload)).toEqual({
        isEnabled: false,
      });
    },
  );

  test.each(ROTATE_TARGETS)(
    "%s: every generated Reset Bearer Token payload is tighten-only for its table, as sent and as received",
    (_screen: string, modelType: ModelType) => {
      const tableName: string = tableNameOf(modelType);

      for (let i: number = 0; i < 200; i++) {
        const token: string = generateScimBearerToken();
        const payload: JSONObject = buildRotateBearerTokenUpdate(token);

        expect(EditionPermissions.isTightenOnlyUpdate(tableName, payload)).toBe(
          true,
        );
        expect(
          EditionPermissions.isTightenOnlyUpdate(
            tableName,
            asReceivedByServer(modelType, payload),
          ),
        ).toBe(true);
        expect(asReceivedByServer(modelType, payload)).toEqual({
          bearerToken: token,
        });
      }
    },
  );

  test.each(LICENSE_UNAVAILABLE)(
    "with %s, the full edition check lets both payloads through for every target",
    (_state: string, install: () => void) => {
      install();

      for (const [, modelType] of DISABLE_TARGETS) {
        expect(
          runEditionCheck(
            modelType,
            asReceivedByServer(modelType, buildDisableProviderUpdate()),
          ),
        ).toBe("allowed");
      }

      for (const [, modelType] of ROTATE_TARGETS) {
        expect(
          runEditionCheck(
            modelType,
            asReceivedByServer(
              modelType,
              buildRotateBearerTokenUpdate(generateScimBearerToken()),
            ),
          ),
        ).toBe("allowed");
      }
    },
  );

  /*
   * Negative controls: the check above would pass vacuously if the server
   * let everything through. These are the updates a form would send.
   */
  test.each(LICENSE_UNAVAILABLE)(
    "with %s, one column more, or a payload on the wrong kind of table, is refused",
    (_state: string, install: () => void) => {
      install();

      for (const [, modelType] of DISABLE_TARGETS) {
        expect(
          runEditionCheck(modelType, {
            ...buildDisableProviderUpdate(),
            name: "Okta",
          }),
        ).toBe("refused");
        expect(runEditionCheck(modelType, { isEnabled: true })).toBe("refused");
        expect(
          runEditionCheck(
            modelType,
            buildRotateBearerTokenUpdate(generateScimBearerToken()),
          ),
        ).toBe("refused");
      }

      for (const [, modelType] of ROTATE_TARGETS) {
        expect(
          runEditionCheck(modelType, {
            ...buildRotateBearerTokenUpdate(generateScimBearerToken()),
            autoProvisionUsers: true,
          }),
        ).toBe("refused");
        expect(
          runEditionCheck(modelType, {
            bearerToken: "a".repeat(MIN_ROTATED_SCIM_BEARER_TOKEN_LENGTH - 1),
          }),
        ).toBe("refused");
        expect(runEditionCheck(modelType, buildDisableProviderUpdate())).toBe(
          "refused",
        );
      }
    },
  );

  test("a license that is valid lets everything through, so the payloads above are what make the difference", () => {
    installFakeEnterpriseModule();

    expect(EnterpriseEdition.isLoaded()).toBe(true);

    for (const [, modelType] of [...DISABLE_TARGETS, ...ROTATE_TARGETS]) {
      expect(runEditionCheck(modelType, { name: "Okta" })).toBe("allowed");
    }
  });
});

/*
 * The token is a secret: it must come from the browser's secure random number
 * generator. CodeQL flags Math.random for secrets; this keeps it out of the
 * code that builds these payloads at all.
 */
describe("the tighten-only UI code", () => {
  const TIGHTEN_ONLY_DIR: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "Dashboard",
    "SSO",
    "TightenOnly",
  );

  const SOURCE_FILE: RegExp = /\.tsx?$/;

  test("never uses Math.random or Common's UUID generator (which falls back to it)", () => {
    const files: Array<string> = fs
      .readdirSync(TIGHTEN_ONLY_DIR)
      .filter((name: string) => {
        return SOURCE_FILE.test(name);
      });

    expect(files).toContain("TightenOnlyUpdates.ts");

    for (const file of files) {
      const source: string = fs
        .readFileSync(path.join(TIGHTEN_ONLY_DIR, file), "utf8")
        // Comments may name what the code avoids.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

      expect(source).not.toMatch(/Math\.random/);
      expect(source).not.toMatch(/UUID\.generate|ObjectID\.generate/);
    }
  });
});
