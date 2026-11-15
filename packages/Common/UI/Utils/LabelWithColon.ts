import { translationKey } from "../../Types/Translator";

/*
 * A LABEL AND ITS COLON, AS THE READER'S LANGUAGE WRITES THEM (#8290).
 *
 * A label drawn before its value - "Capabilities: ...", a screen reader's
 * "Error: ..." - wrote its colon in the code beside the looked-up word, so
 * every language read English's colon: French sets it apart ("Statut :"),
 * Chinese writes a full-width one ("状态："). The colon is a key's, with the
 * label in it, looked up with the sentence:
 *
 *   translator.translateTemplate(LABEL_WITH_COLON, {
 *     label: translatableTerm(label),
 *   })
 *
 * A label a page already words with its colon ("Duration:") keeps its key.
 */
export const LABEL_WITH_COLON: string = translationKey("{{label}}:");
