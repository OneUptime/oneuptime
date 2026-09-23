import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import { NoteVisibility } from "./EventNotesUtil";

export interface ComponentProps {
  current: NoteVisibility;
  // The page of the other kind of note on the same event.
  siblingRoute: Route;
}

interface SwitchOption {
  visibility: NoteVisibility;
  label: string;
  icon: IconProp;
}

const OPTIONS: Array<SwitchOption> = [
  { visibility: "private", label: "Private", icon: IconProp.Lock },
  { visibility: "public", label: "Public", icon: IconProp.Globe },
];

/*
 * Private and public notes live on two pages of the same event. People pick
 * the wrong one, then hunt the side menu for the other; this puts the other
 * one a click away, right where the choice matters.
 */
const NotesVisibilitySwitch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <nav
      aria-label={translateString("Note type") || "Note type"}
      className="inline-flex shrink-0 items-center rounded-lg bg-gray-100 p-0.5"
      data-testid="notes-visibility-switch"
    >
      {OPTIONS.map((option: SwitchOption) => {
        const label: string = translateString(option.label) || option.label;
        const content: ReactElement = (
          <>
            <Icon icon={option.icon} className="h-3.5 w-3.5" />
            <span>{label}</span>
          </>
        );

        if (option.visibility === props.current) {
          return (
            <span
              key={option.visibility}
              aria-current="page"
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/5"
            >
              {content}
            </span>
          );
        }

        return (
          <Link
            key={option.visibility}
            to={props.siblingRoute}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-gray-500 transition hover:text-gray-900"
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
};

export default NotesVisibilitySwitch;
