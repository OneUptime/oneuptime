import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  DROP_FILTER_IMPACT_API_PATHS,
  DropFilterImpact,
  DropFilterImpactAction,
  DropFilterImpactRequest,
  readDropFilterImpact,
} from "Common/Types/Telemetry/DropFilterImpact";
import {
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
} from "Common/Types/Telemetry/DropFilterSampling";
import { TelemetryFieldSignal } from "Common/Types/Telemetry/TelemetryFieldReaders";
import { normalizeFormValue } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT A DROP OR SAMPLE FILTER WOULD TAKE, ASKED OF THE SERVER (#10436).
 *
 * The form's preview, its question before a save and a filter's Enable ask
 * here (Server/API/DropFilterImpactAPI), with the filter as the form or the
 * row holds it, through the refresh-aware client with the project's
 * headers. The answer is read defensively (readDropFilterImpact), and kept
 * a minute by the question: the preview on each step and the question at
 * the end ask once, and a filter edited back to what it was is not asked
 * again.
 */

// A filter as a form or a saved row holds it.
export interface DropFilterImpactRule {
  filterQuery?: unknown;
  action?: unknown;
  samplePercentage?: unknown;
  name?: unknown;
}

// How long an answer is kept.
export const DROP_FILTER_IMPACT_CACHE_MS: number = 60 * 1000;

// How many answers are kept.
const MAX_CACHED_ANSWERS: number = 50;

interface CachedAnswer {
  at: number;
  answer: Promise<DropFilterImpact>;
}

const answers: Map<string, CachedAnswer> = new Map<string, CachedAnswer>();

function readText(value: unknown): string {
  const normalized: unknown = normalizeFormValue(value);

  return typeof normalized === "string" ? normalized : "";
}

function readNumber(value: unknown): number | null {
  const normalized: unknown = normalizeFormValue(value);
  const number: number =
    typeof normalized === "number"
      ? normalized
      : typeof normalized === "string" && normalized.trim()
        ? Number(normalized)
        : Number.NaN;

  return Number.isFinite(number) ? number : null;
}

/*
 * The question to ask for a filter, or null when there is none to ask: no
 * query yet, or a sample with no share to keep - the form says what is
 * missing there.
 */
export function getDropFilterImpactRequest(
  signal: TelemetryFieldSignal,
  rule: DropFilterImpactRule,
): DropFilterImpactRequest | null {
  const filterQuery: string = readText(rule.filterQuery).trim();

  if (!filterQuery) {
    return null;
  }

  const action: DropFilterImpactAction =
    readText(rule.action) === DropFilterImpactAction.Sample
      ? DropFilterImpactAction.Sample
      : DropFilterImpactAction.Drop;
  const request: DropFilterImpactRequest = { signal, filterQuery, action };

  if (action === DropFilterImpactAction.Sample) {
    const samplePercentage: number | null = readNumber(rule.samplePercentage);

    if (
      samplePercentage === null ||
      samplePercentage < MIN_SAMPLE_PERCENTAGE ||
      samplePercentage > MAX_SAMPLE_PERCENTAGE
    ) {
      return null;
    }

    request.samplePercentage = samplePercentage;
  }

  const name: string = readText(rule.name).trim();

  if (name) {
    request.name = name;
  }

  return request;
}

export function getDropFilterImpactRequestKey(
  request: DropFilterImpactRequest,
): string {
  return JSON.stringify([
    request.signal,
    request.filterQuery,
    request.action,
    request.samplePercentage ?? null,
    request.name || "",
  ]);
}

export default class DropFilterImpactApi {
  public static async getImpact(
    request: DropFilterImpactRequest,
  ): Promise<DropFilterImpact> {
    const key: string = getDropFilterImpactRequestKey(request);
    const now: number = Date.now();
    const cached: CachedAnswer | undefined = answers.get(key);

    if (cached && now - cached.at < DROP_FILTER_IMPACT_CACHE_MS) {
      return await cached.answer;
    }

    const answer: Promise<DropFilterImpact> = DropFilterImpactApi.ask(request);

    answers.set(key, { at: now, answer });

    // A failed answer is asked again next time.
    answer.catch(() => {
      answers.delete(key);
    });

    while (answers.size > MAX_CACHED_ANSWERS) {
      const oldest: string | undefined = answers.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      answers.delete(oldest);
    }

    return await answer;
  }

  // Forget every answer: a filter saved changes what the next one says.
  public static forgetAnswers(): void {
    answers.clear();
  }

  private static async ask(
    request: DropFilterImpactRequest,
  ): Promise<DropFilterImpact> {
    const body: JSONObject = {
      filterQuery: request.filterQuery,
      action: request.action,
    };

    if (request.samplePercentage !== undefined) {
      body["samplePercentage"] = request.samplePercentage;
    }

    if (request.name) {
      body["name"] = request.name;
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          DROP_FILTER_IMPACT_API_PATHS[request.signal],
        ),
        data: body,
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    return readDropFilterImpact(response.data);
  }
}
