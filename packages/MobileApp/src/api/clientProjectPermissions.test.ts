import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import {
  clearAllProjectPermissions,
  getProjectPermissionRows,
} from "./projectPermissions";
import apiClient from "./client";
import {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The API client keeps the person's permission rows from every answer
 * about a project (api/projectPermissions).
 *
 * The server writes them on every answer to a request that names a project
 * in its `tenantid` header - UserAuthorization sets `project-permissions`
 * unless the request sent the hash of the snapshot it already has, which
 * the app never does - and on a refusal too, which passes through the same
 * middleware first. This file drives the REAL interceptors in
 * src/api/client.ts with a custom `config.adapter`, as clientSsoDenial does:
 * nothing is re-implemented and no socket is opened.
 */

const PROJECT_A: string = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B: string = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function snapshot(projectId: string, permission: string): string {
  return JSON.stringify({
    _type: "UserTenantAccessPermission",
    projectId: { _type: "ObjectID", value: projectId },
    permissions: [
      {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        scope: "All",
        isBlockPermission: false,
      },
    ],
  });
}

function adapterFor(data: {
  status: number;
  headers: Record<string, string>;
}): (config: InternalAxiosRequestConfig) => Promise<AxiosResponse> {
  return (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response: AxiosResponse = {
      data: {},
      status: data.status,
      statusText: String(data.status),
      headers: data.headers,
      config,
    } as AxiosResponse;

    if (data.status >= 200 && data.status < 300) {
      return Promise.resolve(response);
    }

    return Promise.reject(
      new AxiosError(
        `Request failed with status code ${data.status}`,
        String(data.status),
        config,
        undefined,
        response,
      ),
    );
  };
}

async function call(data: {
  status: number;
  headers: Record<string, string>;
  tenantId?: string;
}): Promise<void> {
  const config: AxiosRequestConfig = {
    adapter: adapterFor({ status: data.status, headers: data.headers }),
  };

  if (data.tenantId !== undefined) {
    config.headers = { tenantid: data.tenantId };
  }

  try {
    await apiClient.get("/api/on-call-duty-policy-user-override", config);
  } catch {
    // A refusal is part of what is under test.
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearTokens();
  await setServerUrl("https://oneuptime.test");
  clearAllProjectPermissions();
});

afterEach(() => {
  clearAllProjectPermissions();
});

describe("the API client keeps the permission rows each answer carries", () => {
  test("an answer about a project leaves that project's rows", async () => {
    await call({
      status: 200,
      tenantId: PROJECT_A,
      headers: { "project-permissions": snapshot(PROJECT_A, "OnCallMember") },
    });

    expect(getProjectPermissionRows(PROJECT_A)?.[0]?.permission).toBe(
      "OnCallMember",
    );
    expect(getProjectPermissionRows(PROJECT_B)).toBeNull();
  });

  test("a refusal about a project leaves them too", async () => {
    await call({
      status: 400,
      tenantId: PROJECT_B,
      headers: { "project-permissions": snapshot(PROJECT_B, "OnCallAdmin") },
    });

    expect(getProjectPermissionRows(PROJECT_B)?.[0]?.permission).toBe(
      "OnCallAdmin",
    );
  });

  test("an answer to a request that names no project keeps nothing", async () => {
    await call({
      status: 200,
      headers: { "project-permissions": snapshot(PROJECT_A, "OnCallMember") },
    });

    expect(getProjectPermissionRows(PROJECT_A)).toBeNull();

    // The control: the same answer, about the project, is kept.
    await call({
      status: 200,
      tenantId: PROJECT_A,
      headers: { "project-permissions": snapshot(PROJECT_A, "OnCallMember") },
    });

    expect(getProjectPermissionRows(PROJECT_A)).toHaveLength(1);
  });

  test("an answer without the header leaves what was kept", async () => {
    await call({
      status: 200,
      tenantId: PROJECT_A,
      headers: { "project-permissions": snapshot(PROJECT_A, "OnCallMember") },
    });
    await call({ status: 200, tenantId: PROJECT_A, headers: {} });

    expect(getProjectPermissionRows(PROJECT_A)?.[0]?.permission).toBe(
      "OnCallMember",
    );
  });
});
