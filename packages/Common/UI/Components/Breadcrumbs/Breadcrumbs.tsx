import Icon from "../Icon/Icon";
import IsolatedText from "../IsolatedText/IsolatedText";
import UILink from "../Link/Link";
import { getRecordCrumbName } from "../Page/RecordNameInTrail";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

interface ComponentProps {
  links: Array<Link>;
}

/*
 * The crumb that stands for a numbered record (Link.recordNumber): "INC-18
 * Manually declared". At most a line's worth, like any record's crumb. The
 * number keeps its whole width and the name gives way, cut short with an
 * ellipsis at its own end - on a right-to-left page too, where the number
 * starts the crumb on the right and an English name still reads from its
 * start. The whole of it on hover.
 *
 * A box of its own (flex, not inline-flex), so on a phone it is as wide as
 * the trail leaves it and no wider: an inline box is never narrower than its
 * text, and "INC-1042 Checkout API p95 latency above 2s" pushed a 320px
 * page sideways.
 *
 * On a phone the crumb is the number alone: "Project > Incidents >
 * INC-1042". The page's heading, right under the trail, names the record
 * whole there, and the name cut short on a line of its own was a second,
 * shorter copy of it. A screen reader still hears the name with the number
 * (sr-only), as it does from 640px up, where the crumb shows both.
 */
export const BREADCRUMB_NUMBERED_RECORD_CLASS_NAME: string =
  "flex min-w-0 max-w-xs items-baseline";

export const BREADCRUMB_RECORD_NUMBER_CLASS_NAME: string =
  "shrink-0 whitespace-nowrap";

// The space between the number and the name: a flex row draws no other.
export const BREADCRUMB_RECORD_NUMBER_SEPARATOR_CLASS_NAME: string =
  "max-sm:sr-only";

export const BREADCRUMB_RECORD_NUMBER_NAME_CLASS_NAME: string =
  "min-w-0 truncate max-sm:sr-only";

// Any other record's crumb: its name, cut short the same way.
export const BREADCRUMB_RECORD_NAME_CLASS_NAME: string =
  "block max-w-xs truncate";

/*
 * Every crumb, and the link in it, may be narrower than its words: none is
 * wider than the trail, so a record's crumb gives way on a phone instead of
 * pushing the page sideways. A crumb as wide as its words is drawn as before.
 */
export const BREADCRUMB_ITEM_CLASS_NAME: string =
  "breadcrumb-item min-w-0 max-w-full";

export const BREADCRUMB_LINK_CLASS_NAME: string =
  "ml-1 min-w-0 text-sm font-medium text-gray-500 hover:text-gray-700 -mt-1";

const Breadcrumbs: FunctionComponent<ComponentProps> = ({
  links,
}: ComponentProps): ReactElement => {
  const { translateString } = useTranslateValue();
  return (
    <nav className="block" aria-label={translateString("Breadcrumb")}>
      <ol role="list" className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {links &&
          links.length > 0 &&
          links.map((link: Link, i: number) => {
            // A record's name is drawn as typed (Link.isRecordName).
            const translatedTitle: string = link.isRecordName
              ? link.title
              : translateString(link.title) || link.title;

            /*
             * The record's name in place of the page's ("View Monitor"),
             * as typed (Link.recordName). Cut short past a line's worth,
             * with the whole of it on hover: an incident's title can be a
             * sentence. A numbered record's number before it, whole.
             */
            let shownTitle: ReactElement | string = translatedTitle;

            if (link.recordNumber) {
              shownTitle = (
                <span
                  className={BREADCRUMB_NUMBERED_RECORD_CLASS_NAME}
                  title={getRecordCrumbName(link)}
                  data-testid="breadcrumb-record-name"
                >
                  <bdi
                    className={BREADCRUMB_RECORD_NUMBER_CLASS_NAME}
                    data-testid="breadcrumb-record-number"
                  >
                    {link.recordNumber}
                  </bdi>
                  {link.recordName ? (
                    <>
                      <span
                        className={
                          BREADCRUMB_RECORD_NUMBER_SEPARATOR_CLASS_NAME
                        }
                      >
                        {"\u00a0"}
                      </span>
                      <IsolatedText
                        className={BREADCRUMB_RECORD_NUMBER_NAME_CLASS_NAME}
                        text={link.recordName}
                        dataTestId="breadcrumb-record-number-name"
                      />
                    </>
                  ) : (
                    <></>
                  )}
                </span>
              );
            } else if (link.recordName) {
              shownTitle = (
                <span
                  className={BREADCRUMB_RECORD_NAME_CLASS_NAME}
                  title={link.recordName}
                  data-testid="breadcrumb-record-name"
                >
                  {link.recordName}
                </span>
              );
            }
            return (
              <li className={BREADCRUMB_ITEM_CLASS_NAME} key={i}>
                {i === 0 && (
                  <div className="-mt-1">
                    <UILink
                      to={link.to}
                      className="text-gray-400 hover:text-gray-500 -mt-1"
                    >
                      <span className="text-sm font-medium text-gray-500 hover:text-gray-700 -mt-1">
                        {shownTitle}
                      </span>
                    </UILink>
                  </div>
                )}

                {i !== 0 && (
                  <div className="flex min-w-0 items-center">
                    <Icon
                      className="h-5 w-5 flex-shrink-0 text-gray-400"
                      icon={IconProp.ChevronRight}
                    />
                    {/*
                     * The page you are on is text, not a link to itself,
                     * and says so to a screen reader (aria-current), as
                     * the side menu's entry for it does.
                     */}
                    <UILink
                      to={
                        isCurrentPage(link.to)
                          ? null // Avoid linking to current page
                          : link.to
                      }
                      ariaCurrent={isCurrentPage(link.to) ? "page" : undefined}
                      className={BREADCRUMB_LINK_CLASS_NAME}
                    >
                      {shownTitle}
                    </UILink>
                  </div>
                )}
              </li>
            );
          })}
      </ol>
    </nav>
  );
};

function isCurrentPage(linkTo: Route | URL): boolean {
  return linkTo.toString() === window.location.pathname;
}

export default Breadcrumbs;
