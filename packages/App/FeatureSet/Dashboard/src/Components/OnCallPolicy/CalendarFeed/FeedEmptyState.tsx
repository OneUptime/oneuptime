import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The "there is no link yet" panel that every calendar-feed card shows before
 * anything is minted.
 *
 * It replaces what used to be a paragraph of prose sitting above a bare
 * button. This state is the one moment the reader decides whether to
 * subscribe at all, so what the link will contain and who can read it belong
 * in a scannable list beside the action - not in a sentence they have to
 * unpack. The panel also gives the card a body: without it the empty state
 * was a line of grey text and a button floating under the card header.
 *
 * Purely presentational, and the action is passed in rather than built here,
 * because who may take it differs per feed: a personal link needs no
 * permission, while a shared one is gated on Edit and may render a disabled
 * button or a "ask an editor" note instead.
 */
export interface FeedEmptyStatePoint {
  icon: IconProp;
  text: string;
  /** Defaults to the muted grey the cautions use. */
  iconClassName?: string | undefined;
}

export interface ComponentProps {
  /** The state, named in three or four words: "No calendar link yet". */
  title: string;
  /** One sentence saying what the action will do. */
  description: string;
  /** Bullets under the description. Omit for a plain panel. */
  points?: Array<FeedEmptyStatePoint> | undefined;
  /** The primary action, or whatever stands in for it. */
  control: ReactElement;
  /** The badge next to the title. */
  icon?: IconProp | undefined;
  /** Prefix for the data-testids, so two panels on one page stay distinct. */
  idPrefix: string;
}

const FeedEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const points: Array<FeedEmptyStatePoint> = props.points || [];

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-5 sm:px-6 sm:py-6"
      data-testid={`${props.idPrefix}-empty-state`}
    >
      <div className="flex gap-4 sm:gap-5">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm ring-1 ring-inset ring-indigo-100">
          <Icon
            icon={props.icon || IconProp.Calendar}
            className="h-5 w-5"
            data-testid={`${props.idPrefix}-empty-icon`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <h3
            className="text-sm font-semibold text-gray-900"
            data-testid={`${props.idPrefix}-empty-title`}
          >
            {translateString(props.title)}
          </h3>
          <p
            className="mt-1 text-sm leading-relaxed text-gray-600"
            data-testid={`${props.idPrefix}-empty-description`}
          >
            {translateString(props.description)}
          </p>

          {points.length > 0 && (
            <ul
              className="mt-4 space-y-2.5"
              data-testid={`${props.idPrefix}-empty-points`}
            >
              {points.map(
                (point: FeedEmptyStatePoint, index: number): ReactElement => {
                  return (
                    <li
                      key={index}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-gray-600"
                      data-testid={`${props.idPrefix}-empty-point-${index}`}
                    >
                      <Icon
                        icon={point.icon}
                        className={`mt-0.5 h-4 w-4 flex-none ${
                          point.iconClassName || "text-gray-400"
                        }`}
                        data-testid={`${props.idPrefix}-empty-point-icon-${index}`}
                      />
                      <span>{translateString(point.text)}</span>
                    </li>
                  );
                },
              )}
            </ul>
          )}

          <div className="mt-5" data-testid={`${props.idPrefix}-empty-control`}>
            {props.control}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedEmptyState;
