import Input from "Common/UI/Components/Input/Input";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  SSH_TARGET_NEEDS_USER,
  SSH_TARGET_PLACEHOLDER,
  SSH_TARGET_TITLE,
  SshTarget,
  formatSshTarget,
  parseSshTarget,
} from "./RunbookStepEditorModel";

/*
 * The machine an SSH step signs in to, written the way it is after `ssh`:
 * deploy@10.0.4.21. One field rather than a host and a user apart, because
 * that is how everybody already writes it; the step keeps the two apart
 * (SSHStepConfig.host and .username), and a variable may stand for either
 * ({{global.variables.DB_HOST}}).
 *
 * What is typed is kept as typed while the field is edited - so "deploy@"
 * does not lose its "@" before the host is there - and read into the user
 * and the host on every change.
 */

export interface ComponentProps {
  host: string;
  username: string;
  onChange: (target: SshTarget) => void;
  helperText: string;
  dataTestId: string;
}

const SshTargetInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [text, setText] = useState<string>(
    formatSshTarget({ username: props.username, host: props.host }),
  );

  const target: SshTarget = parseSshTarget(text);
  const needsUser: boolean = Boolean(target.host) && !target.username;
  const inputId: string = `${props.dataTestId}-input`;

  return (
    <div data-testid={props.dataTestId}>
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-gray-700 mb-1.5"
      >
        {translator.translateText(SSH_TARGET_TITLE)}
      </label>
      <Input
        id={inputId}
        value={text}
        placeholder={SSH_TARGET_PLACEHOLDER}
        disableSpellCheck={true}
        dataTestId={inputId}
        onChange={(value: string) => {
          setText(value);
          props.onChange(parseSshTarget(value));
        }}
      />
      <p
        className={`text-xs mt-1.5 ${needsUser ? "text-amber-700" : "text-gray-500"}`}
        data-testid={`${props.dataTestId}-help`}
      >
        {needsUser
          ? translator.translateText(SSH_TARGET_NEEDS_USER)
          : translator.translateText(props.helperText)}
      </p>
    </div>
  );
};

export default SshTargetInput;
