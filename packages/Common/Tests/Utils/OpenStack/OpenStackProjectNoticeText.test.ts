import { describe, expect, test } from "@jest/globals";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackProjectNoticeEvent } from "../../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackProjectNoticeFacts,
  OpenStackProjectNoticeMessage,
  writeOpenStackProjectNotice,
} from "../../../Utils/OpenStack/OpenStackProjectNoticeText";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * WHAT A PROJECT READS.
 *
 * Everything in it either is ours or came from the cloud, and what came from the cloud is a name someone
 * typed: it acts in no mail client, chat room or webhook, and an email loads nothing from outside.
 */

function facts(
  overrides: Partial<OpenStackProjectNoticeFacts> = {},
): OpenStackProjectNoticeFacts {
  return {
    event: OpenStackProjectNoticeEvent.IncidentOpened,
    projectId: "aaaabbbbccccdddd",
    projectName: "ou-payments",
    partKind: OpenStackResourceKind.Hypervisor,
    partWords: "A compute host",
    regionName: "RegionOne",
    holdings: { instanceCount: 3, volumeCount: 1 },
    occurredAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("what each event says", () => {
  test("an incident opening says the part, the region and what this project holds", () => {
    const message: OpenStackProjectNoticeMessage =
      writeOpenStackProjectNotice(facts());

    expect(message.markdown).toContain("A compute host in region `RegionOne`");
    expect(message.markdown).toContain("has an incident");
    expect(message.markdown).toContain("ou-payments");
    expect(message.markdown).toContain("3 instances, 1 volume");
    expect(message.markdown).toContain("told again when it is resolved");
    expect(message.subject).toBe(
      "OpenStack notice for ou-payments: incident on a compute host",
    );
  });

  test("resolved says it is over, and promises nothing more", () => {
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({ event: OpenStackProjectNoticeEvent.IncidentResolved }),
    );

    expect(message.markdown).toContain("is resolved");
    expect(message.markdown).not.toContain("told again");
    expect(message.subject).toContain("resolved");
  });

  test("planned maintenance says when, in UTC", () => {
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({
        event: OpenStackProjectNoticeEvent.MaintenancePlanned,
        startsAt: "2026-11-07T09:30:00.000Z",
        endsAt: "2026-11-07T11:00:00.000Z",
      }),
    );

    expect(message.markdown).toContain(
      "Planned from 2026-11-07 09:30 UTC to 2026-11-07 11:00 UTC",
    );
    expect(message.subject).toContain("maintenance planned");
    expect(message.webhook["window"]).toEqual({
      startsAt: "2026-11-07T09:30:00.000Z",
      endsAt: "2026-11-07T11:00:00.000Z",
    });
  });

  test("maintenance on a zone names the zone, which a project can see for itself", () => {
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({
        event: OpenStackProjectNoticeEvent.MaintenancePlanned,
        partWords: "An availability zone",
        zoneName: "az-east",
      }),
    );

    expect(message.markdown).toContain("availability zone `az-east`");
  });

  test("a project's name it doesn't know falls back to its ID", () => {
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({ projectName: null }),
    );

    expect(message.markdown).toContain("aaaabbbbccccdddd");
    expect(message.webhook["project"]).toEqual({
      id: "aaaabbbbccccdddd",
      name: null,
    });
  });

  test("a part it holds nothing countable on still says whose it is", () => {
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({ partWords: "A router", holdings: {} }),
    );

    expect(message.markdown).toContain("about project `ou-payments`");
  });

  test("the webhook says the same, as data", () => {
    const message: OpenStackProjectNoticeMessage =
      writeOpenStackProjectNotice(facts());

    expect(message.webhook).toMatchObject({
      kind: "openstack.project.notice",
      event: OpenStackProjectNoticeEvent.IncidentOpened,
      project: { id: "aaaabbbbccccdddd", name: "ou-payments" },
      part: {
        kind: OpenStackResourceKind.Hypervisor,
        description: "A compute host",
        regionName: "RegionOne",
      },
      holdings: { instanceCount: 3, volumeCount: 1 },
      message: message.markdown,
    });
  });
});

describe("nothing a name holds acts", () => {
  const HOSTILE: Array<string> = [
    "<img src=x onerror=alert(1)>",
    "![tracker](https://tracker.example/p.png)",
    "<script>alert(1)</script>",
    "<!channel> <@U123>",
    "{{constructor.constructor('x')()}}",
    "[click me](https://evil.example/)",
    "```mermaid\ngraph TD; A-->B;\n```",
    "line one\nSubject: injected\r\nBcc: someone@example.com",
    "https://evil.example/autolink",
  ];

  test.each(HOSTILE)("%s", async (name: string) => {
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({ projectName: name, regionName: name, zoneName: name }),
    );

    // One line, whatever it held: a header holds no line break.
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.subject.length).toBeLessThan(160);

    const html: string = await Markdown.convertToHTML(
      message.markdown,
      MarkdownContentType.Email,
    );

    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<[^>]+onerror\s*=/i);
    // Nothing fetched, and no link anyone chose to write.
    expect(html).not.toMatch(/<[^>]*\ssrc\s*=/i);
    expect(html).not.toMatch(/href\s*=\s*"https?:\/\/(evil|tracker)/i);
    // Slack would read these as mentions.
    expect(message.markdown).not.toContain("<!channel>");
    expect(message.markdown).not.toContain("<@U123>");
    expect(JSON.stringify(message.webhook)).not.toContain("<!channel>");
  });

  test("the webhook's own fields are neutralized too, not only its message", () => {
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({ projectName: "<!here> team", regionName: "<@U1>" }),
    );
    const project: JSONObject = message.webhook["project"] as JSONObject;
    const part: JSONObject = message.webhook["part"] as JSONObject;

    expect(project["name"]).not.toBe("<!here> team");
    expect(part["regionName"]).not.toBe("<@U1>");
  });

  test("a name far past any subject is cut, and the body is not", () => {
    const name: string = "x".repeat(5000);
    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      facts({ projectName: name }),
    );

    expect(message.subject.length).toBeLessThan(160);
    expect(message.markdown).toContain(name);
  });

  test("whatever it is, it writes something and throws nothing", () => {
    for (const name of generatedTexts(200, 5750, [
      "<",
      ">",
      "!",
      "[",
      "]",
      "(",
      ")",
      "`",
      "*",
      "_",
      "\n",
      "{{",
      "}}",
      "a",
      " ",
      "@",
    ])) {
      const message: OpenStackProjectNoticeMessage =
        writeOpenStackProjectNotice(facts({ projectName: name }));

      expect(message.subject).not.toMatch(/[\r\n]/);
      expect(message.markdown.length).toBeGreaterThan(0);
    }
  });
});

describe("what it never holds", () => {
  test("nothing about any other project can be in it, because nothing else is in its facts", () => {
    const message: OpenStackProjectNoticeMessage =
      writeOpenStackProjectNotice(facts());

    // The whole shape, so a field added to what it sends has to be looked at here.
    expect(Object.keys(message.webhook).sort()).toEqual([
      "event",
      "holdings",
      "kind",
      "message",
      "occurredAt",
      "part",
      "project",
      "window",
    ]);
    expect(Object.keys(message.webhook["part"] as JSONObject).sort()).toEqual([
      "availabilityZone",
      "description",
      "kind",
      "regionName",
    ]);
  });
});
