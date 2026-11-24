import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { describe, expect, it } from "@jest/globals";

describe("HTTPErrorResponse", () => {
  it("should return an empty string when data is null", () => {
    const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
      404,
      { data: null },
      {},
    );
    expect(httpResponse.message).toBe("");
  });

  it('should return the message from the "data" property if present', () => {
    const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
      200,
      { data: "Data message" },
      {},
    );
    expect(httpResponse.message).toBe("Data message");
  });

  it('should return the message from the "message" property if present', () => {
    const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
      200,
      { message: "Message message" },
      {},
    );
    expect(httpResponse.message).toBe("Message message");
  });

  it('should return the message from the "error" property if no other message properties are present', () => {
    const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { error: "Error message" },
      {},
    );
    expect(httpResponse.message).toBe("Error message");
  });

  it("should return an empty string when no relevant message properties are present", () => {
    const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
      204,
      { otherProperty: "Other message" },
      {},
    );
    expect(httpResponse.message).toBe("");
  });

  it('should prioritize "data" > "message" > "error" when multiple message properties are present', () => {
    const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
      201,
      {
        data: "Data message",
        message: "Message message",
        error: "Error message",
      },
      {},
    );
    expect(httpResponse.message).toBe("Data message");
  });
});

/*
 * What an error answer says in words (#8413): a page draws statedMessage,
 * never the JSON that `message` falls back to for a log line.
 */
describe("HTTPErrorResponse.statedMessage", () => {
  it.each([
    [{ message: "Pick a probe." }, "Pick a probe."],
    [{ error: "Pick a probe." }, "Pick a probe."],
    [{ data: "<html>502</html>" }, "<html>502</html>"],
    [{ error: { message: "Pick a probe." } }, "Pick a probe."],
    [{ error: { error: "Pick a probe." } }, "Pick a probe."],
    [{ data: { rows: [] }, message: "Pick a probe." }, "Pick a probe."],
  ])(
    "reads the words of %j",
    (body: Record<string, unknown>, words: string) => {
      const answer: HTTPErrorResponse = new HTTPErrorResponse(
        400,
        body as never,
        {},
      );

      expect(answer.statedMessage).toBe(words);
    },
  );

  it.each([
    [{ error: { code: 42 } }],
    [{ error: [1, 2, 3] }],
    [{ error: 42 }],
    [{ error: true }],
    [{ message: "   " }],
    [{ data: { rows: [] } }],
    [{ data: null }],
    [{}],
  ])(
    "states nothing for %j, where message has JSON or a number",
    (body: Record<string, unknown>) => {
      const answer: HTTPErrorResponse = new HTTPErrorResponse(
        500,
        body as never,
        {},
      );

      expect(answer.statedMessage).toBe("");
    },
  );

  it("keeps message as it was, for a log line", () => {
    const answer: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { error: { code: 42 } },
      {},
    );

    expect(answer.message).toBe('{"code":42}');
    expect(answer.statedMessage).toBe("");
  });
});
