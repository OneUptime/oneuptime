import { getNewWatchlistSource } from "./WatchlistFormFields";
import {
  WatchlistSourceChoice,
  getWatchlistSourceChoicesFor,
} from "./WatchlistsModel";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Radio, {
  RadioOption,
  RadioValue,
} from "Common/UI/Components/Radio/Radio";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // What the list holds, as the form has it: which sources it can have.
  entityType: unknown;
  value: string | undefined;
  onChange: (value: string) => void;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * VALUES COME FROM, in Create Watchlist: the team's own values, a file at
 * an address, or - for a kind a feed carries - a threat intel feed. The
 * choices follow what the list holds as it is picked, so a list of users is
 * never offered a feed that carries none. Each choice says what it is, in
 * the reader's language.
 */
const WatchlistSourceRadio: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const options: Array<RadioOption> = getWatchlistSourceChoicesFor(
    props.entityType,
  ).map((choice: WatchlistSourceChoice): RadioOption => {
    return {
      value: choice.value,
      label: translator.translateText(choice.title) || choice.title,
      description:
        translator.translateText(choice.description) || choice.description,
    };
  });

  return (
    <Radio
      options={options}
      value={props.value}
      onChange={(value: RadioValue | null) => {
        props.onChange(value ? String(value) : "");
      }}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      error={props.error}
      dataTestId={props.dataTestId}
    />
  );
};

/*
 * Create Watchlist's "Values come from", drawn as this radio: the choices
 * of what the list holds so far, with the source the list would be saved
 * with chosen (getNewWatchlistSource). The page hands it to the form's
 * fields (getWatchlistCreateFields), which stay free of React.
 */
export function renderWatchlistSourceChoice(
  values: FormValues<SecurityWatchlist>,
  customElementProps: CustomElementProps,
): ReactElement {
  return (
    <WatchlistSourceRadio
      entityType={(values as Record<string, unknown>)["entityType"]}
      value={getNewWatchlistSource(values)}
      onChange={(value: string) => {
        customElementProps.onChange?.(value);
      }}
      ariaLabelledby={customElementProps.ariaLabelledby}
      ariaDescribedby={customElementProps.ariaDescribedby}
      error={customElementProps.error}
      dataTestId="watchlist-source"
    />
  );
}

export default WatchlistSourceRadio;
