import { describe, expect, test } from "@jest/globals";
import {
  AWS_XML_MAX_DEPTH,
  AWS_XML_MAX_ELEMENTS,
  AWS_XML_MAX_LENGTH,
  AwsXmlElement,
  AwsXmlError,
  decodeXmlEntities,
  parseAwsXml,
  xmlAt,
  xmlChild,
  xmlFind,
  xmlList,
  xmlText,
} from "../../../../Server/Utils/CloudConnection/LiveRead/AwsXml";
import {
  LiveReadText,
  joinLiveWords,
  liveEntries,
  liveHeader,
  liveText,
  liveTime,
  liveUsage,
  sliceWhole,
} from "../../../../Server/Utils/CloudConnection/LiveRead/LiveReadFormat";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * The XML reader the AWS Query protocol's answers are read with, and the
 * formatting every live read's answer is written with: both read text a
 * cloud sent, so both are total, bounded and linear in what they read -
 * no regular expression runs over the cloud's text.
 */

function parseError(xml: string): string {
  try {
    parseAwsXml(xml);
  } catch (error) {
    expect(error).toBeInstanceOf(AwsXmlError);
    return (error as Error).message;
  }

  throw new Error("The XML was read.");
}

describe("the AWS XML reader", () => {
  test("reads a Query answer whole: the declaration and namespace skipped, lists whatever their items are called", () => {
    const root: AwsXmlElement = parseAwsXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<DescribeDBInstancesResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/">
  <DescribeDBInstancesResult>
    <DBInstances>
      <DBInstance>
        <DBInstanceIdentifier>orders</DBInstanceIdentifier>
        <Endpoint><Address>orders.example.com</Address><Port>5432</Port></Endpoint>
        <ReadReplicaDBInstanceIdentifiers>
          <ReadReplicaDBInstanceIdentifier>orders-a</ReadReplicaDBInstanceIdentifier>
          <ReadReplicaDBInstanceIdentifier>orders-b</ReadReplicaDBInstanceIdentifier>
        </ReadReplicaDBInstanceIdentifiers>
      </DBInstance>
      <DBInstance><DBInstanceIdentifier>billing</DBInstanceIdentifier></DBInstance>
    </DBInstances>
  </DescribeDBInstancesResult>
  <ResponseMetadata><RequestId>abc</RequestId></ResponseMetadata>
</DescribeDBInstancesResponse>`,
    );

    expect(root.name).toBe("DescribeDBInstancesResponse");

    const instances: Array<AwsXmlElement> = xmlFind(
      root,
      "DBInstances",
    )!.children;
    expect(
      instances.map((instance: AwsXmlElement): string => {
        return xmlText(instance, "DBInstanceIdentifier");
      }),
    ).toEqual(["orders", "billing"]);
    expect(xmlText(instances[0], "Endpoint/Port")).toBe("5432");
    expect(
      xmlList(instances[0], "ReadReplicaDBInstanceIdentifiers").map(
        (replica: AwsXmlElement): string => {
          return replica.text;
        },
      ),
    ).toEqual(["orders-a", "orders-b"]);
    expect(xmlText(root, "ResponseMetadata/RequestId")).toBe("abc");
  });

  test("EC2's item lists and Auto Scaling's member lists read alike", () => {
    const ec2: AwsXmlElement = parseAwsXml(
      "<R><reservationSet><item><instancesSet><item><instanceId>i-1</instanceId></item></instancesSet></item></reservationSet></R>",
    );
    const autoscaling: AwsXmlElement = parseAwsXml(
      "<R><Groups><member><Name>a</Name></member><member><Name>b</Name></member></Groups></R>",
    );

    expect(
      xmlText(
        xmlList(xmlList(ec2, "reservationSet")[0], "instancesSet")[0],
        "instanceId",
      ),
    ).toBe("i-1");
    expect(xmlList(autoscaling, "Groups")).toHaveLength(2);
  });

  test("decodes the five named entities and numeric references, and leaves anything else as it is", () => {
    expect(
      xmlText(
        parseAwsXml(
          "<a><b>&lt;tag&gt; &amp; &quot;q&quot; &apos;s&apos; &#65;&#x42;&#x1F600;</b></a>",
        ),
        "b",
      ),
    ).toBe("<tag> & \"q\" 's' AB😀");
    expect(decodeXmlEntities("&unknown; & alone &#0; &#xD800; &#xZZ; &;")).toBe(
      "&unknown; & alone &#0; &#xD800; &#xZZ; &;",
    );
    expect(decodeXmlEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeXmlEntities("no entities")).toBe("no entities");
  });

  test("keeps CDATA as it is, and skips comments and processing instructions", () => {
    const root: AwsXmlElement = parseAwsXml(
      "<a><!-- a <b>comment</b> --><?pi x?><b><![CDATA[x &amp; <y>]]> and &amp;</b></a>",
    );

    expect(
      root.children.map((child: AwsXmlElement): string => {
        return child.name;
      }),
    ).toEqual(["b"]);
    expect(xmlText(root, "b")).toBe("x &amp; <y> and &");
  });

  test("skips attributes, a quoted > among them, and reads self-closing elements", () => {
    const root: AwsXmlElement = parseAwsXml(
      `<a x="1>2" y='"'><b/><c attr="v" /><d>text</d></a>`,
    );

    expect(
      root.children.map((child: AwsXmlElement): string => {
        return `${child.name}:${child.text}`;
      }),
    ).toEqual(["b:", "c:", "d:text"]);
  });

  test("drops a namespace prefix from every name, closing tags included", () => {
    const root: AwsXmlElement = parseAwsXml(
      "<ns:Response xmlns:ns='x'><ns:Value>1</ns:Value></ns:Response>",
    );

    expect(root.name).toBe("Response");
    expect(xmlText(root, "Value")).toBe("1");
  });

  test("a path that is not there reads as nothing", () => {
    const root: AwsXmlElement = parseAwsXml("<a><b>1</b></a>");

    expect(xmlText(root, "c/d")).toBe("");
    expect(xmlAt(root, "b/c")).toBeNull();
    expect(xmlChild(null, "b")).toBeNull();
    expect(xmlList(root, "missing")).toEqual([]);
    expect(xmlFind(root, "missing")).toBeNull();
    expect(xmlFind(null, "a")).toBeNull();
    // An element is found when it is the one asked for.
    expect(xmlFind(root, "a")).toBe(root);
  });

  test("refuses what is not a well-formed answer", () => {
    expect(parseError("")).toBe("The answer is empty.");
    expect(parseError("<a><b></a>")).toContain("does not match");
    expect(parseError("<a><b>")).toBe("An element is not closed.");
    expect(parseError("<a>")).toBe("An element is not closed.");
    expect(parseError("</a>")).toContain("does not match");
    expect(parseError("<a><!-- open")).toBe("A comment is not closed.");
    expect(parseError("<a><![CDATA[open")).toBe(
      "A CDATA section is not closed.",
    );
    expect(parseError("<?xml open")).toBe("A declaration is not closed.");
    expect(parseError("<a></a><b></b>")).toBe(
      "The answer does not have exactly one top element.",
    );
    expect(parseError("just text")).toBe(
      "The answer does not have exactly one top element.",
    );
    expect(parseError("<a b='1'")).toBe("A tag is not closed.");
    expect(parseError("<a><>x</></a>")).toBe("A tag has no name.");
  });

  test("never expands an entity a document declares: a DOCTYPE is refused", () => {
    expect(
      parseError(
        '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><a>&lol2;</a>',
      ),
    ).toBe("A DOCTYPE or other declaration is not read.");
  });

  test("refuses an answer deeper, longer or with more elements than a describe's ever is", () => {
    expect(
      parseError(
        `${"<a>".repeat(AWS_XML_MAX_DEPTH + 1)}${"</a>".repeat(AWS_XML_MAX_DEPTH + 1)}`,
      ),
    ).toBe(`The answer nests deeper than ${AWS_XML_MAX_DEPTH} elements.`);
    expect(
      parseAwsXml(
        `${"<a>".repeat(AWS_XML_MAX_DEPTH)}${"</a>".repeat(AWS_XML_MAX_DEPTH)}`,
      ).name,
    ).toBe("a");
    expect(parseError(`<a>${"<b/>".repeat(AWS_XML_MAX_ELEMENTS)}</a>`)).toBe(
      `The answer has more than ${AWS_XML_MAX_ELEMENTS} elements.`,
    );
    expect(parseError(`<a>${"x".repeat(AWS_XML_MAX_LENGTH)}</a>`)).toContain(
      "characters long",
    );
  });

  test("reads in time linear in the answer, whatever its shape", () => {
    // A large, ordinary answer: 50,000 members.
    const members: string =
      "<member><Id>i-0123456789abcdef0</Id><State>ok</State></member>".repeat(
        50000,
      );
    const ampersands: string = `<a>${"&".repeat(2_000_000)};</a>`;
    const entities: string = `<a>${"&amp;".repeat(400_000)}</a>`;
    const openQuote: string = `<a b="${"x".repeat(2_000_000)}`;
    const openTags: string = `<a>${"<".repeat(1_000_000)}`;

    const timed: FastestRun<Array<unknown>> = fastestRun({
      run: (): Array<unknown> => {
        return [
          xmlList(parseAwsXml(`<R><L>${members}</L></R>`), "L").length,
          // Ampersands that never end an entity, and runs of entities.
          parseAwsXml(ampersands).text.length,
          parseAwsXml(entities).text.length,
          // A quote that never closes inside a tag, and a "<" with no ">" after it.
          parseError(openQuote),
          parseError(openTags) !== "",
        ];
      },
      limitInMs: 10000,
    });

    expect(timed.result).toEqual([
      50000,
      2_000_001,
      400_000,
      "A tag is not closed.",
      true,
    ]);
    expect(timed.inMs).toBeLessThan(10000);
  });
});

describe("how a live read writes a value from the cloud", () => {
  test("on one line: control characters become a space, line breaks too (or ⏎ in a log line), the ends trimmed", () => {
    // NUL and LINE SEPARATOR, written as codes: the source holds no such character.
    expect(
      liveText(
        `  a\tb${String.fromCharCode(0)}c${String.fromCharCode(0x2028)}d${String.fromCharCode(0x85)}e  `,
      ),
    ).toBe("a b c d e");
    expect(liveText("first\r\nsecond\nthird\r")).toBe("first second third");
    expect(liveText("first\r\nsecond\n\n", 100, { keepLineBreaks: true })).toBe(
      "first ⏎ second",
    );
    expect(liveText("\n\n  only  \n")).toBe("only");
    expect(liveText("a      b")).toBe("a b");
  });

  test("numbers and booleans are written out; anything else is nothing", () => {
    expect(liveText(42)).toBe("42");
    expect(liveText(true)).toBe("true");
    expect(liveText(NaN)).toBe("");
    expect(liveText({ a: 1 })).toBe("");
    expect(liveText(null)).toBe("");
  });

  test("cut to its length with …, never in half of a surrogate pair, and never scanned past twice its length", () => {
    expect(liveText("abcdefghij", 5)).toBe("abcd…");
    expect(liveText("abcde", 5)).toBe("abcde");
    expect(sliceWhole("ab😀", 3)).toBe("ab");
    expect(sliceWhole("ab😀", 4)).toBe("ab😀");

    const input: string = "x".repeat(16 * 1024 * 1024);
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return liveText(input, 500);
      },
      limitInMs: 2000,
    });
    expect(timed.result).toHaveLength(500);
    expect(timed.result.endsWith("…")).toBe(true);
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("times are ISO 8601 in UTC, to the second unless asked for milliseconds", () => {
    expect(liveTime(Date.parse("2026-10-27T09:58:00.123Z"))).toBe(
      "2026-10-27T09:58:00Z",
    );
    expect(liveTime("2026-10-27T09:58:00.123Z", { milliseconds: true })).toBe(
      "2026-10-27T09:58:00.123Z",
    );
    expect(liveTime(new Date("2026-10-27T09:58:00Z"))).toBe(
      "2026-10-27T09:58:00Z",
    );
    expect(liveTime("2026-10-01T10:00:00.000+0000")).toBe(
      "2026-10-01T10:00:00Z",
    );
    expect(liveTime("not a time")).toBe("");
    expect(liveTime(undefined)).toBe("");
  });

  test("usage is used of limit, with its share; a unit of None is not written", () => {
    expect(liveUsage(96, 128, "vCPU")).toBe("96 of 128 vCPU (75%)");
    expect(liveUsage(1, 3, "None")).toBe("1 of 3 (33.3%)");
    expect(liveUsage(2.5, 0)).toBe("2.5 of 0");
  });

  test("an answer: the header, facts that have a value, lists with how many of how many, notes", () => {
    const text: LiveReadText = new LiveReadText(
      liveHeader({
        cloud: "AWS",
        at: new Date("2026-10-27T10:00:00Z"),
        calls: ["ECS DescribeServices", "DescribeTaskDefinition"],
        subject: "ECS service x\nwith a line break",
      }),
    );

    text.fact("status", "ACTIVE");
    text.fact("empty", "");
    text.fact("missing", undefined);
    text.list("events", ["one", "two\nlines", ""], { total: 9 });
    text.list("targets", [], { empty: "none registered" });
    text.note("read with care\n");

    expect(text.toString()).toBe(
      [
        "Live from AWS at 2026-10-27T10:00:00Z (ECS DescribeServices, DescribeTaskDefinition): ECS service x with a line break",
        "status: ACTIVE",
        "events (2 of 9):",
        "- one",
        "- two ⏎ lines",
        "targets: none registered",
        "note: read with care",
      ].join("\n"),
    );
  });

  test("entries of an object are sorted, bounded, and plain values only", () => {
    expect(
      liveEntries(
        { b: "2", a: 1, c: ["x", "y"], d: { nested: true }, e: "" },
        10,
      ),
    ).toEqual(["a: 1", "b: 2", "c: x, y"]);
    expect(liveEntries({ a: "1", b: "2", c: "3" }, 2)).toEqual([
      "a: 1",
      "b: 2",
    ]);
    expect(liveEntries(null, 5)).toEqual([]);
    expect(joinLiveWords(["a", "b", "c"])).toBe("a, b and c");
    expect(joinLiveWords(["a"], "or")).toBe("a");
  });
});
