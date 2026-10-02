import Icon from "../Icon/Icon";
import useTranslateValue from "../../Utils/Translation";
import IconProp from "../../../Types/Icon/IconProp";
import { startsCollapsed } from "./SideMenuSectionState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
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
  const { translateString } = useTranslateValue();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    startsCollapsed({
      title: props.title,
      defaultCollapsed: props.defaultCollapsed,
      collapsible: props.collapsible,
      isActive: props.isActive,
    }),
  );
  const translatedTitle: string = translateString(props.title) || props.title;
  const bodyId: string = `side-menu-section-${useId()}`;

  const isCollapsible: boolean = props.collapsible ?? true;

  useEffect(() => {
    if (props.isActive) {
      setIsCollapsed(false);
    }
  }, [props.isActive]);

  const handleToggle: () => void = (): void => {
    if (isCollapsible) {
      setIsCollapsed(!isCollapsed);
    }
  };

  /*
   * The heading itself. Identical in both branches — only the element around
   * it changes.
   *
   * An <h6> because the side-menu test harness locates a section by its
   * heading; the visual weight comes from the classes, not the level.
   */
  const heading: ReactElement = (
    <div className="flex items-center gap-2 min-w-0">
      {props.icon && (
        <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-400" />
      )}
      <h6 className="truncate text-xs font-semibold uppercase tracking-wider text-gray-400">
        {translatedTitle}
      </h6>
    </div>
  );

  const headerClassName: string =
    "w-full flex items-center justify-between px-3 pt-2 pb-1 rounded-md";

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
            className={`h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform duration-200 ${
              isCollapsed ? "-rotate-90" : "rotate-0"
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
       * later.
       */}
      <div
        id={bodyId}
        className={`overflow-hidden duration-200 ease-in-out ${
          isCollapsed
            ? "max-h-0 opacity-0 invisible transition-all"
            : "max-h-[2000px] opacity-100 transition-[max-height,opacity]"
        }`}
      >
        <div className="mt-0.5 space-y-0.5">{props.children}</div>
      </div>
    </div>
  );
};

export default SideMenuSection;
