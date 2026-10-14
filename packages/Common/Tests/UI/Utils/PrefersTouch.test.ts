/*
 * Whether the reader's main pointer is a finger (UI/Utils/PrefersTouch): the
 * Add Component panel and a record step's Add field list open without
 * focusing their search box there, so no keyboard covers what they offer.
 */

import prefersTouch from "../../../UI/Utils/PrefersTouch";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

type MatchMediaFunction = typeof window.matchMedia;

const original: MatchMediaFunction | undefined = window.matchMedia;

type SetMatchMediaFunction = (matchMedia: unknown) => void;

const setMatchMedia: SetMatchMediaFunction = (matchMedia: unknown): void => {
  (window as { matchMedia?: unknown }).matchMedia = matchMedia;
};

afterEach(() => {
  if (original) {
    window.matchMedia = original;
  } else {
    delete (window as { matchMedia?: unknown }).matchMedia;
  }
});

describe("prefersTouch", () => {
  test("asks the browser whether the main pointer is coarse", () => {
    const asked: Array<string> = [];

    setMatchMedia((query: string): { matches: boolean } => {
      asked.push(query);

      return { matches: true };
    });

    expect(prefersTouch()).toBe(true);
    expect(asked).toEqual(["(pointer: coarse)"]);
  });

  test("a mouse is not a finger", () => {
    setMatchMedia((): { matches: boolean } => {
      return { matches: false };
    });

    expect(prefersTouch()).toBe(false);
  });

  test("a browser that cannot say is taken to have a mouse", () => {
    setMatchMedia(undefined);

    expect(prefersTouch()).toBe(false);
  });

  test("a browser that throws when asked is taken to have a mouse", () => {
    setMatchMedia((): never => {
      throw new Error("matchMedia is not available here");
    });

    expect(prefersTouch()).toBe(false);
  });
});

describe("the panels that ask", () => {
  type ReadFunction = (file: string) => string;

  const read: ReadFunction = (file: string): string => {
    return fs.readFileSync(
      path.resolve(__dirname, "../../../UI/Components/Workflow", file),
      "utf8",
    );
  };

  test.each(["ComponentsModal.tsx", "FieldPicker/AddFieldsPanel.tsx"])(
    "%s asks this one, and keeps no copy of its own",
    (file: string) => {
      const source: string = read(file);

      expect(source).toContain("Utils/PrefersTouch");
      expect(source).toContain("if (!prefersTouch()) {");
      expect(source).not.toContain("pointer: coarse");
    },
  );
});
