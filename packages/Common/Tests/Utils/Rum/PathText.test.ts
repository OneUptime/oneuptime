import { describe, expect, test } from "@jest/globals";
import { decodePathWords, getPathText } from "../../../Utils/Rum/PathText";
import {
  OTHER_PAGES_KEY,
  OTHER_PAGES_LABEL,
  getUserFlowPageText,
} from "../../../Utils/Rum/UserFlow";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * A path as a person reads it (#8196): the one reading User Flows draws a
 * page by, which product analytics draws its pages by too. A page is stored
 * as the URL parser escapes it ("/caf%C3%A9"); only the words of what is
 * drawn are decoded, and a path with a letter read from the right is set
 * apart, left to right, so its "/" stays first.
 */

const LRI: string = String.fromCharCode(0x2066);
const PDI: string = String.fromCharCode(0x2069);

describe("decodePathWords", () => {
  test("decodes the letters of a page's words, in either case of hex", () => {
    expect(decodePathWords("/caf%C3%A9")).toBe("/café");
    expect(decodePathWords("/caf%c3%a9")).toBe("/café");
    expect(decodePathWords("/%D8%A7%D9%84%D8%B3%D9%84%D8%A9")).toBe("/السلة");
    expect(decodePathWords("/%E8%A3%BD%E5%93%81/men%C3%BC")).toBe("/製品/menü");
    // An accent decomposed is a mark, part of the word it follows.
    expect(decodePathWords("/cafe%CC%81")).toBe(
      `/cafe${String.fromCharCode(0x301)}`,
    );
  });

  test("keeps every escape that could name another page, or hide part of one", () => {
    for (const path of [
      "/a%2Fb",
      "/a%3Fb",
      "/a%23b",
      "/100%25",
      "/x%20y",
      "/%E9t%E9",
      "/%E0%A4",
      "/%C0%AF",
      "/%E2%80%8B",
      "/%E2%80%AE",
      "/%E2%88%95",
      "/%",
    ]) {
      expect([path, decodePathWords(path)]).toEqual([path, path]);
    }
  });

  test("leaves a path with nothing to decode exactly as it is", () => {
    for (const path of ["/", "/pricing", "/Cart/42", "/[redacted]", ""]) {
      expect(decodePathWords(path)).toBe(path);
    }
  });
});

describe("getPathText", () => {
  test("sets a path read from the right apart, and nothing else", () => {
    expect(getPathText("/%D8%A7%D9%84%D8%B3%D9%84%D8%A9")).toBe(
      `${LRI}/السلة${PDI}`,
    );
    expect(getPathText("/caf%C3%A9")).toBe("/café");
    expect(getPathText("/pricing")).toBe("/pricing");
  });

  test("is what User Flows draws for every page but its fold", () => {
    const random: SeededRandom = seededRandom(8196);
    const pieces: Array<string> = [
      "/",
      "a",
      "%C3%A9",
      "%c3%a9",
      "%CC%81",
      "%D8%B3",
      "%2F",
      "%25",
      "%E9",
      "%E2%80%8C",
      "%E2%80%8B",
      "é",
      "س",
      "%",
      "[redacted]",
    ];

    for (let index: number = 0; index < 2000; index++) {
      let path: string = "/";
      const count: number = random(8);

      for (let piece: number = 0; piece < count; piece++) {
        path += pieces[random(pieces.length)];
      }

      expect([path, getPathText(path)]).toEqual([
        path,
        getUserFlowPageText(path),
      ]);
    }

    expect(getUserFlowPageText(OTHER_PAGES_KEY)).toBe(OTHER_PAGES_LABEL);
  });
});
