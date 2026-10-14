import {
  describeMitreId,
  getMitreTactic,
} from "Common/Types/SecurityEvent/MitreAttack";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getMitreAttackUrl } from "./MitreAttackLinks";

import React, { FunctionComponent, ReactElement } from "react";

export { getMitreAttackUrl };

export interface ComponentProps {
  tactics: Array<string>;
  techniques: Array<string>;
  emptyText?: string | undefined;
}

const Chip: FunctionComponent<{ id: string; isTactic: boolean }> = (props: {
  id: string;
  isTactic: boolean;
}): ReactElement => {
  const url: string | null = getMitreAttackUrl(props.id);
  const label: string = describeMitreId(props.id);
  const className: string = props.isTactic
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-gray-200 bg-white text-gray-700";
  const goal: string | undefined = props.isTactic
    ? getMitreTactic(props.id)?.goal
    : undefined;

  if (!url) {
    return (
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${className}`}
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={goal || label}
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs hover:underline ${className}`}
    >
      {label}
    </a>
  );
};

/*
 * A case's or a detection's ATT&CK mapping: its tactics (the attacker's
 * goal, tinted) and then its techniques (how), each linked to its page on
 * attack.mitre.org.
 */
const MitreAttackChips: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.tactics.length === 0 && props.techniques.length === 0) {
    return (
      <span className="text-sm text-gray-400">
        {translator.translateText(props.emptyText || "Not mapped")}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {props.tactics.map((id: string): ReactElement => {
        return <Chip key={`tactic-${id}`} id={id} isTactic={true} />;
      })}
      {props.techniques.map((id: string): ReactElement => {
        return <Chip key={`technique-${id}`} id={id} isTactic={false} />;
      })}
    </div>
  );
};

export default MitreAttackChips;
