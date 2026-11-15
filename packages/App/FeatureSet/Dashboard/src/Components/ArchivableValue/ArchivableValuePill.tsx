import Color from "Common/Types/Color";
import ArchivedTag from "Common/UI/Components/ArchivedTag/ArchivedTag";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A value a setting names - a template's severity, its initial state -
 * drawn as its coloured pill, with the Archived tag beside it once it has
 * been archived (Common/Utils/ArchivableValues): the template keeps it, but
 * an incident declared from the template does not take it, so whoever reads
 * the template sees why.
 */

export const ARCHIVABLE_VALUE_PILL_TAG_TEST_ID: string =
  "archivable-value-pill-archived";

export interface ComponentProps {
  name: string;
  /*
   * How the name reads (Pill.isUserContent): a state's or a severity's by
   * the one rule for them, isRecordNameAsWritten - OneUptime's default
   * names looked up, the project's own as written.
   */
  isUserContent: boolean;
  color: Color;
  isArchived?: boolean | undefined;
}

const ArchivableValuePill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.isArchived) {
    return (
      <Pill
        color={props.color}
        text={props.name}
        isUserContent={props.isUserContent}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill
        color={props.color}
        text={props.name}
        isUserContent={props.isUserContent}
      />
      <ArchivedTag dataTestId={ARCHIVABLE_VALUE_PILL_TAG_TEST_ID} />
    </div>
  );
};

export default ArchivableValuePill;
