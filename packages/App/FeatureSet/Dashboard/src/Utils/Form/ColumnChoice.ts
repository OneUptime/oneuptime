/*
 * ONE PLAIN CHOICE, WRITTEN INTO THE COLUMNS IT STANDS FOR.
 *
 * Several forms asked a question as switches whose help explained the
 * modes between them: "Do not send confirmation link" beside "Send
 * Subscription Email" on a status page subscriber, "Enable Custom Email
 * Footer Text" over the footer it turned on. Read together each is one
 * question with a few plain answers, so the form asks exactly that - a
 * choice, each answer with one line saying what it means - and writes the
 * answer into the same columns as before. The API, Terraform and every
 * stored record keep what they mean.
 *
 * A config names the answers, how the stored columns read as an answer
 * (readChoice) and what each answer writes (getColumns). The form keeps
 * the pick in a form-only value (key), so a pick stays picked while the
 * columns it wrote change under it; until something is picked, the form
 * shows the answer the stored columns make - on an Edit form, the record's
 * own.
 *
 * Kept free of React, so App/Tests can read it. The field that draws a
 * config is ColumnChoiceField.tsx.
 */

export interface ColumnChoiceOption<TChoice extends string> {
  value: TChoice;
  // The answer, in English: looked up in the reader's language where drawn.
  title: string;
  // One line on what picking it means, in English.
  description?: string | undefined;
}

export interface ColumnChoiceConfig<TChoice extends string> {
  // The form-only value the pick is kept in: never sent.
  key: string;
  // The question, in English.
  title: string;
  options: ReadonlyArray<ColumnChoiceOption<TChoice>>;
  // The answer the columns make, read from a form's values or a record.
  readChoice: (values: Record<string, unknown>) => TChoice;
  // The columns an answer writes, and what it writes into them.
  getColumns: (choice: TChoice) => Record<string, unknown>;
  dataTestId: string;
}

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

// Whether a value is one of a config's answers.
export const isColumnChoice: <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
  value: unknown,
) => value is TChoice = <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
  value: unknown,
): value is TChoice => {
  return config.options.some((option: ColumnChoiceOption<TChoice>): boolean => {
    return option.value === value;
  });
};

/*
 * The answer a form shows: the one picked in it, once one is, and
 * otherwise the one its columns make.
 */
export const getColumnChoiceInForm: <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
  values: unknown,
) => TChoice = <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
  values: unknown,
): TChoice => {
  const picked: unknown = asValues(values)[config.key];

  if (isColumnChoice(config, picked)) {
    return picked;
  }

  return config.readChoice(asValues(values));
};

// A form's values once an answer is picked: the pick and the columns it writes.
export const getValuesForColumnChoice: <TChoice extends string>(data: {
  config: ColumnChoiceConfig<TChoice>;
  values: unknown;
  choice: TChoice;
}) => Values = <TChoice extends string>(data: {
  config: ColumnChoiceConfig<TChoice>;
  values: unknown;
  choice: TChoice;
}): Values => {
  return {
    ...asValues(data.values),
    [data.config.key]: data.choice,
    ...data.config.getColumns(data.choice),
  };
};

// The answers' English titles, in order: what the form offers.
export const getColumnChoiceTitles: <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
) => Array<string> = <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
): Array<string> => {
  return config.options.map((option: ColumnChoiceOption<TChoice>): string => {
    return option.title;
  });
};

/*
 * The answers as a plain RadioButton field's options, for a form that is
 * not a model's (Add in Bulk): the field keeps the answer itself, and the
 * form's own submit writes the columns.
 */
export const getColumnChoiceRadioButtons: <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
) => Array<{ value: TChoice; title: string; description?: string }> = <
  TChoice extends string,
>(
  config: ColumnChoiceConfig<TChoice>,
): Array<{ value: TChoice; title: string; description?: string }> => {
  return config.options.map(
    (
      option: ColumnChoiceOption<TChoice>,
    ): { value: TChoice; title: string; description?: string } => {
      return {
        value: option.value,
        title: option.title,
        ...(option.description ? { description: option.description } : {}),
      };
    },
  );
};

// An answer's English title, for a card's row or a summary.
export const getColumnChoiceTitle: <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
  choice: TChoice,
) => string = <TChoice extends string>(
  config: ColumnChoiceConfig<TChoice>,
  choice: TChoice,
): string => {
  const option: ColumnChoiceOption<TChoice> | undefined = config.options.find(
    (candidate: ColumnChoiceOption<TChoice>): boolean => {
      return candidate.value === choice;
    },
  );

  return option ? option.title : String(choice);
};
