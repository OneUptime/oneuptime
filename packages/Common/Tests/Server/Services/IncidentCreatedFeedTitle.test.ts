import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import IncidentWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Incident from "../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Token, Tokens, marked } from "marked";

/*
 * An incident's title is plain text, typed by whoever declared it - since
 * incident forms, that is anyone holding a form's link - and the "Incident
 * Created" feed item places it into Markdown that the dashboard renders
 * without its safe mode, that is posted to Slack and Teams, and that owners
 * read in email. So the title is escaped where it is placed, as MarkdownEscape
 * says a title must be: a title cannot become a link, an image fetched when
 * the feed is opened, raw HTML, or a Slack channel mention - and an ordinary
 * title still reads exactly as typed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f201",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f202",
);

type CreateIncidentFeedAsyncFunction = (incident: Incident) => Promise<void>;

let feedItem: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  feedItem = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentWorkspaceMessages, "getIncidentCreateMessageBlocks")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createdFeedFor(title: string): Promise<string> {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 7;
  incident.incidentNumberWithPrefix = "INC-7";
  incident.title = title;
  incident.description = "Every order fails.";

  await (
    IncidentService as unknown as {
      createIncidentFeedAsync: CreateIncidentFeedAsyncFunction;
    }
  ).createIncidentFeedAsync(incident);

  expect(feedItem).toHaveBeenCalledTimes(1);

  return (feedItem.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
    tokens.push(token);
  });

  return tokens;
}

function typesOf(markdown: string): Array<string> {
  return tokensOf(markdown).map((token: Token): string => {
    return token.type;
  });
}

// The title line of the feed item: the bold text right after the heading.
function titleLine(markdown: string): string {
  return markdown.split("\n").find((line: string): boolean => {
    return line.startsWith("**");
  })!;
}

function slackText(markdown: string): string {
  return JSON.stringify(
    SlackUtil.getMarkdownBlocks({
      payloadMarkdownBlock: {
        _type: "WorkspacePayloadMarkdown",
        text: markdown,
      },
    }),
  );
}

describe("the incident created feed item's title", () => {
  test("an ordinary title reads exactly as typed", async () => {
    const markdown: string = await createdFeedFor("Site 03 - payments (EU)");

    expect(titleLine(markdown)).toBe("**Site 03 - payments (EU)**:");
    expect(slackText(markdown)).toContain("Site 03 - payments (EU)");
    expect(
      await Markdown.convertToHTML(markdown, MarkdownContentType.Email),
    ).toContain("Site 03 - payments (EU)");
  });

  test("an image in the title is not fetched: it arrives as the characters typed", async () => {
    const markdown: string = await createdFeedFor(
      "![x](https://tracker.example/p.png)",
    );

    expect(titleLine(markdown)).toBe(
      "**!\\[x\\](https://tracker.example/p.png)**:",
    );
    expect(typesOf(titleLine(markdown))).not.toContain("image");

    const html: string = await Markdown.convertToHTML(
      markdown,
      MarkdownContentType.Email,
    );

    expect(html).not.toContain("<img");
    /*
     * The bare address may still become a link, which shows where it goes;
     * the text reads as typed.
     */
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "![x](https://tracker.example/p.png)",
    );
  });

  test("a link in the title is not a link that hides where it goes", async () => {
    const markdown: string = await createdFeedFor(
      "[Reset your password](https://evil.example/login)",
    );

    const links: Array<Tokens.Link> = tokensOf(titleLine(markdown)).filter(
      (token: Token): boolean => {
        return token.type === "link";
      },
    ) as Array<Tokens.Link>;

    // Only the bare address stays a link, showing the address it goes to.
    expect(
      links.map((link: Tokens.Link): string => {
        return link.text;
      }),
    ).not.toContain("Reset your password");
    expect(
      await Markdown.convertToHTML(markdown, MarkdownContentType.Email),
    ).toContain("[Reset your password]");
  });

  test("raw HTML in the title reads as text", async () => {
    const markdown: string = await createdFeedFor(
      "<img src=x onerror=alert(1)>",
    );

    expect(typesOf(titleLine(markdown))).not.toContain("html");
  });

  test.each([
    ["<!channel> Checkout is down"],
    ["<!here> ping"],
    ["<#C0123ABC>"],
  ])("%j does not reach Slack as a mention", async (title: string) => {
    const markdown: string = await createdFeedFor(title);

    expect(slackText(markdown)).not.toMatch(/<(![a-z]|#C)/);
    expect(slackText(markdown)).toContain("&lt;");
  });

  test("a backslash at the end of the title does not undo the bold around it", async () => {
    const markdown: string = await createdFeedFor("C:\\temp\\");

    expect(titleLine(markdown)).toBe("**C:\\\\temp\\\\**:");
    expect(
      await Markdown.convertToHTML(
        titleLine(markdown),
        MarkdownContentType.Email,
      ),
    ).toContain("<strong>C:\\temp\\</strong>");
  });

  test("a missing title still says so", async () => {
    const markdown: string = await createdFeedFor("");

    expect(titleLine(markdown)).toBe("**No title provided.**:");
  });

  test("the description stays Markdown", async () => {
    const markdown: string = await createdFeedFor("Checkout is down");

    expect(markdown).toContain("\n\nEvery order fails.\n\n");
  });
});
