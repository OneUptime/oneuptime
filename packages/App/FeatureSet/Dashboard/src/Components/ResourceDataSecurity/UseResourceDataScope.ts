import DataSecurityApi from "../DataSecurity/DataSecurityApi";
import { DataSecurityResourceScope } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";

/*
 * THE DATA STORES OF ONE RESOURCE (#9547, #9555), as its menu and its Data
 * Security and Compliance pages read them (POST
 * /data-security/resource-scope): a cluster's or a container host's
 * databases' stores, a database's, a cloud resource's, a service's
 * telemetry.
 *
 * The menu is drawn on every page of the resource, and asks whether it has
 * any stores; the pages ask for them again. So one answer is kept per
 * resource for RESOURCE_SCOPE_KEEP_MS, shared by whoever asks meanwhile,
 * and a failed read is forgotten at once, so the next page asks again.
 */

export const RESOURCE_SCOPE_KEEP_MS: number = 60_000;

interface KeptScope {
  at: number;
  answer: Promise<DataSecurityResourceScope>;
}

const keptScopes: Map<string, KeptScope> = new Map();

function keyOf(kind: DataStoreResourceKind, id: ObjectID | string): string {
  return `${kind}:${id.toString().toLowerCase()}`;
}

// A resource's scope: the one kept, while it is young enough, or a new read.
export function readResourceScope(
  kind: DataStoreResourceKind,
  id: ObjectID,
  now: number = Date.now(),
): Promise<DataSecurityResourceScope> {
  const key: string = keyOf(kind, id);
  const kept: KeptScope | undefined = keptScopes.get(key);

  if (kept && now - kept.at < RESOURCE_SCOPE_KEEP_MS) {
    return kept.answer;
  }

  const answer: Promise<DataSecurityResourceScope> =
    DataSecurityApi.getResourceScope({ kind, id });

  keptScopes.set(key, { at: now, answer });

  answer.catch(() => {
    // A failed read is not kept: the next asker reads again.
    if (keptScopes.get(key)?.answer === answer) {
      keptScopes.delete(key);
    }
  });

  return answer;
}

// Forgets every kept scope: a change to a resource's stores, or a test.
export function forgetResourceScopes(): void {
  keptScopes.clear();
}

export interface ResourceDataScopeState {
  scope: DataSecurityResourceScope | null;
  isLoading: boolean;
  error: string;
}

/*
 * The resource's scope, read only while isEnabled (Data Security shown in
 * the resource's pages): a resource whose menu cannot show the section asks
 * nothing.
 */
const useResourceDataScope: (data: {
  kind: DataStoreResourceKind;
  modelId: ObjectID;
  isEnabled: boolean;
}) => ResourceDataScopeState = (data: {
  kind: DataStoreResourceKind;
  modelId: ObjectID;
  isEnabled: boolean;
}): ResourceDataScopeState => {
  const [state, setState] = useState<ResourceDataScopeState>({
    scope: null,
    isLoading: data.isEnabled,
    error: "",
  });

  useEffect(() => {
    if (!data.isEnabled) {
      setState({ scope: null, isLoading: false, error: "" });
      return () => {};
    }

    let isCurrent: boolean = true;

    setState((previous: ResourceDataScopeState): ResourceDataScopeState => {
      return { ...previous, isLoading: true, error: "" };
    });

    readResourceScope(data.kind, data.modelId)
      .then((scope: DataSecurityResourceScope) => {
        if (isCurrent) {
          setState({ scope, isLoading: false, error: "" });
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setState({
            scope: null,
            isLoading: false,
            error: API.getFriendlyMessage(err),
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [data.kind, data.modelId.toString(), data.isEnabled]);

  return state;
};

export default useResourceDataScope;
