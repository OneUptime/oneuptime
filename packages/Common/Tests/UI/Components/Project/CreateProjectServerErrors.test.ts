import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  isProjectNameServerError,
  isPromoCodeServerError,
} from "../../../../UI/Components/Project/CreateProjectServerErrors";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * Project/CreateProjectServerErrors: which of the server's answers to a new
 * project are about the promo code, and which about the name, so the Create
 * New Project dialog says each under its field (Field.ownsServerError).
 *
 * The answers are read from ProjectService itself, so a reworded one that
 * no longer names its field fails here rather than going back to the top of
 * the dialog unnoticed.
 */

const PROJECT_SERVICE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "Server",
    "Services",
    "ProjectService.ts",
  ),
  "utf8",
);

// The text of every BadDataException ProjectService throws with a literal.
function thrownMessages(): Array<string> {
  const messages: Array<string> = [];
  const marker: string = "new BadDataException(";
  let at: number = PROJECT_SERVICE.indexOf(marker);

  while (at !== -1) {
    const rest: string = PROJECT_SERVICE.slice(at + marker.length).trimStart();
    const quote: string = rest[0] || "";

    if (quote === '"' || quote === "`") {
      const end: number = rest.indexOf(quote, 1);
      messages.push(rest.slice(1, end));
    }

    at = PROJECT_SERVICE.indexOf(marker, at + marker.length);
  }

  return messages;
}

describe("the promo code's answers", () => {
  const promoAnswers: Array<string> = [
    "Promo code is invalid.",
    "This promocode has already been used.",
    "This promocode is assigned to a different user and cannot be used.",
    "Promocode is not valid for this plan. Please select the Growth plan.",
  ];

  test.each(promoAnswers)("%p is the promo code's", (message: string) => {
    expect(isPromoCodeServerError(message)).toBe(true);
    expect(isProjectNameServerError(message)).toBe(false);
  });

  test("every promo code answer ProjectService throws names the promo code", () => {
    const fromService: Array<string> = thrownMessages().filter(
      (message: string): boolean => {
        return message.toLowerCase().includes("promo");
      },
    );

    expect(fromService.length).toBeGreaterThanOrEqual(4);

    for (const message of fromService) {
      expect({ message, isPromo: isPromoCodeServerError(message) }).toEqual({
        message,
        isPromo: true,
      });
    }
  });
});

describe("the name's answer", () => {
  test("a name another of the reader's projects has is the name's", () => {
    expect(
      isProjectNameServerError("Project with the same name already exists"),
    ).toBe(true);
    expect(
      isPromoCodeServerError("Project with the same name already exists"),
    ).toBe(false);
  });

  test("ProjectService still says it in those words", () => {
    expect(thrownMessages()).toContain(
      "Project with the same name already exists",
    );
  });
});

describe("answers about nothing on the form", () => {
  test.each([
    "Server error. Please try again.",
    "You do not have permission to create projects.",
    "",
  ])("%p is neither field's", (message: string) => {
    expect(isPromoCodeServerError(message)).toBe(false);
    expect(isProjectNameServerError(message)).toBe(false);
  });

  test("a long answer is read in time that grows with it", () => {
    const long: string = `${"promo ".repeat(80000)}code`;

    const run: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isPromoCodeServerError(long) || isProjectNameServerError(long);
      },
      limitInMs: 2000,
    });

    expect(run.result).toBe(true);
    expect(run.inMs).toBeLessThan(2000);
  });
});
