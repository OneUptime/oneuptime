import DataObservabilityApi from "./DataObservabilityApi";
import RecommendationDismissalUtil from "../Recommendations/RecommendationDismissalUtil";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import {
  DataObservabilitySourceOrigin,
  DataObservabilitySourceSuggestion,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  onConnect: (suggestion: DataObservabilitySourceSuggestion) => void;
  // Changes when a database was connected, so this list is read again.
  refreshToken?: number | undefined;
}

// Dismissals of suggested databases are kept per project.
const RESOURCE_TYPE: string = "Project";

const ORIGIN_TEXT: Readonly<Record<DataObservabilitySourceOrigin, string>> = {
  [DataObservabilitySourceOrigin.Traces]: "Seen in your traces",
  [DataObservabilitySourceOrigin.DatabaseMonitoring]:
    "Watched by Database Monitoring",
  [DataObservabilitySourceOrigin.CloudAccount]: "Found in your cloud account",
};

/*
 * The databases the project knows of that nobody has connected to Data
 * Observability, from its traces, its cloud accounts and Database Monitoring
 * (Server/Utils/DataObservability/DataSourceSuggestions). Connect starts the
 * form from what is known of the database; Dismiss keeps it from coming back.
 * With nothing to suggest, it shows nothing.
 */
const DataSourceSuggestionsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [suggestions, setSuggestions] = useState<
    Array<DataObservabilitySourceSuggestion>
  >([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const read: () => Promise<void> = async (): Promise<void> => {
      const [found, dismissals]: [
        Array<DataObservabilitySourceSuggestion>,
        Array<RecommendationDismissal>,
      ] = await Promise.all([
        DataObservabilityApi.getSourceSuggestions(),
        projectId
          ? RecommendationDismissalUtil.getDismissals({
              resourceType: RESOURCE_TYPE,
              resourceId: projectId,
              recommendationType: RecommendationType.DataSource,
            })
          : Promise.resolve([]),
      ]);
      const dismissed: Set<string> = new Set(
        dismissals.map((dismissal: RecommendationDismissal): string => {
          return dismissal.recommendationId || "";
        }),
      );

      if (isCurrent) {
        setSuggestions(
          found.filter((suggestion: DataObservabilitySourceSuggestion) => {
            return !dismissed.has(suggestion.id);
          }),
        );
      }
    };

    // Extra to the page it is on: when it cannot be read, the page carries on without it.
    read().catch(() => {
      if (isCurrent) {
        setSuggestions([]);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [props.refreshToken]);

  const dismiss: (
    suggestion: DataObservabilitySourceSuggestion,
  ) => Promise<void> = async (
    suggestion: DataObservabilitySourceSuggestion,
  ): Promise<void> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    setError("");

    try {
      await RecommendationDismissalUtil.dismiss({
        recommendationId: suggestion.id,
        recommendationType: RecommendationType.DataSource,
        resourceType: RESOURCE_TYPE,
        resourceId: projectId,
      });
      setSuggestions((previous: Array<DataObservabilitySourceSuggestion>) => {
        return previous.filter(
          (candidate: DataObservabilitySourceSuggestion) => {
            return candidate.id !== suggestion.id;
          },
        );
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  if (suggestions.length === 0 && !error) {
    return <></>;
  }

  return (
    <Card
      title="Databases You Could Connect"
      description="Your project already knows of these, and nobody has connected them. Nothing is read until you do."
    >
      <div className="px-6 pb-6">
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : <></>}
        <ul className="divide-y divide-gray-100">
          {suggestions.map(
            (suggestion: DataObservabilitySourceSuggestion): ReactElement => {
              return (
                <li
                  key={suggestion.id}
                  className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="truncate font-medium text-gray-900">
                      {suggestion.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {suggestion.kind ? `${suggestion.kind} · ` : ""}
                      {translator.translateText(ORIGIN_TEXT[suggestion.origin])}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      title="Connect"
                      buttonStyle={ButtonStyleType.NORMAL}
                      icon={IconProp.Add}
                      onClick={() => {
                        props.onConnect(suggestion);
                      }}
                    />
                    <Button
                      title="Dismiss"
                      buttonStyle={ButtonStyleType.OUTLINE}
                      icon={IconProp.Close}
                      onClick={() => {
                        void dismiss(suggestion);
                      }}
                    />
                  </div>
                </li>
              );
            },
          )}
        </ul>
      </div>
    </Card>
  );
};

export default DataSourceSuggestionsCard;
