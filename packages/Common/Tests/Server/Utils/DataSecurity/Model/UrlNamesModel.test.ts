import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  EntityRecognizer,
  recognizeAsWritten,
} from "../../../../../Server/Utils/DataSecurity/Model/EntityRecognizer";
import { ModelBudget } from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  closeNameAddressRecognizer,
  getNameAddressRecognizer,
  RecognizerAvailability,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import { readableForModel } from "../../../../../Utils/DataSecurity/Model/ModelTextReading";
import { RecognizedEntity } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import { fetchModelIntoCache } from "./ModelCache";

/*
 * THE REAL MODEL ON A NAME PERCENT-ENCODED IN A URL (#11034).
 *
 * The model read /profile?name=Jos%C3%A9%20Garc%C3%ADa as it is written: one
 * token of escapes, no name. It reads a text as a URL is read now - its
 * escapes read, a "+" between letters a space (readingForModel) - and each
 * name it finds is placed on the characters it is written with. A URL's
 * path and query string are full of words that are no one's name (a
 * product, a city, a font, a status), so the model was measured on URLs of
 * both kinds, in the languages it reads, before this was turned on: these
 * hold it to what was measured. Each name is made up.
 */

// A URL that holds a person's name, written encoded, and the name as it reads.
const WITH_NAMES: ReadonlyArray<[string, string]> = [
  ["GET /profile?name=Jos%C3%A9%20Garc%C3%ADa&tab=orders 200", "José García"],
  ["GET /invite?to=Maria%20Gonzalez&role=editor 302", "Maria Gonzalez"],
  [
    "POST /api/v1/contacts?full_name=Lars+Eriksson&source=import 201",
    "Lars Eriksson",
  ],
  ["GET /users/Fran%C3%A7ois%20Dupuis/settings 200", "François Dupuis"],
  ["GET /support?customer=Anna%20Kowalska&ticket=open 200", "Anna Kowalska"],
  ["GET /search?q=Giulia+Bianchi&type=people 200", "Giulia Bianchi"],
  [
    "GET /crm/lead?contact=Pieter%20van%20Dijk&stage=new 200",
    "Pieter van Dijk",
  ],
  ["GET /orders?ship_to=Hannah%20Schmidt&country=DE 200", "Hannah Schmidt"],
  ["GET /checkout?cardholder=Sofia%20Andersson&step=2 200", "Sofia Andersson"],
  ["GET /patients?patient_name=Carlos%20Mart%C3%ADnez 200", "Carlos Martínez"],
  [
    "redirect to /welcome?greeting=Hello%2C%20Emma%20Thompson%21",
    "Emma Thompson",
  ],
  ["GET /team/member?name=Jo%C3%A3o%20Silva&lang=pt 200", "João Silva"],
  ["GET /mentions?user=Ren%C3%A9e%20Laurent&page=2 200", "Renée Laurent"],
  ["GET /share?with=Matteo%20Rossi%2C%20Chiara%20Conti 200", "Matteo Rossi"],
  ["GET /calendar?attendee=Thomas+M%C3%BCller&week=48 200", "Thomas Müller"],
  ["GET /dashboard?owner=Isabel%20Ferreira&view=all 200", "Isabel Ferreira"],
];

// URLs whose words are no one's name: products, places, fonts, statuses, docs.
const WITHOUT_NAMES: ReadonlyArray<string> = [
  "GET /products/blue-widget?color=Ocean%20Blue&size=XL 200",
  "GET /search?q=New%20York%20weather&units=metric 200",
  "GET /docs/getting-started?section=Rate%20Limits 200",
  "GET /api/v1/orders?status=Pending%20Review&page=3 200",
  "GET /blog/how-to-scale-postgres?ref=newsletter 200",
  "GET /static/fonts/Open%20Sans%20Bold.woff2 200",
  "GET /cities?name=San%20Francisco&state=CA 200",
  "GET /catalog?category=Garden%20Tools&sort=price_asc 200",
  "GET /reports/monthly?metric=Active%20Users&range=30d 200",
  "GET /help?topic=Reset%20Password&lang=en 200",
  "GET /shop?collection=Summer%20Sale%202026 200",
  "GET /events?venue=Madison%20Square%20Garden 200",
  "GET /recipes?dish=Pad%20Thai&diet=vegan 200",
  "GET /books?title=The%20Great%20Gatsby 200",
  "GET /maps?route=Main%20Street%20to%20Central%20Park 200",
  "GET /jobs?role=Senior%20Software%20Engineer&remote=true 200",
  "GET /movies?genre=Science%20Fiction&year=2024 200",
  "GET /settings?theme=Dark%20Mode&density=compact 200",
  "GET /plans?tier=Business%20Plus&billing=annual 200",
  "GET /status?component=Payment%20Gateway&region=eu-west 200",
];

let recognizer: EntityRecognizer;
let asWritten: Map<string, Array<RecognizedEntity>> = new Map();
let asRead: Map<string, Array<RecognizedEntity>> = new Map();

function budget(): ReturnType<ModelBudget["forStore"]> {
  return new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs: 1e9 }).forStore(
    "urls",
  );
}

const TEXTS: Array<string> = [
  ...WITH_NAMES.map(([text]: [string, string]): string => {
    return text;
  }),
  ...WITHOUT_NAMES,
];

beforeAll(async () => {
  const directory: string = await fetchModelIntoCache();

  await closeNameAddressRecognizer();

  const availability: RecognizerAvailability = await getNameAddressRecognizer({
    directory,
  });

  if (!("recognizer" in availability)) {
    throw new Error(`The model did not load: ${availability.reason}`);
  }

  recognizer = availability.recognizer;
  // The texts as written, as the model read them before; and as it reads them now.
  asWritten = await recognizer.recognize(TEXTS, budget());
  asRead = await recognizeAsWritten(recognizer, TEXTS, budget());
}, 600000);

afterAll(async () => {
  await closeNameAddressRecognizer();
});

function namesIn(
  found: Map<string, Array<RecognizedEntity>>,
  text: string,
): Array<string> {
  return (found.get(text) || [])
    .filter((entity: RecognizedEntity): boolean => {
      return entity.dataTypeId === "person-name";
    })
    .map((entity: RecognizedEntity): string => {
      return readableForModel(text.slice(entity.start, entity.end));
    });
}

interface UrlScores {
  found: number;
  falseFindings: number;
  precision: number;
  recall: number;
}

/*
 * A name is found when one finding holds it whole: "Jos" of "José García"
 * leaves "%C3%A9%20Garc%C3%ADa" as it is. A finding that is part of the
 * name is no false one; a finding of no name's is.
 */
function scoreOf(found: Map<string, Array<RecognizedEntity>>): UrlScores {
  let right: number = 0;
  let wrong: number = 0;
  let foundNames: number = 0;

  for (const [text, name] of WITH_NAMES) {
    const names: Array<string> = namesIn(found, text);

    if (
      names.some((each: string): boolean => {
        return each.includes(name);
      })
    ) {
      foundNames++;
    }

    for (const each of names) {
      if (name.includes(each) || each.includes(name)) {
        right++;
      } else {
        wrong++;
      }
    }
  }

  let falseFindings: number = 0;

  for (const text of WITHOUT_NAMES) {
    falseFindings += namesIn(found, text).length;
  }

  wrong += falseFindings;

  return {
    found: foundNames,
    falseFindings,
    precision: right + wrong === 0 ? 1 : right / (right + wrong),
    recall: foundNames / WITH_NAMES.length,
  };
}

/*
 * Measured on 2026-11-26 with the pinned model: read as written, it found
 * none of the 16 names whole - twelve only in part, the given name before
 * the first escape ("Jos", "Maria") or a name's words a "+" joins apart,
 * and four not at all; read as a URL is read, all 16 whole, and no name in
 * any of the 20 URLs that hold none. Held to what was measured, above the
 * bar the model was chosen by (#10373): a precision of 0.90, a recall of
 * 0.70.
 */
describe("the names-and-addresses model on a name percent-encoded in a URL", () => {
  test("finds names it could not read as written, at least as precisely", () => {
    const before: UrlScores = scoreOf(asWritten);
    const after: UrlScores = scoreOf(asRead);

    expect(before.found).toBeLessThan(after.found);
    expect(after).toEqual({
      found: WITH_NAMES.length,
      falseFindings: 0,
      precision: 1,
      recall: 1,
    });
  });

  test("each name is placed on the characters it is written with, escapes and all", () => {
    const text: string = WITH_NAMES[0]![0];
    const [entity] = (asRead.get(text) || []).filter(
      (each: RecognizedEntity): boolean => {
        return each.dataTypeId === "person-name";
      },
    );

    expect(entity).toBeDefined();
    expect(text.slice(entity!.start, entity!.end)).toBe(
      "Jos%C3%A9%20Garc%C3%ADa",
    );
  });
});
