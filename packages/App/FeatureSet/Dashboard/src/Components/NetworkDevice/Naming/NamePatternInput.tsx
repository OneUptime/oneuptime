import IconProp from "Common/Types/Icon/IconProp";
import { MAX_NAME_PATTERN_LENGTH } from "Common/Types/NetworkDevice/DeviceNaming";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  NAME_COUNTER_DESCRIPTION,
  NAME_COUNTER_TITLE,
  NAME_PLACEHOLDERS,
  NamePatternProblem,
  NamePlaceholder,
  NamePlaceholderInfo,
  getExampleName,
  getNamePatternProblem,
} from "Common/Utils/NetworkDevice/Naming/NamePattern";
import React, { FunctionComponent, ReactElement, useRef } from "react";

/*
 * THE NAME PATTERN, AS IT IS TYPED (Network > Rules > Naming Rules, issue
 * #6619).
 *
 * A pattern is text with placeholders in braces, which few people write
 * from memory. So the field offers each placeholder as a button that puts it
 * where the cursor is - "Site code" puts {site.code} - and names the example
 * device as it is typed: "UN{site.code}{lookup}" reads "Example: UN1216
 * MNUPLR01". A pattern that cannot be read says why, in place of the
 * example, before the form is sent.
 *
 * The buttons offered first are the placeholders most conventions are made
 * of; the first three parts of the address wait behind the last one's line
 * in the help, so the row stays one row on most screens.
 */

// The placeholders offered as buttons, in the order the row shows them.
export const OFFERED_PLACEHOLDERS: ReadonlyArray<NamePlaceholder> = [
  NamePlaceholder.SiteCode,
  NamePlaceholder.Site,
  NamePlaceholder.DiscoveredName,
  NamePlaceholder.IpOctet4,
  NamePlaceholder.IpAddress,
  NamePlaceholder.MacAddress,
  NamePlaceholder.Vendor,
  NamePlaceholder.Lookup,
];

// What a placeholder's button puts in the pattern.
export function getPlaceholderToken(placeholder: NamePlaceholder): string {
  return `{${placeholder}}`;
}

export const COUNTER_TOKEN: string = "{nn}";

/*
 * The pattern with `token` put where the cursor was - replacing what was
 * selected - and where the cursor goes after it. With no cursor (the field
 * was never focused), the token goes at the end.
 */
export function insertToken(data: {
  value: string;
  token: string;
  selectionStart?: number | null | undefined;
  selectionEnd?: number | null | undefined;
}): { value: string; cursor: number } {
  const value: string = data.value || "";
  const start: number =
    typeof data.selectionStart === "number"
      ? Math.max(0, Math.min(data.selectionStart, value.length))
      : value.length;
  const end: number =
    typeof data.selectionEnd === "number"
      ? Math.max(start, Math.min(data.selectionEnd, value.length))
      : start;

  return {
    value: value.substring(0, start) + data.token + value.substring(end),
    cursor: start + data.token.length,
  };
}

export interface NamePatternInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
  // The lookup table's first value, for the example.
  exampleLookupValue?: string | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  tabIndex?: number | undefined;
}

const NamePatternInput: FunctionComponent<NamePatternInputProps> = (
  props: NamePatternInputProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const value: string = props.value || "";
  const problem: NamePatternProblem | null = value.trim()
    ? getNamePatternProblem(value)
    : null;
  const example: string | null =
    value.trim() && !problem
      ? getExampleName(value, props.exampleLookupValue)
      : null;

  const insert: (token: string) => void = (token: string): void => {
    const input: HTMLInputElement | null = inputRef.current;
    const next: { value: string; cursor: number } = insertToken({
      value: value,
      token: token,
      selectionStart: input?.selectionStart,
      selectionEnd: input?.selectionEnd,
    });

    props.onChange(next.value);

    // The cursor after what was put in, so the next button continues it.
    window.requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(next.cursor, next.cursor);
      }
    });
  };

  const chips: Array<{ token: string; title: string; description: string }> = [
    ...OFFERED_PLACEHOLDERS.map(
      (
        placeholder: NamePlaceholder,
      ): { token: string; title: string; description: string } => {
        const info: NamePlaceholderInfo | undefined = NAME_PLACEHOLDERS.find(
          (candidate: NamePlaceholderInfo): boolean => {
            return candidate.placeholder === placeholder;
          },
        );

        return {
          token: getPlaceholderToken(placeholder),
          title: info?.title || placeholder,
          description: info?.description || "",
        };
      },
    ),
    {
      token: COUNTER_TOKEN,
      title: NAME_COUNTER_TITLE,
      description: NAME_COUNTER_DESCRIPTION,
    },
  ];

  const hasError: boolean = Boolean(props.error) || Boolean(problem);

  return (
    <div className="space-y-2" data-testid="name-pattern-input">
      <input
        ref={inputRef}
        type="text"
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        maxLength={MAX_NAME_PATTERN_LENGTH}
        value={value}
        tabIndex={props.tabIndex}
        aria-labelledby={props.ariaLabelledby}
        aria-describedby={props.ariaDescribedby}
        aria-invalid={hasError}
        placeholder="UN{site.code}{lookup}"
        data-testid="name-pattern-text"
        className={`block w-full rounded-md border bg-white px-3 py-2 font-mono text-sm placeholder-gray-400 focus:outline-none focus:ring-1 ${
          hasError
            ? "border-red-300 text-red-900 focus:border-red-500 focus:ring-red-500"
            : "border-gray-300 text-gray-900 focus:border-indigo-500 focus:ring-indigo-500"
        }`}
        onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
          props.onChange(event.target.value);
        }}
        onBlur={(): void => {
          props.onBlur?.();
        }}
      />

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={translator.translateText("Insert into the name pattern")}
        data-testid="name-pattern-chips"
      >
        <span className="me-0.5 text-xs font-medium text-gray-500">
          {translator.translateText("Insert:")}
        </span>
        {chips.map(
          (chip: {
            token: string;
            title: string;
            description: string;
          }): ReactElement => {
            return (
              <button
                key={chip.token}
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                title={`${chip.token} - ${translator.translateText(chip.description)}`}
                data-testid={`name-pattern-chip-${chip.token}`}
                onClick={(): void => {
                  insert(chip.token);
                }}
              >
                <Icon icon={IconProp.Add} className="h-3 w-3 text-gray-400" />
                {translator.translateText(chip.title)}
              </button>
            );
          },
        )}
      </div>

      {/*
       * Divs, not paragraphs: an Icon draws a div, which a paragraph cannot
       * hold.
       */}
      {problem ? (
        <div
          className="flex items-start gap-1.5 text-sm text-red-600"
          role="alert"
          data-testid="name-pattern-problem"
        >
          <Icon
            icon={IconProp.ErrorSolid}
            className="mt-0.5 h-4 w-4 flex-shrink-0"
          />
          <span>
            {translator.translateTemplate(problem.template, problem.values)}
          </span>
        </div>
      ) : example ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600"
          data-testid="name-pattern-example"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="h-4 w-4 flex-shrink-0 text-green-600"
          />
          <span>{translator.translateText("Example:")}</span>
          <span
            dir="ltr"
            className="rounded bg-green-50 px-1.5 py-0.5 font-mono text-sm font-medium text-green-800"
          >
            {example}
          </span>
          <span className="text-xs text-gray-400">
            {translator.translateText(
              "for a device at 10.48.145.51 in the site coded 1216",
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default NamePatternInput;
