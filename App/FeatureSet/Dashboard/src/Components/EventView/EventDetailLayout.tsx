import React, { FunctionComponent, ReactElement } from "react";

/**
 * EventDetailLayout
 *
 * The shared header chassis for an "event" detail page (incident / alert /
 * scheduled maintenance) in the Linear-like overhaul. It renders the state /
 * action panel, then a full-width header with an eyebrow (the event number),
 * an inline-editable title, and an optional actions slot — so every event type
 * gets the same scannable top-of-page treatment.
 *
 * The investigation content (description, root cause, remediation, activity)
 * lives inline in the page body below this header instead of behind separate
 * routes. Over time this component will grow to own the full body + right-rail
 * layout; today it owns the header so all three event types can adopt it.
 */

export interface ComponentProps {
  // The state / primary-action panel (e.g. ChangeIncidentState).
  header?: ReactElement | undefined;
  // Small label above the title — typically the event number (e.g. "#142").
  eyebrow?: string | undefined;
  // The event title, usually an inline-editable field.
  title?: ReactElement | undefined;
  // Optional right-aligned actions in the header row.
  actions?: ReactElement | undefined;
}

const EventDetailLayout: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const hasTitleRow: boolean = Boolean(
    props.eyebrow || props.title || props.actions,
  );

  return (
    <div className="mb-5">
      {props.header && <div className="mb-4">{props.header}</div>}
      {hasTitleRow && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {props.eyebrow && (
              <div className="mb-1 text-sm font-medium text-gray-400">
                {props.eyebrow}
              </div>
            )}
            {props.title}
          </div>
          {props.actions && (
            <div className="flex-shrink-0">{props.actions}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default EventDetailLayout;
