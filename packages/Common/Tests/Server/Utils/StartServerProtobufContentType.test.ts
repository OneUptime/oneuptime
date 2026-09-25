import {
  PROTOBUF_CONTENT_TYPES,
  isProtobufContentType,
} from "../../../Server/Utils/StartServer";
import { describe, expect, test } from "@jest/globals";

/*
 * The global body-parser chain decides by content type whether a body is
 * read raw (a Buffer the protobuf handlers decode) or handed to the JSON
 * parser. "application/proto" - the Connect protocol's spelling, posted by
 * Grafana Alloy's pyroscope.write and pyroscope-dotnet v0.14+ - was missing,
 * so those bodies fell through to the JSON parser, came out as {} and every
 * Pyroscope push was answered 400 (GH#4037).
 */
describe("isProtobufContentType", () => {
  test.each([
    ["application/x-protobuf"],
    ["application/protobuf"],
    ["application/proto"],
    ["application/proto; charset=binary"],
    ["Application/Proto"],
    ["APPLICATION/X-PROTOBUF"],
    ["  application/proto  "],
  ])("%s is protobuf", (contentType: string) => {
    expect(isProtobufContentType(contentType)).toBe(true);
  });

  test.each([
    [undefined],
    [""],
    ["application/json"],
    ["application/octet-stream"],
    ["multipart/form-data; boundary=x"],
    ["application/grpc"],
    ["application/connect+proto"],
    ["application/protobuffer"],
    ["text/plain; note=application/proto"],
  ])("%s is not", (contentType: string | undefined) => {
    expect(isProtobufContentType(contentType)).toBe(false);
  });

  /*
   * The raw parser and the dispatch both read this one list. Whether a real
   * application/proto body arrives as a Buffer is asserted end to end in
   * App's PyroscopeDotnetIngest test, through the actual parser chain.
   */
  test("lists exactly the protobuf media types, Connect's included", () => {
    expect(PROTOBUF_CONTENT_TYPES).toEqual([
      "application/x-protobuf",
      "application/protobuf",
      "application/proto",
    ]);
  });
});
