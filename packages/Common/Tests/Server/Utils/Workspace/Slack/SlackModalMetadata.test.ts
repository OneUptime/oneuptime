import { describe, expect, test } from "@jest/globals";
import SlackModalMetadata, {
  SlackModalMetadataValue,
} from "../../../../../Server/Utils/Workspace/Slack/SlackModalMetadata";

/*
 * A Slack form's submission comes back with no channel, so the form carries
 * where it was opened in its private_metadata, beside the value it always
 * carried - and its submission is answered there, not in a direct message.
 * A form opened before this shipped carries the bare value, and still works.
 */

const INCIDENT_ID: string = "c0000000-0000-4000-8000-000000000001";

describe("SlackModalMetadata", () => {
  test("carries the channel and the thread a form was opened in, and its value", () => {
    const written: string = SlackModalMetadata.write(INCIDENT_ID, {
      channelId: "C0INC2",
      threadTs: "1760000000.000100",
    });

    const read: SlackModalMetadataValue = SlackModalMetadata.read(written);

    expect(read).toEqual({
      value: INCIDENT_ID,
      origin: { channelId: "C0INC2", threadTs: "1760000000.000100" },
    });
  });

  test("a form opened outside a thread carries only its channel", () => {
    const read: SlackModalMetadataValue = SlackModalMetadata.read(
      SlackModalMetadata.write(INCIDENT_ID, { channelId: "C0INC2" }),
    );

    expect(read).toEqual({
      value: INCIDENT_ID,
      origin: { channelId: "C0INC2" },
    });
  });

  test("a form opened from a message only its presser sees carries that too: its submission is answered with what it did", () => {
    const written: string = SlackModalMetadata.write(INCIDENT_ID, {
      channelId: "C0INC2",
      isFromPrivateMessage: true,
    });

    expect(JSON.parse(written)).toEqual({
      oneuptime: 1,
      value: INCIDENT_ID,
      channelId: "C0INC2",
      private: 1,
    });
    expect(SlackModalMetadata.read(written)).toEqual({
      value: INCIDENT_ID,
      origin: { channelId: "C0INC2", isFromPrivateMessage: true },
    });
  });

  test("the private flag alone is worth an envelope; false is not written", () => {
    expect(
      SlackModalMetadata.read(
        SlackModalMetadata.write(INCIDENT_ID, { isFromPrivateMessage: true }),
      ),
    ).toEqual({
      value: INCIDENT_ID,
      origin: { isFromPrivateMessage: true },
    });
    expect(
      SlackModalMetadata.write(INCIDENT_ID, { isFromPrivateMessage: false }),
    ).toBe(INCIDENT_ID);
  });

  test.each([[true], ["1"], [0], [2]])(
    "an envelope whose private flag is %p - not the 1 OneUptime writes - is no private message",
    (flag: unknown) => {
      expect(
        SlackModalMetadata.read(
          JSON.stringify({
            oneuptime: 1,
            value: INCIDENT_ID,
            channelId: "C0INC2",
            private: flag,
          }),
        ),
      ).toEqual({ value: INCIDENT_ID, origin: { channelId: "C0INC2" } });
    },
  );

  test("with nowhere to carry, the value is written bare, as it always was", () => {
    expect(SlackModalMetadata.write(INCIDENT_ID, undefined)).toBe(INCIDENT_ID);
    expect(SlackModalMetadata.write(INCIDENT_ID, {})).toBe(INCIDENT_ID);
  });

  test("a form opened before this shipped reads as its bare value, with nowhere known", () => {
    expect(SlackModalMetadata.read(INCIDENT_ID)).toEqual({
      value: INCIDENT_ID,
      origin: {},
    });

    // The new-incident form carried the channel id it was opened in.
    expect(SlackModalMetadata.read("C0INC2")).toEqual({
      value: "C0INC2",
      origin: {},
    });
  });

  test("JSON that is not the envelope is a bare value too", () => {
    const json: string = JSON.stringify({ value: "x", channelId: "C0OTHER" });

    expect(SlackModalMetadata.read(json)).toEqual({
      value: json,
      origin: {},
    });
  });

  test("text that only starts like JSON is a bare value", () => {
    expect(SlackModalMetadata.read("{not json")).toEqual({
      value: "{not json",
      origin: {},
    });
  });

  test("nothing at all reads as no value", () => {
    expect(SlackModalMetadata.read(undefined)).toEqual({
      value: undefined,
      origin: {},
    });
    expect(SlackModalMetadata.read("")).toEqual({
      value: undefined,
      origin: {},
    });
    expect(SlackModalMetadata.read(42)).toEqual({
      value: undefined,
      origin: {},
    });
  });

  test("an envelope with values that are not text drops them", () => {
    const read: SlackModalMetadataValue = SlackModalMetadata.read(
      JSON.stringify({
        oneuptime: 1,
        value: 7,
        channelId: ["C0"],
        threadTs: 1,
      }),
    );

    expect(read).toEqual({ value: undefined, origin: {} });
  });

  test("a value too long for the envelope's 3000 characters is written bare", () => {
    const long: string = "x".repeat(2990);

    expect(SlackModalMetadata.write(long, { channelId: "C0INC2" })).toBe(long);
  });
});
