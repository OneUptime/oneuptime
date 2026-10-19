/*
 * A RUN OF CAPITALS BEFORE A WORD, SPLIT IN TIME IN LINE WITH THE TEXT'S
 * LENGTH.
 *
 * "OIDCProvider" -> "OIDC Provider", "twilioAccountSIDValue" -> "twilio
 * Account SID Value": a run of two or more capitals that a lower-case letter
 * follows starts a word with its last capital, so the separator goes before
 * it - exactly where text.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") put it.
 *
 * That pattern was tried from every capital of a run that no lower-case
 * letter follows ("AAAA..."), and each try read on to the end of the run:
 * time that grows with the square of the run's length. Here each run is
 * taken whole, once.
 */

// A run of capitals, taken whole: the global search goes on after it.
const CAPITAL_RUN: RegExp = /[A-Z]+/g;

type IsLowerCaseCodeFunction = (code: number) => boolean;

const isLowerCaseCode: IsLowerCaseCodeFunction = (code: number): boolean => {
  return code >= 0x61 && code <= 0x7a;
};

export type SplitCapitalRunsBeforeWordsFunction = (
  text: string,
  // What goes between the run and the word: " " or "_".
  separator: string,
) => string;

export const splitCapitalRunsBeforeWords: SplitCapitalRunsBeforeWordsFunction =
  (text: string, separator: string): string => {
    return text.replace(
      CAPITAL_RUN,
      (run: string, offset: number, whole: string): string => {
        if (
          run.length < 2 ||
          !isLowerCaseCode(whole.charCodeAt(offset + run.length))
        ) {
          return run;
        }

        return run.slice(0, -1) + separator + run.slice(-1);
      },
    );
  };
