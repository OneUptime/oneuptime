import ModelServiceHandler, {
  DocumentedPermission,
  getDocumentedPermissions,
} from "../../../FeatureSet/APIReference/Service/Model";
import ResourceUtil, {
  ModelDocumentation,
} from "../../../FeatureSet/APIReference/Utils/Resources";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { describe, expect, it, jest } from "@jest/globals";
import type * as Path from "path";

/*
 * A resource's page lists the permissions that allow each operation on it
 * (Service/Model.ts). A permission the permission catalogue has no entry
 * for - AuthenticatedRequest, which a File's create allows, has none by
 * design - reached the template as undefined, and /reference/en/file
 * answered 500; Google Search Console listed it as a server error.
 */

jest.mock("../../../FeatureSet/APIReference/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(
    __dirname,
    "../../../FeatureSet/APIReference",
  );
  return {
    ViewsPath: path.join(root, "views"),
    StaticPath: path.join(root, "Static"),
    CodeExamplesPath: path.join(root, "CodeExamples"),
  };
});

const OPERATIONS: Array<string> = ["read", "create", "update", "delete"];

describe("getDocumentedPermissions", () => {
  it("names a permission in the catalogue by its title and description", () => {
    expect(getDocumentedPermissions([Permission.CurrentUser])).toEqual([
      {
        permission: Permission.CurrentUser,
        title: PermissionHelper.getTitle(Permission.CurrentUser),
        description: PermissionHelper.getDescription(Permission.CurrentUser),
      },
    ]);
  });

  it("lists a grant the catalogue has no entry for by its key, rather than dropping it", () => {
    expect(
      getDocumentedPermissions([
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
        Permission.UnAuthorizedSsoUser,
      ]),
    ).toEqual([
      {
        permission: Permission.CurrentUser,
        title: PermissionHelper.getTitle(Permission.CurrentUser),
        description: PermissionHelper.getDescription(Permission.CurrentUser),
      },
      {
        permission: Permission.AuthenticatedRequest,
        title: "AuthenticatedRequest",
        description: "",
      },
      {
        permission: Permission.UnAuthorizedSsoUser,
        title: "UnAuthorizedSsoUser",
        description: "",
      },
    ]);
  });
});

describe("every resource's page", () => {
  it("lists each permission of each operation with a key and a title", async () => {
    const wrong: Array<string> = [];
    const resources: Array<ModelDocumentation> = ResourceUtil.getResources();

    for (const resource of resources) {
      let locals: Record<string, unknown> = {};

      const req: ExpressRequest = {
        params: { lang: "en", page: resource.path },
        originalUrl: `/reference/en/${resource.path}`,
        headers: {},
      } as unknown as ExpressRequest;

      const res: unknown = {
        status: (): unknown => {
          return res;
        },
        render: (
          _view: string,
          renderLocals: Record<string, unknown>,
        ): void => {
          locals = renderLocals;
        },
      };

      await ModelServiceHandler.executeResponse(req, res as ExpressResponse);

      const pageData: {
        tablePermissions?: Record<string, Array<DocumentedPermission>>;
      } = (locals["pageData"] || {}) as {
        tablePermissions?: Record<string, Array<DocumentedPermission>>;
      };

      for (const operation of OPERATIONS) {
        for (const entry of pageData.tablePermissions?.[operation] || []) {
          if (
            !entry ||
            !entry.permission ||
            !entry.title ||
            typeof entry.description !== "string"
          ) {
            wrong.push(
              `${resource.path} ${operation}: ${JSON.stringify(entry)}`,
            );
          }
        }
      }
    }

    expect(resources.length).toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  }, 300000);
});
