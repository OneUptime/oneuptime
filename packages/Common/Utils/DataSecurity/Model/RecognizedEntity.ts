import DataConfidence from "../../../Types/DataSecurity/DataConfidence";

/*
 * WHAT THE NAMES-AND-ADDRESSES MODEL FINDS IN A TEXT, AND HOW THE SCANNER
 * JUDGES IT.
 *
 * The model (Server/Utils/DataSecurity/Model) reads free text inside the
 * scanner and says where people's names and street addresses are, and how
 * sure it is. This is all the rest of the scanner sees of it: positions in a
 * text it already holds, never a copy of a value, so the same rules that turn
 * a pattern's candidate into a finding (TextScanner.ts) turn a model's into
 * one too:
 *
 *  - Medium on its own;
 *  - High when the field's name or the words around it agree (`customer_name`,
 *    "ship to", "Herr", "dirección");
 *  - Low when the model is unsure (UNSURE_SCORE), Medium when it is unsure
 *    and the context agrees;
 *  - a test value (Jane Doe, John Smith, 123 Main Street) is counted apart,
 *    and a value the project says is never sensitive is no finding.
 *
 * Its samples are masked as values of a name-found type are: the first
 * character, then a fixed mask (Masking.maskWord), so no sample shows more of
 * a name or an address than its first letter or digit.
 */

export type RecognizedDataTypeId = "person-name" | "postal-address";

export const RECOGNIZED_DATA_TYPE_IDS: ReadonlyArray<RecognizedDataTypeId> = [
  "person-name",
  "postal-address",
];

export interface RecognizedEntity {
  dataTypeId: RecognizedDataTypeId;
  // Where it starts and ends in the text the model read.
  start: number;
  end: number;
  // The model's mean probability over the entity's words, from 0 to 1.
  score: number;
}

/*
 * What the model found in the texts it read, by text: a text it did not
 * read (the scan's model time ran out, or the model is off) has no entry.
 */
export interface ModelRecognitions {
  get(text: string): ReadonlyArray<RecognizedEntity> | undefined;
}

/*
 * Below this mean probability the model is unsure, and its finding is Low.
 * Chosen on the test set (NamesAndAddressesTestSet.json): of the model's
 * findings with less, as many were wrong as right.
 */
export const UNSURE_SCORE: number = 0.6;

/*
 * Words that, near a name or an address the model found, say what it is.
 * In the languages the model is measured in, lower case, matched as whole
 * words (TextScanner.containsWord).
 */
export const PERSON_NAME_KEYWORDS: ReadonlyArray<string> = [
  "name",
  "full name",
  "first name",
  "last name",
  "surname",
  "customer",
  "client",
  "contact",
  "patient",
  "mr",
  "mrs",
  "dear",
  "signed by",
  "nombre",
  "apellido",
  "cliente",
  "sr",
  "sra",
  "señor",
  "señora",
  "estimado",
  "estimada",
  "herr",
  "frau",
  "kunde",
  "kundin",
  "vorname",
  "nachname",
  "nom",
  "prénom",
  "monsieur",
  "madame",
  "mme",
  "nome",
  "cognome",
  "signor",
  "signora",
  "gentile",
  "senhor",
  "senhora",
  "exmo",
  "exma",
  "naam",
  "klant",
  "meneer",
  "mevrouw",
  "heer",
  "geachte",
];

export const POSTAL_ADDRESS_KEYWORDS: ReadonlyArray<string> = [
  "address",
  "street",
  "ship to",
  "bill to",
  "deliver",
  "delivery",
  "residence",
  "lives at",
  "dirección",
  "domicilio",
  "envío",
  "entrega",
  "adresse",
  "anschrift",
  "lieferadresse",
  "wohnhaft",
  "livraison",
  "domicile",
  "indirizzo",
  "consegna",
  "residenza",
  "endereço",
  "morada",
  "adres",
  "bezorgadres",
  "woonadres",
  "levering",
];

export function keywordsOf(
  dataTypeId: RecognizedDataTypeId,
): ReadonlyArray<string> {
  return dataTypeId === "person-name"
    ? PERSON_NAME_KEYWORDS
    : POSTAL_ADDRESS_KEYWORDS;
}

// A value as it is compared and counted: its spaces collapsed.
export function normalizeRecognizedValue(value: string): string {
  return value.replace(/\s{1,64}/g, " ").trim();
}

/*
 * Known placeholders, lower case: the names and addresses documentation,
 * forms and test data use, in the model's languages. Counted apart, never
 * findings.
 */
const TEST_PERSON_NAMES: ReadonlySet<string> = new Set([
  "jane doe",
  "john doe",
  "john smith",
  "jane smith",
  "joe bloggs",
  "joe public",
  "john q. public",
  "max mustermann",
  "erika mustermann",
  "juan pérez",
  "juan perez",
  "fulano de tal",
  "jean dupont",
  "marie dupont",
  "mario rossi",
  "jan jansen",
  "jan modaal",
  "test user",
  "john appleseed",
]);

const TEST_STREET_ADDRESSES: ReadonlyArray<string> = [
  "123 main street",
  "123 main st",
  "742 evergreen terrace",
  "1234 main street",
  "musterstraße 1",
  "musterstrasse 1",
  "musterweg 1",
  "calle falsa 123",
  "calle ejemplo 1",
  "1 rue de l'exemple",
  "via roma 1",
  "rua exemplo 123",
  "voorbeeldstraat 1",
];

const LETTER_OR_DIGIT: RegExp = /[\p{L}\p{N}]/u;

function lowerWords(value: string): string {
  return normalizeRecognizedValue(value).toLowerCase();
}

export function isTestPersonName(value: string): boolean {
  return TEST_PERSON_NAMES.has(lowerWords(value));
}

/*
 * An address that starts with a placeholder street: "123 Main Street,
 * Springfield" is as much a test value as "123 Main Street".
 */
export function isTestStreetAddress(value: string): boolean {
  const lower: string = lowerWords(value);

  return TEST_STREET_ADDRESSES.some((street: string): boolean => {
    return (
      lower === street ||
      (lower.startsWith(street) && !LETTER_OR_DIGIT.test(lower[street.length]!))
    );
  });
}

export function isRecognizedTestValue(
  dataTypeId: RecognizedDataTypeId,
  value: string,
): boolean {
  return dataTypeId === "person-name"
    ? isTestPersonName(value)
    : isTestStreetAddress(value);
}

// How sure a finding the model made is, before its context is read.
export function confidenceOfScore(score: number): DataConfidence {
  return score < UNSURE_SCORE ? DataConfidence.Low : DataConfidence.Medium;
}
