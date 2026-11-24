import { HOST_LOG_SESSION_NOTE_MAX_LENGTH } from "../../../Types/Host/HostLogSession";
import HostLogSessionNote, {
  MAX_KEPT_NOTE_LENGTH,
  NOTE_TOO_LONG_MESSAGE,
} from "../../../Utils/Host/HostLogSessionNote";
import { describe, expect, test } from "@jest/globals";

/*
 * A log session's note (#9966): why the requester asks, which the person at
 * the device reads under the request. What a person types becomes one line
 * of plain text, at most HOST_LOG_SESSION_NOTE_MAX_LENGTH characters, with
 * what a kiosk's screen must not show taken out.
 */

describe("a note as it is kept and shown", () => {
  test("is the text as written, trimmed", () => {
    expect(
      HostLogSessionNote.prepare(
        "  Checking why the payment app crashes after 6pm  ",
      ),
    ).toEqual({ note: "Checking why the payment app crashes after 6pm" });
  });

  test("is written in any script, and never translated", () => {
    for (const text of [
      "Prüfen, warum die Zahlungs-App nach 18 Uhr abstürzt",
      "支付应用在晚上6点后崩溃，正在排查",
      "بررسی خرابی برنامهٔ پرداخت پس از ساعت ۶ عصر",
      "Проверяем сбой оплаты после 18:00 🔍",
    ]) {
      expect(HostLogSessionNote.prepare(text)).toEqual({ note: text });
    }
  });

  test("is none when nothing is written", () => {
    expect(HostLogSessionNote.prepare(undefined)).toEqual({});
    expect(HostLogSessionNote.prepare(null)).toEqual({});
    expect(HostLogSessionNote.prepare("")).toEqual({});
    expect(HostLogSessionNote.prepare(" \n\t ")).toEqual({});
    // Not text at all, as an API caller may send.
    expect(HostLogSessionNote.prepare(42)).toEqual({});
    expect(HostLogSessionNote.prepare({ note: "x" })).toEqual({});
  });

  test("is one line: breaks, tabs and runs of spaces are one space", () => {
    expect(
      HostLogSessionNote.clean("Crashes after 6pm.\r\n\r\nTicket\t4412."),
    ).toBe("Crashes after 6pm. Ticket 4412.");
    expect(HostLogSessionNote.clean("a\u2028b\u2029c\u0085d")).toBe("a b c d");
    expect(HostLogSessionNote.clean("a \u0007 b")).toBe("a b");
  });

  test("never holds what would reorder the request beside it on the device", () => {
    // An override, an embedding and an isolate, each with its end.
    expect(HostLogSessionNote.clean("Allow it, \u202Eit is safe\u202C")).toBe(
      "Allow it, it is safe",
    );
    expect(HostLogSessionNote.clean("a\u202Bb\u202Cc")).toBe("abc");
    expect(HostLogSessionNote.clean("a\u2067b\u2069c")).toBe("abc");
    // Right-to-left text needs none: its letters say which way it reads.
    expect(HostLogSessionNote.clean("שלום עולם")).toBe("שלום עולם");
  });

  test("has a card number, an email address, a token and a password's value taken out", () => {
    expect(
      HostLogSessionNote.prepare(
        "Card 4111 1111 1111 1111 declined at 6pm, ask dana@example.com",
      ),
    ).toEqual({ note: "Card [card number] declined at 6pm, ask [email]" });
    expect(
      HostLogSessionNote.prepare("Retry with password=hunter2 then"),
    ).toEqual({ note: "Retry with password=[redacted] then" });
    expect(HostLogSessionNote.prepare("Bearer abcdefgh12345678 fails")).toEqual(
      { note: "Bearer [credential] fails" },
    );
  });

  test("keeps what is no secret in a fleet tool: a store, a till, a time", () => {
    expect(
      HostLogSessionNote.prepare("Store 0412, till 3, since 18:05 (job 1234)"),
    ).toEqual({ note: "Store 0412, till 3, since 18:05 (job 1234)" });
  });
});

describe("how long a note may be", () => {
  test("up to the limit, counted as a person counts characters", () => {
    const atLimit: string = "a".repeat(HOST_LOG_SESSION_NOTE_MAX_LENGTH);
    expect(HostLogSessionNote.prepare(atLimit)).toEqual({ note: atLimit });

    // An emoji is one character, though JavaScript counts it as two.
    const emoji: string = "🔍".repeat(HOST_LOG_SESSION_NOTE_MAX_LENGTH);
    expect(emoji.length).toBe(HOST_LOG_SESSION_NOTE_MAX_LENGTH * 2);
    expect(HostLogSessionNote.prepare(emoji)).toEqual({ note: emoji });
  });

  test("one character more is refused, saying what to do", () => {
    expect(
      HostLogSessionNote.prepare(
        "a".repeat(HOST_LOG_SESSION_NOTE_MAX_LENGTH + 1),
      ),
    ).toEqual({ error: NOTE_TOO_LONG_MESSAGE });
    expect(NOTE_TOO_LONG_MESSAGE).toBe(
      "A note says why you ask in at most 200 characters. Shorten it.",
    );
  });

  test("is counted once it is one line: spaces a paste brought along do not count", () => {
    // 198 letters, six line breaks and a letter: 205 as pasted, 200 as one line.
    const text: string =
      "a".repeat(HOST_LOG_SESSION_NOTE_MAX_LENGTH - 2) + "\n\n\n\n\n\nb";

    expect(text.length).toBeGreaterThan(HOST_LOG_SESSION_NOTE_MAX_LENGTH);
    expect(HostLogSessionNote.prepare(text).note).toHaveLength(
      HOST_LOG_SESSION_NOTE_MAX_LENGTH,
    );
  });

  test("what redaction adds never takes it past what is kept", () => {
    // The most a note can grow: a value a character long after each name.
    const worst: string = "pin=1,".repeat(
      Math.floor(HOST_LOG_SESSION_NOTE_MAX_LENGTH / 6),
    );
    const note: string = HostLogSessionNote.prepare(worst).note!;

    expect(note).toContain("pin=[redacted],");
    expect(Array.from(note).length).toBeLessThanOrEqual(MAX_KEPT_NOTE_LENGTH);
  });
});
