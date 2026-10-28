import Icon from "../Icon/Icon";
import useTranslateValue from "../../Utils/Translation";
import IconProp from "../../../Types/Icon/IconProp";
import { startsCollapsed } from "./SideMenuSectionState";
import {
  getDrawnLanguage,
  getMenuWordsBreakClassName,
} from "./SideMenuEntryState";
import React, {
  FunctionComponent,
  ReactElement,
  RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  title: string;
  children: ReactElement | Array<ReactElement>;
  /*
   * Leave unset to follow the product rule: a section whose title names a
   * rarely used kind of section (Advanced, Developer, Settings, Rules,
   * Workspace, AI, Logs and the rest of SECTION_TITLES_COLLAPSED_BY_DEFAULT
   * in SideMenuSectionState.ts) starts collapsed, every other section starts
   * open. Set it to decide for this section either way.
   */
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  icon?: IconProp;
  /*
   * Whether the page the user is on is inside this section, which keeps it
   * open. SideMenu works this out and passes it in, for sections in its
   * `sections` array and for <SideMenuSection> elements written as its
   * children alike.
   */
  isActive?: boolean;
  /*
   * The app path SideMenu rendered this section for. A section can also hold
   * an entry drawn by an Enterprise component, which the route scan behind
   * `isActive` cannot read; with the path, the section opens for that entry
   * once its row says aria-current, and only when the page changes - a
   * section the reader folded by hand stays folded until then.
   */
  currentPath?: string | undefined;
}

/*
 * A titled group of menu rows.
 *
 * The collapsed body keeps its children mounted and animates a max-height,
 * rather than unmounting them: several menus badge their rows from a fetch on
 * mount, and unmounting a collapsed section would restart those fetches every
 * time it was reopened. The `max-h-0 / opacity-0` pair is also the contract
 * the side-menu tests read collapse state from.
 *
 * Collapsed also means `invisible` (visibility: hidden). max-h-0 and
 * opacity-0 only stop the rows being SEEN: they were still tab stops, so a
 * keyboard user walked through every link of a folded section on a focus
 * ring nobody could see, and a screen reader read them out. visibility:hidden
 * takes them out of the tab order and the accessibility tree while they stay
 * mounted, and the transition flips it only once the fold has finished, so
 * the animation is unchanged.
 */
const SideMenuSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { translateString, language } = useTranslateValue();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    startsCollapsed({
      title: props.title,
      defaultCollapsed: props.defaultCollapsed,
      collapsible: props.collapsible,
      isActive: props.isActive,
    }),
  );
  /*
   * Whether the section last opened by itself, for the page the reader
   * arrived on (below), rather than at the reader's press. Opened for the
   * page, it opens without a transition, drawn at once as a section that
   * starts open is: with one, its rows faded in from nothing whenever the
   * arriving page had measured the menu before the section opened - the very
   * rows the reader had just clicked blinked out and back.
   */
  const [isOpenedForPage, setIsOpenedForPage] = useState<boolean>(false);
  const bodyRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const translatedTitle: string = translateString(props.title) || props.title;
  const titleLanguage: string | undefined = getDrawnLanguage({
    english: props.title,
    drawn: translatedTitle,
    language: language,
  });
  const bodyId: string = `side-menu-section-${useId()}`;

  const isCollapsible: boolean = props.collapsible ?? true;

  useEffect(() => {
    if (props.isActive) {
      setIsCollapsed(false);
    }
  }, [props.isActive]);

  /*
   * The entry for the page the user is on says so with aria-current, and
   * that includes one an Enterprise component draws, which SideMenu's route
   * scan cannot see. Open for it when the page changes: arriving on a page
   * inside a folded section must never hide where the reader is.
   *
   * A layout effect, so the section opens before the browser paints the
   * menu. As a passive effect it ran after the first paint: arriving on
   * Admin Dashboard > Settings > Custom Channels drew Notifications folded
   * for a frame or two (about a tenth of a second), then sprang open - a
   * section the reader had just opened by hand flickered shut and open
   * again.
   */
  useLayoutEffect(() => {
    if (!props.currentPath) {
      return;
    }

    if (bodyRef.current?.querySelector("a[aria-current]")) {
      setIsOpenedForPage(true);
      setIsCollapsed(false);
    }
  }, [props.currentPath]);

  const handleToggle: () => void = (): void => {
    if (isCollapsible) {
      setIsOpenedForPage(false);
      setIsCollapsed(!isCollapsed);
    }
  };

  /*
   * The heading itself. Identical in both branches — only the element around
   * it changes.
   *
   * An <h6> because the side-menu test harness locates a section by its
   * heading; the visual weight comes from the classes, not the level.
   *
   * Drawn whole, on a second line when it needs one: cut to one line, the
   * German "Benachrichtigungsprotokolle" (Notification Logs) read
   * "BENACHRICHTIGUNGSPROT…". A word longer than the line is hyphenated in
   * its language (getDrawnLanguage, getMenuWordsBreakClassName), or else
   * breaks at its edge; a shorter one moves to the next line whole. The lines
   * start at the heading's start (a <button> centres its text), and the
   * icon and the chevron stay level with the first line, so a heading of
   * one line is drawn as before.
   */
  const heading: ReactElement = (
    <div className="flex items-start gap-2 min-w-0">
      {props.icon && (
        <Icon
          icon={props.icon}
          className="mt-px h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
      )}
      <h6
        className={`min-w-0 ${getMenuWordsBreakClassName({
          text: translatedTitle,
          lang: titleLanguage,
        })} text-start text-xs font-semibold uppercase tracking-wider text-gray-400`}
        lang={titleLanguage}
      >
        {translatedTitle}
      </h6>
    </div>
  );

  const headerClassName: string =
    "w-full flex items-start justify-between px-3 pt-2 pb-1 rounded-md";

  return (
    <div className="mb-2 first:mt-0 mt-1">
      {/*
       * Section Header.
       *
       * A section that cannot collapse renders no control at all, rather than
       * a disabled-in-spirit <button aria-expanded="true"> whose handler
       * returns immediately. The chevron and the pointer cursor were already
       * suppressed in that case, so only keyboard and screen-reader users
       * were being offered the phantom: a tab stop announcing an expand
       * control that does nothing when activated.
       */}
      {isCollapsible ? (
        <button
          type="button"
          onClick={handleToggle}
          className={`${headerClassName} cursor-pointer transition-colors duration-150 hover:bg-gray-50`}
          aria-expanded={!isCollapsed}
          aria-controls={bodyId}
        >
          {heading}
          <Icon
            icon={IconProp.ChevronDown}
            className={`mt-px ml-2 h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform duration-200 ${
              isCollapsed ? "-rotate-90 [&:dir(rtl)]:rotate-90" : "rotate-0"
            }`}
          />
        </button>
      ) : (
        <div className={`${headerClassName} cursor-default`}>{heading}</div>
      )}

      {/*
       * Section Content with Animation.
       *
       * A transition follows the property list of the state it goes TO.
       * Folding transitions visibility with the rest, so the rows only turn
       * invisible once the fold has finished. Opening leaves visibility out,
       * so the rows are focusable and announced at once rather than a frame
       * later. Opening by itself for the page the reader arrived on
       * (isOpenedForPage) transitions nothing: the section is drawn open at
       * once, as one that starts open.
       *
       * Open, nothing caps its height (FoldedSection does the same): a cap
       * of 2,000 pixels cut the last rows of a long section off, with
       * nothing to scroll to - the menu scrolls, a section does not.
       */}
      <div
        id={bodyId}
        ref={bodyRef}
        className={`overflow-hidden duration-200 ease-in-out ${
          isCollapsed
            ? "max-h-0 opacity-0 invisible transition-all"
            : isOpenedForPage
              ? "opacity-100 transition-none"
              : "opacity-100 transition-opacity"
        }`}
      >
        <div className="mt-0.5 space-y-0.5">{props.children}</div>
      </div>
    </div>
  );
};

export default SideMenuSection;
