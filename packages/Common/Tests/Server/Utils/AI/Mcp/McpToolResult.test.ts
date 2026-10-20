import {
  McpToolResultText,
  readMcpToolResult,
} from "../../../../../Server/Utils/AI/Mcp/McpToolResult";
import { describe, expect, test } from "@jest/globals";

/*
 * What a tool of an external MCP server answered, as the text OneUptime AI
 * reads: text kept, images and files named and left out, the structured
 * result when there is no text.
 */

describe("readMcpToolResult", () => {
  test("keeps text parts as they are, one after the other", () => {
    expect(
      readMcpToolResult({
        content: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
        ],
      }),
    ).toEqual({ isError: false, text: "line one\nline two", omittedParts: 0 });
  });

  test("names images, audio and binary files, and leaves them out", () => {
    const answer: McpToolResultText = readMcpToolResult({
      content: [
        { type: "text", text: "Here is a graph:" },
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        { type: "audio", data: "UklGR", mimeType: "audio/wav" },
        {
          type: "resource",
          resource: {
            uri: "file:///report.pdf",
            mimeType: "application/pdf",
            blob: "JVBERi0=",
          },
        },
      ],
    });

    expect(answer.omittedParts).toBe(3);
    expect(answer.text).toBe(
      [
        "Here is a graph:",
        "[An image (image/png) the tool returned is not shown.]",
        "[An audio clip (audio/wav) the tool returned is not shown.]",
        "[The file file:///report.pdf (application/pdf) the tool returned is not shown.]",
      ].join("\n"),
    );
    expect(answer.text).not.toContain("iVBORw0KGgo");
  });

  test("keeps an embedded resource's text under its address, and names a link", () => {
    expect(
      readMcpToolResult({
        content: [
          {
            type: "resource",
            resource: { uri: "logs://api/latest", text: "ERROR timeout" },
          },
          {
            type: "resource_link",
            uri: "https://console.aws.amazon.com/ec2",
            name: "EC2 console",
          },
        ],
      }).text,
    ).toBe(
      "[Resource logs://api/latest]\nERROR timeout\n[Resource EC2 console: https://console.aws.amazon.com/ec2]",
    );
  });

  test("with no text, shows the structured result as JSON", () => {
    expect(
      readMcpToolResult({
        content: [],
        structuredContent: { instances: 2, region: "us-east-1" },
      }).text,
    ).toBe(JSON.stringify({ instances: 2, region: "us-east-1" }, null, 2));
  });

  test("with text, does not repeat the structured result", () => {
    expect(
      readMcpToolResult({
        content: [{ type: "text", text: '[{"instances":2}]' }],
        structuredContent: { instances: 2 },
      }).text,
    ).toBe('[{"instances":2}]');
  });

  test("says when the tool failed", () => {
    expect(
      readMcpToolResult({
        content: [{ type: "text", text: "AccessDenied" }],
        isError: true,
      }),
    ).toEqual({ isError: true, text: "AccessDenied", omittedParts: 0 });
  });

  test("an empty answer says so", () => {
    expect(readMcpToolResult({}).text).toBe("(The tool returned nothing.)");
    expect(readMcpToolResult({ content: "not a list" }).text).toBe(
      "(The tool returned nothing.)",
    );
  });

  test("names a part of a kind it does not know", () => {
    expect(
      readMcpToolResult({ content: [{ type: "hologram" }, null, 5] }),
    ).toEqual({
      isError: false,
      text: '[A part of type "hologram" the tool returned is not shown.]',
      omittedParts: 1,
    });
  });
});
