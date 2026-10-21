import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color, { RGB } from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { parseColor } from "Common/Utils/ColorContrast";
import { ColorVision, simulateColorVision } from "Common/Utils/ColorVision";
import {
  HistoryChartBarColorRuleInput,
  NO_DATA_BAR_CLASS_NAME,
} from "Common/Utils/StatusPage/HistoryChartBarColors";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  BarColorPreviewEntry,
  BarColorPreviewEntryKind,
  formatUptimePercent,
  getLookAlikeEntryPairs,
  getRulePreviewEntries,
  getStatusPreviewEntries,
} from "./HistoryChartBarColorPreviewModel";
import StatusPageBrandingCopy from "./StatusPageBrandingCopy";

/*
 * Bar Color Preview, under a status page's bar color rules on its Branding
 * page (issue #486): every colour a day of the page's uptime history can
 * take, named, as most people see it and as people with red-green colour
 * blindness see it, and what is wrong with them.
 *
 * Nothing else on the page shows an operator what they cannot see for
 * themselves: the Operational green and Offline red the monitor statuses
 * start with look the same to about one man in twelve. With no rules, a
 * day's colour is its most severe status's, so the preview draws the
 * project's statuses, says how a day is coloured without rules, and offers
 * the recommended rules.
 */

export interface ComponentProps {
  projectId: ObjectID | null;
  // The page's rules, in their order, as the rules table loaded them; null before it has.
  rules: ReadonlyArray<HistoryChartBarColorRuleInput> | null;
  // What a day no rule matches is drawn in: the page's default bar color.
  fallbackColor?: Color | string | null | undefined;
  // Offered while the page has no rules.
  onUseRecommendedRules?: (() => void) | undefined;
  isAddingRecommendedRules?: boolean | undefined;
}

export const BAR_COLOR_PREVIEW_TEST_ID: string = "bar-color-preview";
export const BAR_COLOR_PREVIEW_SWATCH_TEST_ID: string =
  "bar-color-preview-swatch";
export const BAR_COLOR_PREVIEW_WARNING_TEST_ID: string =
  "bar-color-preview-warning";
export const BAR_COLOR_PREVIEW_NOTE_TEST_ID: string = "bar-color-preview-note";

interface PreviewVision {
  vision: ColorVision;
  label: string;
}

// The rows: as most people see the bars, then the two red-green kinds.
export const PREVIEW_VISIONS: ReadonlyArray<PreviewVision> = [
  { vision: ColorVision.Full, label: StatusPageBrandingCopy.fullColorVision },
  {
    vision: ColorVision.Deuteranopia,
    label: StatusPageBrandingCopy.deuteranopia,
  },
  { vision: ColorVision.Protanopia, label: StatusPageBrandingCopy.protanopia },
];

type SeenColorFunction = (color: Color, vision: ColorVision) => string;

// The colour as `vision` sees it, as a hex a style can take.
const getSeenColor: SeenColorFunction = (
  color: Color,
  vision: ColorVision,
): string => {
  const rgb: RGB | null = parseColor(color);

  if (!rgb) {
    return color.toString();
  }

  return Color.rgbToColor(simulateColorVision(rgb, vision))
    .toString()
    .toLowerCase();
};

const HistoryChartBarColorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hasRules: boolean = Boolean(props.rules && props.rules.length > 0);
  const isWithoutRules: boolean = Boolean(
    props.rules && props.rules.length === 0,
  );

  const [statuses, setStatuses] = useState<Array<MonitorStatus> | null>(null);
  const [statusError, setStatusError] = useState<string>("");

  // Without rules a day takes its status's colour: the statuses are what to preview.
  const fetchStatuses: () => Promise<void> = async (): Promise<void> => {
    if (!props.projectId) {
      return;
    }

    setStatusError("");

    try {
      const result: ListResult<MonitorStatus> =
        await ModelAPI.getList<MonitorStatus>({
          modelType: MonitorStatus,
          query: {
            projectId: props.projectId,
          },
          select: {
            name: true,
            color: true,
            priority: true,
          },
          sort: {
            priority: SortOrder.Ascending,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      setStatuses(result.data);
    } catch (err) {
      setStatusError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    if (isWithoutRules && statuses === null) {
      void fetchStatuses();
    }
  }, [isWithoutRules, props.projectId?.toString()]);

  type EntryLabelFunction = (entry: BarColorPreviewEntry) => string;

  const getEntryLabel: EntryLabelFunction = (
    entry: BarColorPreviewEntry,
  ): string => {
    if (entry.kind === BarColorPreviewEntryKind.NoData) {
      return (
        translator.translateText(StatusPageBrandingCopy.noData) ||
        StatusPageBrandingCopy.noData
      );
    }

    if (entry.kind === BarColorPreviewEntryKind.Status) {
      return entry.statusName || "";
    }

    const percent: number = entry.uptimePercent ?? 0;

    if (entry.kind === BarColorPreviewEntryKind.NoRuleMatches) {
      return translator.translateTemplate(
        StatusPageBrandingCopy.uptimeUnderPercent,
        { percent: formatUptimePercent(percent) },
      );
    }

    if (percent >= 100) {
      return `${formatUptimePercent(percent)}%`;
    }

    return translator.translateTemplate(
      StatusPageBrandingCopy.uptimePercentOrMore,
      { percent: formatUptimePercent(percent) },
    );
  };

  const getEntries: () => Array<BarColorPreviewEntry> | null =
    (): Array<BarColorPreviewEntry> | null => {
      if (!props.rules) {
        return null;
      }

      if (hasRules) {
        return getRulePreviewEntries({
          rules: props.rules,
          fallbackColor: props.fallbackColor,
        });
      }

      return statuses
        ? getStatusPreviewEntries(
            statuses.map((status: MonitorStatus) => {
              return {
                name: status.name,
                color: status.color,
                priority: status.priority,
              };
            }),
          )
        : null;
    };

  const getWarnings: (entries: Array<BarColorPreviewEntry>) => Array<string> = (
    entries: Array<BarColorPreviewEntry>,
  ): Array<string> => {
    const warnings: Array<string> = [];

    for (const [first, second] of getLookAlikeEntryPairs(entries)) {
      warnings.push(
        translator.translateTemplate(StatusPageBrandingCopy.lookAlike, {
          first: getEntryLabel(first),
          second: getEntryLabel(second),
        }),
      );
    }

    for (const entry of entries) {
      if (entry.isShadowed) {
        warnings.push(
          translator.translateTemplate(StatusPageBrandingCopy.shadowedRule, {
            percent: formatUptimePercent(entry.uptimePercent ?? 0),
          }),
        );
      }
    }

    return warnings;
  };

  const getNotes: (entries: Array<BarColorPreviewEntry>) => Array<string> = (
    entries: Array<BarColorPreviewEntry>,
  ): Array<string> => {
    const notes: Array<string> = [];

    if (isWithoutRules) {
      notes.push(
        translator.translateText(StatusPageBrandingCopy.withoutRules) ||
          StatusPageBrandingCopy.withoutRules,
      );
    }

    for (const entry of entries) {
      if (entry.kind === BarColorPreviewEntryKind.NoRuleMatches) {
        notes.push(
          translator.translateTemplate(StatusPageBrandingCopy.noRuleMatches, {
            percent: formatUptimePercent(entry.uptimePercent ?? 0),
          }),
        );
      }
    }

    return notes;
  };

  const getSwatches: (entries: Array<BarColorPreviewEntry>) => ReactElement = (
    entries: Array<BarColorPreviewEntry>,
  ): ReactElement => {
    return (
      /*
       * Scrolls sideways on a phone, or with many rules, rather than
       * squeezing the swatches; the names wrap so a long translation does
       * not push the swatches off the card.
       */
      <div className="overflow-x-auto">
        <table className="-mx-2 border-separate border-spacing-x-2 border-spacing-y-2">
          <thead>
            <tr>
              {/* The corner, above the row names. */}
              <td />
              {entries.map((entry: BarColorPreviewEntry) => {
                return (
                  <th
                    key={entry.key}
                    scope="col"
                    className="min-w-[3.25rem] max-w-[6.5rem] break-words align-bottom text-center text-xs font-medium text-gray-600"
                  >
                    {getEntryLabel(entry)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {PREVIEW_VISIONS.map((row: PreviewVision) => {
              return (
                <tr key={row.vision}>
                  <th
                    scope="row"
                    className="min-w-[6rem] max-w-[11rem] pr-2 text-left text-xs font-medium text-gray-500"
                  >
                    {translator.translateText(row.label) || row.label}
                  </th>
                  {entries.map((entry: BarColorPreviewEntry) => {
                    const isNoData: boolean =
                      entry.kind === BarColorPreviewEntryKind.NoData;

                    return (
                      <td key={entry.key} className="text-center">
                        <span
                          data-testid={BAR_COLOR_PREVIEW_SWATCH_TEST_ID}
                          data-vision={row.vision}
                          data-entry={entry.key}
                          aria-hidden="true"
                          className={`inline-block h-8 w-3 rounded-sm ring-1 ring-inset ring-black/10${
                            isNoData ? ` ${NO_DATA_BAR_CLASS_NAME}` : ""
                          }${entry.isShadowed ? " opacity-40" : ""}`}
                          style={{
                            backgroundColor: getSeenColor(
                              entry.color,
                              row.vision,
                            ),
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (statusError) {
      return (
        <ErrorMessage
          message={statusError}
          onRefreshClick={() => {
            void fetchStatuses();
          }}
        />
      );
    }

    const entries: Array<BarColorPreviewEntry> | null = getEntries();

    if (!entries) {
      return <ComponentLoader />;
    }

    const notes: Array<string> = getNotes(entries);
    const warnings: Array<string> = getWarnings(entries);

    return (
      <div className="space-y-4">
        {notes.map((note: string, index: number) => {
          return (
            <p
              key={`note-${index}`}
              className="text-sm text-gray-600"
              data-testid={BAR_COLOR_PREVIEW_NOTE_TEST_ID}
            >
              {note}
            </p>
          );
        })}

        {getSwatches(entries)}

        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((warning: string, index: number) => {
              return (
                <Alert
                  key={`warning-${index}`}
                  type={AlertType.WARNING}
                  title={warning}
                  dataTestId={BAR_COLOR_PREVIEW_WARNING_TEST_ID}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const buttons: Array<CardButtonSchema> =
    isWithoutRules && props.onUseRecommendedRules
      ? [
          {
            title: StatusPageBrandingCopy.useRecommendedRules,
            icon: IconProp.Swatch,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: props.isAddingRecommendedRules,
            onClick: (): void => {
              if (props.isAddingRecommendedRules) {
                return;
              }

              props.onUseRecommendedRules?.();
            },
          },
        ]
      : [];

  return (
    <Card
      title={StatusPageBrandingCopy.barColorPreviewTitle}
      description={StatusPageBrandingCopy.barColorPreviewDescription}
      buttons={buttons}
    >
      <div data-testid={BAR_COLOR_PREVIEW_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export default HistoryChartBarColorPreview;
