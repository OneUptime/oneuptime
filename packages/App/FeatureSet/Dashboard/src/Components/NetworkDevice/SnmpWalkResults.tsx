import {
  SNMP_WALK_ROWS_PER_PAGE,
  SNMP_WALK_VALUE_PREVIEW_LENGTH,
  SnmpWalkRowLabels,
  SnmpWalkRowNotice,
  SnmpWalkRowView,
  filterSnmpWalkRows,
  getSnmpWalkRowLabels,
} from "./SnmpWalkViewModel";
import { SnmpWalkRow } from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useClipboardCopy, {
  ClipboardCopy,
} from "Common/UI/Utils/UseClipboardCopy";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * What a walk of a device read (issue #5184), one OID a row: its name from
 * the MIBs OneUptime knows (a vendor template's name for it first), its
 * type, its value - and what can be done with it: collect it on every poll,
 * then alert on it.
 *
 * The layout follows the width of the results themselves, not the window's
 * (a container query, as ExternalStatusPageMonitorView does): on a device
 * page the side menu takes about 330 pixels from md up, so a 768 to 1100
 * pixel window leaves the results only 430 to 700 pixels. Below 44rem each
 * OID is a small card - the name across the row with its menu in the
 * corner, the type and the value under it, and the row's action under
 * those, never squeezing the name. From 44rem it is a table: OID | type |
 * value | action | menu, one grid whose rows are subgrids, so every column
 * lines up and the type and action columns are as wide as their widest
 * entry in any language. A walk can hold thousands of OIDs, so
 * SNMP_WALK_ROWS_PER_PAGE are drawn at a time.
 */

export interface SnmpWalkRowActions {
  // The OIDs the device already collects, normalized.
  collectedOids: Set<string>;
  // Hidden when the reader may not change the device, or nothing polls it.
  canCollect: boolean;
  // The device's OID Collection Template, when it has one.
  templateName?: string | undefined;
  canCollectOnTemplate: boolean;
  // The OID being collected right now.
  collectingOid?: string | undefined;
  onCollect: (row: SnmpWalkRow) => void;
  onCollectOnTemplate: (row: SnmpWalkRow) => void;
  // Where "Alert on it" goes for a collected OID; undefined hides it.
  getAlertRoute?: ((row: SnmpWalkRow) => Route) | undefined;
}

export interface ComponentProps {
  rows: Array<SnmpWalkRow>;
  views: Array<SnmpWalkRowView>;
  actions: SnmpWalkRowActions;
  /*
   * What collecting an OID from this page came to, shown in that OID's
   * row: the reader is looking at the row they pressed Collect in, which
   * can be hundreds of rows below the top of the page.
   */
  notice?: SnmpWalkRowNotice | undefined;
  /*
   * Drawn where the list ends - only once every OID read so far (that the
   * filter keeps) is on screen, so "read more from the device" never sits
   * next to "show more of what was read".
   */
  listEnd?: ReactElement | undefined;
}

interface RowProps {
  row: SnmpWalkRow;
  view: SnmpWalkRowView;
  actions: SnmpWalkRowActions;
  notice?: SnmpWalkRowNotice | undefined;
  translator: Translator;
}

interface PartProps {
  view: SnmpWalkRowView;
  translator: Translator;
}

interface NameProps extends PartProps {
  isCollected: boolean;
}

const SnmpWalkRowName: FunctionComponent<NameProps> = (
  props: NameProps,
): ReactElement => {
  const labels: SnmpWalkRowLabels = getSnmpWalkRowLabels(
    props.view,
    props.translator,
  );

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`font-medium text-gray-900 [overflow-wrap:anywhere] ${
            labels.isTitleTheOid ? "font-mono text-xs" : "text-sm"
          }`}
          data-testid="snmp-walk-row-name"
        >
          {labels.title}
        </span>
        {labels.titleModule ? (
          <span className="text-xs text-gray-400">{labels.titleModule}</span>
        ) : (
          <></>
        )}
        {/*
         * Whether every poll collects the OID is a fact about the OID, so
         * it is said beside its name - where a reader scanning the list
         * looks - and the action column keeps only the next step.
         */}
        {props.isCollected ? (
          <span
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
            data-testid="snmp-walk-row-collected"
          >
            <Icon icon={IconProp.Check} className="h-3 w-3" />
            {props.translator.translateText("Collected")}
          </span>
        ) : (
          <></>
        )}
      </div>
      {labels.mibName ? (
        <div
          className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]"
          data-testid="snmp-walk-row-mib-name"
        >
          {labels.mibName}
        </div>
      ) : (
        <></>
      )}
      {labels.isTitleTheOid ? (
        <></>
      ) : (
        <div
          className="mt-0.5 font-mono text-xs text-gray-500 [overflow-wrap:anywhere]"
          data-testid="snmp-walk-row-oid"
        >
          {props.view.oid}
        </div>
      )}
      {labels.source ? (
        <div
          className="mt-0.5 text-xs text-gray-500"
          data-testid="snmp-walk-row-source"
        >
          {labels.source}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

interface TypeProps {
  view: SnmpWalkRowView;
  testId: string;
}

const SnmpWalkRowType: FunctionComponent<TypeProps> = (
  props: TypeProps,
): ReactElement => {
  return (
    <span
      className="inline-flex shrink-0 whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
      data-testid={props.testId}
    >
      {props.view.typeLabel}
    </span>
  );
};

const SnmpWalkRowValue: FunctionComponent<PartProps> = (
  props: PartProps,
): ReactElement => {
  const view: SnmpWalkRowView = props.view;
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  if (view.isNull) {
    return (
      <span className="text-sm text-gray-400" data-testid="snmp-walk-row-value">
        —
      </span>
    );
  }

  if (view.valueText === "") {
    return (
      <span
        className="text-sm italic text-gray-400"
        data-testid="snmp-walk-row-value"
      >
        {props.translator.translateText("Empty")}
      </span>
    );
  }

  const isLong: boolean =
    view.valueText.length > SNMP_WALK_VALUE_PREVIEW_LENGTH;
  const shownText: string =
    isLong && !isExpanded
      ? `${view.valueText.substring(0, SNMP_WALK_VALUE_PREVIEW_LENGTH)}…`
      : `${view.valueText}${view.isCut ? "…" : ""}`;

  return (
    <div className="min-w-0">
      <span
        className={`whitespace-pre-wrap text-gray-900 [overflow-wrap:anywhere] ${
          view.isMonospace ? "font-mono text-xs" : "text-sm"
        }`}
        data-testid="snmp-walk-row-value"
      >
        {shownText}
      </span>
      {view.durationText ? (
        <span
          className="ml-2 whitespace-nowrap text-xs text-gray-500"
          data-testid="snmp-walk-row-duration"
        >
          {view.durationText}
        </span>
      ) : (
        <></>
      )}
      {view.isCut && (isExpanded || !isLong) ? (
        <span className="mt-0.5 block text-xs text-gray-500">
          {props.translator.translateText(
            "The device's value is longer: the walk keeps its first 1,024 characters.",
          )}
        </span>
      ) : (
        <></>
      )}
      {/*
       * On a line of its own, at the value's left edge: beside a value that
       * wraps it would start a line indented by its own margin.
       */}
      {isLong ? (
        <button
          type="button"
          className="mt-1 block text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:underline"
          data-testid="snmp-walk-row-value-toggle"
          aria-expanded={isExpanded}
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded
            ? props.translator.translateText("Show less")
            : props.translator.translateText("Show all")}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The row's cells, placed for both layouts. Narrow: a two-column grid -
 * the name and the menu share the first line, the value takes the second,
 * the action the third, and a notice the next free line. Wide (the results
 * 44rem or more): the row is a subgrid of the table's five columns, the
 * notice a line of its own under them.
 */
const ROW_CLASS_NAME: string =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3 [@container(min-width:44rem)]:col-span-full [@container(min-width:44rem)]:grid-cols-subgrid [@container(min-width:44rem)]:gap-x-4 [@container(min-width:44rem)]:gap-y-1.5";
const NAME_CELL_CLASS_NAME: string = "col-start-1 row-start-1 min-w-0";
const TYPE_CELL_CLASS_NAME: string =
  "[@container(max-width:43.99rem)]:hidden [@container(min-width:44rem)]:col-start-2 [@container(min-width:44rem)]:row-start-1";
const VALUE_CELL_CLASS_NAME: string =
  "col-span-2 row-start-2 flex min-w-0 items-start gap-2 [@container(min-width:44rem)]:col-span-1 [@container(min-width:44rem)]:col-start-3 [@container(min-width:44rem)]:row-start-1";
const PHONE_TYPE_CLASS_NAME: string = "[@container(min-width:44rem)]:hidden";
const ACTION_CELL_CLASS_NAME: string =
  "col-span-2 row-start-3 flex [@container(min-width:44rem)]:col-span-1 [@container(min-width:44rem)]:col-start-4 [@container(min-width:44rem)]:row-start-1 [@container(min-width:44rem)]:justify-end";
const MENU_CELL_CLASS_NAME: string =
  "col-start-2 row-start-1 -my-1 [@container(min-width:44rem)]:col-start-5";
// Narrow, the first free line after the value: under the action, if any.
const NOTICE_CELL_CLASS_NAME: string =
  "col-span-2 [@container(min-width:44rem)]:col-span-full [@container(min-width:44rem)]:row-start-2";

/*
 * "Alert on it" goes to another page, so it is a link - drawn as the
 * small button "Collect" is, as the same column's next step.
 */
const ACTION_LINK_CLASS_NAME: string =
  "inline-flex items-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-150 ease-out hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const SnmpWalkResultRow: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const { row, view, actions, notice, translator } = props;
  const clipboard: ClipboardCopy = useClipboardCopy({ copiedForMs: 1500 });
  const isCollected: boolean = actions.collectedOids.has(view.oid);
  const isCollecting: boolean = actions.collectingOid === view.oid;
  const alertRoute: Route | undefined = isCollected
    ? actions.getAlertRoute?.(row)
    : undefined;
  const canCollect: boolean = !isCollected && actions.canCollect;

  const menuItems: Array<ReactElement> = [
    <MoreMenuItem
      key="copy"
      icon={IconProp.Copy}
      text={
        clipboard.isCopied
          ? translator.translateText("Copied!")!
          : clipboard.isFailed
            ? translator.translateText("Copy failed")!
            : translator.translateText("Copy OID")!
      }
      onClick={() => {
        clipboard.copy(view.oid).catch(() => {
          // useClipboardCopy says itself when the browser refused.
        });
      }}
    />,
  ];

  if (actions.canCollectOnTemplate && actions.templateName && !isCollected) {
    menuItems.push(
      <MoreMenuItem
        key="collect-on-template"
        icon={IconProp.Layers}
        text={translator.translateTemplate(
          "Collect on every device using {{template}}",
          { template: actions.templateName },
        )}
        isDisabled={Boolean(actions.collectingOid)}
        onClick={() => {
          actions.onCollectOnTemplate(row);
        }}
      />,
    );
  }

  const getAction: () => ReactElement = (): ReactElement => {
    if (canCollect) {
      return (
        <Button
          title="Collect"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.NORMAL}
          dataTestId="snmp-walk-row-collect"
          className="!ml-0 !w-auto whitespace-nowrap !text-sm"
          isLoading={isCollecting}
          disabled={Boolean(actions.collectingOid) && !isCollecting}
          tooltip="Collect this OID on every poll, so it is charted and can be alerted on."
          onClick={() => {
            actions.onCollect(row);
          }}
        />
      );
    }

    if (alertRoute) {
      return (
        <Link
          to={alertRoute}
          className={ACTION_LINK_CLASS_NAME}
          dataTestId="snmp-walk-row-alert"
        >
          {translator.translateText("Alert on it")}
        </Link>
      );
    }

    return <></>;
  };

  const hasAction: boolean = canCollect || Boolean(alertRoute);
  const isNoticeHere: boolean = Boolean(notice && notice.oid === view.oid);

  return (
    <li
      className={ROW_CLASS_NAME}
      data-testid="snmp-walk-row"
      data-oid={view.oid}
    >
      <div className={NAME_CELL_CLASS_NAME}>
        <SnmpWalkRowName
          view={view}
          translator={translator}
          isCollected={isCollected}
        />
      </div>
      <div className={TYPE_CELL_CLASS_NAME}>
        <SnmpWalkRowType view={view} testId="snmp-walk-row-type" />
      </div>
      <div className={VALUE_CELL_CLASS_NAME}>
        {/*
         * Narrow, the type sits before the value on its line instead of
         * taking a line of its own; wide, it has its column.
         */}
        <div className={PHONE_TYPE_CLASS_NAME}>
          <SnmpWalkRowType view={view} testId="snmp-walk-row-type-phone" />
        </div>
        <SnmpWalkRowValue view={view} translator={translator} />
      </div>
      {hasAction ? (
        <div className={ACTION_CELL_CLASS_NAME}>{getAction()}</div>
      ) : (
        <></>
      )}
      <div className={MENU_CELL_CLASS_NAME}>
        <MoreMenu
          text=""
          ariaLabel={translator.translateTemplate("More actions for {{oid}}", {
            oid: view.oid,
          })}
          menuIcon={IconProp.EllipsisHorizontal}
          isMenuPortaled={true}
          dataTestId="snmp-walk-row-more"
        >
          {menuItems}
        </MoreMenu>
      </div>
      {isNoticeHere && notice ? (
        <div
          className={`${NOTICE_CELL_CLASS_NAME} flex items-start gap-1.5 text-xs ${
            notice.kind === "success" ? "text-gray-600" : "text-red-700"
          }`}
          data-testid="snmp-walk-collect-notice"
          role={notice.kind === "success" ? "status" : "alert"}
        >
          <Icon
            icon={
              notice.kind === "success" ? IconProp.CheckCircle : IconProp.Alert
            }
            className={`mt-px h-4 w-4 shrink-0 ${
              notice.kind === "success" ? "text-green-600" : "text-red-600"
            }`}
          />
          <span className="[overflow-wrap:anywhere]">{notice.text}</span>
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

const SnmpWalkResults: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [query, setQuery] = useState<string>("");
  const [shownCount, setShownCount] = useState<number>(SNMP_WALK_ROWS_PER_PAGE);

  const rowsByOid: Map<string, SnmpWalkRow> = useMemo(() => {
    return new Map(
      props.rows.map((row: SnmpWalkRow): [string, SnmpWalkRow] => {
        return [row.oid, row];
      }),
    );
  }, [props.rows]);

  const matching: Array<SnmpWalkRowView> = useMemo(() => {
    return filterSnmpWalkRows(props.views, query);
  }, [props.views, query]);

  // A new filter starts from the top again.
  useEffect(() => {
    setShownCount(SNMP_WALK_ROWS_PER_PAGE);
  }, [query]);

  const shown: Array<SnmpWalkRowView> = matching.slice(0, shownCount);
  const isEveryMatchShown: boolean = matching.length <= shown.length;

  /*
   * The type and action columns start at a floor that fits most of what
   * they hold, so they do not jump as the filter narrows the rows; a
   * longer language widens them. A reader with nothing to do on a row gets
   * no empty action column at all.
   */
  const hasActions: boolean =
    props.actions.canCollect || Boolean(props.actions.getAlertRoute);
  const tableClassName: string = hasActions
    ? "mt-3 [@container(min-width:44rem)]:grid [@container(min-width:44rem)]:grid-cols-[minmax(0,5fr)_minmax(6.5rem,auto)_minmax(0,5fr)_minmax(6rem,auto)_auto] [@container(min-width:44rem)]:gap-x-4"
    : "mt-3 [@container(min-width:44rem)]:grid [@container(min-width:44rem)]:grid-cols-[minmax(0,5fr)_minmax(6.5rem,auto)_minmax(0,5fr)_auto_auto] [@container(min-width:44rem)]:gap-x-4";

  return (
    <div
      data-testid="snmp-walk-results"
      className="[container-type:inline-size]"
    >
      <div className="max-w-md">
        <Input
          value={query}
          placeholder="Filter by OID, name or value"
          ariaLabel="Filter the walked OIDs"
          dataTestId="snmp-walk-filter"
          onChange={(value: string) => {
            setQuery(value);
          }}
        />
      </div>

      {query.trim() ? (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="snmp-walk-filter-count"
        >
          {translator.translatePlural(
            {
              one: "{{count}} of {{total}} OIDs matches.",
              other: "{{count}} of {{total}} OIDs match.",
            },
            matching.length,
            { total: translator.formatNumber(props.views.length) },
          )}
        </p>
      ) : (
        <></>
      )}

      {shown.length === 0 ? (
        <p
          className="py-6 text-center text-sm text-gray-500 [overflow-wrap:anywhere]"
          data-testid="snmp-walk-no-match"
        >
          {translator.translateTemplate('No OIDs match "{{query}}".', {
            query: query.trim(),
          })}
        </p>
      ) : (
        <div className={tableClassName} data-testid="snmp-walk-table">
          {/*
           * The table's header, wide only: a narrow row reads as a card on
           * its own. The action and menu columns need no title.
           */}
          <div
            className="border-b border-gray-200 pb-2 text-xs font-medium uppercase tracking-wide text-gray-500 [@container(max-width:43.99rem)]:hidden [@container(min-width:44rem)]:col-span-full [@container(min-width:44rem)]:grid [@container(min-width:44rem)]:grid-cols-subgrid [@container(min-width:44rem)]:gap-x-4"
            aria-hidden="true"
            data-testid="snmp-walk-results-header"
          >
            <span>{translator.translateText("OID")}</span>
            <span>{translator.translateText("Type")}</span>
            <span>{translator.translateText("Value")}</span>
          </div>
          <ul
            className="divide-y divide-gray-100 [@container(min-width:44rem)]:col-span-full [@container(min-width:44rem)]:grid [@container(min-width:44rem)]:grid-cols-subgrid"
            data-testid="snmp-walk-rows"
          >
            {shown.map((view: SnmpWalkRowView): ReactElement => {
              return (
                <SnmpWalkResultRow
                  key={view.oid}
                  row={rowsByOid.get(view.oid)!}
                  view={view}
                  actions={props.actions}
                  notice={props.notice}
                  translator={translator}
                />
              );
            })}
          </ul>
        </div>
      )}

      {isEveryMatchShown ? (
        <></>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <span className="text-xs text-gray-500">
            {translator.translateTemplate("Showing {{shown}} of {{total}}", {
              shown: translator.formatNumber(shown.length),
              total: translator.formatNumber(matching.length),
            })}
          </span>
          <Button
            title={translator.translateTemplate("Show {{count}} more", {
              count: translator.formatNumber(
                Math.min(
                  SNMP_WALK_ROWS_PER_PAGE,
                  matching.length - shown.length,
                ),
              ),
            })}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            className="!ml-0 !w-auto !text-sm"
            dataTestId="snmp-walk-show-more"
            onClick={() => {
              setShownCount((count: number) => {
                return count + SNMP_WALK_ROWS_PER_PAGE;
              });
            }}
          />
        </div>
      )}

      {isEveryMatchShown && props.listEnd ? props.listEnd : <></>}
    </div>
  );
};

export default SnmpWalkResults;
