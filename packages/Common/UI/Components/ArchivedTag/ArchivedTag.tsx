import { ARCHIVED_VALUE_TAG } from "./ArchivedTagCopy";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Archived", beside a value a record still has but nobody can pick again
 * (Common/Utils/ArchivableValues): the severity a template keeps in its
 * picker, a label chip, a role card, a filter's option. One look wherever
 * it is drawn - the quiet grey tag the settings tables give a built-in
 * value ("Built-in"), so the two read as the same kind of note.
 *
 * Text only, and a span, so it sits inside a picker's label or a chip
 * without putting a block inside an inline element.
 */

export const ARCHIVED_TAG_TEST_ID: string = "archived-tag";

// A tag on a line of its own size: a picker's value, a role card, a menu.
export const ARCHIVED_TAG_CLASS_NAME: string =
  "inline-flex flex-none items-center whitespace-nowrap rounded-md bg-gray-50 px-1.5 py-0.5 text-xs font-medium leading-4 text-gray-600 ring-1 ring-inset ring-gray-200";

// Inside a chip of a multi-select, which is a size smaller.
export const ARCHIVED_TAG_COMPACT_CLASS_NAME: string =
  "inline-flex flex-none items-center whitespace-nowrap rounded bg-gray-50 px-1 text-[11px] font-medium leading-4 text-gray-600 ring-1 ring-inset ring-gray-200";

export interface ComponentProps {
  isCompact?: boolean | undefined;
  dataTestId?: string | undefined;
}

const ArchivedTag: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      data-testid={props.dataTestId || ARCHIVED_TAG_TEST_ID}
      className={
        props.isCompact
          ? ARCHIVED_TAG_COMPACT_CLASS_NAME
          : ARCHIVED_TAG_CLASS_NAME
      }
    >
      {translator.translateText(ARCHIVED_VALUE_TAG) || ARCHIVED_VALUE_TAG}
    </span>
  );
};

export default ArchivedTag;
