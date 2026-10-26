import React, {
  FunctionComponent,
  ReactElement,
  RefObject,
  useContext,
  useId,
  useRef,
  useState,
  useEffect,
} from "react";
import PageTrailEndContext from "../Page/PageTrailEnd";
import {
  fitSideMenuCard,
  getSideMenuFadeClassName,
  revealCurrentSideMenuEntry,
  SIDE_MENU_SCROLL_PADDING_CLASS_NAME,
  SideMenuHiddenEdges,
} from "./SideMenuScroll";
import {
  getDrawnLanguage,
  getMenuWordsBreakClassName,
} from "./SideMenuEntryState";
import useSideMenuHiddenEdges from "./UseSideMenuHiddenEdges";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
import Navigation from "../../Utils/Navigation";
import useTranslateValue from "../../Utils/Translation";
import SideMenuItem from "./SideMenuItem";
import SideMenuSection, {
  ComponentProps as SideMenuSectionElementProps,
} from "./SideMenuSection";
import {
  MenuRoute,
  routesInMenuChildren,
  routesOfMenuEntry,
  sectionsHoldingCurrentPage,
} from "./SideMenuSectionState";
import CountModelSideMenuItem from "./CountModelSideMenuItem";
import Link from "../../../Types/Link";
import { BadgeType } from "../Badge/Badge";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "../../../Types/BaseDatabase/Query";
import { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";

export interface SideMenuItemProps {
  link: Link;
  // Use a different route for selection when the link target also changes query state.
  activeRoute?: Link["to"] | undefined;
  showAlert?: boolean;
  showWarning?: boolean;
  badge?: number;
  badgeType?: BadgeType;
  icon?: IconProp;
  className?: string;
  subItemLink?: Link | undefined;
  subItemIcon?: IconProp;
  // For CountModelSideMenuItem support
  modelType?: { new (): BaseModel };
  countQuery?: Query<any>;
  requestOptions?: RequestOptions;
  onCountFetchInit?: () => void;
}

export interface SideMenuSectionProps {
  title: string;
  items: SideMenuItemProps[];
  icon?: IconProp;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
}

export interface ComponentProps {
  sections?: SideMenuSectionProps[];
  items?: SideMenuItemProps[];
  className?: string;
  header?: ReactElement;
  footer?: ReactElement;
  // Keep children support for backward compatibility
  children?: ReactElement | Array<ReactElement>;
}

type MapSectionFunction = (
  section: ReactElement<SideMenuSectionElementProps>,
) => ReactElement;

/*
 * Rebuilds a menu's hand-written children with every <SideMenuSection> passed
 * through `mapSection`, in menu order. It looks inside fragments, because a
 * section shown only in some editions is written as
 * `{cond ? <SideMenuSection .../> : <></>}`, and leaves everything else as
 * it is.
 */
function mapSectionElements(
  children: ReactElement | Array<ReactElement>,
  mapSection: MapSectionFunction,
): Array<ReactElement> {
  const elements: Array<ReactElement> = Array.isArray(children)
    ? children
    : [children];

  return elements.map((child: ReactElement): ReactElement => {
    if (!React.isValidElement(child)) {
      return child;
    }

    if (child.type === SideMenuSection) {
      return mapSection(child as ReactElement<SideMenuSectionElementProps>);
    }

    if (child.type === React.Fragment) {
      const fragmentChildren: ReactElement | Array<ReactElement> | undefined = (
        child.props as { children?: ReactElement | Array<ReactElement> }
      ).children;

      if (!fragmentChildren) {
        return child;
      }

      return React.cloneElement(
        child,
        {},
        ...mapSectionElements(fragmentChildren, mapSection),
      );
    }

    return child;
  });
}

/*
 * The hand-written form gets the same "this section holds the page you are
 * on" answer the `sections` array gets, so a section that starts collapsed
 * (an Advanced section, say) still opens on its own pages. Before, only the
 * array form computed it; written as JSX, which is how every resource's own
 * menu is written, a collapsed section stayed shut on its own pages.
 *
 * A section that is given `isActive` explicitly keeps it.
 */
function withActiveSections(
  children: ReactElement | Array<ReactElement>,
): Array<ReactElement> {
  const sectionRoutes: Array<Array<MenuRoute>> = [];

  mapSectionElements(
    children,
    (section: ReactElement<SideMenuSectionElementProps>): ReactElement => {
      sectionRoutes.push(routesInMenuChildren(section.props.children));
      return section;
    },
  );

  const holdsCurrentPage: Array<boolean> =
    sectionsHoldingCurrentPage(sectionRoutes);
  let sectionIndex: number = 0;

  return mapSectionElements(
    children,
    (section: ReactElement<SideMenuSectionElementProps>): ReactElement => {
      const isActive: boolean = Boolean(holdsCurrentPage[sectionIndex]);
      sectionIndex++;

      if (section.props.isActive !== undefined) {
        return section;
      }

      return React.cloneElement(section, { isActive });
    },
  );
}

const SideMenu: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  const { translateString, language } = useTranslateValue();
  // The Page's last breadcrumb, for a page none of the entries read here is for.
  const pageTrailEnd: Link | null = useContext(PageTrailEndContext);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isMobileMenuVisible, setIsMobileMenuVisible] =
    useState<boolean>(false);
  // The lists that scroll: the desktop menu's, and the phone menu's when open.
  const desktopListRef: RefObject<HTMLElement> = useRef<HTMLElement>(null);
  // The desktop menu's card, fitted to end above the window's bottom edge.
  const desktopCardRef: RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const mobileListRef: RefObject<HTMLElement> = useRef<HTMLElement>(null);
  const mobileMenuId: string = `side-menu-${useId()}`;
  const currentPath: string = Navigation.getCurrentPath().toString();

  // Use the existing outside click hook for mobile menu
  const {
    ref: mobileMenuRef,
    isComponentVisible: isMobileMenuOpen,
    setIsComponentVisible: setIsMobileMenuOpen,
  } = useComponentOutsideClick(false);

  // Sync local state with hook state
  useEffect(() => {
    setIsMobileMenuVisible(isMobileMenuOpen);
  }, [isMobileMenuOpen]);

  /*
   * The edges of each list with entries behind them, which fade out
   * (SideMenuScroll): the desktop menu's, and the phone menu's while open.
   */
  const desktopList: {
    hiddenEdges: SideMenuHiddenEdges;
    onScroll: () => void;
  } = useSideMenuHiddenEdges(desktopListRef, !isMobile);
  const mobileList: {
    hiddenEdges: SideMenuHiddenEdges;
    onScroll: () => void;
  } = useSideMenuHiddenEdges(mobileListRef, isMobile && isMobileMenuVisible);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  // Close mobile menu when clicking on a menu item
  /*
   * Following a link closes the phone menu; opening or closing a section
   * must not. The handler sits on the whole <nav>, so a tap on a section's
   * header used to close the menu too: a folded section (Advanced, or a
   * product's Settings) could never be opened on a phone, and its pages were
   * out of reach from the menu.
   */
  const handleMenuItemClick: (event: React.MouseEvent<HTMLElement>) => void = (
    event: React.MouseEvent<HTMLElement>,
  ): void => {
    const target: EventTarget | null = event.target;

    if (!(target instanceof Element) || !target.closest("a")) {
      return;
    }

    if (isMobile && isMobileMenuVisible) {
      setIsMobileMenuOpen(false);
    }
  };

  /*
   * Walks the JSX children of a `<SideMenu>` written in the hand-rolled form
   * and returns whichever entry points at the current page.
   *
   * It matches on the shape of the props rather than on component identity —
   * an element with a `link` is a menu entry, an element with a `title` and
   * children is a section — so it keeps working for the components built on
   * top of SideMenuItem, and simply finds nothing for anything else (a
   * fragment, a comment, a caller's own wrapper div) rather than throwing.
   */
  type ActiveMenuItem = {
    sectionTitle?: string;
    itemTitle?: string;
    icon?: IconProp;
  };

  type FindActiveInChildrenFunction = (
    children: ReactElement | Array<ReactElement> | undefined,
    sectionTitle?: string | undefined,
  ) => ActiveMenuItem;

  const findActiveInChildren: FindActiveInChildrenFunction = (
    children: ReactElement | Array<ReactElement> | undefined,
    sectionTitle?: string | undefined,
  ): ActiveMenuItem => {
    if (!children) {
      return {};
    }

    for (const child of React.Children.toArray(children)) {
      if (!React.isValidElement(child)) {
        continue;
      }

      const childProps: {
        link?: Link | undefined;
        activeRoute?: Link["to"] | undefined;
        icon?: IconProp | undefined;
        title?: string | undefined;
        children?: ReactElement | Array<ReactElement> | undefined;
      } = child.props as {
        link?: Link | undefined;
        activeRoute?: Link["to"] | undefined;
        icon?: IconProp | undefined;
        title?: string | undefined;
        children?: ReactElement | Array<ReactElement> | undefined;
      };

      /*
       * `activeRoute` first, matching the two loops above: an entry whose link
       * carries query state points somewhere the current URL never equals, and
       * declares the route that decides selection separately.
       */
      const matchRoute: Link["to"] | undefined =
        childProps.activeRoute || childProps.link?.to;

      if (
        childProps.link &&
        matchRoute &&
        Navigation.isOnThisPage(matchRoute)
      ) {
        const result: ActiveMenuItem = { itemTitle: childProps.link.title };

        if (sectionTitle) {
          result.sectionTitle = sectionTitle;
        }
        if (childProps.icon) {
          result.icon = childProps.icon;
        }

        return result;
      }

      if (childProps.children) {
        const nested: ActiveMenuItem = findActiveInChildren(
          childProps.children,
          childProps.title || sectionTitle,
        );

        if (nested.itemTitle) {
          return nested;
        }
      }
    }

    return {};
  };

  // Function to find the active menu item and section - much simpler now!
  const findActiveMenuItem: () => {
    sectionTitle?: string;
    itemTitle?: string;
    icon?: IconProp;
  } = (): {
    sectionTitle?: string;
    itemTitle?: string;
    icon?: IconProp;
  } => {
    // Check sections first
    if (props.sections) {
      for (const section of props.sections) {
        for (const item of section.items) {
          if (Navigation.isOnThisPage(item.activeRoute || item.link.to)) {
            const result: {
              sectionTitle: string;
              itemTitle: string;
              icon?: IconProp;
            } = {
              sectionTitle: section.title,
              itemTitle: item.link.title,
            };
            if (item.icon) {
              result.icon = item.icon;
            }
            return result;
          }
        }
      }
    }

    // Check direct items
    if (props.items) {
      for (const item of props.items) {
        if (Navigation.isOnThisPage(item.activeRoute || item.link.to)) {
          const result: {
            itemTitle: string;
            icon?: IconProp;
          } = {
            itemTitle: item.link.title,
          };
          if (item.icon) {
            result.icon = item.icon;
          }
          return result;
        }
      }
    }

    /*
     * ...and finally the hand-written JSX form.
     *
     * Roughly half the menus in the product are written as
     * `<SideMenu><SideMenuSection>…<SideMenuItem/>…` rather than as a
     * `sections` array — including every resource View menu. Neither loop
     * above can see those, so on a phone all of them labelled their toggle
     * with the fallback word "Navigation" instead of the page the user is
     * actually on. The summary is the ONLY thing naming the current page
     * while the menu is closed, which is most of the time on a phone.
     *
     * This reads the same two props off the elements the caller wrote, so it
     * covers SideMenuItem, CountModelSideMenuItem and the per-feature items
     * built on top of them (RecommendationsSideMenuItem) without knowing
     * anything about their types.
     */
    return findActiveInChildren(props.children);
  };

  const activeItem: {
    sectionTitle?: string;
    itemTitle?: string;
    icon?: IconProp;
  } = findActiveMenuItem();
  const translatedSectionTitle: string | undefined = translateString(
    activeItem.sectionTitle,
  );
  const translatedItemTitle: string | undefined = translateString(
    activeItem.itemTitle,
  );
  /*
   * "Section / Page" names where the reader is - except when the page is
   * named like its section (a monitor's Overview, under Overview), which
   * read "Overview / Overview".
   */
  const isPageNamedLikeSection: boolean = Boolean(
    translatedSectionTitle &&
      translatedItemTitle &&
      translatedSectionTitle.trim().toLocaleLowerCase() ===
        translatedItemTitle.trim().toLocaleLowerCase(),
  );
  /*
   * An entry the menu cannot read (an Enterprise plugin's own component) or
   * a page it does not list: named by the page's trail, as its breadcrumbs
   * end, rather than "Navigation", which says nothing of where the reader is.
   */
  const pageTrailEndTitle: string | undefined = pageTrailEnd
    ? pageTrailEnd.recordName ||
      (pageTrailEnd.isRecordName
        ? pageTrailEnd.title
        : translateString(pageTrailEnd.title))
    : undefined;
  // The section named before the page, when the summary names one.
  const summarySection: string | undefined =
    translatedSectionTitle && translatedItemTitle && !isPageNamedLikeSection
      ? translatedSectionTitle
      : undefined;
  const summaryPage: string =
    translatedItemTitle ||
    pageTrailEndTitle ||
    translateString("Navigation") ||
    "Navigation";
  // The English the page's name was drawn from, to tell its language by.
  const summaryPageEnglish: string | undefined = translatedItemTitle
    ? activeItem.itemTitle
    : pageTrailEnd
      ? pageTrailEnd.recordName || pageTrailEnd.title
      : "Navigation";
  const summarySectionLanguage: string | undefined = getDrawnLanguage({
    english: activeItem.sectionTitle,
    drawn: summarySection,
    language: language,
  });
  const summaryPageLanguage: string | undefined = getDrawnLanguage({
    english: summaryPageEnglish,
    drawn: summaryPage,
    language: language,
  });

  // Measuring the lists' hidden edges again, when the menu moves them.
  const measureDesktopEdges: () => void = desktopList.onScroll;
  const measureMobileEdges: () => void = mobileList.onScroll;

  /*
   * The lit entry, in sight inside the menu when a page opens (SideMenuScroll):
   * after the next frame, once a section that holds the page has opened. The
   * list's fades follow at once, not on the scroll event a frame later.
   */
  useEffect(() => {
    if (isMobile) {
      return;
    }

    let frame: number = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        // The page above the menu may have changed: fit, then reveal.
        fitSideMenuCard(desktopCardRef.current);
        revealCurrentSideMenuEntry(desktopListRef.current);
        measureDesktopEdges();
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [currentPath, isMobile, measureDesktopEdges]);

  /*
   * The desktop menu's card ends above the window's bottom edge wherever it
   * is (SideMenuScroll.fitSideMenuCard): under the page's title on a page not
   * yet scrolled, below the app's header once it sticks there. As the page
   * scrolls, the card grows into the room it is given; nothing re-renders.
   * A banner or a title that arrives above it later moves the card down:
   * the page grows then, and the card is fitted again.
   */
  useEffect(() => {
    if (isMobile) {
      return;
    }

    let frame: number = 0;

    const refit: () => void = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        fitSideMenuCard(desktopCardRef.current);
      });
    };

    fitSideMenuCard(desktopCardRef.current);
    window.addEventListener("scroll", refit, { passive: true });
    window.addEventListener("resize", refit);

    // Missing in jsdom and older browsers: scroll and resize still refit.
    const pageSize: ResizeObserver | null =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refit);
    pageSize?.observe(document.body);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", refit);
      window.removeEventListener("resize", refit);
      pageSize?.disconnect();
    };
  }, [isMobile]);

  // ...and in the phone's menu, each time it opens.
  useEffect(() => {
    if (!isMobile || !isMobileMenuVisible) {
      return;
    }

    const frame: number = window.requestAnimationFrame(() => {
      revealCurrentSideMenuEntry(mobileListRef.current);
      measureMobileEdges();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isMobile, isMobileMenuVisible, measureMobileEdges]);

  // Render function for the menu content
  const renderMenuContent: () => ReactElement[] = (): ReactElement[] => {
    const content: ReactElement[] = [];

    // Render sections
    if (props.sections) {
      /*
       * Which sections hold the current page: the one with the entry for it,
       * or, on a page the menu does not list (one API key, a timeline), the
       * one with its nearest ancestor. A section that starts collapsed opens
       * on those pages.
       */
      const holdsCurrentPage: Array<boolean> = sectionsHoldingCurrentPage(
        props.sections.map(
          (section: SideMenuSectionProps): Array<MenuRoute> => {
            return section.items.flatMap(routesOfMenuEntry);
          },
        ),
      );

      props.sections.forEach(
        (section: SideMenuSectionProps, sectionIndex: number) => {
          // Build section props conditionally to avoid undefined values
          const sectionProps: {
            key: string;
            title: string;
            icon?: IconProp;
            defaultCollapsed?: boolean;
            collapsible?: boolean;
            isActive: boolean;
          } = {
            key: `section-${sectionIndex}`,
            title: section.title,
            isActive: Boolean(holdsCurrentPage[sectionIndex]),
          };

          if (section.icon) {
            sectionProps.icon = section.icon;
          }
          if (section.defaultCollapsed !== undefined) {
            sectionProps.defaultCollapsed = section.defaultCollapsed;
          }
          if (section.collapsible !== undefined) {
            sectionProps.collapsible = section.collapsible;
          }

          content.push(
            <SideMenuSection {...sectionProps}>
              {section.items.map(
                (item: SideMenuItemProps, itemIndex: number) => {
                  // If item has modelType, render CountModelSideMenuItem
                  if (item.modelType && item.countQuery) {
                    return (
                      <CountModelSideMenuItem
                        key={`section-${sectionIndex}-count-item-${itemIndex}`}
                        link={item.link}
                        activeRoute={item.activeRoute}
                        badgeType={item.badgeType}
                        modelType={item.modelType as any}
                        countQuery={item.countQuery as any}
                        requestOptions={item.requestOptions}
                        icon={item.icon}
                        className={item.className}
                        onCountFetchInit={item.onCountFetchInit}
                      />
                    );
                  }

                  // Otherwise render regular SideMenuItem
                  return (
                    <SideMenuItem
                      key={`section-${sectionIndex}-item-${itemIndex}`}
                      link={item.link}
                      activeRoute={item.activeRoute}
                      showAlert={item.showAlert}
                      showWarning={item.showWarning}
                      badge={item.badge}
                      badgeType={item.badgeType}
                      icon={item.icon}
                      className={item.className}
                      subItemLink={item.subItemLink}
                      subItemIcon={item.subItemIcon}
                    />
                  );
                },
              )}
            </SideMenuSection>,
          );
        },
      );
    }

    // Render direct items
    if (props.items) {
      props.items.forEach((item: SideMenuItemProps, itemIndex: number) => {
        // If item has modelType, render CountModelSideMenuItem
        if (item.modelType && item.countQuery) {
          content.push(
            <CountModelSideMenuItem
              key={`count-item-${itemIndex}`}
              link={item.link}
              activeRoute={item.activeRoute}
              badgeType={item.badgeType}
              modelType={item.modelType as any}
              countQuery={item.countQuery as any}
              requestOptions={item.requestOptions}
              icon={item.icon}
              className={item.className}
              onCountFetchInit={item.onCountFetchInit}
            />,
          );
        } else {
          // Otherwise render regular SideMenuItem
          content.push(
            <SideMenuItem
              key={`item-${itemIndex}`}
              link={item.link}
              activeRoute={item.activeRoute}
              showAlert={item.showAlert}
              showWarning={item.showWarning}
              badge={item.badge}
              badgeType={item.badgeType}
              icon={item.icon}
              className={item.className}
              subItemLink={item.subItemLink}
              subItemIcon={item.subItemIcon}
            />,
          );
        }
      });
    }

    // Support legacy children prop for backward compatibility
    if (props.children) {
      withActiveSections(props.children).forEach(
        (child: ReactElement, index: number) => {
          if (React.isValidElement(child)) {
            content.push(React.cloneElement(child, { key: `child-${index}` }));
          }
        },
      );
    }

    return content;
  };

  // Mobile view
  if (isMobile) {
    return (
      <div className="md:hidden mb-6">
        {/* Mobile toggle button */}
        <button
          type="button"
          onClick={() => {
            setIsMobileMenuOpen(!isMobileMenuVisible);
          }}
          className={`
            w-full flex items-center justify-between
            px-3 py-2.5
            bg-white rounded-xl
            border border-gray-200
            shadow-sm
            transition-all duration-200
            ${isMobileMenuVisible ? "ring-2 ring-indigo-100 border-indigo-200" : "hover:border-gray-300"}
          `}
          /*
           * Named by what it shows, "Navigate to Settings / Roles", and
           * aria-expanded says whether its menu is open. A name of its own
           * ("Open navigation menu") hid where the reader is from a screen
           * reader, and a person speaking the words on the button could
           * not press it.
           */
          aria-expanded={isMobileMenuVisible}
          aria-controls={isMobileMenuVisible ? mobileMenuId : undefined}
          data-testid="mobile-sidemenu-toggle"
        >
          <div className="flex items-center gap-2 min-w-0">
            {activeItem.icon && (
              <div className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex-shrink-0">
                <Icon icon={activeItem.icon} className="h-3.5 w-3.5" />
              </div>
            )}
            {/*
             * text-start: a <button> centres its text, which set "Navigate
             * to" off-centre above the page's name, the two lines starting
             * at different edges. Both start at the icon's side, in a
             * right-to-left page too.
             */}
            {/*
             * Where the reader is, whole: cut to one line, "Notifications /
             * Notification Settings" lost its last word, and a long name in
             * German or French more. A second line takes the page's name
             * whole when the two do not fit together - the section and the
             * page each keep together while they fit a line - and a word
             * longer than the line is hyphenated in its language
             * (getDrawnLanguage, getMenuWordsBreakClassName), or else breaks
             * at its edge.
             */}
            <div className="min-w-0 text-start">
              <p className="text-xs text-gray-400 font-medium">
                {translateString("Navigate to")}
              </p>
              <h3 className="text-sm font-semibold text-gray-900 break-words">
                {summarySection ? (
                  <>
                    <span
                      className={`inline-block max-w-full ${getMenuWordsBreakClassName(
                        {
                          text: summarySection,
                          lang: summarySectionLanguage,
                        },
                      )}`}
                      lang={summarySectionLanguage}
                    >
                      {`${summarySection} /`}
                    </span>{" "}
                    <span
                      className={`inline-block max-w-full ${getMenuWordsBreakClassName(
                        {
                          text: summaryPage,
                          lang: summaryPageLanguage,
                        },
                      )}`}
                      lang={summaryPageLanguage}
                    >
                      {summaryPage}
                    </span>
                  </>
                ) : (
                  <span
                    className={getMenuWordsBreakClassName({
                      text: summaryPage,
                      lang: summaryPageLanguage,
                    })}
                    lang={summaryPageLanguage}
                  >
                    {summaryPage}
                  </span>
                )}
              </h3>
            </div>
          </div>
          <div
            className={`
              flex items-center justify-center
              w-6 h-6 rounded-md
              transition-all duration-200
              ${isMobileMenuVisible ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-500"}
            `}
          >
            <Icon
              icon={isMobileMenuVisible ? IconProp.Close : IconProp.Bars3}
              className="h-3.5 w-3.5"
            />
          </div>
        </button>

        {/* Mobile collapsible menu with overlay */}
        {isMobileMenuVisible && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
              onClick={() => {
                setIsMobileMenuOpen(false);
              }}
            />

            {/* Menu Panel */}
            <div
              ref={mobileMenuRef}
              id={mobileMenuId}
              className={`
                relative z-50
                mt-2
                bg-white rounded-xl
                border border-gray-200
                shadow-xl
                overflow-hidden
                animate-in slide-in-from-top-2 fade-in duration-200
              `}
              role="navigation"
              aria-label={translateString("Main navigation")}
            >
              {/* Optional Header */}
              {props.header && (
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50">
                  {props.header}
                </div>
              )}

              {/*
               * Menu Items. An edge with entries behind it fades out, and
               * the lit entry is brought into sight with the next one
               * peeking past it (SideMenuScroll).
               */}
              <nav
                ref={mobileListRef}
                className={`p-2 max-h-[60vh] overflow-y-auto ${SIDE_MENU_SCROLL_PADDING_CLASS_NAME} ${getSideMenuFadeClassName(
                  mobileList.hiddenEdges,
                )}`}
                data-hidden-top={mobileList.hiddenEdges.top ? "true" : "false"}
                data-hidden-bottom={
                  mobileList.hiddenEdges.bottom ? "true" : "false"
                }
                onScroll={mobileList.onScroll}
                onClick={handleMenuItemClick}
              >
                <div className="space-y-0.5">{renderMenuContent()}</div>
              </nav>

              {/* Optional Footer */}
              {props.footer && (
                <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50">
                  {props.footer}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Desktop view
  return (
    <aside
      /*
       * w-56 rather than w-52. Page.tsx lays the menu out beside a
       * `flex-1 min-w-0` content column, so this class is the only thing
       * setting the sidebar's width — and at 208px the longest shipped titles
       * ("Scheduled Maintenance", "Recommendations" beside a badge) were
       * ellipsised on every page that has them. 16px buys those back without
       * taking a visible bite out of the content column.
       *
       * `max-md:hidden`, not `hidden`, for the reason given on the NavBar's
       * desktop view: a foreign `.hidden` rule must not remove the menu.
       */
      className={`max-md:hidden md:block w-56 lg:w-64 flex-shrink-0 mb-10 ${props.className || ""}`}
      role="navigation"
      aria-label={translateString("Main navigation")}
    >
      {/*
       * Stick below the app header, not at the top of the viewport. The header
       * is sticky too, so a plain `top-6` slides the first menu items behind it
       * as soon as the page scrolls. --app-header-height is measured and
       * published by MasterPage; the 0px fallback keeps this correct on pages
       * that render without a sticky header.
       */}
      <div
        className="sticky"
        style={{ top: "calc(var(--app-header-height, 0px) + 1.5rem)" }}
      >
        {/*
         * rounded-xl and a plain border-gray-200, matching Card and InfoCard.
         * The menu sits directly beside those, and it was the only page-level
         * surface in the product with a 1rem radius and a translucent border —
         * which read as a slightly different shade of white next to them.
         */}
        <div
          className={`
            flex flex-col
            bg-white rounded-xl
            border border-gray-200
            shadow-sm
            overflow-hidden
          `}
          /*
           * Menus longer than the viewport (the Kubernetes cluster menu, for
           * one) would otherwise get pushed back up behind the header near the
           * bottom of a long page. Cap the card to the space left under the
           * header and let the item list scroll inside it instead. That is
           * its height once it sticks below the header; until then it is
           * fitted to end above the window's bottom edge (fitSideMenuCard).
           */
          ref={desktopCardRef}
          style={{
            maxHeight: "calc(100vh - var(--app-header-height, 0px) - 3rem)",
          }}
        >
          {/* Optional Header */}
          {props.header && (
            <div className="flex-shrink-0 px-3 py-3 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
              {props.header}
            </div>
          )}

          {/*
           * Menu Content. Scrolled, or with entries below its fold, the list
           * fades out at that edge, so the reader sees it goes on - its
           * scrollbar shows only while it scrolls on many screens - and the
           * keyboard's focus stays clear of the fades (SideMenuScroll).
           */}
          <nav
            ref={desktopListRef}
            className={`p-2 min-h-0 overflow-y-auto ${SIDE_MENU_SCROLL_PADDING_CLASS_NAME} ${getSideMenuFadeClassName(
              desktopList.hiddenEdges,
            )}`}
            data-hidden-top={desktopList.hiddenEdges.top ? "true" : "false"}
            data-hidden-bottom={
              desktopList.hiddenEdges.bottom ? "true" : "false"
            }
            onScroll={desktopList.onScroll}
          >
            <div className="space-y-1">{renderMenuContent()}</div>
          </nav>

          {/* Optional Footer */}
          {props.footer && (
            <div className="flex-shrink-0 px-3 py-2 border-t border-gray-100 bg-gray-50/50">
              {props.footer}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default SideMenu;
