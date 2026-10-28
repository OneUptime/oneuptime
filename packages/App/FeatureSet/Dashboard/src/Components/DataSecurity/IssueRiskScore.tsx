import { JSONArray, JSONObject } from "Common/Types/JSON";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW AN ISSUE'S RISK SCORE WAS WORKED OUT.
 *
 * The score orders issues inside a severity, from 0 to 100
 * (Types/DataSecurity/DataSecurityRisk): the severity's base, then what
 * makes the same misconfiguration worse on this store - how exposed it is,
 * how many records it holds, whether Security Operations saw activity on
 * it this week, and whether it is production. The server stores each part
 * with its points (riskFactors); this lists them, each with what it means,
 * the largest first, and a bar of how the score adds up.
 */

export interface IssueRiskFactor {
  label: string;
  points: number;
}

// The parts as stored: {label, points} each; anything else left out.
export function readIssueRiskFactors(value: unknown): Array<IssueRiskFactor> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as JSONArray)
    .filter((entry: unknown): entry is JSONObject => {
      return (
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      );
    })
    .map((entry: JSONObject): IssueRiskFactor => {
      return {
        label: typeof entry["label"] === "string" ? entry["label"] : "",
        points: typeof entry["points"] === "number" ? entry["points"] : 0,
      };
    })
    .filter((factor: IssueRiskFactor): boolean => {
      return Boolean(factor.label);
    });
}

const SEVERITY_SUFFIX: string = " severity";
const EXPOSURE_PREFIX: string = "Exposure: ";

const SEVERITY_FACTOR: string = translationKey("{{severity}} severity");
const EXPOSURE_FACTOR: string = translationKey("Exposure: {{exposure}}");

// What each part means, by the words the server labels it with.
const FACTOR_MEANINGS: Record<string, string> = {
  severity: translationKey(
    "How bad this failure is for data as sensitive as this store's.",
  ),
  exposure: translationKey(
    "Who can reach the store from outside your own accounts.",
  ),
  "Number of records it holds": translationKey(
    "More records mean more people harmed if it leaks.",
  ),
  "Security Operations saw activity on it this week": translationKey(
    "Security Operations saw detections on this store in the last week.",
  ),
  "Production store": translationKey(
    "It is a production store: the data is real.",
  ),
};

interface FactorWords {
  title: string;
  meaning: string;
}

const describeFactor: (
  factor: IssueRiskFactor,
  translator: Translator,
) => FactorWords = (
  factor: IssueRiskFactor,
  translator: Translator,
): FactorWords => {
  if (factor.label.endsWith(SEVERITY_SUFFIX)) {
    return {
      title: translator.translateTemplate(SEVERITY_FACTOR, {
        severity: translatableTerm(
          factor.label.slice(0, -SEVERITY_SUFFIX.length),
        ),
      }),
      meaning: translator.translateText(FACTOR_MEANINGS["severity"]) || "",
    };
  }

  if (factor.label.startsWith(EXPOSURE_PREFIX)) {
    return {
      title: translator.translateTemplate(EXPOSURE_FACTOR, {
        exposure: translatableTerm(factor.label.slice(EXPOSURE_PREFIX.length), {
          inSentence: true,
        }),
      }),
      meaning: translator.translateText(FACTOR_MEANINGS["exposure"]) || "",
    };
  }

  const meaning: string | undefined = FACTOR_MEANINGS[factor.label];

  return {
    title: translator.translateText(factor.label) || factor.label,
    meaning: meaning ? translator.translateText(meaning) || meaning : "",
  };
};

// The bar's colours, the largest part first.
const BAR_COLORS: Array<string> = [
  "bg-red-500",
  "bg-orange-400",
  "bg-amber-300",
  "bg-sky-400",
  "bg-indigo-300",
];

const SCORE_OUT_OF: string = translationKey("{{score}} out of 100");
const SCORE_CAPPED: string = translationKey(
  "The parts add up to more than 100, so the score stops at 100.",
);
const POINTS: string = translationKey("+{{points}}");
const NO_FACTORS: string = translationKey(
  "The score was worked out before its parts were recorded. It is recorded on the next check.",
);

export interface ComponentProps {
  score: number;
  factors: Array<IssueRiskFactor>;
}

const IssueRiskScore: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const factors: Array<IssueRiskFactor> = [...props.factors].sort(
    (a: IssueRiskFactor, b: IssueRiskFactor): number => {
      return b.points - a.points;
    },
  );
  const total: number = factors.reduce(
    (sum: number, factor: IssueRiskFactor): number => {
      return sum + Math.max(0, factor.points);
    },
    0,
  );

  return (
    <div className="space-y-4" data-testid="data-security-issue-risk-score">
      <p className="text-sm text-gray-500">
        <TranslatedSentence
          template={SCORE_OUT_OF}
          slots={{
            score: (
              <span className="me-1 text-3xl font-semibold tabular-nums text-gray-900">
                {translator.formatNumber(props.score)}
              </span>
            ),
          }}
        />
      </p>

      {total > 0 ? (
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100"
          aria-hidden="true"
        >
          {factors.map(
            (factor: IssueRiskFactor, index: number): ReactElement => {
              const width: number =
                (Math.max(0, factor.points) / Math.max(100, total)) * 100;

              return (
                <div
                  key={`${index}-${factor.label}`}
                  className={BAR_COLORS[index % BAR_COLORS.length]}
                  style={{ width: `${width}%` }}
                />
              );
            },
          )}
        </div>
      ) : (
        <></>
      )}

      {factors.length === 0 ? (
        <p className="text-sm text-gray-500">
          {translator.translateText(NO_FACTORS)}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {factors.map(
            (factor: IssueRiskFactor, index: number): ReactElement => {
              const words: FactorWords = describeFactor(factor, translator);

              return (
                <li
                  key={`${index}-${factor.label}`}
                  className="flex items-start justify-between gap-4 py-2.5"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                        BAR_COLORS[index % BAR_COLORS.length]
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        {words.title}
                      </div>
                      {words.meaning ? (
                        <div className="text-sm text-gray-500">
                          {words.meaning}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                  <span className="flex-none text-sm font-semibold tabular-nums text-gray-900">
                    {translator.translateTemplate(POINTS, {
                      points: translator.formatNumber(factor.points),
                    })}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      )}

      {total > 100 ? (
        <p className="text-xs text-gray-500">
          {translator.translateText(SCORE_CAPPED)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default IssueRiskScore;
