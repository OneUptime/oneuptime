import {
  EXTERNAL_MCP_SERVER_AUTH_OPTIONS,
  EXTERNAL_MCP_SERVER_FIELD_COPY,
} from "./ExternalMcpServerCopy";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpServerAuthType from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import {
  getExternalMcpServerHeadersProblem,
  getExternalMcpServerUrlProblem,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerSettingsCheck";
import Dictionary from "Common/Types/Dictionary";
import DictionaryForm, {
  ValueType,
} from "Common/UI/Components/Dictionary/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import Field, {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import React, { ReactElement } from "react";

/*
 * THE EXTERNAL MCP SERVER FORM: WHERE IT IS, THEN HOW TO SIGN IN.
 *
 * One form for adding a server (Settings → AI → External MCP Servers) and
 * editing it (the server's page), so both ask the same thing in the same
 * words:
 *
 *   - Server: its name and its MCP address; what it is for (which OneUptime
 *     AI reads to pick a server) under More fields. Whether it speaks
 *     Streamable HTTP or the older SSE is never asked: OneUptime finds out
 *     when it connects.
 *   - Authentication: one card per way of signing in - none, a bearer token,
 *     custom headers of the server's own, or OAuth client credentials - then
 *     only what that one needs.
 *   - OAuth: for OAuth client credentials only, the token URL, client ID and
 *     secret, with the scope and audience under More fields.
 *
 * Every secret is written, never read back. An edit starts each one empty,
 * and one left empty keeps what is stored (ModelForm's write-only fields;
 * the service does the same for any client).
 *
 * The form checks the address and the headers with the server's own
 * sentences (ExternalMcpServerSettingsCheck) before it sends anything.
 *
 * Every step id is written out as a string literal on each field, so the
 * form step guards (Common/Tests/Helpers/FormStepsScan.ts) can place them.
 */

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

// The Authentication a form holds now: None until one is picked.
export function getFormAuthType(values: unknown): ExternalMcpServerAuthType {
  const authType: unknown = asValues(values)["authType"];

  return typeof authType === "string" &&
    Object.values(ExternalMcpServerAuthType).includes(
      authType as ExternalMcpServerAuthType,
    )
    ? (authType as ExternalMcpServerAuthType)
    : ExternalMcpServerAuthType.None;
}

const isAuthType: (
  values: unknown,
  authType: ExternalMcpServerAuthType,
) => boolean = (
  values: unknown,
  authType: ExternalMcpServerAuthType,
): boolean => {
  return getFormAuthType(values) === authType;
};

/*
 * The headers the form holds, or undefined while none are entered: an
 * empty list is "nothing entered", so a new server is asked for one
 * (required) and an edit keeps the stored ones.
 */
export function readFormHeaders(
  value: unknown,
): Dictionary<string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries: Array<[string, unknown]> = Object.entries(
    value as Record<string, unknown>,
  );

  if (entries.length === 0) {
    return undefined;
  }

  const headers: Dictionary<string> = {};

  for (const [name, headerValue] of entries) {
    headers[name] =
      headerValue === undefined || headerValue === null
        ? ""
        : String(headerValue);
  }

  return headers;
}

// Why the headers the form holds cannot be saved, or null.
export function getFormHeadersProblem(values: unknown): string | null {
  if (!isAuthType(values, ExternalMcpServerAuthType.Headers)) {
    return null;
  }

  const headers: Dictionary<string> | undefined = readFormHeaders(
    asValues(values)["headers"],
  );

  // Nothing entered: required on a new server, kept on an edit.
  if (!headers) {
    return null;
  }

  return getExternalMcpServerHeadersProblem(headers);
}

// Why the address the form holds cannot be an MCP server's, or null.
export function getFormUrlProblem(values: unknown): string | null {
  const url: unknown = asValues(values)["url"];

  // Empty is the required check's to say.
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }

  return getExternalMcpServerUrlProblem(url, "The URL");
}

/*
 * The headers, one row each: a name and its value, both text. The shared
 * key/value editor, with text values only - a header has no number or
 * yes/no. A value is typed masked, as the Token and the Client Secret are:
 * it is an API key more often than not, and it is never shown again.
 *
 * It opens on one empty row, ready to type into, rather than on a lone Add
 * Header button: picking Custom headers says a header is coming. An empty
 * row is nothing entered (the editor reports only what is typed), so a new
 * server still asks for one and an edit keeps the stored ones.
 */
function renderHeadersInput(props: CustomElementProps): ReactElement {
  const initialValue: Dictionary<DictionaryEntryValue> = readFormHeaders(
    props.initialValue,
  ) || { "": "" };

  return (
    <div data-testid="external-mcp-server-headers">
      <DictionaryForm
        initialValue={initialValue}
        keyPlaceholder="X-API-Key"
        valuePlaceholder="Value"
        addButtonSuffix="Header"
        valueTypes={[ValueType.Text]}
        renderTextValueInput={(args: {
          value: string;
          onChange: (value: string) => void;
          placeholder?: string | undefined;
          rowIndex: number;
        }): ReactElement => {
          return (
            <Input
              type={InputType.PASSWORD}
              value={args.value}
              placeholder={args.placeholder}
              onChange={args.onChange}
              disableSpellCheck={true}
              dataTestId={`external-mcp-server-header-value-${args.rowIndex}`}
            />
          );
        }}
        onChange={(value: Dictionary<DictionaryEntryValue>) => {
          props.onChange?.(readFormHeaders(value));
        }}
      />
    </div>
  );
}

export const getExternalMcpServerFormSteps: () => Array<
  FormStep<ExternalMcpServer>
> = (): Array<FormStep<ExternalMcpServer>> => {
  return [
    { title: "Server", id: "server" },
    { title: "Authentication", id: "authentication" },
    {
      title: "OAuth",
      id: "oauth",
      showIf: (values: FormValues<ExternalMcpServer>): boolean => {
        return isAuthType(
          values,
          ExternalMcpServerAuthType.OAuthClientCredentials,
        );
      },
    },
  ];
};

export const getExternalMcpServerFormFields: () => Array<
  Field<ExternalMcpServer>
> = (): Array<Field<ExternalMcpServer>> => {
  const serverMore: FormFieldCollapsibleSection<ExternalMcpServer> =
    getAdvancedFormSection<ExternalMcpServer>();

  const oauthMore: FormFieldCollapsibleSection<ExternalMcpServer> =
    getAdvancedFormSection<ExternalMcpServer>({ id: "oauth-advanced" });

  const isOAuth: (values: FormValues<ExternalMcpServer>) => boolean = (
    values: FormValues<ExternalMcpServer>,
  ): boolean => {
    return isAuthType(values, ExternalMcpServerAuthType.OAuthClientCredentials);
  };

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "server",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      hideColumnDescription: true,
      placeholder: EXTERNAL_MCP_SERVER_FIELD_COPY.namePlaceholder,
      validation: {
        minLength: 2,
      },
      dataTestId: "external-mcp-server-name",
    },
    {
      field: {
        url: true,
      },
      title: "URL",
      description: EXTERNAL_MCP_SERVER_FIELD_COPY.urlHint,
      stepId: "server",
      fieldType: FormFieldSchemaType.URL,
      required: true,
      hideColumnDescription: true,
      placeholder: EXTERNAL_MCP_SERVER_FIELD_COPY.urlPlaceholder,
      disableSpellCheck: true,
      customValidation: (
        values: FormValues<ExternalMcpServer>,
      ): string | null => {
        return getFormUrlProblem(values);
      },
      dataTestId: "external-mcp-server-url",
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      description: EXTERNAL_MCP_SERVER_FIELD_COPY.descriptionHint,
      stepId: "server",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      hideColumnDescription: true,
      placeholder: EXTERNAL_MCP_SERVER_FIELD_COPY.descriptionPlaceholder,
      collapsibleSection: serverMore,
    },
    {
      field: {
        authType: true,
      },
      title: "Authentication",
      stepId: "authentication",
      fieldType: FormFieldSchemaType.CardSelect,
      required: true,
      // Each card says what it is: the column's sentence would not.
      hideColumnDescription: true,
      cardSelectOptions: EXTERNAL_MCP_SERVER_AUTH_OPTIONS,
      /*
       * One card a row: four read top to bottom, each on one line, and a
       * long German title never squeezes a two-column card.
       */
      cardSelectSingleColumn: true,
      dataTestId: "external-mcp-server-auth-type",
    },
    {
      field: {
        bearerToken: true,
      },
      title: "Token",
      description: EXTERNAL_MCP_SERVER_FIELD_COPY.tokenHint,
      stepId: "authentication",
      fieldType: FormFieldSchemaType.Password,
      showIf: (values: FormValues<ExternalMcpServer>): boolean => {
        return isAuthType(values, ExternalMcpServerAuthType.BearerToken);
      },
      required: (values: FormValues<ExternalMcpServer>): boolean => {
        return isAuthType(values, ExternalMcpServerAuthType.BearerToken);
      },
      // A blank token on an edit keeps the stored one.
      doNotRequireWhenEditing: true,
      hideColumnDescription: true,
      disableSpellCheck: true,
      dataTestId: "external-mcp-server-token",
    },
    {
      field: {
        headers: true,
      },
      title: "Request Headers",
      description: EXTERNAL_MCP_SERVER_FIELD_COPY.headersHint,
      stepId: "authentication",
      fieldType: FormFieldSchemaType.CustomComponent,
      showIf: (values: FormValues<ExternalMcpServer>): boolean => {
        return isAuthType(values, ExternalMcpServerAuthType.Headers);
      },
      required: (values: FormValues<ExternalMcpServer>): boolean => {
        return isAuthType(values, ExternalMcpServerAuthType.Headers);
      },
      // No headers entered on an edit keeps the stored ones.
      doNotRequireWhenEditing: true,
      hideColumnDescription: true,
      customValidation: (
        values: FormValues<ExternalMcpServer>,
      ): string | null => {
        return getFormHeadersProblem(values);
      },
      getCustomElement: (
        _values: FormValues<ExternalMcpServer>,
        props: CustomElementProps,
      ): ReactElement => {
        return renderHeadersInput(props);
      },
    },
    {
      field: {
        oauthTokenUrl: true,
      },
      title: "Token URL",
      description: EXTERNAL_MCP_SERVER_FIELD_COPY.tokenUrlHint,
      stepId: "oauth",
      fieldType: FormFieldSchemaType.URL,
      showIf: isOAuth,
      required: isOAuth,
      hideColumnDescription: true,
      placeholder: EXTERNAL_MCP_SERVER_FIELD_COPY.tokenUrlPlaceholder,
      disableSpellCheck: true,
      dataTestId: "external-mcp-server-token-url",
    },
    {
      field: {
        oauthClientId: true,
      },
      title: "Client ID",
      stepId: "oauth",
      fieldType: FormFieldSchemaType.Text,
      showIf: isOAuth,
      required: isOAuth,
      hideColumnDescription: true,
      disableSpellCheck: true,
      dataTestId: "external-mcp-server-client-id",
    },
    {
      field: {
        oauthClientSecret: true,
      },
      title: "Client Secret",
      stepId: "oauth",
      fieldType: FormFieldSchemaType.Password,
      showIf: isOAuth,
      required: isOAuth,
      // A blank secret on an edit keeps the stored one.
      doNotRequireWhenEditing: true,
      hideColumnDescription: true,
      disableSpellCheck: true,
      dataTestId: "external-mcp-server-client-secret",
    },
    {
      field: {
        oauthScope: true,
      },
      title: "Scope",
      description: EXTERNAL_MCP_SERVER_FIELD_COPY.scopeHint,
      stepId: "oauth",
      fieldType: FormFieldSchemaType.Text,
      showIf: isOAuth,
      required: false,
      hideColumnDescription: true,
      placeholder: EXTERNAL_MCP_SERVER_FIELD_COPY.scopePlaceholder,
      disableSpellCheck: true,
      collapsibleSection: oauthMore,
    },
    {
      field: {
        oauthAudience: true,
      },
      title: "Audience",
      description: EXTERNAL_MCP_SERVER_FIELD_COPY.audienceHint,
      stepId: "oauth",
      fieldType: FormFieldSchemaType.Text,
      showIf: isOAuth,
      required: false,
      hideColumnDescription: true,
      disableSpellCheck: true,
      collapsibleSection: oauthMore,
    },
  ];
};
