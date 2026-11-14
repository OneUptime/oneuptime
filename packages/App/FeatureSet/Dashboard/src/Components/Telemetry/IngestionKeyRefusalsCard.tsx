import TelemetryIngestionKeyRefusal from "Common/Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import Route from "Common/Types/API/Route";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { getInlineSeparator } from "Common/Types/Translator";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AppLink from "../AppLink/AppLink";
import {
  INGEST_REFUSAL_SELECT,
  IngestRefusalFact,
  toIngestRefusalFacts,
} from "./IngestRefusalFacts";
import { getIngestRefusalFixRoute } from "./IngestRefusalRoutes";
import {
  INGEST_REFUSAL_FIXES,
  INGEST_REFUSAL_FIX_LABELS,
  IngestRefusalFix,
  REFUSALS_CHECK_AGAIN,
  REFUSALS_DESCRIPTION,
  REFUSALS_FAILED,
  REFUSALS_LOADING,
  REFUSALS_LOOKBACK_DAYS,
  REFUSALS_NONE,
  REFUSALS_TITLE,
  getIngestRefusalCountText,
  getIngestRefusalReasonLabel,
  getIngestSurfaceLabel,
  isIngestRefusalRecent,
} from "./IngestRefusalWords";

/*
 * Settings > Ingestion Keys > a key > REFUSED TELEMETRY (issue
 * #6378): what the ingest endpoints turned away from this key in the past
 * 30 days - why, where, how many and when - so "is anything sending with
 * this key, and is it getting through?" has its answer beside Last Used At.
 *
 * One line per reason and endpoint, the latest first, headed by the reason
 * in a few words (the page is the key's: its name would only repeat). A
 * line refused in the past day is drawn as a problem, an older one as
 * history. A reason the project's settings put right (its budgets, a
 * payment method) links there; the key's own settings are on this page.
 */

export interface ComponentProps {
  ingestionKeyId: ObjectID;
}

// The fixes this page links to: the key's own settings are on it already.
const LINKED_FIXES: ReadonlySet<IngestRefusalFix> = new Set<IngestRefusalFix>([
  "budgets",
  "billing",
]);

export async function fetchIngestionKeyRefusals(data: {
  ingestionKeyId: ObjectID;
  now: Date;
}): Promise<Array<IngestRefusalFact>> {
  const result: ListResult<TelemetryIngestionKeyRefusal> =
    await ModelAPI.getList<TelemetryIngestionKeyRefusal>({
      modelType: TelemetryIngestionKeyRefusal,
      query: {
        telemetryIngestionKeyId: data.ingestionKeyId,
        lastRefusedAt: new GreaterThanOrEqual<Date>(
          OneUptimeDate.addRemoveDays(data.now, -REFUSALS_LOOKBACK_DAYS),
        ),
      },
      select: INGEST_REFUSAL_SELECT,
      sort: { lastRefusedAt: SortOrder.Descending },
      limit: 50,
      skip: 0,
    });

  return toIngestRefusalFacts(result.data);
}

const IngestionKeyRefusalsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [refusals, setRefusals] = useState<Array<IngestRefusalFact> | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);
  const [checkedAt, setCheckedAt] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );
  const keyId: string = props.ingestionKeyId.toString();

  useEffect(() => {
    let isCurrent: boolean = true;
    const now: Date = OneUptimeDate.getCurrentDate();

    setIsLoading(true);

    fetchIngestionKeyRefusals({
      ingestionKeyId: new ObjectID(keyId),
      now,
    })
      .then((facts: Array<IngestRefusalFact>) => {
        if (!isCurrent) {
          return;
        }

        setRefusals(facts);
        setFailed(false);
        setCheckedAt(now);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isCurrent) {
          return;
        }

        setFailed(true);
        setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [keyId, reloadToken]);

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  let body: ReactElement;

  if (failed && !refusals) {
    body = (
      <div
        className="flex items-start gap-2 text-sm text-gray-900"
        data-testid="ingestion-key-refusals-failed"
      >
        <Icon
          icon={IconProp.MinusCircle}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span>{translate(REFUSALS_FAILED)}</span>
      </div>
    );
  } else if (!refusals) {
    body = (
      <div
        className="flex items-start gap-2 text-sm text-gray-500"
        data-testid="ingestion-key-refusals-loading"
      >
        <Icon
          icon={IconProp.Clock}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span>{translate(REFUSALS_LOADING)}</span>
      </div>
    );
  } else if (refusals.length === 0) {
    body = (
      <div
        className="flex items-start gap-2 text-sm text-gray-900"
        data-testid="ingestion-key-refusals-none"
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
        />
        <span>{translate(REFUSALS_NONE)}</span>
      </div>
    );
  } else {
    const separator: string = getInlineSeparator(translator.language);

    body = (
      <ul
        className="divide-y divide-gray-100"
        aria-label={translate(REFUSALS_TITLE)}
      >
        {refusals.map((refusal: IngestRefusalFact): ReactElement => {
          const fix: IngestRefusalFix | null =
            INGEST_REFUSAL_FIXES[refusal.reason];
          const linkedFix: IngestRefusalFix | null =
            fix && LINKED_FIXES.has(fix) ? fix : null;
          const route: Route | null = linkedFix
            ? getIngestRefusalFixRoute({ fix: linkedFix, keyId: refusal.keyId })
            : null;
          const isRecent: boolean = isIngestRefusalRecent(refusal, checkedAt);

          return (
            <li
              key={`${refusal.reason}-${refusal.surface}`}
              className="flex min-w-0 items-start gap-2 py-3 first:pt-0 last:pb-0"
              data-testid="ingestion-key-refusal"
              data-reason={refusal.reason}
              data-surface={refusal.surface}
              data-recent={isRecent ? "true" : "false"}
            >
              <Icon
                icon={IconProp.Error}
                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                  isRecent ? "text-red-600" : "text-gray-400"
                }`}
              />
              <div className="min-w-0">
                <div
                  className="break-words text-sm font-medium text-gray-900"
                  data-testid="ingestion-key-refusal-reason"
                >
                  {getIngestRefusalReasonLabel(refusal.reason, translator)}
                </div>
                <div
                  className="mt-0.5 break-words text-sm text-gray-500"
                  data-testid="ingestion-key-refusal-detail"
                >
                  <span>
                    {getIngestSurfaceLabel(refusal.surface, translator)}
                  </span>
                  <span aria-hidden={true}>{separator}</span>
                  <span>
                    {getIngestRefusalCountText(refusal, translator, checkedAt)}
                  </span>
                </div>
                {route && linkedFix ? (
                  <AppLink
                    to={route}
                    className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                    dataTestId="ingestion-key-refusal-action"
                  >
                    <span>
                      {translate(INGEST_REFUSAL_FIX_LABELS[linkedFix])}
                    </span>
                    <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
                  </AppLink>
                ) : (
                  <></>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div data-testid="ingestion-key-refusals" aria-busy={isLoading}>
      <Card
        title={REFUSALS_TITLE}
        description={REFUSALS_DESCRIPTION}
        buttons={[
          {
            title: REFUSALS_CHECK_AGAIN,
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: isLoading,
            onClick: () => {
              setReloadToken((value: number): number => {
                return value + 1;
              });
            },
          },
        ]}
      >
        {body}
      </Card>
    </div>
  );
};

export default IngestionKeyRefusalsCard;
