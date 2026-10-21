/*
 * A step's "How to use" help, as the dialog draws it: one sentence, numbered
 * steps, an example to copy, the gotchas as callouts, and the rest collapsed
 * under Learn more, with links to the full guide.
 *
 * It used to fetch a Markdown file and render it as a page. Nothing is
 * fetched now: the help is data, built from the step.
 */

import React from "react";

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    DOCS_URL: URLType.fromString("https://oneuptime.example.com/docs"),
    API_DOCS_URL: URLType.fromString("https://oneuptime.example.com/reference"),
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
      getFriendlyMessage: jest.fn(),
    },
  };
});

import DocumentationViewer, {
  getDocumentationLinkUrl,
} from "../../../../UI/Components/Workflow/DocumentationViewer";
import API from "../../../../UI/Utils/API/API";
import ComponentMetadata from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import ComponentDocumentation, {
  ComponentDocumentationLinkSite,
  ComponentDocumentationNoteType,
} from "../../../../Types/Workflow/Documentation/ComponentDocumentation";
import { getComponentDocumentation } from "../../../../Types/Workflow/Documentation/Index";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const DOCUMENTATION: ComponentDocumentation = {
  summary: "Posts a message to a **Slack** channel.",
  steps: [
    "Paste the webhook URL into **Slack Incoming Webhook URL** ([Slack's guide](https://api.slack.com/messaging/webhooks)).",
    "Write the message in **Message Text**.",
    "Connect **Success** and **Error**.",
  ],
  examples: [
    {
      title: "A message with a value from another step",
      code: "*Heads up:* {{local.components.incident-on-create-1.returnValues.model.title}}",
      description:
        "`{{local.components.incident-on-create-1.returnValues.model.title}}` puts in the title from `incident-on-create-1`.",
    },
    {
      title: "Why Slack refused it",
      code: "{{local.components.slack-1.returnValues.error}}",
    },
  ],
  notes: [
    {
      type: ComponentDocumentationNoteType.Warning,
      text: "Only URLs starting `https://hooks.slack.com/services/` work.",
    },
    {
      type: ComponentDocumentationNoteType.Tip,
      text: "The URL is hidden in run logs.",
    },
  ],
  learnMore: [
    {
      title: "Formatting",
      paragraphs: ["Use `*bold*` and `_italic_`."],
    },
    {
      title: "Comparing a value",
      paragraphs: ["Fill in these settings."],
      example: {
        title: "If / Else",
        fields: [
          {
            name: "Input 1",
            value:
              "{{local.components.api-get-1.returnValues.response-status}}",
          },
          { name: "Operator", value: "Equal To" },
        ],
      },
    },
  ],
  links: [
    {
      title: "Slack step guide",
      site: ComponentDocumentationLinkSite.Docs,
      path: "/workflows/components#slack",
    },
    {
      title: "Every Incident field",
      site: ComponentDocumentationLinkSite.APIReference,
      path: "/incident",
    },
    {
      title: "Slack: incoming webhooks",
      site: ComponentDocumentationLinkSite.External,
      path: "https://api.slack.com/messaging/webhooks",
    },
  ],
};

type SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
) => void;

const setClipboard: SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText: writeText } : undefined,
    configurable: true,
  });
};

type RenderViewerFunction = (
  documentation?: ComponentDocumentation | undefined,
) => RenderResult;

const renderViewer: RenderViewerFunction = (
  documentation?: ComponentDocumentation | undefined,
): RenderResult => {
  return render(
    <DocumentationViewer documentation={documentation || DOCUMENTATION} />,
  );
};

afterEach(() => {
  setClipboard(null);
});

describe("DocumentationViewer: what shows straight away", () => {
  test("one sentence on what the step does comes first", () => {
    renderViewer();

    const docs: HTMLElement = screen.getByTestId("workflow-component-docs");
    const summary: HTMLElement = screen.getByTestId(
      "workflow-component-docs-summary",
    );

    expect(docs.firstElementChild).toBe(summary);
    expect(summary).toHaveTextContent("Posts a message to a Slack channel.");
  });

  test("the steps are a numbered list, in order", () => {
    renderViewer();

    const list: HTMLElement = screen.getByTestId(
      "workflow-component-docs-steps",
    );
    const steps: Array<HTMLElement> = within(list).getAllByTestId(
      "workflow-component-docs-step",
    );

    expect(list.tagName).toBe("OL");
    expect(
      steps.map((step: HTMLElement) => {
        return step.textContent;
      }),
    ).toEqual([
      "1Paste the webhook URL into Slack Incoming Webhook URL (Slack's guide).",
      "2Write the message in Message Text.",
      "3Connect Success and Error.",
    ]);
  });

  test("the step numbers are decoration, so screen readers hear the list's own numbering", () => {
    renderViewer();

    for (const step of screen.getAllByTestId("workflow-component-docs-step")) {
      expect(step.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("names are bold, literals are code, and links open in a new tab", () => {
    renderViewer();

    const step: HTMLElement = screen.getAllByTestId(
      "workflow-component-docs-step",
    )[0]!;

    expect(within(step).getByText("Slack Incoming Webhook URL").tagName).toBe(
      "STRONG",
    );

    const link: HTMLElement = within(step).getByRole("link", {
      name: "Slack's guide",
    });

    expect(link).toHaveAttribute(
      "href",
      "https://api.slack.com/messaging/webhooks",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const note: HTMLElement = screen.getAllByTestId(
      "workflow-component-docs-note",
    )[0]!;

    expect(
      within(note).getByText("https://hooks.slack.com/services/").tagName,
    ).toBe("CODE");
  });

  test("a literal reference wraps only after its dots; other literals are plain code", () => {
    renderViewer();

    const description: HTMLElement = screen.getByText(
      "puts in the title from",
      {
        exact: false,
      },
    );
    const literals: Array<HTMLElement> = Array.from(
      description.querySelectorAll("code"),
    );

    expect(literals).toHaveLength(2);
    expect(
      Array.from(literals[0]!.querySelectorAll("span")).map((part: Element) => {
        return part.textContent;
      }),
    ).toEqual([
      "{{local.",
      "components.",
      "incident-on-create-1.",
      "returnValues.",
      "model.",
      "title}}",
    ]);
    expect(literals[1]!.querySelectorAll("span")).toHaveLength(0);
    expect(literals[1]).toHaveTextContent("incident-on-create-1");
  });

  test("nothing is fetched: the help is data, not a file on the server", () => {
    renderViewer();

    expect(API.get).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DocumentationViewer: examples", () => {
  test("each example has its title, its text and a copy button", () => {
    renderViewer();

    const examples: Array<HTMLElement> = screen.getAllByTestId(
      "workflow-component-docs-example",
    );

    expect(examples).toHaveLength(2);
    expect(examples[0]).toHaveTextContent(
      "A message with a value from another step",
    );
    expect(
      within(examples[0]!).getByTestId("workflow-component-docs-example-code"),
    ).toHaveTextContent(
      "*Heads up:* {{local.components.incident-on-create-1.returnValues.model.title}}",
    );
    expect(
      within(examples[0]!).getByRole("button", {
        name: "Copy the example: A message with a value from another step",
      }),
    ).toBeInTheDocument();
  });

  test("Copy copies exactly the example", async () => {
    const copied: Array<string> = [];

    setClipboard(async (text: string): Promise<void> => {
      copied.push(text);
    });

    renderViewer();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Copy the example: Why Slack refused it",
        }),
      );
    });

    expect(copied).toEqual(["{{local.components.slack-1.returnValues.error}}"]);
  });

  test("an example that is one reference wraps between its parts, like Returns", () => {
    renderViewer();

    const code: HTMLElement = within(
      screen.getAllByTestId("workflow-component-docs-example")[1]!,
    ).getByTestId("workflow-component-docs-example-code");

    expect(code.tagName).toBe("CODE");
    expect(
      Array.from(code.querySelectorAll("span")).map((part: Element) => {
        return part.textContent;
      }),
    ).toEqual([
      "{{local.",
      "components.",
      "slack-1.",
      "returnValues.",
      "error}}",
    ]);
  });

  test("a longer example keeps its lines", () => {
    renderViewer({
      ...DOCUMENTATION,
      examples: [
        {
          title: "One line per item",
          code: "{{#each local.components.x.returnValues.models}}\n- {{name}}\n{{/each}}",
        },
      ],
    });

    const code: HTMLElement = screen.getByTestId(
      "workflow-component-docs-example-code",
    );

    expect(code.tagName).toBe("PRE");
    expect(code.textContent).toBe(
      "{{#each local.components.x.returnValues.models}}\n- {{name}}\n{{/each}}",
    );
  });

  test("an example of settings lists each setting and its value", () => {
    renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Learn more" }));

    const fields: HTMLElement = screen.getByTestId(
      "workflow-component-docs-example-fields",
    );

    expect(fields.tagName).toBe("DL");
    expect(
      Array.from(fields.querySelectorAll("dt")).map((term: Element) => {
        return term.textContent;
      }),
    ).toEqual(["Input 1", "Operator"]);
    expect(
      Array.from(fields.querySelectorAll("dd")).map((value: Element) => {
        return value.textContent;
      }),
    ).toEqual([
      "{{local.components.api-get-1.returnValues.response-status}}",
      "Equal To",
    ]);
    // Settings are filled in one by one, so there is nothing to copy whole.
    expect(
      within(fields.parentElement as HTMLElement).queryByRole("button", {
        name: /^Copy/,
      }),
    ).not.toBeInTheDocument();
  });
});

describe("DocumentationViewer: callouts", () => {
  test("a warning and a tip look different, and say which they are", () => {
    renderViewer();

    const notes: Array<HTMLElement> = screen.getAllByTestId(
      "workflow-component-docs-note",
    );

    expect(
      notes.map((note: HTMLElement) => {
        return note.getAttribute("data-note-type");
      }),
    ).toEqual([
      ComponentDocumentationNoteType.Warning,
      ComponentDocumentationNoteType.Tip,
    ]);
    expect(notes[0]!.className).toContain("bg-amber-50");
    expect(notes[1]!.className).not.toContain("amber");
  });

  test("no list at all when there are no callouts", () => {
    renderViewer({ ...DOCUMENTATION, notes: [] });

    expect(
      screen.queryByTestId("workflow-component-docs-notes"),
    ).not.toBeInTheDocument();
  });
});

describe("DocumentationViewer: Learn more", () => {
  test("is collapsed until asked for", () => {
    renderViewer();

    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Learn more",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("workflow-component-docs-learn-more"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Formatting")).not.toBeInTheDocument();
  });

  test("opens on click, and closes again", () => {
    renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Learn more" }));

    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Show less",
    });
    const region: HTMLElement = screen.getByTestId(
      "workflow-component-docs-learn-more",
    );

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", region.id);
    expect(
      within(region)
        .getAllByRole("heading")
        .map((heading: HTMLElement) => {
          return heading.textContent;
        }),
    ).toEqual(["Formatting", "Comparing a value"]);
    expect(region).toHaveTextContent("Use *bold* and _italic_.");

    fireEvent.click(toggle);

    expect(
      screen.queryByTestId("workflow-component-docs-learn-more"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learn more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("is not offered when there is nothing more", () => {
    renderViewer({ ...DOCUMENTATION, learnMore: [] });

    expect(
      screen.queryByRole("button", { name: "Learn more" }),
    ).not.toBeInTheDocument();
    // The links stay.
    expect(screen.getAllByTestId("workflow-component-docs-link")).toHaveLength(
      3,
    );
  });
});

describe("DocumentationViewer: links", () => {
  test("go to the docs, the API reference and elsewhere, each in a new tab", () => {
    renderViewer();

    const links: Array<HTMLElement> = screen.getAllByTestId(
      "workflow-component-docs-link",
    );

    expect(
      links.map((link: HTMLElement) => {
        return [link.textContent, link.getAttribute("href")];
      }),
    ).toEqual([
      [
        "Slack step guide",
        "https://oneuptime.example.com/docs/workflows/components#slack",
      ],
      [
        "Every Incident field",
        "https://oneuptime.example.com/reference/incident",
      ],
      ["Slack: incoming webhooks", "https://api.slack.com/messaging/webhooks"],
    ]);

    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  test("getDocumentationLinkUrl puts each site's root in front of the path", () => {
    expect(
      getDocumentationLinkUrl({
        title: "x",
        site: ComponentDocumentationLinkSite.Docs,
        path: "/workflows/triggers#webhook",
      }),
    ).toBe("https://oneuptime.example.com/docs/workflows/triggers#webhook");
    expect(
      getDocumentationLinkUrl({
        title: "x",
        site: ComponentDocumentationLinkSite.APIReference,
        path: "/monitor",
      }),
    ).toBe("https://oneuptime.example.com/reference/monitor");
    expect(
      getDocumentationLinkUrl({
        title: "x",
        site: ComponentDocumentationLinkSite.External,
        path: "https://core.telegram.org/bots",
      }),
    ).toBe("https://core.telegram.org/bots");
  });
});

describe("DocumentationViewer: real help for real steps", () => {
  test.each(
    Components.map((metadata: ComponentMetadata) => {
      return [metadata.id, metadata] as [string, ComponentMetadata];
    }),
  )(
    "%s renders, with its examples built from the step's identifier",
    (_id: string, metadata: ComponentMetadata) => {
      const documentation: ComponentDocumentation | null =
        getComponentDocumentation({ metadata, stepId: "my-step-7" });

      expect(documentation).not.toBeNull();

      renderViewer(documentation as ComponentDocumentation);

      expect(
        screen.getByTestId("workflow-component-docs-summary"),
      ).toHaveTextContent(/\.$/);

      if (metadata.returnValues.length > 0) {
        const learnMore: HTMLElement | null = screen.queryByRole("button", {
          name: "Learn more",
        });

        if (learnMore) {
          fireEvent.click(learnMore);
        }

        expect(screen.getByTestId("workflow-component-docs")).toHaveTextContent(
          "{{local.components.my-step-7.returnValues.",
        );
      }
    },
  );

  test("the Webhook trigger's example reads its body by the step's own identifier", () => {
    const metadata: ComponentMetadata = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.Webhook;
      },
    ) as ComponentMetadata;

    renderViewer(
      getComponentDocumentation({
        metadata,
        stepId: "ci-webhook",
      }) as ComponentDocumentation,
    );

    expect(
      screen.getByTestId("workflow-component-docs-example-code"),
    ).toHaveTextContent(
      "{{local.components.ci-webhook.returnValues.request-body.message}}",
    );
  });
});
