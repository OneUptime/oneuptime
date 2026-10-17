import {
  DATABASE_AUTHENTICATION_OPTIONS,
  DATABASE_AUTHENTICATION_TEST_ID,
  DATABASE_AUTHENTICATION_TITLE,
  DatabaseAuthentication,
  DatabaseAuthenticationOption,
  toDatabaseAuthentication,
} from "../../../Utils/Form/Monitor/DatabaseAuthenticationChoice";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Radio, { RadioValue } from "Common/UI/Components/Radio/Radio";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  value: DatabaseAuthentication;
  onChange: (value: DatabaseAuthentication) => void;
}

/*
 * "Authentication" on the SQL Query and Database Health forms, for SQL
 * Server: Username and password, or Windows Integrated Authentication, each
 * with one line saying what it means (DatabaseAuthenticationChoice).
 */
const DatabaseAuthenticationField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = useId();

  return (
    <div>
      <FieldLabelElement
        id={labelId}
        title={DATABASE_AUTHENTICATION_TITLE}
        required={true}
      />
      <Radio
        ariaLabelledby={labelId}
        dataTestId={DATABASE_AUTHENTICATION_TEST_ID}
        value={props.value}
        options={DATABASE_AUTHENTICATION_OPTIONS.map(
          (option: DatabaseAuthenticationOption) => {
            return {
              value: option.value,
              label: translator.translateText(option.title) || option.title,
              description:
                translator.translateText(option.description) ||
                option.description,
            };
          },
        )}
        onChange={(value: RadioValue | null) => {
          props.onChange(toDatabaseAuthentication(value));
        }}
      />
    </div>
  );
};

export default DatabaseAuthenticationField;
