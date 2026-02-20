import axios, { AxiosResponse } from "axios";
import { getServerUrl } from "../storage/serverUrl";

export interface SSOProvider {
  _id: string;
  name: string;
  description?: string;
  projectId: string;
  project?: {
    name: string;
  };
}

// OneUptime API serializes ObjectID fields as { _type: "ObjectID", value: "uuid" }.
// This helper extracts the plain string value.
function resolveId(
  field: string | { _type?: string; value?: string } | undefined,
): string {
  if (!field) {
    return "";
  }

  if (typeof field === "string") {
    return field;
  }

  if (typeof field === "object" && field.value) {
    return field.value;
  }

  return String(field);
}

interface RawSSOItem {
  _id: string | { _type?: string; value?: string };
  name?: string;
  description?: string;
  projectId?: string | { _type?: string; value?: string };
  project?: {
    _id?: string | { _type?: string; value?: string };
    name?: string;
  };
}

function parseSSOProvider(raw: RawSSOItem): SSOProvider {
  return {
    _id: resolveId(raw._id),
    name: raw.name || "",
    description: raw.description,
    projectId: resolveId(raw.projectId),
    project: raw.project?.name ? { name: raw.project.name } : undefined,
  };
}

export async function fetchSSOProviders(
  email: string,
): Promise<Array<SSOProvider>> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await axios.get(
    `${serverUrl}/identity/service-provider-login`,
    {
      params: { email },
      timeout: 15000,
    },
  );

  const items: Array<RawSSOItem> = response.data?.data || [];

  return items.map(parseSSOProvider);
}

export async function fetchSSOProvidersForProject(
  projectId: string,
): Promise<Array<SSOProvider>> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await axios.post(
    `${serverUrl}/api/project-sso/${projectId}/sso-list`,
    {},
    {
      timeout: 15000,
    },
  );

  const items: Array<RawSSOItem> = response.data?.data || [];

  return items.map((item: RawSSOItem) => {
    const parsed: SSOProvider = parseSSOProvider(item);
    // For project-specific endpoint, use the passed-in projectId
    parsed.projectId = projectId;
    return parsed;
  });
}
