/*
 * FIELDS NAMED FOR FREE TEXT, HOWEVER SHORT THEIR VALUES (#10927).
 *
 * The names-and-addresses model reads a field whose values average more
 * than 80 characters (FieldClassifier.isFreeTextValues): a support note, a
 * message. A column of short notes - "Called Jonas Becker about the late
 * invoice", "Leave the parcel with Tom Fletcher" - averages less, and was
 * never read. Reading every field of short values instead was measured
 * before it was chosen against (ShortFreeTextTestSet.json, seven
 * languages): fields of four or more words on average let in product names,
 * book titles and store names, whose brands and characters the model reads
 * as people - "Ralph Lauren Slim Fit Polo Shirt", "The Adventures of Tom
 * Sawyer" - and names' precision fell to 0.48-0.77 a language, with 222
 * false findings per 1,000 values.
 *
 * So a short field is read when its name says a person wrote free text in
 * it: a note, a comment, a remark, a message, instructions, feedback, an
 * observation - in the seven languages the model is measured in. The
 * field's own name is its last part (orders.delivery_note, attributes.
 * comment); a word of it counts when it is one of these, or, for words of
 * six letters or more, when it ends with one, as German and Dutch join
 * theirs: Lieferhinweis, bezorgopmerking - unless the name ends with what
 * says it is about the note, not the note: message_id, comment_count. A
 * description is not among them: a product's is a catalog's text, and the
 * model reads it when it is long.
 */

export const FREE_TEXT_FIELD_WORDS: ReadonlyArray<string> = [
  // English
  "note",
  "notes",
  "comment",
  "comments",
  "remark",
  "remarks",
  "memo",
  "memos",
  "message",
  "messages",
  "instruction",
  "instructions",
  "feedback",
  "observation",
  "observations",
  "annotation",
  "annotations",
  // Spanish, Portuguese
  "nota",
  "notas",
  "comentario",
  "comentarios",
  "observacion",
  "observaciones",
  "mensaje",
  "mensajes",
  "instrucciones",
  "observacao",
  "observacoes",
  "mensagem",
  "mensagens",
  // German
  "notiz",
  "notizen",
  "hinweis",
  "hinweise",
  "bemerkung",
  "bemerkungen",
  "kommentar",
  "kommentare",
  "nachricht",
  "nachrichten",
  "anmerkung",
  "anmerkungen",
  // French
  "remarque",
  "remarques",
  "commentaire",
  "commentaires",
  "consigne",
  "consignes",
  // Italian
  "commento",
  "commenti",
  "osservazione",
  "osservazioni",
  "messaggio",
  "messaggi",
  // Dutch
  "notitie",
  "notities",
  "opmerking",
  "opmerkingen",
  "commentaar",
  "bericht",
  "berichten",
  "toelichting",
];

const WORDS: ReadonlySet<string> = new Set(FREE_TEXT_FIELD_WORDS);

/*
 * A name that ends with one of these is about the note, not the note
 * itself: message_id, comment_count, note_type, remarks_updated_at.
 */
const NOT_THE_TEXT_ENDINGS: ReadonlySet<string> = new Set([
  "id",
  "ids",
  "uuid",
  "key",
  "hash",
  "count",
  "number",
  "num",
  "type",
  "kind",
  "status",
  "flag",
  "enabled",
  "length",
  "size",
  "at",
  "date",
  "time",
  "timestamp",
  "url",
]);

// The words long enough to be found at the end of a joined word.
const JOINED_WORD_ENDINGS: ReadonlyArray<string> = FREE_TEXT_FIELD_WORDS.filter(
  (word: string): boolean => {
    return word.length >= 6;
  },
);

// The longest field name read: a field's name is a few words.
const MAX_FIELD_NAME_LENGTH: number = 256;

// The words of a field's own name: its last part, its accents gone.
export function getFieldNameWords(fieldPath: string): Array<string> {
  const parts: Array<string> = fieldPath
    .slice(0, MAX_FIELD_NAME_LENGTH)
    .split(/[.›]/)
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      return part.length > 0 && part !== "[]";
    });
  const own: string = (parts[parts.length - 1] || "").replace(/\[\]$/, "");

  return own
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
}

// Whether a field's name says a person wrote free text in it.
export function isFreeTextFieldName(
  fieldPath: string | null | undefined,
): boolean {
  if (!fieldPath) {
    return false;
  }

  const words: Array<string> = getFieldNameWords(fieldPath);

  if (NOT_THE_TEXT_ENDINGS.has(words[words.length - 1] || "")) {
    return false;
  }

  return words.some((word: string): boolean => {
    return (
      WORDS.has(word) ||
      (word.length > 6 &&
        JOINED_WORD_ENDINGS.some((ending: string): boolean => {
          return word.endsWith(ending);
        }))
    );
  });
}
