import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { FacetHelp } from "../FacetHelp";
import FacetHelpButton from "./FacetHelpButton";

export interface FacetSectionHeaderProps {
  /*
   * The facet's name in English, as its config writes it ("Span Kind").
   * The header draws it in the reader's language.
   */
  title: string;
  // Optional icon before the title (e.g. a resource brand icon).
  icon?: IconProp | undefined;
  // Selected values in this facet, shown as a badge when non-zero.
  activeCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  // Id of the section body this header shows and hides.
  controlsId?: string | undefined;
  /*
   * What the facet and its values mean (FacetHelp): an (i) beside the title
   * says it. Without it the header is exactly the plain one.
   */
  help?: FacetHelp | undefined;
}

/*
 * The collapsible header every facet section shares, in both the Logs and the
 * Telemetry sidebars: icon, title, active-count badge and one chevron that
 * turns as the section opens.
 *
 * The title is drawn in the reader's language, the name the filter chips and
 * the section's search box already give the facet: "スパンタイプ" and
 * "スパンの種類" in Japanese, never the English "Span Type" above a
 * Japanese chip.
 *
 * A facet that explains itself (the traces explorer's Span Type) has an (i)
 * right after its title, rather than a paragraph under it. A button cannot
 * hold another, so the fold button then holds the icon, title and badge
 * only, and its ::after covers the whole row: a click anywhere on the row
 * but the (i) - the chevron too - folds the section, as on every other
 * header, and the keyboard's focus ring goes round the row. The (i) and the
 * title sit above that cover, so the (i) answers its own press and a long
 * title still shows whole on hover.
 */
const FacetSectionHeader: FunctionComponent<FacetSectionHeaderProps> = (
  props: FacetSectionHeaderProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string = translator.translateText(props.title) || props.title;

  const iconElement: ReactElement = props.icon ? (
    <span
      className="flex flex-none items-center"
      data-testid="facet-section-icon"
      data-icon={props.icon}
    >
      <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-400" />
    </span>
  ) : (
    <></>
  );

  const badge: ReactElement =
    props.activeCount > 0 ? (
      <span className="inline-flex h-4 min-w-[1rem] flex-none items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-600">
        {props.activeCount}
      </span>
    ) : (
      <></>
    );

  const chevron: ReactElement = (
    <span
      className={`flex flex-none items-center transition-transform duration-150 ${
        props.isExpanded ? "rotate-90" : ""
      }`}
      data-testid="facet-section-chevron"
      aria-hidden={props.help ? true : undefined}
    >
      <Icon icon={IconProp.ChevronRight} className="h-3 w-3 text-gray-400" />
    </span>
  );

  if (props.help) {
    return (
      <div className="relative mx-1 flex items-center gap-0.5 rounded transition-colors hover:bg-gray-50">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded py-1 pl-1.5 text-left after:absolute after:inset-0 after:rounded after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
          aria-expanded={props.isExpanded}
          aria-controls={props.isExpanded ? props.controlsId : undefined}
          onClick={props.onToggle}
        >
          {iconElement}
          <span
            className="relative z-10 truncate text-[11px] font-semibold uppercase tracking-wider text-gray-500"
            title={title}
          >
            {title}
          </span>
          {badge}
        </button>
        <FacetHelpButton
          title={props.title}
          help={props.help}
          className="relative z-10"
        />
        {/*
         * The turned chevron is painted above the cover (a transform puts
         * it there), so it lets the pointer through to the cover below.
         */}
        <span className="pointer-events-none ml-auto flex flex-none items-center pl-2 pr-1.5">
          {chevron}
        </span>
      </div>
    );
  }

  return (
    <div className="px-1">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-gray-50"
        aria-expanded={props.isExpanded}
        aria-controls={props.isExpanded ? props.controlsId : undefined}
        onClick={props.onToggle}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {iconElement}
          {/*
           * A long name is cut short to one line ("Clúster de Docker
           * Swarm" in Spanish): pointing at it shows the whole name.
           */}
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-wider text-gray-500"
            title={title}
          >
            {title}
          </span>
          {badge}
        </div>
        {chevron}
      </button>
    </div>
  );
};

export default FacetSectionHeader;
