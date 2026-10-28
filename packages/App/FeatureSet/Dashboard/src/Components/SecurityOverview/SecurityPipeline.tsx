import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SecurityOverviewQueue,
  SecurityStageView,
  SecurityStatusTone,
  getSecurityStageViews,
  translateSecurityOverviewText,
} from "./SecurityOverviewStatusModel";
import { SecuritySetupStatus } from "./SecuritySetupModel";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const SECURITY_PIPELINE_ID: string = "security-pipeline";

export interface ComponentProps {
  status: SecuritySetupStatus;
  queue: SecurityOverviewQueue;
  // What "Last event 3 days ago" counts from.
  now: Date;
}

/*
 * Literal class names per tone - never built from pieces - so the Tailwind
 * scanner sees each one, and Theme.css can re-colour each for dark mode.
 */
const FIGURE_CLASS_NAMES: Record<SecurityStatusTone, string> = {
  [SecurityStatusTone.Danger]: "text-red-700",
  [SecurityStatusTone.Warning]: "text-amber-700",
  [SecurityStatusTone.Info]: "text-gray-900",
  [SecurityStatusTone.Success]: "text-gray-900",
  // "Not set up": quieter than a figure, still easy to read.
  [SecurityStatusTone.Neutral]: "text-gray-500",
};

const STATUS_CLASS_NAMES: Record<SecurityStatusTone, string> = {
  [SecurityStatusTone.Danger]: "text-red-700",
  [SecurityStatusTone.Warning]: "text-amber-700",
  [SecurityStatusTone.Info]: "text-indigo-700",
  [SecurityStatusTone.Success]: "text-emerald-700",
  [SecurityStatusTone.Neutral]: "text-gray-500",
};

/*
 * Each cell spans three of the grid's rows as a subgrid: its name, its
 * figure, its status. A name or status that takes two lines in one cell,
 * as German ones do, makes that row taller across the whole row of cells,
 * so the figures and the statuses still line up. The one column is
 * minmax(0, 1fr): an auto column would grow to fit a long word and push it
 * past the cell's edge.
 */
const CELL_ROWS: string = "row-span-3 grid grid-cols-1 grid-rows-subgrid";

/*
 * How many cells share a row follows the pipeline's own width, not the
 * window's: beside the side menu a 1024px window leaves the card some 620px,
 * where the window's lg:grid-cols-4 put four cells of 150px and broke German's
 * SICHERHEITSFAELLE and Dutch's BEVEILIGINGSZAKEN mid-word. The nav is a size
 * container; a cell keeps at least 12rem - room for the longest word of the
 * Dashboard's languages (Dutch's, about 190px with the cell's padding) - so:
 *
 * - four across from 51rem (816px: a 1280px window and wider, beside the side
 *   menu), with a chevron on each line between two cells;
 * - two across from 25rem (400px: a tablet beside the side menu, a 1024px
 *   window);
 * - one above the other below that - a phone, where two cells of 160px broke
 *   the same words - in the order the parts work in.
 *
 * Whole two-digit rems, as CardGrid's steps: the Tailwind runtime writes its
 * container variants in the order of their names as text, and the wider one
 * must come last to win where both apply.
 */
export const SECURITY_PIPELINE_CONTAINER_CLASS_NAME: string =
  "[container-type:inline-size]";

export const SECURITY_PIPELINE_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-px border-t border-gray-200 bg-gray-200 [@container(min-width:25rem)]:grid-cols-2 [@container(min-width:51rem)]:grid-cols-4";

/*
 * The chevron between two cells: only while the four share one row - shown,
 * and hidden while the pipeline is narrower than the step that puts the four
 * on one row. Never the bare `hidden` with a variant to show it again: a
 * foreign `.hidden{display:none !important}` rule (Bootstrap's, an
 * extension's) would keep it hidden at every width (ForeignHiddenRuleGuard).
 */
export const SECURITY_PIPELINE_ARROW_SHOWN_CLASS_NAME: string =
  "flex [@container(max-width:50.99rem)]:hidden";

/*
 * The Overview's pipeline: how Security works in this project, left to
 * right - where events come from, what finds threats in them, what needs a
 * person, what responds. One card's row of cells on a hairline grid, as
 * Home draws its numbers, each cell a link: to its part's page, or, for a
 * part not set up, to where it is set up. Where the four share a row, a
 * chevron sits on each line between two cells, so the row reads as the
 * flow it is; two by two, or one above the other, where the card is
 * narrower, the order says it.
 */
const SecurityPipeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const views: Array<SecurityStageView> = getSecurityStageViews({
    status: props.status,
    queue: props.queue,
    now: props.now,
  });

  return (
    <nav
      id={SECURITY_PIPELINE_ID}
      data-testid={SECURITY_PIPELINE_ID}
      aria-label={translator.translateText("How Security works here")}
      className={SECURITY_PIPELINE_CONTAINER_CLASS_NAME}
    >
      <ol className={SECURITY_PIPELINE_GRID_CLASS_NAME}>
        {views.map((view: SecurityStageView, index: number): ReactElement => {
          return (
            <li
              key={view.key}
              className={`relative ${CELL_ROWS} bg-white`}
              data-testid={`security-pipeline-${view.key}`}
              data-ready={view.isReady ? "true" : "false"}
              data-tone={view.statusTone}
            >
              <AppLink
                to={RouteUtil.populateRouteParams(RouteMap[view.page] as Route)}
                className={`${CELL_ROWS} px-4 py-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-5`}
              >
                <>
                  {/*
                   * 16px across and no letter-spacing on a phone, where the
                   * cells stand one above the other; a cell beside another
                   * has room for the longest word (the grid's steps above).
                   */}
                  <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase leading-4 text-gray-500 sm:tracking-wide">
                    <Icon
                      icon={view.icon}
                      className="h-3.5 w-3.5 flex-none text-gray-400"
                    />
                    <span
                      className="min-w-0 break-words"
                      data-testid={`security-pipeline-${view.key}-label`}
                    >
                      {translator.translateText(view.title)}
                    </span>
                  </div>
                  <div
                    data-testid={`security-pipeline-${view.key}-figure`}
                    className={`mt-1.5 break-words text-lg font-semibold leading-7 ${FIGURE_CLASS_NAMES[view.figureTone]}`}
                  >
                    {translateSecurityOverviewText(translator, view.figure)}
                  </div>
                  {view.status ? (
                    <div
                      data-testid={`security-pipeline-${view.key}-status`}
                      className={`mt-1 flex items-start gap-1.5 text-sm ${STATUS_CLASS_NAMES[view.statusTone]}`}
                    >
                      <Icon
                        icon={view.statusIcon}
                        className="mt-0.5 h-4 w-4 flex-none"
                      />
                      <span className="min-w-0 break-words">
                        {translateSecurityOverviewText(translator, view.status)}
                      </span>
                    </div>
                  ) : (
                    <div />
                  )}
                </>
              </AppLink>
              {/*
               * On the line after the cell, in the reading direction: its
               * end edge (the left one in a right-to-left page), pointing on.
               */}
              {index < views.length - 1 ? (
                <span
                  className={`pointer-events-none absolute end-0 top-1/2 z-10 h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm ring-1 ring-gray-200 rtl:-translate-x-1/2 ${SECURITY_PIPELINE_ARROW_SHOWN_CLASS_NAME}`}
                  aria-hidden="true"
                  data-testid="security-pipeline-arrow"
                >
                  <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
                </span>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default SecurityPipeline;
