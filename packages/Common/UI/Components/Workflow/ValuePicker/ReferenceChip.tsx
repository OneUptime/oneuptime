/*
 * A reference, drawn as a chip: "Webhook › Request Body" in place of
 * {{local.components.webhook-1.returnValues.request-body}}, with the
 * reference itself in the tooltip.
 *
 * Two forms of the same chip. The editor builds its content with the DOM
 * directly (React does not own what is inside a contenteditable), so it uses
 * createReferenceChipElement; anywhere else, ReferenceChip. Both take their
 * classes from here, so they cannot drift apart.
 */

import {
  LABEL_SEPARATOR,
  ReferenceDescription,
  ReferenceTone,
} from "./ReferenceDescription";
import React, { FunctionComponent, ReactElement } from "react";

/** Marks a chip in the editor; its value is the reference the chip stands for. */
export const CHIP_REFERENCE_ATTRIBUTE: string = "data-template-reference";

const CHIP_BASE_CLASS: string =
  "inline-flex max-w-full cursor-default select-none items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px align-baseline text-xs font-medium leading-4";

const CHIP_TONE_CLASS: Record<ReferenceTone, string> = {
  [ReferenceTone.Normal]: "border-indigo-200 bg-indigo-50 text-indigo-700",
  [ReferenceTone.Warning]: "border-amber-200 bg-amber-50 text-amber-700",
};

const CHIP_SOURCE_CLASS: Record<ReferenceTone, string> = {
  [ReferenceTone.Normal]: "truncate font-normal text-indigo-500",
  [ReferenceTone.Warning]: "truncate font-normal text-amber-600",
};

const CHIP_PART_CLASS: string = "truncate";

const CHIP_SEPARATOR_CLASS: string = "shrink-0 opacity-60";

export type ChipClassNameFunction = (tone: ReferenceTone) => string;

export const chipClassName: ChipClassNameFunction = (
  tone: ReferenceTone,
): string => {
  return `${CHIP_BASE_CLASS} ${CHIP_TONE_CLASS[tone]}`;
};

export type ChipTitleFunction = (
  description: ReferenceDescription | null,
  reference: string,
) => string;

/** The tooltip: the reference as stored, and what is wrong with it if anything. */
export const chipTitle: ChipTitleFunction = (
  description: ReferenceDescription | null,
  reference: string,
): string => {
  if (description?.problem) {
    return `${reference}\n${description.problem}`;
  }

  return reference;
};

export type CreateReferenceChipElementFunction = (
  ownerDocument: Document,
  reference: string,
  description: ReferenceDescription | null,
) => HTMLElement;

/**
 * The chip as a DOM element, for the editor. Not editable, not draggable, and
 * carrying its reference in an attribute, which is what the editor reads back.
 */
export const createReferenceChipElement: CreateReferenceChipElementFunction = (
  ownerDocument: Document,
  reference: string,
  description: ReferenceDescription | null,
): HTMLElement => {
  const tone: ReferenceTone = description?.tone || ReferenceTone.Normal;

  const chip: HTMLElement = ownerDocument.createElement("span");
  chip.setAttribute(CHIP_REFERENCE_ATTRIBUTE, reference);
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("draggable", "false");
  chip.setAttribute("data-testid", "template-reference-chip");
  chip.setAttribute("data-tone", tone);
  chip.setAttribute("title", chipTitle(description, reference));
  chip.className = chipClassName(tone);

  if (!description) {
    // Not one this workflow can name: the reference itself, as written.
    const raw: HTMLElement = ownerDocument.createElement("span");
    raw.className = CHIP_PART_CLASS;
    raw.textContent = reference;
    chip.appendChild(raw);
    return chip;
  }

  const source: HTMLElement = ownerDocument.createElement("span");
  source.className = CHIP_SOURCE_CLASS[tone];
  source.textContent = description.source;
  chip.appendChild(source);

  for (const part of description.parts) {
    const separator: HTMLElement = ownerDocument.createElement("span");
    separator.className = CHIP_SEPARATOR_CLASS;
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = LABEL_SEPARATOR.trim();
    chip.appendChild(separator);

    const partElement: HTMLElement = ownerDocument.createElement("span");
    partElement.className = CHIP_PART_CLASS;
    partElement.textContent = part;
    chip.appendChild(partElement);
  }

  return chip;
};

export interface ReferenceChipProps {
  reference: string;
  description: ReferenceDescription | null;
  dataTestId?: string | undefined;
}

/** The same chip, for places that are not the editor. */
export const ReferenceChip: FunctionComponent<ReferenceChipProps> = (
  props: ReferenceChipProps,
): ReactElement => {
  const tone: ReferenceTone = props.description?.tone || ReferenceTone.Normal;

  return (
    <span
      className={chipClassName(tone)}
      title={chipTitle(props.description, props.reference)}
      data-testid={props.dataTestId || "template-reference-chip"}
      data-tone={tone}
    >
      {!props.description ? (
        <span className={CHIP_PART_CLASS}>{props.reference}</span>
      ) : (
        <>
          <span className={CHIP_SOURCE_CLASS[tone]}>
            {props.description.source}
          </span>
          {props.description.parts.map((part: string, index: number) => {
            return (
              <React.Fragment key={index}>
                <span className={CHIP_SEPARATOR_CLASS} aria-hidden="true">
                  {LABEL_SEPARATOR.trim()}
                </span>
                <span className={CHIP_PART_CLASS}>{part}</span>
              </React.Fragment>
            );
          })}
        </>
      )}
    </span>
  );
};

export default ReferenceChip;
