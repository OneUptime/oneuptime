import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  header: ReactElement;
  summary: ReactElement;
  children: ReactElement;
  sidebar: ReactElement;
  activityTitle?: string | undefined;
  activityDescription?: string | undefined;
  sidebarTitle?: string | undefined;
}

// Keep the reading order consistent across incidents, alerts, and maintenance.
const EventOverviewLayout: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const id: string = useId();
  const { translateString } = useTranslateValue();
  const activityId: string = `${id}-activity`;
  const detailsId: string = `${id}-details`;
  const skipLinkClassName: string =
    "sr-only focus:not-sr-only focus:inline-flex focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-indigo-700 focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="min-w-0" data-testid="event-overview">
      <nav aria-label={translateString("Overview shortcuts")}>
        <a href={`#${activityId}`} className={skipLinkClassName}>
          {translateString("Skip to activity")}
        </a>
        <a href={`#${detailsId}`} className={skipLinkClassName}>
          {translateString("Skip to details")}
        </a>
      </nav>

      <div className="space-y-4">
        <div>{props.header}</div>
        <section aria-label={translateString("Event summary")}>
          {props.summary}
        </section>
      </div>

      <div className="mt-6 grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <section
          id={activityId}
          tabIndex={-1}
          aria-labelledby={`${activityId}-heading`}
          className="min-w-0 scroll-mt-6 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <div className="mb-4">
            <h2
              id={`${activityId}-heading`}
              className="text-sm font-semibold text-gray-900"
            >
              {translateString(props.activityTitle || "Response activity")}
            </h2>
            {props.activityDescription && (
              <p className="mt-1 text-sm leading-5 text-gray-500">
                {translateString(props.activityDescription)}
              </p>
            )}
          </div>
          {props.children}
        </section>

        <aside
          id={detailsId}
          tabIndex={-1}
          aria-labelledby={`${detailsId}-heading`}
          className="min-w-0 scroll-mt-6 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <h2
            id={`${detailsId}-heading`}
            className="mb-4 text-sm font-semibold text-gray-900"
          >
            {translateString(props.sidebarTitle || "Details")}
          </h2>
          {props.sidebar}
        </aside>
      </div>
    </div>
  );
};

export default EventOverviewLayout;
