import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ServiceCodeRepository from "Common/Models/DatabaseModels/ServiceCodeRepository";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

// Shape returned by GET /service-code-repository/suggest-links.
interface SuggestedLink {
  serviceId: string;
  serviceName: string;
  codeRepositoryId: string;
  codeRepositoryName: string;
  repositoryFullName: string;
  reason: string;
  score: number;
}

export interface ComponentProps {
  /*
   * Exactly one of these two ids is passed — it scopes the suggestions to
   * one side (the repository page or the service page).
   */
  codeRepositoryId?: ObjectID | undefined;
  serviceId?: ObjectID | undefined;
  onLinked: () => void;
}

const SuggestedServiceRepoLinks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [suggestions, setSuggestions] = useState<Array<SuggestedLink>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [linkError, setLinkError] = useState<string>("");
  // Key ("<serviceId>:<codeRepositoryId>") of the suggestion being linked.
  const [linkInFlightKey, setLinkInFlightKey] = useState<string | null>(null);

  type GetSuggestionKeyFunction = (suggestion: SuggestedLink) => string;

  const getSuggestionKey: GetSuggestionKeyFunction = (
    suggestion: SuggestedLink,
  ): string => {
    return `${suggestion.serviceId}:${suggestion.codeRepositoryId}`;
  };

  type FetchSuggestionsFunction = () => Promise<void>;

  const fetchSuggestions: FetchSuggestionsFunction =
    async (): Promise<void> => {
      try {
        setIsLoading(true);

        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/service-code-repository/suggest-links",
        );

        if (props.serviceId) {
          url.addQueryParam("serviceId", props.serviceId.toString());
        }

        if (props.codeRepositoryId) {
          url.addQueryParam(
            "codeRepositoryId",
            props.codeRepositoryId.toString(),
          );
        }

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: url,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const items: JSONArray =
          (response.data?.["suggestions"] as JSONArray) || [];

        setSuggestions(
          items.map((item: JSONObject): SuggestedLink => {
            return {
              serviceId: (item["serviceId"] as string) || "",
              serviceName: (item["serviceName"] as string) || "",
              codeRepositoryId: (item["codeRepositoryId"] as string) || "",
              codeRepositoryName: (item["codeRepositoryName"] as string) || "",
              repositoryFullName: (item["repositoryFullName"] as string) || "",
              reason: (item["reason"] as string) || "",
              score: (item["score"] as number) || 0,
            };
          }),
        );
      } catch {
        // Suggestions are supplementary — stay silent if they can't be fetched.
        setSuggestions([]);
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchSuggestions().catch(() => {
      // Already handled inside fetchSuggestions.
    });
  }, []);

  type LinkSuggestionFunction = (suggestion: SuggestedLink) => Promise<void>;

  const linkSuggestion: LinkSuggestionFunction = async (
    suggestion: SuggestedLink,
  ): Promise<void> => {
    const suggestionKey: string = getSuggestionKey(suggestion);

    setLinkError("");
    setLinkInFlightKey(suggestionKey);

    try {
      const serviceCodeRepository: ServiceCodeRepository =
        new ServiceCodeRepository();
      serviceCodeRepository.serviceId = new ObjectID(suggestion.serviceId);
      serviceCodeRepository.codeRepositoryId = new ObjectID(
        suggestion.codeRepositoryId,
      );
      serviceCodeRepository.projectId = ProjectUtil.getCurrentProjectId()!;

      await ModelAPI.create<ServiceCodeRepository>({
        model: serviceCodeRepository,
        modelType: ServiceCodeRepository,
      });

      setSuggestions((current: Array<SuggestedLink>): Array<SuggestedLink> => {
        return current.filter((item: SuggestedLink): boolean => {
          return getSuggestionKey(item) !== suggestionKey;
        });
      });

      props.onLinked();
    } catch (err) {
      setLinkError(API.getFriendlyMessage(err));
    }

    setLinkInFlightKey(null);
  };

  // Silent by default — render nothing while loading, dismissed, or empty.
  if (isDismissed || isLoading || suggestions.length === 0) {
    return <Fragment />;
  }

  const inFlightSuggestion: SuggestedLink | undefined = suggestions.find(
    (item: SuggestedLink): boolean => {
      return getSuggestionKey(item) === linkInFlightKey;
    },
  );

  return (
    <Card
      title="Suggested links"
      description="These services and repositories look like they belong together, based on their names."
      rightElement={
        <Button
          title="Hide suggestions"
          icon={IconProp.Close}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            setIsDismissed(true);
          }}
        />
      }
    >
      <div>
        {linkError && (
          <Alert
            type={AlertType.DANGER}
            strongTitle="Could not link"
            title={linkError}
            onClose={() => {
              setLinkError("");
            }}
          />
        )}
        <div className="divide-y divide-gray-100">
          {suggestions.map((suggestion: SuggestedLink): ReactElement => {
            const suggestionKey: string = getSuggestionKey(suggestion);
            const isThisLinking: boolean = linkInFlightKey === suggestionKey;
            /*
             * While one link for a service is in flight, hold back the other
             * buttons for that same service so the user can't race two
             * creates for it.
             */
            const isBlocked: boolean = Boolean(
              linkInFlightKey &&
                !isThisLinking &&
                inFlightSuggestion &&
                inFlightSuggestion.serviceId === suggestion.serviceId,
            );

            return (
              <div
                key={suggestionKey}
                className="flex items-center justify-between py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center text-sm font-medium text-gray-900">
                    <span className="truncate">{suggestion.serviceName}</span>
                    <Icon
                      icon={IconProp.Link}
                      className="h-4 w-4 mx-2 text-gray-400 flex-shrink-0"
                    />
                    <span className="truncate">
                      {suggestion.repositoryFullName}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {suggestion.reason}
                  </div>
                </div>
                <div className="ml-4 flex-shrink-0">
                  <Button
                    title="Link"
                    buttonStyle={ButtonStyleType.OUTLINE}
                    buttonSize={ButtonSize.Small}
                    isLoading={isThisLinking}
                    disabled={isBlocked}
                    onClick={() => {
                      linkSuggestion(suggestion).catch(() => {
                        // Already handled inside linkSuggestion.
                      });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

export default SuggestedServiceRepoLinks;
