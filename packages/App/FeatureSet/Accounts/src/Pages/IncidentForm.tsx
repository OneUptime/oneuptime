import {
  buildIncidentFormSubmissionRequest,
  formatIncidentFormRetryAfter,
  getIncidentFormFailure,
  getIncidentFormFailureMessage,
  INCIDENT_FORM_MULTI_LINE_CUSTOM_FIELD_TYPES,
  INCIDENT_FORM_TEXT_CUSTOM_FIELD_TYPES,
  IncidentFormFailure,
  IncidentFormFailureKind,
  IncidentFormStage,
  isBlankIncidentFormAnswer,
  isIncidentFormReporterEmail,
  loadPublicIncidentForm,
  normalizeIncidentFormShareKey,
  submitPublicIncidentForm,
  toCustomFieldFormDefinitions,
} from "../Utils/IncidentForm";
import { isKnownIncidentFormMessage } from "../Utils/IncidentFormMessage";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import {
  INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
  INCIDENT_FORM_DESCRIPTION_MAX_LENGTH,
  INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH,
  INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH,
  INCIDENT_FORM_TITLE_MAX_LENGTH,
  IncidentFormFieldSetting,
  PublicIncidentForm,
  PublicIncidentFormField,
  PublicIncidentFormSeverity,
  PublicIncidentFormSubmissionResult,
} from "Common/Types/Incident/IncidentFormPublic";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Captcha from "Common/UI/Components/Captcha/Captcha";
import { buildCustomFieldFormFields } from "Common/UI/Components/CustomFields/CustomFieldFormFields";
import { getCustomFieldFormKey } from "Common/UI/Components/CustomFields/CustomFieldModelFormFields";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Field, {
  CustomElementProps,
} from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { CAPTCHA_ENABLED, CAPTCHA_SITE_KEY } from "Common/UI/Config";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Params, useParams } from "react-router-dom";

/*
 * The page anybody with an incident form's link opens to report a problem,
 * with or without a OneUptime account: /accounts/incident-form/:shareKey.
 *
 * It reads the form's questions, asks them, and declares an incident from
 * the answers - all through IncidentFormAPI, the one client that never
 * refreshes, signs out or navigates on a refusal. Every failure is shown on
 * this page, next to the form, so a reporter never loses what they typed
 * and a visitor who is also signed in to OneUptime keeps their session.
 *
 * Nothing here needs, reads or changes a session, which is why it works the
 * same for somebody signed in to the dashboard on this host and for somebody
 * who has never heard of OneUptime.
 */

// The form keys of the built-in questions. Custom fields live elsewhere.
const TITLE_KEY: string = "title";
const DESCRIPTION_KEY: string = "description";
const SEVERITY_KEY: string = "incidentSeverityId";
const REPORTER_NAME_KEY: string = "reporterName";
const REPORTER_EMAIL_KEY: string = "reporterEmail";
const CAPTCHA_TOKEN_KEY: string = "captchaToken";

// A locale file's whole-sentence keys contain dots and colons of their own.
const FLAT_KEY_OPTIONS: { keySeparator: false; nsSeparator: false } = {
  keySeparator: false,
  nsSeparator: false,
};

/*
 * What an empty Markdown box says - the editor's own words, as a flat key.
 * Looked up here and handed to the Description and to every Markdown
 * question, so a reporter reading the page in their language does not find
 * the one English sentence inside the box.
 */
const MARKDOWN_PLACEHOLDER: string = "Type your content here...";

type RequireTextFunction = (
  fieldKey: string,
  label: string,
  isMultiLine: boolean,
) => (values: FormValues<JSONObject>) => string | null;

/*
 * The form's own required check passes an answer of nothing but spaces,
 * which the server then refuses: every text answer is cleaned and trimmed
 * there (isBlankIncidentFormAnswer). Asking again here keeps that refusal in
 * the browser, in the reporter's language - for every required text
 * question, the custom ones included.
 */
const requireText: RequireTextFunction = (
  fieldKey: string,
  label: string,
  isMultiLine: boolean,
): ((values: FormValues<JSONObject>) => string | null) => {
  return (values: FormValues<JSONObject>): string | null => {
    const value: unknown = (values as JSONObject)[fieldKey];

    if (
      typeof value === "string" &&
      isBlankIncidentFormAnswer(value, isMultiLine)
    ) {
      return translateValidationMessage("{{field}} is required.", {
        field: label,
      });
    }

    return null;
  };
};

interface PageShellProps {
  // The form's name. Left out on a screen that has no form to name.
  heading?: string | undefined;
  // For the page to move focus to the heading; see IncidentFormPage.
  headingRef?: React.RefObject<HTMLHeadingElement> | undefined;
  // A card holding one short message rather than a form.
  isNarrow?: boolean | undefined;
  children: ReactNode;
}

// The layout every Accounts page shares: the logo, a heading, one card.
const PageShell: FunctionComponent<PageShellProps> = (
  props: PageShellProps,
): ReactElement => {
  const widthClassName: string = props.isNarrow ? "max-w-md" : "max-w-2xl";

  return (
    <div className="flex min-h-full flex-col justify-center px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className={`mx-auto w-full ${widthClassName}`}>
        <img
          className="mx-auto h-10 w-auto sm:h-12"
          src={OneUptimeLogo}
          alt="OneUptime"
        />
        {props.heading ? (
          <h1
            ref={props.headingRef}
            tabIndex={props.headingRef ? -1 : undefined}
            className="mt-5 text-center text-2xl font-semibold tracking-tight text-gray-900 [overflow-wrap:anywhere] focus:outline-none sm:mt-6 sm:text-3xl"
          >
            {props.heading}
          </h1>
        ) : (
          <></>
        )}
      </div>

      <div className={`mx-auto mt-6 w-full sm:mt-8 ${widthClassName}`}>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 shadow-sm sm:px-8 sm:py-8">
          {props.children}
        </div>
      </div>
    </div>
  );
};

const IncidentFormPage: () => JSX.Element = () => {
  const { t, i18n } = useTranslation();
  const params: Readonly<Params<string>> = useParams();

  const shareKey: string | null = normalizeIncidentFormShareKey(
    params["shareKey"],
  );

  const [form, setForm] = useState<PublicIncidentForm | null>(null);
  const [loadFailure, setLoadFailure] = useState<IncidentFormFailure | null>(
    null,
  );

  // Bumped by "Try again" on a form that could not be loaded.
  const [loadAttempt, setLoadAttempt] = useState<number>(0);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const [submitFailure, setSubmitFailure] =
    useState<IncidentFormFailure | null>(null);

  const [result, setResult] =
    useState<PublicIncidentFormSubmissionResult | null>(null);

  // Bumped by "Submit another report": a new key is a fresh, empty form.
  const [formInstance, setFormInstance] = useState<number>(0);

  const [captchaResetSignal, setCaptchaResetSignal] = useState<number>(0);

  /*
   * Where focus goes when the page swaps one view for another. The button
   * that had it - Submit, "Submit another report", "Try again" - leaves with
   * the view it was in, and focus would fall to <body>: a screen reader user
   * would hear nothing of what replaced it - not even that the report went
   * through, or its incident number.
   */
  const successHeadingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);
  const pageHeadingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);
  // Set by "Try again": the view that loads next takes focus on its heading.
  const focusHeadingOnLoadRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const incidentNumberId: string = useId();

  useEffect(() => {
    if (result) {
      successHeadingRef.current?.focus();
    }
  }, [result]);

  useEffect(() => {
    if (!focusHeadingOnLoadRef.current || (!form && !loadFailure)) {
      return;
    }

    focusHeadingOnLoadRef.current = false;
    pageHeadingRef.current?.focus();
  }, [form, loadFailure]);

  /*
   * hCaptcha only where the server asks for it AND this install has a site
   * key to draw it with. A server that wants a captcha the page cannot show
   * refuses the report with its own message, which is shown as it is.
   */
  const isCaptchaShown: boolean = Boolean(
    form && form.isCaptchaRequired && CAPTCHA_ENABLED && CAPTCHA_SITE_KEY,
  );

  useEffect(() => {
    /*
     * Not a key at all: say what the server would say about it, without
     * asking - see normalizeIncidentFormShareKey for why it must not be.
     */
    if (!shareKey) {
      setForm(null);
      setLoadFailure({
        kind: IncidentFormFailureKind.NotAvailable,
        retryAfterSeconds: 0,
      });
      return;
    }

    // A slow answer for a link the visitor already left must not land.
    let isCurrent: boolean = true;

    setForm(null);
    setLoadFailure(null);

    loadPublicIncidentForm(shareKey)
      .then((loadedForm: PublicIncidentForm) => {
        if (isCurrent) {
          setForm(loadedForm);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadFailure(getIncidentFormFailure(error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [shareKey, loadAttempt]);

  /*
   * The tab is named after the form while it is open - its name and nothing
   * else, since the name is already on the page. Put back on the way out.
   */
  const formName: string = form ? form.name : "";

  useEffect(() => {
    if (!formName) {
      return;
    }

    const previousTitle: string = document.title;
    document.title = formName;

    return () => {
      document.title = previousTitle;
    };
  }, [formName]);

  type TranslateMessageFunction = (message: string) => string;

  // Only the sentences a locale file has are looked up; see IncidentFormMessage.
  const translateMessage: TranslateMessageFunction = (
    message: string,
  ): string => {
    if (!isKnownIncidentFormMessage(message)) {
      return message;
    }

    return t(message, { ...FLAT_KEY_OPTIONS, defaultValue: message });
  };

  type DescribeFailureFunction = (data: {
    failure: IncidentFormFailure;
    stage: IncidentFormStage;
  }) => { message: string; retryAfter: string | null };

  // What to tell the reporter, in their language, and when to come back.
  const describeFailure: DescribeFailureFunction = (data: {
    failure: IncidentFormFailure;
    stage: IncidentFormStage;
  }): { message: string; retryAfter: string | null } => {
    const when: string | null =
      data.failure.kind === IncidentFormFailureKind.RateLimited
        ? formatIncidentFormRetryAfter(
            data.failure.retryAfterSeconds,
            i18n.resolvedLanguage || i18n.language,
          )
        : null;

    return {
      message: translateMessage(getIncidentFormFailureMessage(data)),
      retryAfter: when ? t("incidentForm.retryAfter", { when: when }) : null,
    };
  };

  const fields: Fields<JSONObject> = useMemo((): Fields<JSONObject> => {
    if (!form) {
      return [];
    }

    const titleLabel: string = t("incidentForm.title");
    const descriptionLabel: string = t("incidentForm.description");
    const reporterNameLabel: string = t("incidentForm.reporterName");
    const markdownPlaceholder: string = t(
      MARKDOWN_PLACEHOLDER,
      FLAT_KEY_OPTIONS,
    );

    const formFields: Fields<JSONObject> = [
      {
        field: { [TITLE_KEY]: true },
        title: titleLabel,
        description: t("incidentForm.titleDescription"),
        fieldType: FormFieldSchemaType.Text,
        required: true,
        validation: { maxLength: INCIDENT_FORM_TITLE_MAX_LENGTH },
        customValidation: requireText(TITLE_KEY, titleLabel, false),
        dataTestId: "incident-form-title",
        spanFullRow: true,
      },
    ];

    if (form.descriptionSetting !== IncidentFormFieldSetting.Hidden) {
      const isRequired: boolean =
        form.descriptionSetting === IncidentFormFieldSetting.Required;

      const descriptionField: Field<JSONObject> = {
        field: { [DESCRIPTION_KEY]: true },
        title: descriptionLabel,
        fieldType: FormFieldSchemaType.Markdown,
        required: isRequired,
        validation: { maxLength: INCIDENT_FORM_DESCRIPTION_MAX_LENGTH },
        // Uploading an image needs a signed-in user; a reporter may be none.
        allowImageUpload: false,
        placeholder: markdownPlaceholder,
        dataTestId: "incident-form-description",
        spanFullRow: true,
      };

      if (isRequired) {
        descriptionField.customValidation = requireText(
          DESCRIPTION_KEY,
          descriptionLabel,
          true,
        );
      }

      formFields.push(descriptionField);
    }

    // Only when the form lets the reporter choose; the server says so by listing them.
    if (form.severities && form.severities.length > 0) {
      formFields.push({
        field: { [SEVERITY_KEY]: true },
        title: t("incidentForm.severity"),
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: form.severities.map(
          (severity: PublicIncidentFormSeverity): DropdownOption => {
            const option: DropdownOption = {
              label: severity.name,
              value: severity._id,
            };

            if (severity.color) {
              option.color = new Color(severity.color);
            }

            return option;
          },
        ),
        // Left empty, the form's own severity applies.
        required: false,
        dataTestId: "incident-form-severity",
        spanFullRow: true,
      });
    }

    /*
     * The custom fields the form asks, built exactly as the dashboard builds
     * them - required where the FORM requires them. Each is held under its
     * own form key (getCustomFieldFormKey), never under its bare name: a
     * field called "title" must not become the title's answer.
     */
    const customFields: Fields<JSONObject> = buildCustomFieldFormFields({
      definitions: toCustomFieldFormDefinitions(form.customFields),
      enforceRequiredOnCreate: true,
      getFormKey: getCustomFieldFormKey,
    }).map(
      (builtField: Field<JSONObject>, index: number): Field<JSONObject> => {
        const definition: PublicIncidentFormField | undefined =
          form.customFields[index];

        const customField: Field<JSONObject> = {
          ...builtField,
          spanFullRow: true,
        };

        if (customField.fieldType === FormFieldSchemaType.Markdown) {
          customField.allowImageUpload = false;
          customField.placeholder = markdownPlaceholder;
        }

        if (
          definition &&
          INCIDENT_FORM_TEXT_CUSTOM_FIELD_TYPES.includes(
            definition.customFieldType,
          )
        ) {
          customField.validation = {
            maxLength: INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
          };

          // As for the title: spaces alone are no answer to a required field.
          if (definition.isRequired) {
            customField.customValidation = requireText(
              getCustomFieldFormKey(definition.name),
              definition.name,
              INCIDENT_FORM_MULTI_LINE_CUSTOM_FIELD_TYPES.includes(
                definition.customFieldType,
              ),
            );
          }
        }

        return customField;
      },
    );

    formFields.push(...customFields);

    // Side by side on a wide screen: the two halves of "who is reporting".
    const reporterNameField: Field<JSONObject> = {
      field: { [REPORTER_NAME_KEY]: true },
      title: reporterNameLabel,
      fieldType: FormFieldSchemaType.Name,
      required: form.isReporterDetailsRequired,
      validation: { maxLength: INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH },
      dataTestId: "incident-form-reporter-name",
    };

    if (form.isReporterDetailsRequired) {
      reporterNameField.customValidation = requireText(
        REPORTER_NAME_KEY,
        reporterNameLabel,
        false,
      );
    }

    formFields.push(reporterNameField, {
      field: { [REPORTER_EMAIL_KEY]: true },
      title: t("incidentForm.reporterEmail"),
      fieldType: FormFieldSchemaType.Email,
      required: form.isReporterDetailsRequired,
      validation: { maxLength: INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH },
      /*
       * The form's own email check finds an address anywhere in the text;
       * the server wants the whole answer to be one. Asked here as the
       * server asks it, so "Ada <ada@example.com>" is refused in the browser.
       */
      customValidation: (values: FormValues<JSONObject>): string | null => {
        const value: unknown = (values as JSONObject)[REPORTER_EMAIL_KEY];

        // No answer at all is the required check's to judge.
        if (
          typeof value !== "string" ||
          value.trim().length === 0 ||
          isIncidentFormReporterEmail(value)
        ) {
          return null;
        }

        return translateValidationMessage("Email is not valid.");
      },
      dataTestId: "incident-form-reporter-email",
      disableSpellCheck: true,
    });

    if (isCaptchaShown) {
      formFields.push({
        field: { [CAPTCHA_TOKEN_KEY]: true },
        fieldType: FormFieldSchemaType.CustomComponent,
        title: t("captcha.title"),
        description: t("captcha.description"),
        required: true,
        spanFullRow: true,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <Captcha
              siteKey={CAPTCHA_SITE_KEY}
              resetSignal={captchaResetSignal}
              error={customProps.error}
              onTokenChange={(token: string) => {
                customProps.onChange?.(token);
              }}
              onBlur={customProps.onBlur}
            />
          );
        },
      });
    }

    return formFields;
  }, [form, t, isCaptchaShown, captchaResetSignal]);

  // The form's own severity, preselected when it is one of those offered.
  const initialValues: JSONObject = useMemo((): JSONObject => {
    if (form && form.defaultIncidentSeverityId) {
      return { [SEVERITY_KEY]: form.defaultIncidentSeverityId };
    }

    return {};
  }, [form]);

  type SubmitFunction = (values: JSONObject) => Promise<void>;

  const submit: SubmitFunction = async (values: JSONObject): Promise<void> => {
    if (!form || !shareKey || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitFailure(null);

    try {
      const submitted: PublicIncidentFormSubmissionResult =
        await submitPublicIncidentForm(
          shareKey,
          buildIncidentFormSubmissionRequest({
            form: form,
            values: values,
            captchaToken:
              isCaptchaShown && typeof values[CAPTCHA_TOKEN_KEY] === "string"
                ? (values[CAPTCHA_TOKEN_KEY] as string)
                : undefined,
          }),
        );

      setResult(submitted);

      // The thank-you card is far shorter than the form it replaces.
      window.scrollTo(0, 0);
    } catch (error: unknown) {
      setSubmitFailure(getIncidentFormFailure(error));

      /*
       * A captcha answer is good for one request, and the server checks it
       * before it reads the answers - so even a report refused for its
       * answers has spent it. A fresh challenge, every time.
       */
      if (isCaptchaShown) {
        setCaptchaResetSignal((signal: number): number => {
          return signal + 1;
        });
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const startAnotherReport: () => void = (): void => {
    setResult(null);
    setSubmitFailure(null);
    setFormInstance((instance: number): number => {
      return instance + 1;
    });
  };

  if (loadFailure) {
    const failure: { message: string; retryAfter: string | null } =
      describeFailure({
        failure: loadFailure,
        stage: IncidentFormStage.Load,
      });

    // Worth another go: a limit that lapses, a server that comes back.
    const canTryAgain: boolean =
      loadFailure.kind === IncidentFormFailureKind.RateLimited ||
      loadFailure.kind === IncidentFormFailureKind.Unavailable;

    let icon: IconProp = IconProp.Alert;

    if (loadFailure.kind === IncidentFormFailureKind.NotAvailable) {
      icon = IconProp.ClipboardDocumentList;
    } else if (loadFailure.kind === IncidentFormFailureKind.NetworkNotAllowed) {
      icon = IconProp.Lock;
    } else if (loadFailure.kind === IncidentFormFailureKind.RateLimited) {
      icon = IconProp.Clock;
    }

    return (
      <PageShell isNarrow={true}>
        <div className="text-center" data-testid="incident-form-load-failure">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={icon} className="h-6 w-6 text-gray-500" />
          </div>
          <h1
            ref={pageHeadingRef}
            tabIndex={-1}
            className="mt-4 text-base font-medium leading-7 text-gray-900 focus:outline-none"
          >
            {failure.message}
          </h1>
          {failure.retryAfter ? (
            <p className="mt-2 text-sm text-gray-600">{failure.retryAfter}</p>
          ) : (
            <></>
          )}
          {canTryAgain ? (
            <div className="mt-6 flex justify-center">
              <Button
                title={t("incidentForm.tryAgain")}
                buttonStyle={ButtonStyleType.NORMAL}
                icon={IconProp.Refresh}
                className="md:!ml-0"
                dataTestId="incident-form-try-again"
                onClick={() => {
                  focusHeadingOnLoadRef.current = true;
                  setLoadAttempt((attempt: number): number => {
                    return attempt + 1;
                  });
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </PageShell>
    );
  }

  if (!form) {
    return <PageLoader isVisible={true} />;
  }

  if (result) {
    return (
      <PageShell heading={form.name}>
        <div className="text-center" data-testid="incident-form-success">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <Icon
              icon={IconProp.CheckCircle}
              className="h-7 w-7 text-emerald-600"
            />
          </div>
          {/* Read out with the incident number, when there is one. */}
          <h2
            ref={successHeadingRef}
            tabIndex={-1}
            aria-describedby={
              result.incidentNumber ? incidentNumberId : undefined
            }
            className="mt-4 text-lg font-semibold text-gray-900 focus:outline-none"
          >
            {t("incidentForm.successTitle")}
          </h2>
          {result.incidentNumber ? (
            <p
              id={incidentNumberId}
              className="mt-2 text-sm text-gray-600"
              data-testid="incident-form-incident-number"
            >
              {t("incidentForm.incidentNumber", {
                incidentNumber: result.incidentNumber,
              })}
            </p>
          ) : (
            <></>
          )}
        </div>
        {result.successMessage ? (
          <div
            className="mt-6 border-t border-gray-100 pt-6 text-sm text-gray-700"
            data-testid="incident-form-success-message"
          >
            <MarkdownViewer text={result.successMessage} />
          </div>
        ) : (
          <></>
        )}
        <div className="mt-8 flex justify-center">
          <Button
            title={t("incidentForm.submitAnother")}
            buttonStyle={ButtonStyleType.NORMAL}
            className="md:!ml-0"
            dataTestId="incident-form-submit-another"
            onClick={startAnotherReport}
          />
        </div>
      </PageShell>
    );
  }

  const submitError: { message: string; retryAfter: string | null } | null =
    submitFailure
      ? describeFailure({
          failure: submitFailure,
          stage: IncidentFormStage.Submit,
        })
      : null;

  return (
    <PageShell heading={form.name} headingRef={pageHeadingRef}>
      {form.description ? (
        <div
          className="mb-6 border-b border-gray-100 pb-6 text-sm text-gray-700"
          data-testid="incident-form-about"
        >
          <MarkdownViewer text={form.description} />
        </div>
      ) : (
        <></>
      )}
      <BasicForm
        key={formInstance}
        id="incident-form"
        fields={fields}
        initialValues={initialValues}
        showAsColumns={2}
        maxPrimaryButtonWidth={true}
        /*
         * Not on arrival - the reporter reads what the form is for first -
         * but the fresh form "Submit another report" opens starts at its
         * first question.
         */
        disableAutofocus={formInstance === 0}
        isLoading={isSubmitting}
        submitButtonText={t("common.submit")}
        onSubmit={(values: FormValues<JSONObject>) => {
          void submit(values as JSONObject);
        }}
        footer={
          submitError ? (
            <div className="mt-4">
              <Alert
                type={AlertType.DANGER}
                dataTestId="incident-form-submit-error"
                title={
                  /*
                   * An element, not a string: Alert would look a string up in
                   * the locale files, and the server's words can quote a
                   * field's name. translateMessage already did the looking up.
                   */
                  <span>
                    {submitError.message}
                    {submitError.retryAfter ? (
                      <span className="mt-1 block">
                        {submitError.retryAfter}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                }
              />
            </div>
          ) : (
            <></>
          )
        }
      />
    </PageShell>
  );
};

export default IncidentFormPage;
