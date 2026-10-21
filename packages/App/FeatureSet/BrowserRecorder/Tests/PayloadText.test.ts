import textOf, { withoutJsonNumbers } from "./PayloadText";

/*
 * The leak checks look for short card fragments with the recorder's own
 * numbers taken out, because a millisecond clock holds any four digits now
 * and then. That is only safe while these helpers never take out page text:
 * a number goes, a string never does - not even one that is all digits,
 * carries escaped quotes, or is itself JSON.
 */
describe("PayloadText", (): void => {
  describe("withoutJsonNumbers", (): void => {
    it("blanks the clocks and sizes of an upload, frames and all", (): void => {
      const body: string =
        '{"sessionStartUnixMs":1791398424101,"payloadBytes":4111} \n' +
        '[{"type":5,"data":{"tag":"oneuptime.click","payload":' +
        '{"x":6,"y":-6.5,"atUnixMs":1791398424111,"text":"Card ending"}},' +
        '"timestamp":1.7913984241e12}]';

      expect(body).toContain("4111");

      const blanked: string = withoutJsonNumbers(body);

      expect(blanked).not.toContain("4111");
      expect(blanked).toBe(
        '{"sessionStartUnixMs":0,"payloadBytes":0} \n' +
          '[{"type":0,"data":{"tag":"oneuptime.click","payload":' +
          '{"x":0,"y":0,"atUnixMs":0,"text":"Card ending"}},' +
          '"timestamp":0}]',
      );
    });

    it("keeps every string as it is, digits included", (): void => {
      const body: string = JSON.stringify({
        text: "Card ending 4111",
        digitsOnly: "4111",
        quoted: 'labelled "4111" twice: 4111',
        backslash: "C:\\cards\\4111",
        nested: JSON.stringify({ label: "4111 1111", at: 4111 }),
        list: ["4111", "x 4111"],
      });

      expect(withoutJsonNumbers(body)).toBe(body);
    });

    it("keeps strings the wire encoding escaped", (): void => {
      // SessionReplayWireEncoding sends % as \u0025 and the slash of http/ as \/.
      const body: string =
        '{"url":"https:\\/\\/shop.example.com\\/cards\\/4111?q=\\u00254111"}';

      expect(withoutJsonNumbers(body)).toBe(body);
    });
  });

  describe("textOf", (): void => {
    it("collects the strings of a payload and none of its numbers", (): void => {
      const text: string = textOf({
        atUnixMs: 1791398424111,
        payload: { text: "Card ending", list: [4111, "x"] },
      });

      expect(text).toBe("Card ending\nx");
    });
  });
});
