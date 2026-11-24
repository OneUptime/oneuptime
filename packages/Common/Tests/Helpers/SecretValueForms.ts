/*
 * THE FORMS A SECRET'S VALUE IS WRITTEN IN, FOR TESTS THAT CHECK NONE IS
 * LEFT IN A TEXT.
 *
 * A check can say a monitor secret's value back in whatever form the
 * system it watches writes it: as it is or in another case, percent-encoded
 * (either hex case, a space as "+"), escaped in JSON (Python's ensure_ascii,
 * PHP's "\/", Go's "<"), a JSON text inside a JSON string, escaped in
 * HTML (named or numeric), or in base64 (standard or URL-safe, wherever the
 * value starts in the encoded bytes). MonitorSecretValueRedaction hides a
 * value in each of these; a test that says no form is left in a text checks
 * them one by one here, by plain text search - an oracle of its own, not
 * the redaction's reading.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// The fewest characters a form must have to be looked for: shorter is noise.
const SHORTEST_FORM: number = 4;

// A base64 core shorter than this stands in long texts by chance.
const SHORTEST_BASE64_CORE: number = 8;

function percentLowerCase(text: string): string {
  return text.replace(/%[0-9A-F]{2}/g, (escape: string): string => {
    return escape.toLowerCase();
  });
}

function unicodeEscape(character: string): string {
  return Array.from(character)
    .map((codePoint: string): string => {
      const units: Array<string> = [];

      for (let index: number = 0; index < codePoint.length; index++) {
        units.push(
          `\\u${codePoint.charCodeAt(index).toString(16).padStart(4, "0")}`,
        );
      }

      return units.join("");
    })
    .join("");
}

// JSON as Python's json.dumps writes it by default: every non-ASCII escaped.
function asciiJson(value: string): string {
  return Array.from(JSON.stringify(value).slice(1, -1))
    .map((character: string): string => {
      return character.charCodeAt(0) > 0x7e ? unicodeEscape(character) : character;
    })
    .join("");
}

// JSON as Go's encoder and PHP's json_encode write it.
function htmlSafeJson(value: string): string {
  return JSON.stringify(value)
    .slice(1, -1)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\//g, "\\/");
}

function htmlNamed(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlNumeric(value: string): string {
  return value.replace(/[&<>"' ]/g, (character: string): string => {
    return `&#x${character.charCodeAt(0).toString(16)};`;
  });
}

/*
 * The base64 letters only the value's own bytes make, when it starts
 * `offset` bytes into what is encoded (0, 1 or 2 bytes in, the three ways
 * it can fall against base64's groups of three bytes).
 */
function base64Core(value: string, offset: number): string {
  const prefix: Buffer = Buffer.alloc(offset, 0x78);
  const bytes: Buffer = Buffer.concat([prefix, Buffer.from(value, "utf8")]);
  const encoded: string = bytes.toString("base64");
  const firstGroup: number = Math.ceil(offset / 3);
  const lastGroup: number = Math.floor(bytes.length / 3);

  return encoded.slice(firstGroup * 4, lastGroup * 4);
}

// A value's forms as text, each looked for in any case.
export function secretValueTextForms(value: string): Array<string> {
  const forms: Set<string> = new Set<string>();

  const add: (form: string) => void = (form: string): void => {
    if (form.length >= SHORTEST_FORM) {
      forms.add(form);
    }
  };

  add(value);
  add(value.toLowerCase());
  add(value.toUpperCase());

  const percent: string = encodeURIComponent(value);

  add(percent);
  add(percentLowerCase(percent));
  add(percent.replace(/%20/g, "+"));
  add(encodeURI(value));
  add(new URLSearchParams({ v: value }).toString().slice(2));

  add(JSON.stringify(value).slice(1, -1));
  add(JSON.stringify(JSON.stringify(value)).slice(3, -3));
  add(asciiJson(value));
  add(htmlSafeJson(value));

  add(htmlNamed(value));
  add(htmlNumeric(value));

  return Array.from(forms);
}

/*
 * A value's base64 cores - the letters of whole groups of three bytes that
 * hold only the value's - standard and URL-safe, each looked for as
 * written: every base64 encoding of the value holds one of them.
 */
export function secretValueBase64Forms(value: string): Array<string> {
  const forms: Set<string> = new Set<string>();

  for (let offset: number = 0; offset < 3; offset++) {
    const core: string = base64Core(value, offset);

    if (core.length >= SHORTEST_BASE64_CORE) {
      forms.add(core);
      forms.add(core.replace(/\+/g, "-").replace(/\//g, "_"));
    }
  }

  return Array.from(forms);
}

/*
 * A value as a check writes it in base64: whole encodings, the value 0, 1
 * and 2 bytes in (as "user:" puts a password in a Basic header), standard
 * and URL-safe, padded and not. Each holds one of the cores above.
 */
export function secretValueBase64Encodings(value: string): Array<string> {
  const encodings: Set<string> = new Set<string>();

  for (const prefix of ["", "u", "us", "ops:"]) {
    const encoded: string = Buffer.from(`${prefix}${value}`, "utf8").toString(
      "base64",
    );

    encodings.add(encoded);
    encodings.add(
      encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    );
  }

  return Array.from(encodings);
}

/*
 * Every way of writing a value this file knows, for a test to write into
 * what it checks: its text forms and its whole base64 encodings.
 */
export function secretValueForms(value: string): Array<string> {
  return [...secretValueTextForms(value), ...secretValueBase64Encodings(value)];
}

/*
 * The forms of the value a text still holds - a text form in any case, a
 * base64 one as written: none, when the value is gone from it in every
 * form.
 */
export function secretValueFormsIn(text: string, value: string): Array<string> {
  const lowered: string = text.toLowerCase();

  return [
    ...secretValueTextForms(value).filter((form: string): boolean => {
      return lowered.includes(form.toLowerCase());
    }),
    ...secretValueBase64Forms(value).filter((form: string): boolean => {
      return text.includes(form);
    }),
  ];
}
