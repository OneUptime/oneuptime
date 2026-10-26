import AppLink from "../../AppLink/AppLink";
import {
  fetchCloudLinkSuggestions,
  linkCloudResourceToMonitor,
} from "../CloudLinkSuggestionsApi";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import { CloudEndpointSuggestion } from "Common/Types/Cloud/CloudEndpointMatch";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Under a monitor's Linked Resources: the cloud resources it seems to
 * check - those answering on its host, or on a name its host's DNS leads
 * to - that it is not linked to yet, each one Link away. Nothing is drawn
 * while there is nothing to suggest, or when the suggestions cannot be
 * read: a suggestion is a convenience, never a gap in the page.
 */

export interface ComponentProps {
  monitorId: ObjectID;
  // After a link: the card above reads the monitor again.
  onLinked: () => void;
}

const MonitorCloudLinkSuggestions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [suggestions, setSuggestions] = useState<
    Array<CloudEndpointSuggestion>
  >([]);
  const [linkingId, setLinkingId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new Monitor(),
    "cloudResources",
  );

  useEffect(() => {
    let ignore: boolean = false;

    fetchCloudLinkSuggestions(props.monitorId)
      .then((found: Array<CloudEndpointSuggestion>): void => {
        if (!ignore) {
          setSuggestions(found);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setSuggestions([]);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [props.monitorId.toString(), readCount]);

  if (suggestions.length === 0) {
    return <></>;
  }

  // Someone who may not change the links, and may not be told why: nothing to offer.
  if (!gate.isAllowed && !gate.disabledReason) {
    return <></>;
  }

  return (
    <div className="mt-6" data-testid="monitor-cloud-link-suggestions">
      <Card
        title="Suggested Cloud Resources"
        description="Cloud resources that answer on the host this monitor checks. Link one so its incidents and alerts are linked to it too."
      >
        <div>
          {error ? (
            <p className="mb-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : (
            <></>
          )}
          <ul className="divide-y divide-gray-100">
            {suggestions.map(
              (suggestion: CloudEndpointSuggestion): ReactElement => {
                const typeLabel: string = getCloudResourceTypeLabel(
                  suggestion.provider,
                  suggestion.type,
                );

                return (
                  <li
                    key={suggestion.cloudResourceId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <AppLink
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                          { modelId: new ObjectID(suggestion.cloudResourceId) },
                        )}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-700 break-all"
                      >
                        <span>
                          {suggestion.name || suggestion.cloudResourceId}
                        </span>
                      </AppLink>
                      {typeLabel ? (
                        <span className="ml-2 text-xs text-gray-500">
                          {typeLabel}
                        </span>
                      ) : (
                        <></>
                      )}
                      <p className="mt-0.5 text-xs text-gray-500 break-all">
                        {suggestion.via &&
                        suggestion.via !== suggestion.endpoint
                          ? translator.translateTemplate(
                              "{{via}} leads to {{endpoint}}, which it answers on.",
                              {
                                via: suggestion.via,
                                endpoint: suggestion.endpoint,
                              },
                            )
                          : translator.translateTemplate(
                              "It answers on {{endpoint}}.",
                              { endpoint: suggestion.endpoint },
                            )}
                      </p>
                    </div>
                    <Button
                      title="Link resource"
                      buttonStyle={ButtonStyleType.NORMAL}
                      isLoading={linkingId === suggestion.cloudResourceId}
                      disabled={!gate.isAllowed || Boolean(linkingId)}
                      tooltip={gate.isAllowed ? undefined : gate.disabledReason}
                      dataTestId={`link-cloud-resource-${suggestion.cloudResourceId}`}
                      onClick={() => {
                        setLinkingId(suggestion.cloudResourceId);
                        setError("");
                        linkCloudResourceToMonitor({
                          monitorId: props.monitorId,
                          cloudResourceId: suggestion.cloudResourceId,
                        })
                          .then((): void => {
                            setLinkingId("");
                            props.onLinked();
                            setReadCount((count: number): number => {
                              return count + 1;
                            });
                          })
                          .catch((err: unknown): void => {
                            setLinkingId("");
                            setError(API.getFriendlyMessage(err));
                          });
                      }}
                    />
                  </li>
                );
              },
            )}
          </ul>
        </div>
      </Card>
    </div>
  );
};

export default MonitorCloudLinkSuggestions;
