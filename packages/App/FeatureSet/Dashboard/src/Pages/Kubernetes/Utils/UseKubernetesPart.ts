import { useEffect, useState } from "react";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  KubernetesPartRead,
  parseKubernetesPartRead,
} from "./KubernetesPartFacts";

/*
 * An object's own page reads it with what it runs, once as it opens and
 * again when the page refreshes: POST /kubernetes-resource/part/:clusterId
 * (KubernetesResourceService.getPart). The hero, Needs attention and the
 * Pods tab all read this one answer, so they never disagree.
 */

export async function fetchKubernetesPart(data: {
  clusterId: ObjectID;
  kind: string;
  name: string;
  namespace?: string | undefined;
}): Promise<KubernetesPartRead> {
  const url: URL = URL.fromString(APP_API_URL.toString())
    .addRoute("/kubernetes-resource/part/")
    .addRoute(data.clusterId.toString());

  const body: JSONObject = { kind: data.kind, name: data.name };
  if (data.namespace) {
    body["namespace"] = data.namespace;
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: url,
      data: body,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseKubernetesPartRead(response.data);
}

export interface KubernetesPartState {
  read: KubernetesPartRead | null;
  isLoading: boolean;
  error: string;
}

export default function useKubernetesPart(data: {
  clusterId: ObjectID;
  kind: string;
  name: string;
  namespace?: string | undefined;
  // Read again when this changes (the page's refresh).
  refreshToken?: number | undefined;
}): KubernetesPartState {
  const [state, setState] = useState<KubernetesPartState>({
    read: null,
    isLoading: true,
    error: "",
  });

  useEffect(() => {
    let ignore: boolean = false;

    setState((previous: KubernetesPartState): KubernetesPartState => {
      return { ...previous, isLoading: true };
    });

    fetchKubernetesPart({
      clusterId: data.clusterId,
      kind: data.kind,
      name: data.name,
      namespace: data.namespace,
    })
      .then((read: KubernetesPartRead) => {
        if (!ignore) {
          setState({ read: read, isLoading: false, error: "" });
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          // A failed read keeps what the page showed, and says why.
          setState((previous: KubernetesPartState): KubernetesPartState => {
            return {
              read: previous.read,
              isLoading: false,
              error: API.getFriendlyMessage(err),
            };
          });
        }
      });

    return () => {
      ignore = true;
    };
  }, [
    data.clusterId.toString(),
    data.kind,
    data.name,
    data.namespace || "",
    data.refreshToken,
  ]);

  return state;
}
