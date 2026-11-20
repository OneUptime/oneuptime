import {
  SharedNameDates,
  SharedNameMark,
  SharedNameOption,
  getSharedNameMarksFor,
} from "../../Types/Database/SharedNameMarks";
import { writeReaderDay, writeReaderMoment } from "./ReaderMoments";
import { Translator } from "./TranslateTemplate";

/*
 * RECORDS THAT SHARE A NAME, TOLD APART WHERE THEY ARE PICKED ON A PAGE
 * (#10064).
 *
 * The rule itself - which options are twins, and what sets each apart - is
 * server-safe and shared with the chats' pickers (Types/Database/
 * SharedNameMarks, #10314), and every part of it is re-exported here, so a
 * page imports all of it from this one module, as it always has. What is a
 * page's own is how a twin's day and moment are written: in the zone and on
 * the clock the reader picked (ReaderMoments).
 *
 * React-free: the builders, the components and the tests read the same
 * rule.
 */

export * from "../../Types/Database/SharedNameMarks";

// A page's dates: the reader's zone, clock and language.
export const PAGE_SHARED_NAME_DATES: SharedNameDates = {
  writeDay: writeReaderDay,
  writeMoment: writeReaderMoment,
};

/*
 * THE TWINS AMONG A PICKER'S OPTIONS, each with its mark, by its value
 * (getSharedNameOptionKey), as a page draws them. An option appears once
 * whatever group of the menu holds it; options of different kinds are
 * never twins, and an option without facts is never marked.
 */
export const getSharedNameMarks: (
  options: ReadonlyArray<SharedNameOption>,
  translator: Translator,
) => Map<string, SharedNameMark> = (
  options: ReadonlyArray<SharedNameOption>,
  translator: Translator,
): Map<string, SharedNameMark> => {
  return getSharedNameMarksFor(options, {
    translator: translator,
    dates: PAGE_SHARED_NAME_DATES,
  });
};
