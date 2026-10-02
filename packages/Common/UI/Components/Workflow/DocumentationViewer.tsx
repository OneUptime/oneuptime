import { API_DOCS_URL, DOCS_URL } from "../../Config";
import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Icon from "../Icon/Icon";
import BreakableCode from "./BreakableCode";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentDocumentation, {
  ComponentDocumentationExample,
  ComponentDocumentationField,
  ComponentDocumentationLink,
  ComponentDocumentationLinkSite,
  ComponentDocumentationNote,
  ComponentDocumentationNoteType,
  ComponentDocumentationTopic,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import {
  DocumentationTextPart,
  DocumentationTextPartType,
  parseDocumentationText,
} from "../../../Types/Workflow/Documentation/DocumentationText";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useState,
} from "react";

/*
 * A workflow step's "How to use" help (Types/Workflow/Documentation), drawn
 * so it can be taken in at a glance:
 *
 *   what the step does, in one sentence
 *   1 2 3  how to use it
 *   an example to copy, built from this step's own identifier
 *   the gotchas, as short callouts
 *   Learn more (collapsed)                     links to the full guide
 *
 * It used to be a Markdown file fetched from the server and rendered as a
 * page: a heading the size of a title for every topic, the same text for every
 * model, a spinner while it loaded and an error box when it did not. The help
 * is data now, so there is nothing to load and nothing to fail.
 */

export interface ComponentProps {
  documentation: ComponentDocumentation;
}

type GetLinkUrlFunction = (link: ComponentDocumentationLink) => string;

export const getDocumentationLinkUrl: GetLinkUrlFunction = (
  link: ComponentDocumentationLink,
): string => {
  switch (link.site) {
    case ComponentDocumentationLinkSite.Docs:
      return `${DOCS_URL.toString()}${link.path}`;
    case ComponentDocumentationLinkSite.APIReference:
      return `${API_DOCS_URL.toString()}${link.path}`;
    case ComponentDocumentationLinkSite.External:
    default:
      return link.path;
  }
};

// A literal that is a {{...}} reference wraps only between its parts.
const REFERENCE_PATTERN: RegExp = /^\{\{[^\n]*\}\}$/;

type IsReferenceFunction = (text: string) => boolean;

const isReference: IsReferenceFunction = (text: string): boolean => {
  return REFERENCE_PATTERN.test(text);
};

type RenderTextFunction = (text: string) => ReactNode;

/*
 * Help text with its three marks: a name in bold, a literal in code, a link
 * that opens in a new tab.
 */
export const renderDocumentationText: RenderTextFunction = (
  text: string,
): ReactNode => {
  return parseDocumentationText(text).map(
    (part: DocumentationTextPart, index: number): ReactNode => {
      switch (part.type) {
        case DocumentationTextPartType.Name:
          return (
            <strong key={index} className="font-semibold text-gray-900">
              {part.text}
            </strong>
          );
        case DocumentationTextPartType.Literal:
          return isReference(part.text) ? (
            <BreakableCode
              key={index}
              text={part.text}
              breakAfter="."
              className="rounded border border-gray-200 bg-white px-1 text-[0.85em] text-gray-800"
            />
          ) : (
            <code
              key={index}
              className="rounded border border-gray-200 bg-white px-1 font-mono text-[0.85em] text-gray-800"
            >
              {part.text}
            </code>
          );
        case DocumentationTextPartType.Link:
          return (
            <a
              key={index}
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline hover:text-blue-700"
            >
              {part.text}
            </a>
          );
        case DocumentationTextPartType.Text:
        default:
          return <React.Fragment key={index}>{part.text}</React.Fragment>;
      }
    },
  );
};

interface ExampleProps {
  example: ComponentDocumentationExample;
}

const Example: FunctionComponent<ExampleProps> = (
  props: ExampleProps,
): ReactElement => {
  const example: ComponentDocumentationExample = props.example;
  const code: string | undefined = example.code;

  return (
    <div data-testid="workflow-component-docs-example">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-medium text-gray-700">
          {example.title}
        </p>
        {code ? (
          <CopyTextButton
            textToBeCopied={code}
            size="sm"
            variant="soft"
            title={`Copy the example: ${example.title}`}
            className="shrink-0"
          />
        ) : (
          <></>
        )}
      </div>

      {code && isReference(code) ? (
        <div className="mt-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-5">
          <BreakableCode
            text={code}
            breakAfter="."
            dataTestId="workflow-component-docs-example-code"
            className="block text-gray-800"
          />
        </div>
      ) : (
        <></>
      )}

      {code && !isReference(code) ? (
        <pre
          className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-gray-800"
          data-testid="workflow-component-docs-example-code"
        >
          <code className="font-mono">{code}</code>
        </pre>
      ) : (
        <></>
      )}

      {example.fields && example.fields.length > 0 ? (
        <dl
          className="mt-1.5 rounded-md border border-gray-200 bg-white px-3 py-1"
          data-testid="workflow-component-docs-example-fields"
        >
          {example.fields.map(
            (field: ComponentDocumentationField, index: number) => {
              return (
                <div
                  key={index}
                  className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3"
                >
                  <dt className="shrink-0 text-xs font-medium text-gray-500 sm:w-28">
                    {field.name}
                  </dt>
                  <dd className="min-w-0 break-words text-xs text-gray-800">
                    {isReference(field.value) ? (
                      <BreakableCode text={field.value} breakAfter="." />
                    ) : (
                      <code className="font-mono">{field.value}</code>
                    )}
                  </dd>
                </div>
              );
            },
          )}
        </dl>
      ) : (
        <></>
      )}

      {example.description ? (
        <p className="mt-1.5 text-xs leading-5 text-gray-500">
          {renderDocumentationText(example.description)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

interface NoteProps {
  note: ComponentDocumentationNote;
}

const Note: FunctionComponent<NoteProps> = (props: NoteProps): ReactElement => {
  const isWarning: boolean =
    props.note.type === ComponentDocumentationNoteType.Warning;

  return (
    <li
      className={
        isWarning
          ? "flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
          : "flex items-start gap-2 rounded-md border border-blue-100 bg-white px-3 py-2 text-xs leading-5 text-gray-700"
      }
      data-testid="workflow-component-docs-note"
      data-note-type={props.note.type}
    >
      <Icon
        icon={isWarning ? IconProp.Alert : IconProp.Info}
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
          isWarning ? "text-amber-500" : "text-blue-500"
        }`}
      />
      {/* A div, not a p: Icon renders a div, and the two sit side by side. */}
      <div className="min-w-0">{renderDocumentationText(props.note.text)}</div>
    </li>
  );
};

const DocumentationViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const documentation: ComponentDocumentation = props.documentation;
  const [showMore, setShowMore] = useState<boolean>(false);
  const learnMoreId: string = useId();

  const hasLearnMore: boolean = documentation.learnMore.length > 0;
  const hasLinks: boolean = documentation.links.length > 0;

  return (
    <div className="space-y-4" data-testid="workflow-component-docs">
      <p
        className="text-sm leading-6 text-gray-900"
        data-testid="workflow-component-docs-summary"
      >
        {renderDocumentationText(documentation.summary)}
      </p>

      {documentation.steps.length > 0 ? (
        <ol className="space-y-2" data-testid="workflow-component-docs-steps">
          {documentation.steps.map((step: string, index: number) => {
            return (
              <li
                key={index}
                className="flex items-start gap-2.5 text-sm leading-6 text-gray-700"
                data-testid="workflow-component-docs-step"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold leading-none text-blue-700"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">{renderDocumentationText(step)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <></>
      )}

      {documentation.examples.length > 0 ? (
        <div className="space-y-3">
          {documentation.examples.map(
            (example: ComponentDocumentationExample, index: number) => {
              return <Example key={index} example={example} />;
            },
          )}
        </div>
      ) : (
        <></>
      )}

      {documentation.notes.length > 0 ? (
        <ul className="space-y-2" data-testid="workflow-component-docs-notes">
          {documentation.notes.map(
            (note: ComponentDocumentationNote, index: number) => {
              return <Note key={index} note={note} />;
            },
          )}
        </ul>
      ) : (
        <></>
      )}

      {hasLearnMore || hasLinks ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-blue-100 pt-3">
          {hasLearnMore ? (
            <button
              type="button"
              aria-expanded={showMore}
              aria-controls={showMore ? learnMoreId : undefined}
              className="inline-flex items-center gap-1 rounded text-sm font-medium text-blue-700 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              data-testid="workflow-component-docs-learn-more-toggle"
              onClick={() => {
                setShowMore(!showMore);
              }}
            >
              <Icon
                icon={showMore ? IconProp.ChevronDown : IconProp.ChevronRight}
                className="h-4 w-4"
              />
              {showMore ? "Show less" : "Learn more"}
            </button>
          ) : (
            <span />
          )}

          {hasLinks ? (
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1"
              data-testid="workflow-component-docs-links"
            >
              {documentation.links.map(
                (link: ComponentDocumentationLink, index: number) => {
                  return (
                    <a
                      key={index}
                      href={getDocumentationLinkUrl(link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      data-testid="workflow-component-docs-link"
                    >
                      {link.title}
                      <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
                    </a>
                  );
                },
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      {hasLearnMore && showMore ? (
        <div
          id={learnMoreId}
          className="space-y-4"
          data-testid="workflow-component-docs-learn-more"
        >
          {documentation.learnMore.map(
            (topic: ComponentDocumentationTopic, index: number) => {
              return (
                <div key={index}>
                  <h5 className="text-sm font-semibold text-gray-900">
                    {topic.title}
                  </h5>
                  {topic.paragraphs.map((paragraph: string, i: number) => {
                    return (
                      <p
                        key={i}
                        className="mt-1 text-sm leading-6 text-gray-700"
                      >
                        {renderDocumentationText(paragraph)}
                      </p>
                    );
                  })}
                  {topic.example ? (
                    <div className="mt-2">
                      <Example example={topic.example} />
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default DocumentationViewer;
