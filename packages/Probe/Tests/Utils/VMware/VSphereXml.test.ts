import { describe, expect, test } from "@jest/globals";
import VSphereXml, {
  XmlElement,
  XmlParseError,
  decodeXmlEntities,
  escapeXml,
  parseXml,
} from "../../../Utils/VMware/VSphereXml";
import { loadExchanges } from "./Helpers/ReplayTransport";

describe("VSphereXml", () => {
  test("reads elements by local name, whatever their prefix", () => {
    const document: XmlElement = parseXml(
      '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="x"><soapenv:Body><LoginResponse xmlns="urn:vim25"><returnval><key>abc</key></returnval></LoginResponse></soapenv:Body></soapenv:Envelope>',
    );

    expect(document.name).toBe("Envelope");
    expect(
      VSphereXml.path(document, ["Body", "LoginResponse", "returnval", "key"])
        ?.text,
    ).toBe("abc");
  });

  test("keeps text exactly as written - inventory names keep their spaces", () => {
    const document: XmlElement = parseXml("<val>  VM with spaces  </val>");

    expect(document.text).toBe("  VM with spaces  ");
  });

  test("decodes named, decimal and hex entities, and leaves unknown ones", () => {
    expect(
      decodeXmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"),
    ).toBe("a & b <c> \"d\" 'e'");
    expect(decodeXmlEntities("%2f &#47; &#x2F;")).toBe("%2f / /");
    expect(decodeXmlEntities("&unknown; & alone")).toBe("&unknown; & alone");
  });

  test("escapes what XML needs escaped, and round-trips through the reader", () => {
    const value: string = `p&ss<w>rd"'`;
    const escaped: string = escapeXml(value);

    expect(escaped).toBe("p&amp;ss&lt;w&gt;rd&quot;&apos;");
    expect(parseXml(`<password>${escaped}</password>`).text).toBe(value);
  });

  test("reads attributes in either quote, and self-closing elements", () => {
    const document: XmlElement = parseXml(
      `<root><obj type="HostSystem">host-1</obj><empty a='1' b="2"/></root>`,
    );

    expect(VSphereXml.child(document, "obj")?.attributes["type"]).toBe(
      "HostSystem",
    );
    expect(VSphereXml.child(document, "empty")?.attributes).toEqual({
      a: "1",
      b: "2",
    });
  });

  test("an attribute value may hold a '>'", () => {
    const document: XmlElement = parseXml(`<root a="x>y">text</root>`);

    expect(document.attributes["a"]).toBe("x>y");
    expect(document.text).toBe("text");
  });

  test("reads CDATA as text and skips comments and processing instructions", () => {
    const document: XmlElement = parseXml(
      "<?xml version='1.0'?><!-- a comment --><root><![CDATA[<raw & text>]]></root>",
    );

    expect(document.text).toBe("<raw & text>");
  });

  test("xsiType reads vCenter's xsi:type and the simulator's prefix alike", () => {
    const vcenter: XmlElement = parseXml(
      `<val xsi:type="xsd:long" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">5</val>`,
    );
    const simulator: XmlElement = parseXml(
      `<val xmlns:_XMLSchema-instance="http://www.w3.org/2001/XMLSchema-instance" _XMLSchema-instance:type="ManagedObjectReference" type="ComputeResource">domain-s1</val>`,
    );

    expect(VSphereXml.xsiType(vcenter)).toBe("long");
    expect(VSphereXml.xsiType(simulator)).toBe("ManagedObjectReference");
    // The unprefixed "type" is the managed object reference's own.
    expect(simulator.attributes["type"]).toBe("ComputeResource");
  });

  test("refuses a DOCTYPE - entity definitions are how XML grows itself", () => {
    expect(() => {
      return parseXml(
        '<!DOCTYPE lolz [<!ENTITY lol "lol">]><root>&lol;</root>',
      );
    }).toThrow(XmlParseError);
  });

  test("refuses mismatched, unclosed and empty documents", () => {
    expect(() => {
      return parseXml("<a><b></a></b>");
    }).toThrow("does not match");
    expect(() => {
      return parseXml("<a><b>");
    }).toThrow("ends inside");
    expect(() => {
      return parseXml("not xml at all");
    }).toThrow(XmlParseError);
    expect(() => {
      return parseXml("<a");
    }).toThrow("not closed");
  });

  test("holds a document to its size, depth and element limits", () => {
    expect(() => {
      return parseXml("<a>x</a>", {
        maxLength: 3,
        maxDepth: 64,
        maxElements: 10,
      });
    }).toThrow("characters long");

    const deep: string = "<a>".repeat(10) + "</a>".repeat(10);
    expect(() => {
      return parseXml(deep, { maxLength: 1000, maxDepth: 5, maxElements: 100 });
    }).toThrow("nests deeper");

    const wide: string = `<a>${"<b/>".repeat(20)}</a>`;
    expect(() => {
      return parseXml(wide, {
        maxLength: 1000,
        maxDepth: 64,
        maxElements: 10,
      });
    }).toThrow("more than 10 elements");
  });

  test("children and childText return every match, and null for none", () => {
    const document: XmlElement = parseXml("<r><v>1</v><v>2</v><w>3</w></r>");

    expect(
      VSphereXml.children(document, "v").map((element: XmlElement): string => {
        return element.text;
      }),
    ).toEqual(["1", "2"]);
    expect(VSphereXml.childText(document, "w")).toBe("3");
    expect(VSphereXml.childText(document, "missing")).toBeNull();
    expect(VSphereXml.child(null, "v")).toBeNull();
    expect(VSphereXml.children(undefined, "v")).toEqual([]);
  });

  test("reads every recorded simulator answer", () => {
    for (const name of [
      "vcsim-vcenter-collect.json",
      "vcsim-esx-collect.json",
      "vcsim-vcenter-test.json",
      "vcsim-invalid-login.json",
    ]) {
      for (const exchange of loadExchanges(name)) {
        const document: XmlElement = parseXml(exchange.body);
        expect(["Envelope", "namespaces"]).toContain(document.name);
      }
    }
  });

  test("reads a megabyte-long answer in linear time", () => {
    const objects: string = Array.from(
      { length: 20000 },
      (_: unknown, index: number) => {
        return `<objects><obj type="VirtualMachine">vm-${index}</obj><propSet><name>name</name><val xsi:type="xsd:string">vm number ${index}</val></propSet></objects>`;
      },
    ).join("");
    const started: number = Date.now();
    const document: XmlElement = parseXml(`<returnval>${objects}</returnval>`);

    expect(VSphereXml.children(document, "objects")).toHaveLength(20000);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
