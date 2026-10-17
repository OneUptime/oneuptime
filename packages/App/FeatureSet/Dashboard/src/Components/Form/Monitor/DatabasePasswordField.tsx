import URL from "Common/Types/API/URL";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  initialValue: string | undefined;
  onChange: (value: string) => void;
}

/*
 * The database Password of the SQL Query and Database Health forms, with the
 * one thing worth saying about it: a monitor secret keeps it encrypted. It
 * was a paragraph ("Database password. We recommend referencing a monitor
 * secret with ... instead of typing the password here, so it stays encrypted
 * at rest.") written out twice.
 */
const DatabasePasswordField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div>
      <FieldLabelElement
        title="Password"
        description={
          <p>
            <TranslatedSentence
              template="Use a monitor secret, such as {{secret}}, to keep it encrypted."
              slots={{
                secret: (
                  <code className="bg-gray-100 px-1 rounded">
                    {"{{monitorSecrets.name}}"}
                  </code>
                ),
              }}
            />{" "}
            <Link
              className="underline"
              openInNewTab={true}
              to={URL.fromString(
                DOCS_URL.toString() + "/monitor/monitor-secrets",
              )}
            >
              {translator.translateText("Learn more about secrets.")}
            </Link>
          </p>
        }
        required={false}
      />
      <Input
        initialValue={props.initialValue}
        placeholder="{{monitorSecrets.dbPassword}}"
        onChange={props.onChange}
      />
    </div>
  );
};

export default DatabasePasswordField;
