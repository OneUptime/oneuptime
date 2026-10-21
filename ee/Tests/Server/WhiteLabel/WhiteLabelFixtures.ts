/*
 * Image bytes for the white-label tests: the smallest real file of each type
 * an upload can be, and SVGs that must be refused.
 */

// A real 1x1 PNG.
export const PNG_BYTES: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export const JPEG_BYTES: Buffer = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from("JFIF\u0000", "latin1"),
  Buffer.alloc(32, 1),
  Buffer.from([0xff, 0xd9]),
]);

export const GIF_BYTES: Buffer = Buffer.concat([
  Buffer.from("GIF89a", "latin1"),
  Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]),
  Buffer.alloc(16, 0),
  Buffer.from([0x3b]),
]);

export const WEBP_BYTES: Buffer = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8L", "latin1"),
  Buffer.alloc(18, 0),
]);

export const ICO_BYTES: Buffer = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
  Buffer.from([0x10, 0x10, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00]),
  Buffer.alloc(32, 0),
]);

export const SVG_TEXT: string =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32" viewBox="0 0 120 32"><rect width="120" height="32" fill="#4f46e5"/><text x="8" y="22" font-family="Inter" font-size="18" fill="#fff">Acme</text></svg>';

export const SVG_WITH_XML_DECLARATION: string = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->\n${SVG_TEXT}`;

export const UNSAFE_SVGS: ReadonlyArray<[string, string]> = [
  [
    "a script element",
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  ],
  [
    "an onload handler",
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
  ],
  [
    "an event handler with spaces before =",
    '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick  ="alert(1)"/></svg>',
  ],
  [
    "a javascript: link",
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
  ],
  [
    "embedded HTML",
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>',
  ],
  [
    "an entity declaration",
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg"><text>&a;</text></svg>',
  ],
  [
    "a script in upper case",
    '<SVG xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT></SVG>',
  ],
];

export const toDataUrlOf: (type: string, bytes: Buffer | string) => string = (
  type: string,
  bytes: Buffer | string,
): string => {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
};
