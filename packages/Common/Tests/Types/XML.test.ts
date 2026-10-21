import BadDataException from "../../Types/Exception/BadDataException";
import XML from "../../Types/XML";

describe("class XML", () => {
  test("new XML should return valid object if it is valid", () => {
    const xmlString: string = "<test> <info>Test</info></test>";
    const xml: XML = new XML(xmlString);
    expect(xml.toString()).toEqual(xmlString);
    expect(xml.xml).toEqual(xmlString);
  });
  test("XML.xml should be mutable", () => {
    const xmlNewString: string = "<new> <info>Test</info></new>";
    const xml: XML = new XML("<test> <info>Test</info></test>");
    xml.xml = xmlNewString;
    expect(xml.toString()).toEqual(xmlNewString);
    expect(xml.xml).toEqual(xmlNewString);
  });
  test("mutating XML.xml with empty string should throw BadDataException", () => {
    const xml: XML = new XML("<test> <info>Test</info></test>");
    expect(() => {
      xml.xml = "";
    }).toThrowError(BadDataException);
    expect(() => {
      xml.xml = "";
    }).toThrow("XML is not in valid format.");
  });

  test("new should throw BadDataException if empty string is given", () => {
    expect(() => {
      new XML("");
    }).toThrowError(BadDataException);
    expect(() => {
      new XML("");
    }).toThrow("XML is not in valid format.");
  });
});

describe("XML.escape", () => {
  test("escapes the five characters that can break out of text or an attribute", () => {
    expect(XML.escape(`R&D <"core"> isn't`)).toBe(
      "R&amp;D &lt;&quot;core&quot;&gt; isn&apos;t",
    );
  });

  test("escapes each character once", () => {
    expect(XML.escape("<")).toBe("&lt;");
    expect(XML.escape("&lt;")).toBe("&amp;lt;");
  });

  test("escapes the end of a CDATA section", () => {
    expect(XML.escape("a]]>b")).toBe("a]]&gt;b");
  });

  test("drops characters XML cannot carry at all", () => {
    expect(
      XML.escape("a\u0000b\u0008c\u000Bd\u001be\uFFFEf\uFFFFg\uD800h"),
    ).toBe("abcdefgh");
  });

  test("keeps tabs, line breaks and characters outside the BMP", () => {
    const text: string = "one\ttwo\nthree\r\nfour \u{1F525} 日本";

    expect(XML.escape(text)).toBe(text);
  });

  test("round-trips through an XML parser, as text and as an attribute", () => {
    const value: string = `R&D <"core"> isn't ]]> <![CDATA[ x ]]> &amp; \u{1F525}`;
    const parsed: Document = new DOMParser().parseFromString(
      `<x a="${XML.escape(value)}">${XML.escape(value)}</x>`,
      "application/xml",
    );

    expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(parsed.documentElement.textContent).toBe(value);
    expect(parsed.documentElement.getAttribute("a")).toBe(value);
  });

  test("leaves a document a parser accepts after dropping what XML cannot carry", () => {
    const parsed: Document = new DOMParser().parseFromString(
      `<x>${XML.escape("build \u001b[31mfailed\u001b[0m")}</x>`,
      "application/xml",
    );

    expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(parsed.documentElement.textContent).toBe("build [31mfailed[0m");
  });
});
