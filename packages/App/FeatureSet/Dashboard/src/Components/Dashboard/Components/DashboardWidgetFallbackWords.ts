import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS A WIDGET DRAWS FOR A VALUE IT DOES NOT HAVE (#7091).
 *
 * A list's row with no name, a VMware host in no cluster, a grouped Table
 * row whose attribute holds nothing, a network site with no name or no
 * status yet: the widgets wrote "Unnamed", "Standalone", "(unset)",
 * "Unnamed site" and "No status yet" themselves, in English on every
 * board, in every language. Each is the reader's word now, looked up where it is
 * drawn. A row or a tile a widget builds outside its component reads the
 * page's translator, as that row's other words do; a component passes its
 * own (useTranslator).
 *
 * Only the word is looked up: a name a row has is drawn as it is, and a
 * list's order is the server's, so a looked-up word sorts nothing.
 */

// A row with no name, nor an id to name it by.
export const getUnnamedText: (translator?: Translator) => string = (
  translator: Translator = getGlobalTranslator(),
): string => {
  return translator.translateText("Unnamed") as string;
};

// A VMware host that is in no cluster.
export const getStandaloneText: (translator?: Translator) => string = (
  translator: Translator = getGlobalTranslator(),
): string => {
  return translator.translateText("Standalone") as string;
};

// A grouped Table row whose attribute holds nothing.
export const getUnsetText: (translator?: Translator) => string = (
  translator: Translator = getGlobalTranslator(),
): string => {
  return translator.translateText("(unset)") as string;
};

// A network site on the Network Map with no name (#7520).
export const getUnnamedSiteText: (translator?: Translator) => string = (
  translator: Translator = getGlobalTranslator(),
): string => {
  return translator.translateText("Unnamed site") as string;
};

// A network site on the Network Map whose monitors have no status yet (#7520).
export const getNoStatusYetText: (translator?: Translator) => string = (
  translator: Translator = getGlobalTranslator(),
): string => {
  return translator.translateText("No status yet") as string;
};
