import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  ConnectorFieldChoice,
  ConnectorFieldChoicesReport,
  readConnectorFieldChoiceValues,
  writeConnectorFieldChoiceValues,
} from "Common/Types/SecurityEvent/Connectors/ConnectorFieldChoices";
import { ConnectorField } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * A CONNECTION SETTING PICKED FROM WHAT THE PRODUCT OFFERS: a Cloudflare
 * token's accounts, and the zones of the account picked. The connection form
 * draws one for each catalog field whose choices are the product's own
 * (ConnectorField.choicesFromProvider), after the credentials that read
 * them, and asks the API for the choices
 * (POST /security-event-connection/field-choices) with what the form holds:
 * the credentials typed, or a saved connection's id, so an edit reads with
 * the stored token without ever seeing it.
 *
 * The pickers of one form share one request per set of credentials, and ask
 * only once the credentials have stopped changing for a moment, so typing a
 * token sends nothing until it is pasted whole. Choosing an account never
 * asks again: the zones carry their account, and are narrowed to it here.
 */

export const SECURITY_EVENT_CONNECTION_FIELD_CHOICES_ROUTE: string =
  "/security-event-connection/field-choices";

// How long the credentials must stay as they are before the choices are read.
export const FIELD_CHOICES_SETTLE_IN_MS: number = 600;

export async function fetchConnectorFieldChoices(
  body: JSONObject,
): Promise<ConnectorFieldChoicesReport> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        SECURITY_EVENT_CONNECTION_FIELD_CHOICES_ROUTE,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const report: JSONObject = response.data;

  if (
    !report ||
    typeof report["choices"] !== "object" ||
    report["choices"] === null
  ) {
    // A key: the picker shows it in the reader's language.
    throw new Error(
      translationKey(
        "The server did not return the choices. Check the API logs and try again.",
      ),
    );
  }

  return report as unknown as ConnectorFieldChoicesReport;
}

/*
 * One request per set of credentials, shared by every picker that reads
 * it. A failed one is forgotten, so Try Again asks again.
 */
const choicesRequests: Map<
  string,
  Promise<ConnectorFieldChoicesReport>
> = new Map<string, Promise<ConnectorFieldChoicesReport>>();

export function readConnectorFieldChoices(
  key: string,
  body: JSONObject,
  fetcher: (
    body: JSONObject,
  ) => Promise<ConnectorFieldChoicesReport> = fetchConnectorFieldChoices,
): Promise<ConnectorFieldChoicesReport> {
  const known: Promise<ConnectorFieldChoicesReport> | undefined =
    choicesRequests.get(key);

  if (known) {
    return known;
  }

  const request: Promise<ConnectorFieldChoicesReport> = fetcher(body).catch(
    (error: unknown): never => {
      choicesRequests.delete(key);
      throw error;
    },
  );
  choicesRequests.set(key, request);

  return request;
}

// Test seam: every remembered request, forgotten.
export function forgetConnectorFieldChoices(): void {
  choicesRequests.clear();
}

/*
 * The choices a field offers: its own, narrowed to the parent's pick when it
 * has a parent and one is picked. A value stored but no longer offered (a
 * zone since deleted, or the choices not read yet) stays an option of its
 * own, named by its value, so a save never drops it unseen.
 */
export function connectorFieldOptions(data: {
  choices: Array<ConnectorFieldChoice>;
  parentValue?: string | undefined;
  storedValues: Array<string>;
}): Array<DropdownOption> {
  const offered: Array<ConnectorFieldChoice> = data.parentValue
    ? data.choices.filter((choice: ConnectorFieldChoice): boolean => {
        return !choice.parentValue || choice.parentValue === data.parentValue;
      })
    : data.choices;

  const options: Array<DropdownOption> = offered.map(
    (choice: ConnectorFieldChoice): DropdownOption => {
      return {
        value: choice.value,
        // A name in the product, and its plan: drawn as written.
        label: choice.label,
        isUserContent: true,
        ...(choice.description
          ? {
              description: choice.description,
              isDescriptionUserContent: true,
            }
          : {}),
      };
    },
  );

  for (const value of data.storedValues) {
    if (
      !options.some((option: DropdownOption): boolean => {
        return option.value === value;
      })
    ) {
      options.push({ value, label: value, isUserContent: true });
    }
  }

  return options;
}

export interface ConnectorFieldChoicesInputProps {
  field: ConnectorField;
  // The product's name, for the words around the picker.
  productTitle: string;
  // The values the picker stores, as the form holds them.
  value: string;
  // The parent field's pick, for a field whose choices belong to one.
  parentValue?: string | undefined;
  /*
   * The request body naming the credentials (securityEventConnectionTestBody
   * with credentialsOnly), or undefined while they are not all entered.
   */
  body: JSONObject | undefined;
  // A fingerprint of that body: the same credentials read once.
  requestKey: string;
  // Why the choices cannot be read yet, in the reader's words.
  waitingReason?: string | undefined;
  fieldProps: CustomElementProps;
  // Test seam: the request.
  fetcher?:
    | ((body: JSONObject) => Promise<ConnectorFieldChoicesReport>)
    | undefined;
}

type ChoicesState =
  | { status: "waiting" }
  | { status: "loading" }
  | { status: "ready"; choices: Array<ConnectorFieldChoice> }
  | { status: "failed"; message: string };

const ConnectorFieldChoicesInput: FunctionComponent<
  ConnectorFieldChoicesInputProps
> = (props: ConnectorFieldChoicesInputProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<ChoicesState>({ status: "waiting" });
  const [attempt, setAttempt] = useState<number>(0);
  const bodyRef: React.MutableRefObject<JSONObject | undefined> = useRef<
    JSONObject | undefined
  >(props.body);
  bodyRef.current = props.body;
  const isMultiple: boolean = Boolean(
    props.field.choicesFromProvider?.isMultiple,
  );
  const storedValues: Array<string> = readConnectorFieldChoiceValues(
    props.value,
  );

  useEffect(() => {
    if (!props.body) {
      setState({ status: "waiting" });
      return undefined;
    }

    let isCurrent: boolean = true;
    setState({ status: "loading" });

    // Asked once the credentials have stayed as they are for a moment.
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      readConnectorFieldChoices(
        props.requestKey,
        bodyRef.current || {},
        props.fetcher,
      )
        .then((report: ConnectorFieldChoicesReport): void => {
          if (isCurrent) {
            setState({
              status: "ready",
              choices: report.choices[props.field.key] || [],
            });
          }
        })
        .catch((error: unknown): void => {
          if (isCurrent) {
            setState({
              status: "failed",
              message: API.getFriendlyErrorMessage(error as Error),
            });
          }
        });
    }, FIELD_CHOICES_SETTLE_IN_MS);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [props.requestKey, Boolean(props.body), attempt]);

  const options: Array<DropdownOption> =
    state.status === "ready"
      ? connectorFieldOptions({
          choices: state.choices,
          parentValue: props.parentValue,
          storedValues,
        })
      : connectorFieldOptions({ choices: [], storedValues });

  /*
   * The obvious pick, made: a token that reads one account has nothing to
   * choose. And a pick the parent no longer has (zones of the account given
   * up) is let go, so a save never stores zones of another account.
   */
  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    const offered: Array<string> = connectorFieldOptions({
      choices: state.choices,
      parentValue: props.parentValue,
      storedValues: [],
    }).map((option: DropdownOption): string => {
      return String(option.value);
    });

    if (!isMultiple && storedValues.length === 0 && offered.length === 1) {
      props.fieldProps.onChange?.(offered[0]);
      return;
    }

    if (isMultiple && props.parentValue && storedValues.length > 0) {
      const kept: Array<string> = storedValues.filter(
        (value: string): boolean => {
          const choice: ConnectorFieldChoice | undefined = state.choices.find(
            (candidate: ConnectorFieldChoice): boolean => {
              return candidate.value === value;
            },
          );

          return (
            !choice ||
            !choice.parentValue ||
            choice.parentValue === props.parentValue
          );
        },
      );

      if (kept.length !== storedValues.length) {
        props.fieldProps.onChange?.(writeConnectorFieldChoiceValues(kept));
      }
    }
  }, [state.status, props.parentValue]);

  const selected: Array<DropdownOption> = options.filter(
    (option: DropdownOption): boolean => {
      return storedValues.includes(String(option.value));
    },
  );

  return (
    <div className="space-y-2">
      <Dropdown
        options={options}
        isMultiSelect={isMultiple}
        value={isMultiple ? selected : selected[0]}
        placeholder={props.fieldProps.placeholder}
        isPlaceholderTranslated={props.fieldProps.isPlaceholderTranslated}
        isClearable={isMultiple || !props.field.required}
        disabled={state.status === "waiting"}
        error={props.fieldProps.error}
        tabIndex={props.fieldProps.tabIndex}
        onBlur={props.fieldProps.onBlur}
        dataTestId={`connector-field-choices-${props.field.key}`}
        ariaLabel={props.field.title}
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
        ): void => {
          const values: Array<string> = Array.isArray(value)
            ? value.map((item: DropdownValue): string => {
                return String(item);
              })
            : value === null || value === undefined
              ? []
              : [String(value)];

          props.fieldProps.onChange?.(writeConnectorFieldChoiceValues(values));
        }}
      />
      {state.status === "waiting" && props.waitingReason ? (
        <p className="text-sm text-gray-500">{props.waitingReason}</p>
      ) : null}
      {state.status === "loading" ? (
        <p className="text-sm text-gray-500" role="status">
          {translator.translateTemplate("Reading what {{product}} offers…", {
            product: props.productTitle,
          })}
        </p>
      ) : null}
      {state.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-sm text-red-700">
            <ErrorInSentence message={state.message} showWhereToLook={true} />
          </p>
          <Button
            title="Try Again"
            buttonStyle={ButtonStyleType.LINK}
            onClick={() => {
              setAttempt(attempt + 1);
            }}
          />
        </div>
      ) : null}
    </div>
  );
};

/*
 * What the picker says while it cannot read yet: which credentials to enter,
 * named as the form names them.
 */
export function connectorFieldChoicesWaitingReason(
  missing: ConnectorField,
  translator: Translator,
): string {
  return translator.translateTemplate(
    "Enter the {{field}} above to see what it can read.",
    { field: translatableTerm(missing.title, { inSentence: true }) },
  );
}

export default ConnectorFieldChoicesInput;
