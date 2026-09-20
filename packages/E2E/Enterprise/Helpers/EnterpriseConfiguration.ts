import {
  ApiResult,
  sendWithRetry,
} from "../../Tests/Dashboard/Helpers/ApiRequest";
import {
  JSONish,
  listItems,
} from "../../Tests/Dashboard/Helpers/MonitorAlerting";
import { enterpriseUrl } from "./LicenseState";
import { APIResponse, Page } from "@playwright/test";

/*
 * Writing ENTERPRISE CONFIGURATION over the ordinary CRUD API - the sharpest
 * assertion a licence makes on a plain REST route.
 *
 * Models marked requiresEnterprise (project/global/status-page SSO, OIDC and
 * SCIM, team compliance) can always be read and deleted, but creating or
 * changing one needs an active licence: Common/Server/Types/Database/
 * Permissions/EditionPermission.ts asks EnterpriseEdition, which throws
 * PaymentRequired with one of two different messages - one for "this build has
 * no Enterprise Edition at all" and one for "it has one, but the licence does
 * not cover this". Both come back as 402, so the STATUS alone cannot tell a
 * Community image from a lapsed licence; the message can, which is why both
 * fragments are exported here and each suite asserts its own.
 *
 * What this proves that the jest suites cannot: that the rule survives the
 * whole real stack - the session the sign-up flow created, nginx, the API
 * layer, the permission pipeline and the licence snapshot in a booted
 * process - rather than a direct call to the permission check.
 */

// Common/Models/DatabaseModels/ProjectSCIM.ts: name, projectId, bearerToken.
export const PROJECT_SCIM_API_PATH: string = "/api/project-scim";

/*
 * Copied from packages/Common/Server/Enterprise/EnterpriseEdition.ts rather
 * than imported: nothing in core (this package included) may import ee/, and
 * these two constants are the only part of that file this suite needs. A
 * distinctive first clause is enough to pin which refusal came back.
 */
export const COMMUNITY_EDITION_MESSAGE_FRAGMENT: string =
  "This is a OneUptime Enterprise Edition feature and is not available in the Community Edition.";

export const LICENSE_REQUIRED_MESSAGE_FRAGMENT: string =
  "This OneUptime Enterprise feature needs a valid Enterprise license that includes it.";

export interface EnterpriseWriteResult {
  status: number;
  // The raw body, so a caller can assert which refusal it is.
  body: string;
  /*
   * The created row's id when the API echoes one. It is EMPTY for ProjectSCIM:
   * verified against a booted stack, both the create response and a
   * get-list that selects `_id` come back with the row's columns but no key
   * for a project-owner session. So these suites address the row by the unique
   * name they gave it (isProjectScimListed) and never by id.
   */
  id: string;
}

type ReadCreatedIdFunction = (body: string) => string;

const readCreatedId: ReadCreatedIdFunction = (body: string): string => {
  try {
    const parsed: Record<string, unknown> = JSON.parse(body) as Record<
      string,
      unknown
    >;
    const data: Record<string, unknown> =
      (parsed["data"] as Record<string, unknown>) || parsed;
    const id: unknown = data["_id"];

    if (typeof id === "string") {
      return id;
    }

    if (id && typeof id === "object") {
      return String((id as Record<string, unknown>)["value"] || "");
    }

    return "";
  } catch {
    return "";
  }
};

type CreateProjectScimFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
  bearerToken?: string | undefined;
}) => Promise<EnterpriseWriteResult>;

/*
 * Creates a project SCIM configuration as the signed-in project owner and
 * returns the RAW outcome - never asserting success, because the Lapsed and
 * Community suites call this expecting a 402 with their own message.
 *
 * ProjectSCIM is the enterprise configuration model that needs the least
 * fixture data: a name, the project and a bearer token. A ProjectSSO would
 * need an issuer, a sign-on URL and a certificate.
 */
export const createProjectScim: CreateProjectScimFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
  bearerToken?: string | undefined;
}): Promise<EnterpriseWriteResult> => {
  const url: string = enterpriseUrl(PROJECT_SCIM_API_PATH);

  const result: ApiResult = await sendWithRetry({
    send: (): Promise<APIResponse> => {
      return data.page.request.post(url, {
        headers: {
          "content-type": "application/json",
          tenantid: data.projectId,
          projectid: data.projectId,
        },
        data: {
          data: {
            name: data.name,
            projectId: data.projectId,
            bearerToken:
              data.bearerToken ||
              `e2e-scim-${Math.random().toString(36).slice(2)}`,
          },
        },
      });
    },
  });

  return {
    status: result.status,
    body: result.text,
    id: readCreatedId(result.text),
  };
};

type IsProjectScimListedFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
}) => Promise<boolean>;

/*
 * Whether this project still lists a SCIM configuration with that exact name.
 *
 * Reading enterprise configuration is never licence-gated - an administrator
 * must be able to see what is configured, and nothing is ever deleted - so
 * both suites use this: the Licensed one to show the row it created is really
 * there, the Lapsed one to show the lapse kept it.
 *
 * By name, not by id, because the API does not hand a project-owner session
 * the row's key (see EnterpriseWriteResult.id). Each run's name carries a
 * random suffix, so it identifies one row.
 */
export const isProjectScimListed: IsProjectScimListedFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
}): Promise<boolean> => {
  const rows: Array<JSONish> = await listItems({
    page: data.page,
    projectId: data.projectId,
    path: PROJECT_SCIM_API_PATH,
    query: { projectId: data.projectId },
    select: {
      name: true,
    },
  });

  return rows.some((row: JSONish): boolean => {
    return String(row["name"] || "") === data.name;
  });
};
