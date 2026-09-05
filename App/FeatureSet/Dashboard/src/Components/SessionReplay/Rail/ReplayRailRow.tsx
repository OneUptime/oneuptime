import React, { FunctionComponent, ReactElement, memo } from "react";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import AppLink from "../../AppLink/AppLink";
import { formatReplayOffsetPrecise } from "../ReplayTimeFormat";
import { ReplaySignal } from "./ReplaySignalTypes";
import {
  ReplayRailGlyph,
  ReplayRailRowModel,
  glyphForSignal,
} from "./ReplayRailTabs";

/*
 * One rail row: [glyph][mm:ss.t][title, truncated][right meta][actions].
 *
 * SEMANTICS. The row is a listitem in the rail's role="list", and its
 * clickable surface is a real <button>. It used to be a role="option"
 * whose click target was a bare div: ARIA gives an option "children
 * presentational" semantics, so the nested Seek / Copy / trace controls
 * and the whole expanded detail were hidden or mis-announced, and the
 * primary target itself was not focusable - "click a row to seek and open
 * its detail" had no keyboard equivalent at all. A listitem has no such
 * rule, so every control inside it keeps its own semantics.
 *
 * The body button carries aria-current (the playhead is on this row) and
 * aria-expanded (its detail is open, which is what selection means here).
 * Focus roves: only one row is in the Tab order (the selected one, else
 * the active one, else the first), and j/k/Arrow move both selection and
 * focus - the listbox pattern's aria-activedescendant would have needed
 * option semantics we just gave up.
 *
 * The two hover actions are SIBLINGS of the body, never inside it: an <a>
 * nested in a click target is invalid HTML and browsers hoist it out,
 * which is how the old panel's trace link kept jumping.
 *
 * Three visual states on top of hover: past rows (gray-700), the active
 * row (indigo-50 with a ring) and future rows (gray-400). Selection is
 * separate from activity so a clicked row stays visibly chosen while the
 * playhead sits in its pre-roll window.
 */

export interface ReplayRailRowProps {
  row: ReplayRailRowModel;
  /* DOM id for the row; the detail is <domId>-detail. */
  domId: string;
  isActive: boolean;
  isSelected: boolean;
  isFuture: boolean;
  /* The one row in the Tab order (roving tabindex across the list). */
  isFocusStop: boolean;
  /* The detail element to render under the row when expanded. */
  detail?: ReactElement | null | undefined;
  /* Right-hand note beside the meta: "±3s" on unanchored telemetry rows. */
  uncertaintyLabel?: string | null | undefined;
  /* "also reported server-side" / "also seen in the browser". */
  counterpartNote?: string | null | undefined;
  /* The link out for this row (trace view, exception group, ...). */
  link?: { route: Route; label: string } | null | undefined;
  onActivate: (row: ReplayRailRowModel) => void;
  onSeek: (row: ReplayRailRowModel) => void;
  onHover: (offsetMs: number | null) => void;
  onCopyLink?: ((row: ReplayRailRowModel) => void) | undefined;
}

function sourceTag(signal: ReplaySignal): string | null {
  if (signal.kind === "client-error") {
    return "client";
  }

  if (signal.kind === "server-error") {
    return "server";
  }

  return null;
}

/*
 * What a screen reader reads for the row. aria-label replaces the button's
 * text, so everything the eye gets from the row has to be in it: the
 * repeat count, the client/server tag and the right-hand meta included.
 */
function rowLabel(
  props: ReplayRailRowProps,
  glyph: ReplayRailGlyph,
  time: string,
  tag: string | null,
): string {
  const signal: ReplaySignal = props.row.signal;
  const parts: Array<string> = [
    `${glyph.description} at ${time}: ${signal.title}`,
  ];

  if (props.row.repeatCount > 1) {
    parts.push(`repeated ${props.row.repeatCount} times`);
  }

  if (tag) {
    parts.push(tag);
  }

  if (props.counterpartNote) {
    parts.push(props.counterpartNote);
  }

  if (signal.subtitle) {
    parts.push(signal.subtitle);
  }

  if (props.uncertaintyLabel) {
    parts.push(`server-stamped, ${props.uncertaintyLabel}`);
  }

  return parts.join(", ");
}

const ReplayRailRowComponent: FunctionComponent<ReplayRailRowProps> = (
  props: ReplayRailRowProps,
): ReactElement => {
  const signal: ReplaySignal = props.row.signal;
  const glyph: ReplayRailGlyph = glyphForSignal(signal);
  const time: string = formatReplayOffsetPrecise(signal.offsetMs);
  const tag: string | null = sourceTag(signal);
  const detailId: string = `${props.domId}-detail`;

  const textClass: string = props.isActive
    ? "text-gray-900"
    : props.isFuture
      ? "text-gray-400"
      : "text-gray-700";

  const rowClass: string = props.isActive
    ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
    : props.isSelected
      ? "bg-gray-50 ring-1 ring-inset ring-gray-200"
      : "hover:bg-gray-50";

  return (
    <div
      id={props.domId}
      role="listitem"
      data-testid="rail-row"
      data-signal-id={signal.id}
      data-future={props.isFuture ? "true" : "false"}
      data-selected={props.isSelected ? "true" : "false"}
      data-active={props.isActive ? "true" : "false"}
      className={`group rounded font-mono text-[11px] leading-relaxed ${rowClass}`}
      style={{ contentVisibility: "auto" } as React.CSSProperties}
      onMouseEnter={(): void => {
        props.onHover(signal.offsetMs);
      }}
      onMouseLeave={(): void => {
        props.onHover(null);
      }}
    >
      <div className="flex items-start gap-1.5 px-2 py-1">
        <button
          type="button"
          data-rail-row-body="true"
          tabIndex={props.isFocusStop ? 0 : -1}
          aria-current={props.isActive ? "true" : undefined}
          aria-expanded={props.isSelected}
          aria-controls={props.detail ? detailId : undefined}
          aria-label={rowLabel(props, glyph, time, tag)}
          className={`flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400 ${textClass}`}
          title={`Seek to ${time} (1s before) and open the detail`}
          onClick={(): void => {
            props.onActivate(props.row);
          }}
        >
          <span
            className={`mt-px inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${glyph.className}`}
            aria-hidden="true"
          >
            {glyph.label}
          </span>

          {props.isActive && (
            <span data-testid="rail-row-active" className="sr-only">
              now
            </span>
          )}

          <span className="shrink-0 tabular-nums text-gray-400">{time}</span>

          <span className="min-w-0 flex-1 truncate">{signal.title}</span>

          {props.row.repeatCount > 1 && (
            <span
              className="shrink-0 rounded bg-gray-200 px-1 text-[10px] font-semibold text-gray-700"
              title={`Repeated ${props.row.repeatCount} times in a row`}
            >
              ×{props.row.repeatCount}
            </span>
          )}

          {tag && (
            <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] text-gray-500">
              {tag}
            </span>
          )}

          {props.counterpartNote && (
            <span
              className="shrink-0 text-[10px] text-indigo-600"
              title={props.counterpartNote}
            >
              linked
            </span>
          )}

          {signal.subtitle && (
            <span className="shrink-0 text-gray-400">{signal.subtitle}</span>
          )}

          {props.uncertaintyLabel && (
            <span
              className="shrink-0 text-gray-400"
              title="Server-stamped time; not anchored to the recording's clock"
            >
              {props.uncertaintyLabel}
            </span>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            className="rounded p-0.5 text-gray-400 hover:bg-white hover:text-indigo-600"
            aria-label={`Seek to ${time}`}
            title="Seek here (1s before)"
            onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
              event.stopPropagation();
              props.onSeek(props.row);
            }}
          >
            <Icon icon={IconProp.Play} className="h-3 w-3" />
          </button>

          {props.onCopyLink && (
            <button
              type="button"
              className="rounded p-0.5 text-gray-400 hover:bg-white hover:text-indigo-600"
              aria-label="Copy link to this moment"
              title="Copy link to this moment"
              onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
                event.stopPropagation();
                props.onCopyLink?.(props.row);
              }}
            >
              <Icon icon={IconProp.Link} className="h-3 w-3" />
            </button>
          )}

          {props.link && (
            <AppLink
              to={props.link.route}
              className="rounded px-1 text-[10px] text-indigo-600 hover:underline"
            >
              {props.link.label}
            </AppLink>
          )}
        </div>
      </div>

      {props.detail && (
        <div
          id={detailId}
          data-testid="rail-row-detail"
          role="group"
          aria-label={`Detail for ${signal.title}`}
          className="border-t border-gray-100 px-2 py-2 font-sans"
          onClick={(event: React.MouseEvent<HTMLDivElement>): void => {
            /* Clicks inside the detail never re-seek the row. */
            event.stopPropagation();
          }}
        >
          {props.detail}
        </div>
      )}
    </div>
  );
};

/* Rows re-render only when their own props change: 500 rows tick at 30Hz. */
const ReplayRailRow: React.NamedExoticComponent<ReplayRailRowProps> = memo(
  ReplayRailRowComponent,
);

export default ReplayRailRow;
