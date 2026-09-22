import React, { FunctionComponent, ReactElement, useState } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  UserFlowDirection,
  UserFlowLoop,
  UserFlowPageStats,
  UserFlowPath,
} from "Common/Utils/Rum/UserFlow";
import AppLink from "../AppLink/AppLink";
import { buildReplayLinkRoute } from "../SessionReplay/ReplayLinkRoute";
import {
  formatUserFlowCount,
  formatUserFlowDuration,
  formatUserFlowShare,
} from "./UserFlowFormat";

/*
 * The map's companions, under one tab strip:
 *  - Top paths: whole journeys, most common first, each with a session to
 *    watch.
 *  - Pages: every page with its entries, exits, exit rate and problem
 *    counts - the table to sort through when the map is too busy.
 *  - Back and forth: A -> B -> A loops, the clearest sign that a visitor
 *    did not find what they expected where they looked first.
 */

export type UserFlowTableTab = "paths" | "pages" | "loops";

export interface ComponentProps {
  paths: Array<UserFlowPath>;
  pages: Array<UserFlowPageStats>;
  loops: Array<UserFlowLoop>;
  rumApplicationId: ObjectID;
  onAnchor: (page: string, direction: UserFlowDirection) => void;
}

function WatchLink(props: {
  sessionId: string | undefined;
  rumApplicationId: ObjectID;
}): ReactElement {
  if (!props.sessionId) {
    return <></>;
  }

  const route: Route | null = buildReplayLinkRoute({
    rumApplicationId: props.rumApplicationId,
    sessionId: props.sessionId,
  });

  if (!route) {
    return <></>;
  }

  return (
    <AppLink
      to={route}
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-indigo-700 hover:underline"
    >
      <Icon icon={IconProp.Play} className="h-3 w-3" />
      <span>Watch</span>
    </AppLink>
  );
}

function PageChip(props: { page: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="max-w-[16rem] truncate rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 hover:bg-indigo-100 hover:text-indigo-800"
      title={`Show paths from ${props.page}`}
      onClick={props.onClick}
    >
      {props.page}
    </button>
  );
}

function ShareBar(props: { share: number }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{ width: `${Math.min(100, props.share * 100)}%` }}
        />
      </div>
      <span className="text-xs text-gray-600">
        {formatUserFlowShare(props.share)}
      </span>
    </div>
  );
}

const HEADER_CELL: string =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
const CELL: string = "px-3 py-2 align-middle text-sm text-gray-700";

type PageSortKey =
  | "sessions"
  | "views"
  | "entries"
  | "exits"
  | "exitRate"
  | "errorSessions"
  | "frustrationSessions";

const PAGE_COLUMNS: Array<{ key: PageSortKey; label: string }> = [
  { key: "sessions", label: "Sessions" },
  { key: "views", label: "Visits" },
  { key: "entries", label: "Landed" },
  { key: "exits", label: "Left" },
  { key: "exitRate", label: "Exit rate" },
  { key: "errorSessions", label: "Errors" },
  { key: "frustrationSessions", label: "Frustrated" },
];

const UserFlowTables: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [tab, setTab] = useState<UserFlowTableTab>("paths");
  const [pageSort, setPageSort] = useState<PageSortKey>("sessions");

  const tabs: Array<{ id: UserFlowTableTab; label: string; count: number }> = [
    { id: "paths", label: "Top paths", count: props.paths.length },
    { id: "pages", label: "Pages", count: props.pages.length },
    { id: "loops", label: "Back and forth", count: props.loops.length },
  ];

  const sortedPages: Array<UserFlowPageStats> = [...props.pages].sort(
    (a: UserFlowPageStats, b: UserFlowPageStats): number => {
      const difference: number = b[pageSort] - a[pageSort];

      return difference !== 0 ? difference : b.sessions - a.sessions;
    },
  );

  return (
    <div data-testid="user-flow-tables">
      <div className="mb-3 flex gap-1 border-b border-gray-200" role="tablist">
        {tabs.map(
          (item: {
            id: UserFlowTableTab;
            label: string;
            count: number;
          }): ReactElement => {
            const active: boolean = item.id === tab;

            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`user-flow-tab-${item.id}`}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  active
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
                onClick={(): void => {
                  setTab(item.id);
                }}
              >
                {item.label}
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-xs text-gray-600">
                  {item.count}
                </span>
              </button>
            );
          },
        )}
      </div>

      {tab === "paths" ? (
        <div className="overflow-x-auto" role="tabpanel">
          <table className="min-w-full" data-testid="user-flow-paths-table">
            <thead>
              <tr>
                <th className={HEADER_CELL}>#</th>
                <th className={HEADER_CELL}>Journey</th>
                <th className={HEADER_CELL}>Sessions</th>
                <th className={HEADER_CELL}>Avg. duration</th>
                <th className={HEADER_CELL}>With errors</th>
                <th className={HEADER_CELL}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {props.paths.map(
                (path: UserFlowPath, index: number): ReactElement => {
                  return (
                    <tr
                      key={`${path.pages.join(">")}-${path.isTruncated}`}
                      data-testid="user-flow-path-row"
                      data-path={path.pages.join(" > ")}
                      data-sessions={path.sessions}
                    >
                      <td className={`${CELL} text-gray-400`}>{index + 1}</td>
                      <td className={CELL}>
                        <div className="flex flex-wrap items-center gap-1">
                          {path.pages.map(
                            (page: string, position: number): ReactElement => {
                              return (
                                <React.Fragment key={`${position}-${page}`}>
                                  {position > 0 ? (
                                    <Icon
                                      icon={IconProp.ChevronRight}
                                      className="h-3 w-3 text-gray-400"
                                    />
                                  ) : (
                                    <></>
                                  )}
                                  <PageChip
                                    page={page}
                                    onClick={(): void => {
                                      props.onAnchor(page, "forward");
                                    }}
                                  />
                                </React.Fragment>
                              );
                            },
                          )}
                          {path.isTruncated ? (
                            <span className="text-xs text-gray-400">…</span>
                          ) : (
                            <></>
                          )}
                          {path.pages.length === 1 ? (
                            <span className="text-xs text-gray-400">
                              (left without navigating)
                            </span>
                          ) : (
                            <></>
                          )}
                        </div>
                      </td>
                      <td className={CELL}>
                        <div className="flex items-center gap-3">
                          <span className="w-12 font-medium text-gray-900">
                            {formatUserFlowCount(path.sessions)}
                          </span>
                          <ShareBar share={path.share} />
                        </div>
                      </td>
                      <td className={CELL}>
                        {formatUserFlowDuration(path.avgDurationMs)}
                      </td>
                      <td className={CELL}>
                        {path.errorSessions > 0 ? (
                          <span className="text-rose-700">
                            {formatUserFlowShare(
                              path.errorSessions / path.sessions,
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={CELL}>
                        <WatchLink
                          sessionId={path.sampleSessionIds[0]}
                          rumApplicationId={props.rumApplicationId}
                        />
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <></>
      )}

      {tab === "pages" ? (
        <div className="overflow-x-auto" role="tabpanel">
          <table className="min-w-full" data-testid="user-flow-pages-table">
            <thead>
              <tr>
                <th className={HEADER_CELL}>Page</th>
                {PAGE_COLUMNS.map(
                  (column: {
                    key: PageSortKey;
                    label: string;
                  }): ReactElement => {
                    const active: boolean = column.key === pageSort;

                    return (
                      <th
                        key={column.key}
                        className={HEADER_CELL}
                        aria-sort={active ? "descending" : "none"}
                      >
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1 uppercase ${
                            active ? "text-indigo-700" : "hover:text-gray-700"
                          }`}
                          onClick={(): void => {
                            setPageSort(column.key);
                          }}
                        >
                          {column.label}
                          {active ? (
                            <Icon
                              icon={IconProp.ChevronDown}
                              className="h-3 w-3"
                            />
                          ) : (
                            <></>
                          )}
                        </button>
                      </th>
                    );
                  },
                )}
                <th className={HEADER_CELL}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedPages.map((page: UserFlowPageStats): ReactElement => {
                return (
                  <tr
                    key={page.page}
                    data-testid="user-flow-page-row"
                    data-page={page.page}
                  >
                    <td className={CELL}>
                      <PageChip
                        page={page.page}
                        onClick={(): void => {
                          props.onAnchor(page.page, "forward");
                        }}
                      />
                    </td>
                    <td className={`${CELL} font-medium text-gray-900`}>
                      {formatUserFlowCount(page.sessions)}
                    </td>
                    <td className={CELL}>{formatUserFlowCount(page.views)}</td>
                    <td className={CELL}>
                      {formatUserFlowCount(page.entries)}
                    </td>
                    <td className={CELL}>{formatUserFlowCount(page.exits)}</td>
                    <td className={CELL}>
                      <ShareBar share={page.exitRate} />
                    </td>
                    <td className={CELL}>
                      {page.errorSessions > 0 ? (
                        <span className="text-rose-700">
                          {formatUserFlowCount(page.errorSessions)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={CELL}>
                      {page.frustrationSessions > 0 ? (
                        <span className="text-amber-700">
                          {formatUserFlowCount(page.frustrationSessions)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={`${CELL} whitespace-nowrap`}>
                      <button
                        type="button"
                        className="mr-3 text-xs font-medium text-indigo-700 hover:underline"
                        onClick={(): void => {
                          props.onAnchor(page.page, "backward");
                        }}
                      >
                        Paths before
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-indigo-700 hover:underline"
                        onClick={(): void => {
                          props.onAnchor(page.page, "forward");
                        }}
                      >
                        Paths after
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <></>
      )}

      {tab === "loops" ? (
        <div role="tabpanel" data-testid="user-flow-loops">
          {props.loops.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No session in this range left a page and came straight back to it.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {props.loops.map((loop: UserFlowLoop): ReactElement => {
                return (
                  <li
                    key={`${loop.pageA}-${loop.pageB}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-2"
                    data-testid="user-flow-loop-row"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PageChip
                        page={loop.pageA}
                        onClick={(): void => {
                          props.onAnchor(loop.pageA, "forward");
                        }}
                      />
                      <Icon
                        icon={IconProp.ArrowUpDown}
                        className="h-3.5 w-3.5 rotate-90 text-amber-500"
                      />
                      <PageChip
                        page={loop.pageB}
                        onClick={(): void => {
                          props.onAnchor(loop.pageB, "forward");
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-700">
                        {formatUserFlowCount(loop.sessions)} sessions
                      </span>
                      <ShareBar share={loop.share} />
                      <WatchLink
                        sessionId={loop.sampleSessionIds[0]}
                        rumApplicationId={props.rumApplicationId}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default UserFlowTables;
