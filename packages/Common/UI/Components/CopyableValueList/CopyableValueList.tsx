import CopyTextButton from "../CopyTextButton/CopyTextButton";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Values somebody copies into another system - an identity provider's
 * Entity ID and Reply URL, an OIDC redirect URI - one row each: the value's
 * name over the value, and a button that copies it. Drawn as the DNS Setup
 * dialog draws the record to add at a DNS provider.
 *
 * These used to be a bold "Name:" line over the value as plain text, with
 * line breaks between them and nothing to copy with: a long address had to
 * be selected by hand, and a character missed or added at either end only
 * showed when signing in failed.
 */

export interface CopyableValue {
  // The value's name, in English: the list looks it up.
  label: string;
  value: string;
  // The value's own element, for tests.
  dataTestId?: string | undefined;
}

export interface ComponentProps {
  values: Array<CopyableValue>;
  dataTestId?: string | undefined;
}

/*
 * A label as the copy button names it: without the colon some labels end
 * with ("Identifier (Entity ID):"), in any script.
 */
export const getCopyableValueName: (label: string) => string = (
  label: string,
): string => {
  const trimmed: string = label.trim();

  if (trimmed.endsWith(":") || trimmed.endsWith("\u{FF1A}")) {
    return trimmed.slice(0, -1).trim();
  }

  return trimmed;
};

const CopyableValueList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <dl
      className="divide-y divide-gray-200 rounded-md border border-gray-200"
      data-testid={props.dataTestId}
    >
      {props.values.map((item: CopyableValue): ReactElement => {
        const label: string =
          translator.translateText(item.label) || item.label;

        return (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <dt className="text-xs font-medium text-gray-500">{label}</dt>
              <dd
                className="mt-0.5 break-all font-mono text-sm text-gray-900"
                data-testid={item.dataTestId}
              >
                {item.value}
              </dd>
            </div>
            {/*
             * Named for the value it copies, in the reader's language: the
             * button's own lookup finds no key for it and keeps it.
             */}
            <CopyTextButton
              textToBeCopied={item.value}
              title={translator.translateTemplate("Copy {{name}}", {
                name: getCopyableValueName(label),
              })}
              size="sm"
              variant="ghost"
              iconOnly={true}
              className="shrink-0"
            />
          </div>
        );
      })}
    </dl>
  );
};

export default CopyableValueList;
