import Icon from "../Icon/Icon";
import UILink from "../Link/Link";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

interface ComponentProps {
  links: Array<Link>;
}

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
             * sentence.
             */
            const shownTitle: ReactElement | string = link.recordName ? (
              <span
                className="inline-block max-w-xs truncate align-bottom"
                title={link.recordName}
                data-testid="breadcrumb-record-name"
              >
                {link.recordName}
              </span>
            ) : (
              translatedTitle
            );
            return (
              <li className="breadcrumb-item" key={i}>
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
                  <div className="flex items-center">
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
                      className="ml-1 text-sm font-medium text-gray-500 hover:text-gray-700 -mt-1"
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
