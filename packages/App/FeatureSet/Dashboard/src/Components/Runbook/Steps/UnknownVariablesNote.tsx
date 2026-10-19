import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Under a field that names variables: the ones that are not the project's
 * (a typo, or a variable deleted since), so the author sees before the run
 * what the step would fail with. Nothing when every one is there.
 */

export interface ComponentProps {
  // As written: {{global.variables.NAME}}.
  references: Array<string>;
  dataTestId: string;
}

const UnknownVariablesNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.references.length === 0) {
    return <></>;
  }

  return (
    <p
      className="text-xs text-amber-700 mt-1.5 break-words"
      data-testid={props.dataTestId}
    >
      <TranslatedSentence
        template="No variable is named {{references}}, so the step will fail when it runs."
        slots={{
          references: (
            <>
              {props.references.map((reference: string, index: number) => {
                return (
                  <Fragment key={reference}>
                    {index > 0 ? ", " : ""}
                    <code>{reference}</code>
                  </Fragment>
                );
              })}
            </>
          ),
        }}
      />
    </p>
  );
};

export default UnknownVariablesNote;
