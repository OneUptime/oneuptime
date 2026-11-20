import AppLink from "../../AppLink/AppLink";
import { getWidgetTypeBadgeText } from "../../Dashboard/Toolbar/WidgetCatalog";
import { getMetricRecordingRulesRoute } from "../RecordingRule/RecordingRulesRoute";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IsolatedTextList from "Common/UI/Components/IsolatedText/IsolatedTextList";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT READS A METRIC, LISTED THE ONE WAY (#10107).
 *
 * Two dialogs say what reads a metric before it goes: Drop This Metric (a
 * metric pipeline rule that drops it at ingest) and Remove on a cloud
 * resource's More Metrics (an added metric the connection stops reading).
 * Both ask the server's one lookup (Telemetry/MetricReaders), and both list
 * the answer here, so they look and behave alike:
 *
 *  - kind by kind - monitors, dashboards, SLOs, recording rules - each under
 *    its title, with the line its dialog says of what happens to it;
 *  - each record the reader may open as a link to it - a recording rule,
 *    which has no page, to its list filtered to the metric it writes - the
 *    first MAX_METRIC_READERS_SHOWN, then "and N more";
 *  - a dashboard with the widgets on it that read the metric: by title as
 *    written, or by kind when untitled ("Chart"), the first
 *    MAX_READER_WIDGETS_SHOWN, then "and N more";
 *  - the ones the reader may not open counted, never named: "and 2 more you
 *    can't see" after the ones they can, or "3 SLOs you can't see";
 *  - and, where its dialog words it, that a kind could not be checked.
 *
 * Each dialog says what is its own: the line of each kind, and any line of
 * one record (a cloud addition's reader of every resource, #10078).
 */

// How many records of each kind are named; the rest are counted.
export const MAX_METRIC_READERS_SHOWN: number = 5;
// How many of a dashboard's widgets are named under it; the rest are counted.
export const MAX_READER_WIDGETS_SHOWN: number = 5;

export enum MetricReaderListKind {
  Monitor = "monitor",
  Dashboard = "dashboard",
  Slo = "slo",
  RecordingRule = "recordingRule",
}

// A record that reads the metric, as the list names it.
export interface MetricReaderListReader {
  id: string;
  // As its person named it; "" when it has none.
  name: string;
  // A dashboard's widgets that read it, in their order on it.
  widgets?: Array<{ title: string; type: string }> | undefined;
  // A recording rule's: the metric it writes, which finds it in its list.
  outputMetricName?: string | undefined;
  // A line of its own under its link, already in the reader's words.
  note?: string | undefined;
}

// What a dialog says of one kind.
export interface MetricReaderListKindWords {
  // What taking the metric away does to them, said plainly.
  consequence: string;
  // That they could not be read just now; none to leave it to the dialog.
  unchecked?: string | undefined;
}

export interface MetricReaderListGroup {
  kind: MetricReaderListKind;
  readers: Array<MetricReaderListReader>;
  // How many more read it that the reader may not open.
  hidden: number;
  // False when the records of the kind could not be read just now.
  isChecked: boolean;
  words: MetricReaderListKindWords;
  dataTestId: string;
}

export interface ComponentProps {
  // The kinds, in the order they are listed: one of no reader is left out.
  groups: Array<MetricReaderListGroup>;
  // Under a dashboard, the line that names its widgets.
  widgetsDataTestId?: string | undefined;
  // A widget with no title, of a kind the catalog does not know.
  untitledWidget?: string | undefined;
}

const TITLES: Record<MetricReaderListKind, string> = {
  [MetricReaderListKind.Monitor]: translationKey("Monitors"),
  [MetricReaderListKind.Dashboard]: translationKey("Dashboards"),
  [MetricReaderListKind.Slo]: translationKey("SLOs"),
  [MetricReaderListKind.RecordingRule]: translationKey("Recording Rules"),
};

// How many of a kind read it when the reader can see none of them.
const ONLY_HIDDEN: Record<MetricReaderListKind, PluralTemplate> = {
  [MetricReaderListKind.Monitor]: {
    one: "{{count}} monitor you can't see",
    other: "{{count}} monitors you can't see",
  },
  [MetricReaderListKind.Dashboard]: {
    one: "{{count}} dashboard you can't see",
    other: "{{count}} dashboards you can't see",
  },
  [MetricReaderListKind.Slo]: {
    one: "{{count}} SLO you can't see",
    other: "{{count}} SLOs you can't see",
  },
  [MetricReaderListKind.RecordingRule]: {
    one: "{{count}} recording rule you can't see",
    other: "{{count}} recording rules you can't see",
  },
};

const MORE: PluralTemplate = {
  one: "and {{count}} more",
  other: "and {{count}} more",
};
const MORE_HIDDEN: PluralTemplate = {
  one: "and {{count}} more you can't see",
  other: "and {{count}} more you can't see",
};
const UNTITLED: string = translationKey("Untitled");

const VIEW_PAGES: Record<
  Exclude<MetricReaderListKind, MetricReaderListKind.RecordingRule>,
  PageMap
> = {
  [MetricReaderListKind.Monitor]: PageMap.MONITOR_VIEW,
  [MetricReaderListKind.Dashboard]: PageMap.DASHBOARD_VIEW,
  [MetricReaderListKind.Slo]: PageMap.SLO_VIEW,
};

// A reader's page: a recording rule has none, so its list, filtered to the metric it writes.
export function getMetricReaderRoute(
  kind: MetricReaderListKind,
  reader: Pick<MetricReaderListReader, "id" | "outputMetricName">,
): Route {
  if (kind === MetricReaderListKind.RecordingRule) {
    return getMetricRecordingRulesRoute(reader.outputMetricName || undefined);
  }

  return RouteUtil.populateRouteParams(RouteMap[VIEW_PAGES[kind]] as Route, {
    modelId: new ObjectID(reader.id),
  });
}

// Whether a group lists anything: a reader the person can open, or one they cannot.
export function isMetricReaderGroupShown(
  group: MetricReaderListGroup,
): boolean {
  return group.readers.length > 0 || group.hidden > 0;
}

/*
 * A dashboard's widgets that read it, under its link: each by its title as
 * written, or by its kind when it has none, the first few named and the
 * rest counted.
 */
const WidgetsOfDashboard: FunctionComponent<{
  widgets: Array<{ title: string; type: string }>;
  untitledWidget: string;
  dataTestId?: string | undefined;
}> = (props: {
  widgets: Array<{ title: string; type: string }>;
  untitledWidget: string;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.widgets.length === 0) {
    return <></>;
  }

  const shown: Array<{ title: string; type: string }> = props.widgets.slice(
    0,
    MAX_READER_WIDGETS_SHOWN,
  );
  const more: number = props.widgets.length - shown.length;
  const texts: Array<string | ReactElement> = shown.map(
    (widget: { title: string; type: string }, index: number) => {
      return (
        widget.title || (
          <span key={`untitled-${index}`} className="italic">
            {getWidgetTypeBadgeText(widget.type, translator) ||
              translator.translateText(props.untitledWidget)}
          </span>
        )
      );
    },
  );

  if (more > 0) {
    texts.push(
      <span key="more">{translator.translatePlural(MORE, more)}</span>,
    );
  }

  return (
    <IsolatedTextList
      className="block text-xs text-gray-500 [overflow-wrap:anywhere]"
      dataTestId={props.dataTestId}
      texts={texts}
    />
  );
};

/*
 * The records of one kind that read it: what taking it away does to them,
 * then each the reader may open as a link - a dashboard with its widgets
 * under it - and how many more there are that they may not see, never named.
 */
const ReadersOfKind: FunctionComponent<{
  group: MetricReaderListGroup;
  widgetsDataTestId?: string | undefined;
  untitledWidget: string;
}> = (props: {
  group: MetricReaderListGroup;
  widgetsDataTestId?: string | undefined;
  untitledWidget: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const group: MetricReaderListGroup = props.group;

  if (!isMetricReaderGroupShown(group)) {
    return <></>;
  }

  const shown: Array<MetricReaderListReader> = group.readers.slice(
    0,
    MAX_METRIC_READERS_SHOWN,
  );
  const more: number = group.readers.length - shown.length;

  return (
    <div data-testid={group.dataTestId}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(TITLES[group.kind])}
      </div>
      <p className="mt-0.5 text-gray-600">
        {translator.translateText(group.words.consequence)}
      </p>
      <ul className="mt-1 space-y-1">
        {shown.map((reader: MetricReaderListReader): ReactElement => {
          return (
            <li key={reader.id}>
              <AppLink
                className="font-medium text-indigo-600 hover:underline [overflow-wrap:anywhere]"
                to={getMetricReaderRoute(group.kind, reader)}
              >
                {reader.name || reader.id}
              </AppLink>
              <WidgetsOfDashboard
                widgets={reader.widgets || []}
                untitledWidget={props.untitledWidget}
                dataTestId={props.widgetsDataTestId}
              />
              {reader.note ? (
                <span
                  className="block text-xs text-gray-500"
                  data-testid={`${group.dataTestId}-note`}
                >
                  {reader.note}
                </span>
              ) : (
                <></>
              )}
            </li>
          );
        })}
        {more > 0 ? (
          <li className="text-gray-500">
            {translator.translatePlural(MORE, more)}
          </li>
        ) : (
          <></>
        )}
        {group.hidden > 0 ? (
          <li
            className="text-gray-500"
            data-testid={`${group.dataTestId}-hidden`}
          >
            {translator.translatePlural(
              shown.length > 0 ? MORE_HIDDEN : ONLY_HIDDEN[group.kind],
              group.hidden,
            )}
          </li>
        ) : (
          <></>
        )}
      </ul>
    </div>
  );
};

const MetricReadersList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const untitledWidget: string = props.untitledWidget || UNTITLED;

  return (
    <>
      {props.groups.map((group: MetricReaderListGroup): ReactElement => {
        return (
          <ReadersOfKind
            key={group.dataTestId}
            group={group}
            widgetsDataTestId={props.widgetsDataTestId}
            untitledWidget={untitledWidget}
          />
        );
      })}
      {props.groups
        .filter((group: MetricReaderListGroup): boolean => {
          return !group.isChecked && Boolean(group.words.unchecked);
        })
        .map((group: MetricReaderListGroup): ReactElement => {
          return (
            <p
              key={`${group.dataTestId}-unchecked`}
              className="text-gray-600"
              data-testid={`${group.dataTestId}-unchecked`}
            >
              {translator.translateText(group.words.unchecked!)}
            </p>
          );
        })}
    </>
  );
};

export default MetricReadersList;
