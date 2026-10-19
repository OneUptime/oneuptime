/*
 * RUNS OF WHITE SPACE THAT HOLD A LINE BREAK, EACH MADE ONE SPACE.
 *
 * Text that may span lines, written on one line: a code span, a sentence
 * with a value in it, a record's title. What changes is exactly what a
 * global replace of the pattern \s*[\r\n]+\s* with " " changed - every run
 * of white space (as \s reads it) that holds a "\r" or a "\n" becomes one
 * space, and every other run stays as it is - and the text is read in time
 * in line with its length.
 *
 * That pattern was tried again from every character of a run of white space
 * that holds no line break, each try reading on to the end of the run, so a
 * long run took time that grows with the square of its length. Here each
 * run is read once, whole.
 */

// A run of white space, as \s reads it.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

const LINE_BREAK: RegExp = /[\r\n]/;

export type CollapseLineBreakRunsFunction = (text: string) => string;

export const collapseLineBreakRuns: CollapseLineBreakRunsFunction = (
  text: string,
): string => {
  return text.replace(WHITE_SPACE_RUN, (run: string): string => {
    return LINE_BREAK.test(run) ? " " : run;
  });
};
