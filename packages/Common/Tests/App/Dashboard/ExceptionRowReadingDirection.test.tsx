import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";

/*
 * An exception row on a Persian page (#5344): its fingerprint chip, a code
 * cut short to the row, lost its start, and so did an English assignee's
 * name; the exception's English type and message put a full stop at their
 * start. The fingerprint reads left to right in every language, the name
 * the way it is written where the page reads the other way, and the type
 * and message line in an isolate of its own.
 */

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const exceptionAssignedTo: (name: string) => TelemetryException = (
  name: string,
): TelemetryException => {
  const exception: TelemetryException = new TelemetryException();
  exception._id = "70000000-0000-4000-8000-000000000001";
  exception.exceptionType = "DeadlineExceededError";
  exception.message = "context deadline exceeded calling /charge.";
  exception.fingerprint = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  exception.occuranceCount = 3;

  const user: User = new User();
  user._id = "00000000-0000-4000-8000-000000000001";
  user.name = new Name(name);
  exception.assignToUserId = new ObjectID(user._id);
  exception.assignToUser = user;

  return exception;
};

const draw: (language: string, assignee: string) => void = (
  language: string,
  assignee: string,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <ExceptionRow exception={exceptionAssignedTo(assignee)} />
    </I18nextProvider>,
  );
};

describe("on a Persian page", () => {
  test("the fingerprint chip reads left to right, as a code does", () => {
    draw("fa", "José Ignacio Negro de la Vega");

    const fingerprint: HTMLElement = screen.getByTestId(
      "exception-row-fingerprint",
    );

    expect(fingerprint).toHaveAttribute("dir", "ltr");
    expect(fingerprint).toHaveTextContent(/^a1b2c3d4e5f6…$/);
    expect(fingerprint).toHaveClass("truncate");
  });

  test("an English assignee's name reads left to right, cut short at its own end", () => {
    draw("fa", "José Ignacio Negro de la Vega");

    const name: HTMLElement = screen.getByText("José Ignacio Negro de la Vega");

    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("a Persian assignee's name reads as the page does", () => {
    draw("fa", "سارا احمدی");

    expect(screen.getByText("سارا احمدی")).not.toHaveAttribute("dir");
  });

  test("the type and the message read the way they are written", () => {
    draw("fa", "سارا احمدی");

    const type: HTMLElement = screen.getByText("DeadlineExceededError");
    const isolate: HTMLElement = type.closest("bdi") as HTMLElement;

    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(isolate).toHaveTextContent(
      "DeadlineExceededError: context deadline exceeded calling /charge.",
    );
  });
});

describe("on an English page", () => {
  test("the fingerprint still reads left to right; an English name has no direction of its own", () => {
    draw("en", "José Ignacio Negro de la Vega");

    expect(screen.getByTestId("exception-row-fingerprint")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(
      screen.getByText("José Ignacio Negro de la Vega"),
    ).not.toHaveAttribute("dir");
  });
});
