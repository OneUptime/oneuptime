import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  MarkdownLinkBehavior,
  getCurrentPageUrl,
  getMarkdownLinkBehavior,
} from "./MarkdownLinkBehavior";
import { handleAuthenticatedLinkClick } from "../../Utils/OpenAuthenticatedUrl";
import Navigation from "../../Utils/Navigation";
import Route from "../../../Types/API/Route";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

/*
 * A link in rendered Markdown (MarkdownViewer's `a`).
 *
 * Where it opens is decided here, from its address alone
 * (MarkdownLinkBehavior): a link that leaves the app - another site, an
 * attachment - opens in a tab of its own, so the reader's OneUptime tab
 * stays where it was. Nothing the Markdown says can change that: it has no
 * way to write a target or a rel (react-markdown renders no HTML), and any
 * that reached this component would be dropped all the same.
 */

/*
 * [overflow-wrap:anywhere]: an address pasted into a note is one long word
 * ("https://grafana.example/d/checkout-api-latency?..."), and on a phone it
 * ran out past the note's edge, cut off. It wraps inside the note instead,
 * in a table cell too, as the product's Alert wraps its message.
 */
export const MARKDOWN_LINK_CLASS_NAME: string =
  "underline text-blue-600 hover:text-blue-800 font-medium transition-colors [overflow-wrap:anywhere]";

// What a link that opens a tab of its own tells a screen reader.
export const NEW_TAB_DESCRIPTION: string = translationKey("Opens in a new tab");

/*
 * A plain click on a link to another page of the same app opens it inside
 * the app (Navigation), as the app's own links do, instead of loading the
 * whole app again - and losing what the page had loaded. A click with a
 * modifier key or another button is the browser's (a new tab or window),
 * and so is any click where the app has no router to open it with, or the
 * address is not one it takes: the browser loads the page, as it always did.
 */
export const openInApp: (
  event: React.MouseEvent<HTMLAnchorElement>,
  inAppPath: string,
) => void = (
  event: React.MouseEvent<HTMLAnchorElement>,
  inAppPath: string,
): void => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !Navigation.canNavigateInApp()
  ) {
    return;
  }

  let route: Route;

  try {
    route = new Route(inAppPath);
  } catch {
    return;
  }

  event.preventDefault();
  Navigation.navigate(route);
};

export interface MarkdownLinkProps {
  href?: string | undefined;
  title?: string | undefined;
  children?: ReactNode;
  // The rest of what react-markdown hands over (a footnote's id, aria-*).
  [attribute: string]: unknown;
}

const MarkdownLink: FunctionComponent<MarkdownLinkProps> = (
  props: MarkdownLinkProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * react-markdown's own `node`, and whatever might claim where the link
   * opens, are never put on the element.
   */
  const attributes: Record<string, unknown> = { ...props };
  delete attributes["node"];
  delete attributes["children"];
  delete attributes["target"];
  delete attributes["rel"];
  delete attributes["onClick"];

  const href: string | undefined =
    typeof props.href === "string" ? props.href : undefined;

  const behavior: MarkdownLinkBehavior = getMarkdownLinkBehavior(
    href,
    getCurrentPageUrl(),
  );

  if (!behavior.opensInNewTab) {
    const inAppPath: string | null = behavior.inAppPath;

    return (
      <a
        className={MARKDOWN_LINK_CLASS_NAME}
        {...attributes}
        onClick={
          inAppPath
            ? (event: React.MouseEvent<HTMLAnchorElement>): void => {
                openInApp(event, inAppPath);
              }
            : undefined
        }
      >
        {props.children}
      </a>
    );
  }

  const absoluteUrl: string = behavior.absoluteUrl || href || "";

  return (
    <a
      className={MARKDOWN_LINK_CLASS_NAME}
      {...attributes}
      target="_blank"
      rel="noopener noreferrer"
      aria-description={translator.translateText(NEW_TAB_DESCRIPTION)}
      onClick={
        behavior.needsSignedInSession
          ? (event: React.MouseEvent<HTMLAnchorElement>): void => {
              handleAuthenticatedLinkClick(event, absoluteUrl);
            }
          : undefined
      }
    >
      {props.children}
    </a>
  );
};

export default MarkdownLink;
