import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  ProjectAiDailyLimitValues,
  ProjectAiDailyUsage,
} from "Common/Types/AI/ProjectAiDailyLimits";
import { JSONObject } from "Common/Types/JSON";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { useEffect, useState } from "react";
import {
  getProjectAiAdvancedItems,
  getProjectAiAdvancedSummary,
  getProjectAiDailyLimitsFromItem,
  parseProjectAiDailyUsage,
} from "./ProjectAiSettingsCopy";

/*
 * What the folded More settings section of Project Settings → AI Features
 * says: the Daily limits card by name - a chip once a limit is set - and the
 * sentence of what applies and what AI used today (see
 * ProjectAiSettingsCopy).
 *
 * The limits come from the card itself, through onCardLoaded, when it first
 * reads and again after each save, so the sentence follows an edit at once.
 * Today's usage is asked for once, when the page opens (POST
 * /ai/daily-usage). It is extra: an answer that fails or is refused (a
 * member who may not read the AI Logs) leaves the sentence saying only what
 * applies.
 */

export interface ProjectAiDailyLimitsSection {
  items: Array<FoldedSectionItem>;
  summary: string | undefined;
  onCardLoaded: (item: Project) => void;
}

export const PROJECT_AI_DAILY_USAGE_ROUTE: string = "/ai/daily-usage";

const useProjectAiDailyLimits: () => ProjectAiDailyLimitsSection =
  (): ProjectAiDailyLimitsSection => {
    const translator: Translator = useTranslator();
    const [limits, setLimits] = useState<ProjectAiDailyLimitValues | null>(
      null,
    );
    const [usage, setUsage] = useState<ProjectAiDailyUsage | null>(null);

    useEffect(() => {
      let isCurrent: boolean = true;

      const loadUsage: () => Promise<void> = async (): Promise<void> => {
        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(APP_API_URL.toString()).addRoute(
                PROJECT_AI_DAILY_USAGE_ROUTE,
              ),
              data: {},
              headers: ModelAPI.getCommonHeaders(),
            });

          if (!isCurrent || response instanceof HTTPErrorResponse) {
            return;
          }

          const parsed: ProjectAiDailyUsage | null = parseProjectAiDailyUsage(
            response.data,
          );

          if (parsed) {
            setUsage(parsed);
          }
        } catch {
          // Usage is extra: the sentence still says what applies.
        }
      };

      loadUsage().catch(() => {
        // Already handled above.
      });

      return () => {
        isCurrent = false;
      };
    }, []);

    return {
      items: getProjectAiAdvancedItems(limits),
      summary: getProjectAiAdvancedSummary({
        limits,
        usage,
        isBillingEnabled: BILLING_ENABLED,
        translator,
      }),
      onCardLoaded: (item: Project): void => {
        setLimits(
          getProjectAiDailyLimitsFromItem({
            item: item as unknown as Record<string, unknown>,
            isBillingEnabled: BILLING_ENABLED,
          }),
        );
      },
    };
  };

export default useProjectAiDailyLimits;
