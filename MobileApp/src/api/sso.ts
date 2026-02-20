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

  const data: { data: Array<SSOProvider> } = response.data;

  return data.data || [];
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

  const items: Array<{ _id: string; name: string; description?: string }> =
    response.data?.data || [];

  return items.map(
    (item: { _id: string; name: string; description?: string }) => {
      return {
        _id: item._id,
        name: item.name,
        description: item.description,
        projectId: projectId,
      };
    },
  );
}
