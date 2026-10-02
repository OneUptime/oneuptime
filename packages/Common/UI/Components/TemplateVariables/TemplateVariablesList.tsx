/*
 * "Template variables" under a template's field: the variables it can use,
 * collapsed into one line until it is opened. The maintainer's ask, for the
 * note template dialog that listed every placeholder above the editor: "show
 * the list of variables at the bottom, but it should be collapsed ... so it's
 * very simple for people to understand what's happening."
 *
 * Open, it says what the variables are filled with, then lists them by group
 * as cards - the {{name}} and what it holds - and, when the field can take
 * one (onInsert), each card is a button that adds the variable where the
 * cursor is. Typing "{{" in the field picks one too, and the list says so.
 *
 * A native <details>, so the list is in the page while closed (for search
 * and find-in-page) and opens with the keyboard and a screen reader alike.
 */

import { ChevronDownIcon } from "./TemplateVariableIcons";
import TemplateVariablesCopy, {
  TYPING_HINT_KEYS,
  TYPING_HINT_SLOT,
} from "./TemplateVariablesCopy";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
  countTemplateVariables,
  formatTemplateVariable,
} from "../../../Types/Template/TemplateVariable";
import useTranslateValue from "../../Utils/Translation";
import {
  TemplateAround,
  translateTemplateAround,
} from "../../Utils/TranslateTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
} from "react";

/*
 * A variable's {{name}}, allowed to wrap after each dot: a long custom field
 * variable then breaks as "{{incident.customFields." / "customer_impact}}"
 * rather than in the middle of a word.
 */
export const BreakableTemplateVariableName: (props: {
  name: string;
}) => ReactElement = (props: { name: string }): ReactElement => {
  const parts: Array<string> = formatTemplateVariable(props.name).split(".");

  return (
    <>
      {parts.map((part: string, index: number): ReactElement => {
        const isLast: boolean = index === parts.length - 1;

        return (
          <Fragment key={index}>
            {isLast ? part : `${part}.`}
            {isLast ? null : <wbr />}
          </Fragment>
        );
      })}
    </>
  );
};

export interface TemplateVariablesListProps {
  groups: TemplateVariableGroups;
  /** What the variables are filled with, at the top of the open list. */
  description?: string | ReactElement | undefined;
  /** Adds the variable where the cursor is. Without it the list is to read. */
  onInsert?: ((variable: TemplateVariable) => void) | undefined;
  /** Typing "{{" in the field opens the list too; the list says so. */
  supportsTyping?: boolean | undefined;
  /** More, after the groups: a panel of the field's own. */
  children?: ReactNode | undefined;
  defaultOpen?: boolean | undefined;
  dataTestId?: string | undefined;
}

const TemplateVariablesList: FunctionComponent<TemplateVariablesListProps> = (
  props: TemplateVariablesListProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const headingIdPrefix: string = `template-variables-${useId()}`;

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const describe: (variable: TemplateVariable) => string = (
    variable: TemplateVariable,
  ): string => {
    return variable.isDescriptionVerbatim
      ? variable.description
      : tx(variable.description);
  };

  const count: number = countTemplateVariables(props.groups);
  const canInsert: boolean = Boolean(props.onInsert);

  const typingHint: TemplateAround = translateTemplateAround(
    TemplateVariablesCopy.typingHint,
    TYPING_HINT_SLOT,
  );

  const description: ReactNode =
    typeof props.description === "string"
      ? tx(props.description)
      : props.description;

  const renderVariable: (variable: TemplateVariable) => ReactElement = (
    variable: TemplateVariable,
  ): ReactElement => {
    const content: ReactElement = (
      <>
        {/*
         * overflow-wrap: anywhere, not break-word: only "anywhere" lets a
         * long name with no dot to wrap at ({{timeToResolutionDeadline}})
         * shrink the card's min-content width instead of overflowing it.
         */}
        <code className="w-full font-mono text-xs font-medium text-indigo-700 [overflow-wrap:anywhere]">
          <BreakableTemplateVariableName name={variable.name} />
        </code>
        <span className="text-xs text-gray-600">{describe(variable)}</span>
        {variable.example ? (
          <span className="w-full text-xs text-gray-400 [overflow-wrap:anywhere]">
            {variable.example}
          </span>
        ) : null}
      </>
    );

    if (props.onInsert) {
      const onInsert: (variable: TemplateVariable) => void = props.onInsert;

      return (
        <button
          type="button"
          data-testid="template-variable-insert"
          data-variable-name={variable.name}
          className="flex h-full w-full flex-col items-start gap-0.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
            // The field keeps its focus and its cursor.
            event.preventDefault();
          }}
          onClick={() => {
            onInsert(variable);
          }}
        >
          {content}
        </button>
      );
    }

    return (
      <div
        data-testid="template-variable"
        data-variable-name={variable.name}
        className="flex h-full w-full flex-col items-start gap-0.5 rounded-md border border-gray-200 bg-white px-3 py-2"
      >
        {content}
      </div>
    );
  };

  return (
    <details
      className="group mt-3 rounded-lg border border-gray-200 bg-white"
      data-testid={props.dataTestId || "template-variables"}
      open={props.defaultOpen}
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-50 font-mono text-[11px] font-semibold text-indigo-700"
        >
          {"{ }"}
        </span>
        <span className="font-medium text-gray-900">
          {tx(TemplateVariablesCopy.listTitle)}
        </span>
        {count > 0 ? (
          <span
            data-testid="template-variables-count"
            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
          >
            {count}
          </span>
        ) : null}
        <ChevronDownIcon className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-gray-200 px-3 pb-3 pt-3">
        {description || canInsert ? (
          <div className="space-y-1">
            {description ? (
              <p
                className="text-sm text-gray-600"
                data-testid="template-variables-description"
              >
                {description}
              </p>
            ) : null}
            {canInsert ? (
              <p
                className="text-xs text-gray-500"
                data-testid="template-variables-hint"
              >
                {tx(TemplateVariablesCopy.clickToInsert)}
                {props.supportsTyping ? (
                  <>
                    {" "}
                    {typingHint.before}
                    <kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono text-[11px] text-gray-700">
                      {TYPING_HINT_KEYS}
                    </kbd>
                    {typingHint.after}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {props.groups.map(
          (group: TemplateVariableGroup, index: number): ReactElement => {
            const headingId: string = `${headingIdPrefix}-${index}`;

            return (
              <section
                key={`${index}-${group.title || ""}`}
                aria-labelledby={group.title ? headingId : undefined}
                data-testid="template-variables-group"
              >
                {group.title ? (
                  <h4
                    id={headingId}
                    className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {tx(group.title)}
                  </h4>
                ) : null}
                {group.description ? (
                  <p
                    className="mt-0.5 text-xs text-gray-500"
                    data-testid="template-variables-group-description"
                  >
                    {tx(group.description)}
                  </p>
                ) : null}
                {group.variables.length > 0 ? (
                  <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {group.variables.map(
                      (variable: TemplateVariable): ReactElement => {
                        return (
                          <li key={variable.name}>
                            {renderVariable(variable)}
                          </li>
                        );
                      },
                    )}
                  </ul>
                ) : null}
              </section>
            );
          },
        )}

        {props.children}
      </div>
    </details>
  );
};

export default TemplateVariablesList;
