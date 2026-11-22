import AppLink from "../../AppLink/AppLink";
import { getDashboardWidgetRoute } from "../../Dashboard/DashboardWidgetRoute";
import { getWidgetTypeBadgeText } from "../../Dashboard/Toolbar/WidgetCatalog";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityEventsFieldNeed,
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldPart,
  TelemetryFieldRead,
  TelemetryFieldReader,
  TelemetryFieldReaderKind,
  TelemetryFieldReaderList,
  TelemetryFieldReaders,
  TelemetryFieldReadersOfKind,
  TelemetryFieldReaderWidget,
  TelemetryFieldUse,
} from "Common/Types/Telemetry/TelemetryFieldReaders";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import IsolatedTextList from "Common/UI/Components/IsolatedText/IsolatedTextList";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT READS A LOG'S OR A SPAN'S FIELDS, LISTED THE ONE WAY (#10433).
 *
 * Before a scrub rule hides values - made by Scrub It, written in the
 * rule form, or turned on - the page lists what reads them, from the
 * server's one lookup (Server/Utils/Telemetry/TelemetryFieldReaders), as
 * MetricReadersList lists what reads a metric:
 *
 *  - kind by kind - monitors, dashboards, saved views, recording rules,
 *    SLOs - each under its title, with what the rule does to them;
 *  - each record the reader may open as a link to it, with what of the
 *    field it reads ("Filters on user.email", "Groups by client.address"),
 *    the first MAX_FIELD_READERS_SHOWN, then "and N more"; a dashboard with
 *    its widgets that read it, each opening the board at the widget;
 *  - the ones the reader may not open counted, never named;
 *  - Security Events, which reads the records themselves, and what the
 *    rule would take from it: the address to block, or who signed in;
 *  - and that a kind could not be checked.
 *
 * With nothing that reads them, it draws nothing: a page says no more.
 */

// How many records of each kind are named; the rest are counted.
export const MAX_FIELD_READERS_SHOWN: number = 5;
// How many of a dashboard's widgets are named under it; the rest are counted.
export const MAX_FIELD_READER_WIDGETS_SHOWN: number = 5;

export const FIELD_READERS_HEADING: string = translationKey(
  "These read values this rule would hide. From now on they get what the rule leaves in their place:",
);

const TITLES: Record<TelemetryFieldReaderKind, string> = {
  [TelemetryFieldReaderKind.Monitor]: translationKey("Monitors"),
  [TelemetryFieldReaderKind.Dashboard]: translationKey("Dashboards"),
  [TelemetryFieldReaderKind.SavedView]: translationKey("Saved Views"),
  [TelemetryFieldReaderKind.RecordingRule]: translationKey("Recording Rules"),
  [TelemetryFieldReaderKind.ServiceLevelObjective]: translationKey("SLOs"),
};

// What the rule does to each kind, said plainly.
export const FIELD_READER_CONSEQUENCES: Record<
  TelemetryFieldReaderKind,
  string
> = {
  [TelemetryFieldReaderKind.Monitor]: translationKey(
    "A filter on these values stops matching, and the monitor can go quiet. A group by them no longer shows the real values.",
  ),
  [TelemetryFieldReaderKind.Dashboard]: translationKey(
    "The widgets named under each stop finding new data by these values, or no longer show the real values.",
  ),
  [TelemetryFieldReaderKind.SavedView]: translationKey(
    "They stop finding new records by these values.",
  ),
  [TelemetryFieldReaderKind.RecordingRule]: translationKey(
    "They stop writing points for these values, or write them without the real values.",
  ),
  [TelemetryFieldReaderKind.ServiceLevelObjective]: translationKey(
    "Their filters on these values stop matching new requests: an SLO can count none, or count good requests as failed.",
  ),
};

export const FIELD_READER_UNCHECKED: Record<TelemetryFieldReaderKind, string> =
  {
    [TelemetryFieldReaderKind.Monitor]: translationKey(
      "Whether a monitor reads these values could not be checked.",
    ),
    [TelemetryFieldReaderKind.Dashboard]: translationKey(
      "Whether a dashboard reads these values could not be checked.",
    ),
    [TelemetryFieldReaderKind.SavedView]: translationKey(
      "Whether a saved view reads these values could not be checked.",
    ),
    [TelemetryFieldReaderKind.RecordingRule]: translationKey(
      "Whether a recording rule reads these values could not be checked.",
    ),
    [TelemetryFieldReaderKind.ServiceLevelObjective]: translationKey(
      "Whether an SLO reads these values could not be checked.",
    ),
  };

// How many of a kind read it when the reader can see none of them.
export const FIELD_READERS_ONLY_HIDDEN: Record<
  TelemetryFieldReaderKind,
  PluralTemplate
> = {
  [TelemetryFieldReaderKind.Monitor]: {
    one: "{{count}} monitor you can't see",
    other: "{{count}} monitors you can't see",
  },
  [TelemetryFieldReaderKind.Dashboard]: {
    one: "{{count}} dashboard you can't see",
    other: "{{count}} dashboards you can't see",
  },
  [TelemetryFieldReaderKind.SavedView]: {
    one: "{{count}} saved view you can't see",
    other: "{{count}} saved views you can't see",
  },
  [TelemetryFieldReaderKind.RecordingRule]: {
    one: "{{count}} recording rule you can't see",
    other: "{{count}} recording rules you can't see",
  },
  [TelemetryFieldReaderKind.ServiceLevelObjective]: {
    one: "{{count}} SLO you can't see",
    other: "{{count}} SLOs you can't see",
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

// What a reader reads of an attribute, by how: its key in the sentence's slot.
export const FIELD_READ_OF_KEY: Record<TelemetryFieldUse, string> = {
  [TelemetryFieldUse.Filter]: translationKey("Filters on {{key}}"),
  [TelemetryFieldUse.Search]: translationKey("Searches {{key}}"),
  [TelemetryFieldUse.GroupBy]: translationKey("Groups by {{key}}"),
  [TelemetryFieldUse.Value]: translationKey("Aggregates {{key}}"),
};

// What a reader reads of a part that has no key: a log's body, a span's name.
export const FIELD_READ_OF_PART: Partial<Record<TelemetryFieldPart, string>> = {
  [TelemetryFieldPart.Body]: translationKey("Searches the log body"),
  [TelemetryFieldPart.SpanName]: translationKey("Reads the span name"),
  [TelemetryFieldPart.StatusMessage]: translationKey(
    "Searches the status message",
  ),
  [TelemetryFieldPart.Events]: translationKey("Searches exception messages"),
};

export const SECURITY_EVENTS_TITLE: string = translationKey("Security Events");

// What a rule would take from Security Events, which reads the records themselves.
export const SECURITY_EVENTS_LOSSES: Record<SecurityEventsFieldNeed, string> = {
  [SecurityEventsFieldNeed.ClientAddresses]: translationKey(
    "It reads the address each attack comes from in these records. With the addresses hidden, its events can't name the address to block.",
  ),
  [SecurityEventsFieldNeed.UserNames]: translationKey(
    "It reads who signs in from these records. With the names hidden, it can count different users as one, so per-user rules misfire.",
  ),
};

export const SECURITY_EVENTS_UNCHECKED: string = translationKey(
  "Whether Security Events reads these records could not be checked.",
);

// The list a saved view or a recording rule is in, after its name.
const LIST_WORDS: Record<TelemetryFieldReaderList, string> = {
  [TelemetryFieldReaderList.Logs]: translationKey("Logs"),
  [TelemetryFieldReaderList.Traces]: translationKey("Traces"),
  [TelemetryFieldReaderList.Exceptions]: translationKey("Exceptions"),
};

const EXPLORER_PAGES: Record<TelemetryFieldReaderList, PageMap> = {
  [TelemetryFieldReaderList.Logs]: PageMap.LOGS,
  [TelemetryFieldReaderList.Traces]: PageMap.TRACES,
  [TelemetryFieldReaderList.Exceptions]: PageMap.EXCEPTIONS,
};

const RECORDING_RULE_PAGES: Partial<Record<TelemetryFieldReaderList, PageMap>> =
  {
    [TelemetryFieldReaderList.Logs]: PageMap.LOGS_SETTINGS_RECORDING_RULES,
    [TelemetryFieldReaderList.Traces]: PageMap.TRACES_SETTINGS_RECORDING_RULES,
  };

/*
 * A reader's page: a monitor's, a dashboard's or an SLO's own page; a saved
 * view its explorer opened at it; a recording rule its list. Null when the
 * answer does not say which list.
 */
export function getFieldReaderRoute(
  kind: TelemetryFieldReaderKind,
  reader: Pick<TelemetryFieldReader, "id" | "list">,
): Route | null {
  switch (kind) {
    case TelemetryFieldReaderKind.Monitor:
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_VIEW] as Route,
        { modelId: new ObjectID(reader.id) },
      );
    case TelemetryFieldReaderKind.Dashboard:
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.DASHBOARD_VIEW] as Route,
        { modelId: new ObjectID(reader.id) },
      );
    case TelemetryFieldReaderKind.ServiceLevelObjective:
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.SLO_VIEW] as Route,
        { modelId: new ObjectID(reader.id) },
      );
    case TelemetryFieldReaderKind.SavedView:
      return reader.list
        ? new Route(
            RouteUtil.populateRouteParams(
              RouteMap[EXPLORER_PAGES[reader.list]] as Route,
            ).toString(),
          ).addQueryParams({ savedView: reader.id })
        : null;
    case TelemetryFieldReaderKind.RecordingRule: {
      const page: PageMap | undefined = reader.list
        ? RECORDING_RULE_PAGES[reader.list]
        : undefined;

      return page
        ? RouteUtil.populateRouteParams(RouteMap[page] as Route)
        : null;
    }
    default:
      return null;
  }
}

// Whether a kind lists anything: a reader the person can open, or one they cannot.
export function isFieldReaderKindShown(
  ofKind: TelemetryFieldReadersOfKind,
): boolean {
  return ofKind.readers.length > 0 || ofKind.hiddenCount > 0;
}

// Whether the list draws anything: a reader, Security Events' loss, or a kind not checked.
export function isFieldReadersListShown(
  readers: TelemetryFieldReaders,
): boolean {
  return (
    TELEMETRY_FIELD_READER_KINDS.some((kind: TelemetryFieldReaderKind) => {
      return (
        isFieldReaderKindShown(readers.kinds[kind]) ||
        !readers.kinds[kind].isChecked
      );
    }) ||
    readers.securityEvents.loses.length > 0 ||
    !readers.securityEvents.isChecked
  );
}

// What a reader reads of the field, one phrase each, the key drawn as code.
const FieldReads: FunctionComponent<{
  reads: Array<TelemetryFieldRead>;
}> = (props: { reads: Array<TelemetryFieldRead> }): ReactElement => {
  const translator: Translator = useTranslator();
  const texts: Array<string | ReactElement> = [];

  props.reads.forEach((read: TelemetryFieldRead, index: number): void => {
    if (read.key) {
      texts.push(
        <TranslatedSentence
          key={`read-${index}`}
          template={FIELD_READ_OF_KEY[read.use]}
          slots={{
            key: (
              <code className="rounded bg-gray-100 px-1 font-mono text-xs text-gray-700 [overflow-wrap:anywhere]">
                {read.key}
              </code>
            ),
          }}
        />,
      );
      return;
    }

    const phrase: string | undefined = FIELD_READ_OF_PART[read.part];

    if (phrase) {
      texts.push(translator.translateText(phrase) || phrase);
    }
  });

  if (texts.length === 0) {
    return <></>;
  }

  return (
    <IsolatedTextList
      className="block text-xs text-gray-500 [overflow-wrap:anywhere]"
      dataTestId="telemetry-field-reader-reads"
      texts={texts}
    />
  );
};

// A dashboard's widgets that read it, each opening the board at the widget.
const WidgetsOfDashboard: FunctionComponent<{
  dashboardId: string;
  widgets: Array<TelemetryFieldReaderWidget>;
}> = (props: {
  dashboardId: string;
  widgets: Array<TelemetryFieldReaderWidget>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.widgets.length === 0) {
    return <></>;
  }

  const shown: Array<TelemetryFieldReaderWidget> = props.widgets.slice(
    0,
    MAX_FIELD_READER_WIDGETS_SHOWN,
  );
  const more: number = props.widgets.length - shown.length;
  const texts: Array<string | ReactElement> = shown.map(
    (widget: TelemetryFieldReaderWidget, index: number): ReactElement => {
      return (
        <AppLink
          key={`widget-${index}`}
          className="text-indigo-600 hover:underline [overflow-wrap:anywhere]"
          to={getDashboardWidgetRoute({
            dashboardId: props.dashboardId,
            widgetId: widget.id,
          })}
        >
          {widget.title ? (
            <IsolatedText text={widget.title} />
          ) : (
            <span className="italic">
              {getWidgetTypeBadgeText(widget.type, translator) ||
                translator.translateText(UNTITLED)}
            </span>
          )}
        </AppLink>
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
      dataTestId="telemetry-field-reader-widgets"
      texts={texts}
    />
  );
};

const ReadersOfKind: FunctionComponent<{
  kind: TelemetryFieldReaderKind;
  ofKind: TelemetryFieldReadersOfKind;
}> = (props: {
  kind: TelemetryFieldReaderKind;
  ofKind: TelemetryFieldReadersOfKind;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (!isFieldReaderKindShown(props.ofKind)) {
    return <></>;
  }

  const shown: Array<TelemetryFieldReader> = props.ofKind.readers.slice(
    0,
    MAX_FIELD_READERS_SHOWN,
  );
  const more: number = props.ofKind.readers.length - shown.length;
  const dataTestId: string = `telemetry-field-readers-${props.kind}`;

  return (
    <div data-testid={dataTestId}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(TITLES[props.kind])}
      </div>
      <p className="mt-0.5 text-gray-600">
        {translator.translateText(FIELD_READER_CONSEQUENCES[props.kind])}
      </p>
      <ul className="mt-1 space-y-1">
        {shown.map((reader: TelemetryFieldReader): ReactElement => {
          const route: Route | null = getFieldReaderRoute(props.kind, reader);
          const name: string = reader.name || reader.id;

          return (
            <li key={reader.id} data-testid={`${dataTestId}-reader`}>
              {route ? (
                <AppLink
                  className="font-medium text-indigo-600 hover:underline [overflow-wrap:anywhere]"
                  to={route}
                >
                  {name}
                </AppLink>
              ) : (
                <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">
                  {name}
                </span>
              )}
              {reader.list ? (
                <span className="ms-1.5 text-xs text-gray-500">
                  {translator.translateText(LIST_WORDS[reader.list])}
                </span>
              ) : (
                <></>
              )}
              <WidgetsOfDashboard
                dashboardId={reader.id}
                widgets={reader.widgets || []}
              />
              <FieldReads reads={reader.reads} />
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
        {props.ofKind.hiddenCount > 0 ? (
          <li className="text-gray-500" data-testid={`${dataTestId}-hidden`}>
            {translator.translatePlural(
              shown.length > 0
                ? MORE_HIDDEN
                : FIELD_READERS_ONLY_HIDDEN[props.kind],
              props.ofKind.hiddenCount,
            )}
          </li>
        ) : (
          <></>
        )}
      </ul>
    </div>
  );
};

export interface ComponentProps {
  readers: TelemetryFieldReaders;
}

const TelemetryFieldReadersList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readers: TelemetryFieldReaders = props.readers;

  if (!isFieldReadersListShown(readers)) {
    return <></>;
  }

  const isAnyReader: boolean = TELEMETRY_FIELD_READER_KINDS.some(
    (kind: TelemetryFieldReaderKind): boolean => {
      return isFieldReaderKindShown(readers.kinds[kind]);
    },
  );

  return (
    <div className="space-y-3" data-testid="telemetry-field-readers">
      {isAnyReader ? (
        <p data-testid="telemetry-field-readers-heading">
          {translator.translateText(FIELD_READERS_HEADING)}
        </p>
      ) : (
        <></>
      )}
      {TELEMETRY_FIELD_READER_KINDS.map(
        (kind: TelemetryFieldReaderKind): ReactElement => {
          return (
            <ReadersOfKind
              key={kind}
              kind={kind}
              ofKind={readers.kinds[kind]}
            />
          );
        },
      )}
      {readers.securityEvents.loses.length > 0 ? (
        <div data-testid="telemetry-field-readers-security-events">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText(SECURITY_EVENTS_TITLE)}
          </div>
          <ul className="mt-0.5 space-y-1 text-gray-600">
            {readers.securityEvents.loses.map(
              (need: SecurityEventsFieldNeed): ReactElement => {
                return (
                  <li
                    key={need}
                    data-testid={`telemetry-field-readers-security-events-${need}`}
                  >
                    {translator.translateText(SECURITY_EVENTS_LOSSES[need])}
                  </li>
                );
              },
            )}
          </ul>
        </div>
      ) : (
        <></>
      )}
      {TELEMETRY_FIELD_READER_KINDS.filter(
        (kind: TelemetryFieldReaderKind): boolean => {
          return !readers.kinds[kind].isChecked;
        },
      ).map((kind: TelemetryFieldReaderKind): ReactElement => {
        return (
          <p
            key={`${kind}-unchecked`}
            className="text-gray-600"
            data-testid={`telemetry-field-readers-${kind}-unchecked`}
          >
            {translator.translateText(FIELD_READER_UNCHECKED[kind])}
          </p>
        );
      })}
      {!readers.securityEvents.isChecked ? (
        <p
          className="text-gray-600"
          data-testid="telemetry-field-readers-security-events-unchecked"
        >
          {translator.translateText(SECURITY_EVENTS_UNCHECKED)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryFieldReadersList;
