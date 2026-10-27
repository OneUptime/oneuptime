import AppLink from "../../AppLink/AppLink";
import {
  fetchCloudLinkSuggestions,
  getCloudLinkSuggestionReason,
  linkCloudResourceToMonitor,
} from "../CloudLinkSuggestionsApi";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import { CloudEndpointSuggestion } from "Common/Types/Cloud/CloudEndpointMatch";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  Translator,
  translateNamedAction,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * At the foot of a monitor's Linked Resources card: the cloud resources it
 * seems to check - those answering on its host, or on a name its host's DNS
 * points to - that it is not linked to yet, each one press away. They sit
 * under what it is linked to (or under "Not linked to anything yet"), in
 * the same card, set apart by a rule and a dashed box each: offered, not
 * linked. Nothing is drawn while there is nothing to suggest, or when the
 * suggestions cannot be read: a suggestion is a convenience, never a gap in
 * the page.
 */

export const MONITOR_CLOUD_LINK_SUGGESTIONS_TEST_ID: string =
  "monitor-cloud-link-suggestions";

export interface ComponentProps {
  monitorId: ObjectID;
  // After a link: the card it sits in reads the monitor again.
  onLinked: () => void;
}

const MonitorCloudLinkSuggestions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const titleId: string = useId();
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
    <section
      className="mt-4 border-t border-gray-100 pt-4"
      data-testid={MONITOR_CLOUD_LINK_SUGGESTIONS_TEST_ID}
      aria-labelledby={titleId}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-50">
          <Icon
            icon={IconProp.LightBulb}
            className="h-3.5 w-3.5 text-amber-600"
          />
        </div>
        <h3 id={titleId} className="text-sm font-medium text-gray-900">
          {translator.translateText("Suggested Cloud Resources")}
        </h3>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {translator.translateText(
          "Cloud resources that answer on the host this monitor checks. Link one so its incidents and alerts are linked to it too.",
        )}
      </p>
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <></>
      )}
      <ul className="mt-3 space-y-2">
        {suggestions.map(
          (suggestion: CloudEndpointSuggestion): ReactElement => {
            const typeLabel: string = getCloudResourceTypeLabel(
              suggestion.provider,
              suggestion.type,
            );
            const name: string = suggestion.name || suggestion.cloudResourceId;
            const reason: string = getCloudLinkSuggestionReason(
              translator,
              suggestion,
            );

            return (
              <li
                key={suggestion.cloudResourceId}
                className="min-w-0 rounded-lg border border-dashed border-gray-300 px-3 py-2.5"
                data-testid="monitor-cloud-link-suggestion"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <Icon
                    icon={IconProp.Cloud}
                    className="h-4 w-4 shrink-0 text-gray-400"
                  />
                  <AppLink
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                      { modelId: new ObjectID(suggestion.cloudResourceId) },
                    )}
                    className="min-w-0 truncate text-sm font-medium text-gray-900 hover:underline"
                  >
                    <span title={name}>{name}</span>
                  </AppLink>
                </div>
                {typeLabel ? (
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {typeLabel}
                  </p>
                ) : (
                  <></>
                )}
                {/*
                 * Why it is offered, on up to two lines: the monitor's host,
                 * and the name it points to, which a load balancer's makes
                 * long - cut only past that, the whole line on hover.
                 */}
                <p
                  className="mt-0.5 line-clamp-2 text-xs text-gray-500 [overflow-wrap:anywhere]"
                  title={reason}
                  data-testid="monitor-cloud-link-suggestion-reason"
                >
                  {reason}
                </p>
                {/*
                 * Button keeps a dialog footer's left margin from md up; here
                 * it starts where the text above it does.
                 */}
                <div className="mt-2 [&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
                  <Button
                    title="Link resource"
                    icon={IconProp.Link}
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    ariaLabel={translateNamedAction(translator, {
                      template: "Link {{itemName}}",
                      itemName: name,
                    })}
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
                </div>
              </li>
            );
          },
        )}
      </ul>
    </section>
  );
};

export default MonitorCloudLinkSuggestions;
