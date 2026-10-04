import {
  buildFormSubmissionRequest,
  formatFormRetryAfter,
  FormFailure,
  FormFailureKind,
  FormStage,
  getFormFailure,
  getFormFailureMessage,
  loadPublicForm,
  normalizeFormShareKey,
  submitPublicForm,
} from "../Utils/Form";
import { isKnownFormMessage } from "../Utils/FormMessage";
import IconProp from "Common/Types/Icon/IconProp";
import { PublicFormImage } from "Common/Types/Form/FormBranding";
import {
  PublicForm,
  PublicFormSubmissionResult,
} from "Common/Types/Form/FormPublic";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Captcha from "Common/UI/Components/Captcha/Captcha";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { showPublicFormFavicon } from "Common/UI/Components/PublicForm/PublicFormFavicon";
import {
  buildPublicFormFields,
  getPublicFormInitialValues,
} from "Common/UI/Components/PublicForm/PublicFormFields";
import PublicFormLogo from "Common/UI/Components/PublicForm/PublicFormLogo";
import { CAPTCHA_ENABLED, CAPTCHA_SITE_KEY } from "Common/UI/Config";
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
 * The page anybody with a form's link opens to fill it in, with or without a
 * OneUptime account: /accounts/form/:shareKey (and the incident form links
 * shared before Forms replaced them, /accounts/incident-form/:shareKey,
 * which App sends here).
 *
 * It reads the form's questions, asks them, and sends the answers - all
 * through FormAPI, the one client that never refreshes, signs out or
 * navigates on a refusal. Every failure is shown on this page, next to the
 * form, so a submitter never loses what they typed and a visitor who is also
 * signed in to OneUptime keeps their session.
 *
 * The questions are drawn by buildPublicFormFields, the builder the
 * dashboard's form preview draws them with, so what an admin previews is
 * what a submitter sees.
 *
 * The form's branding comes with its questions: its logo replaces the
 * OneUptime logo at the top of every screen that has the form (the form
 * and the thank-you screen), and its favicon is the tab's icon while the
 * form is open. A link that leads to no form shows OneUptime's.
 */

const CAPTCHA_TOKEN_KEY: string = "captchaToken";

// A locale file's whole-sentence keys contain dots and colons of their own.
const FLAT_KEY_OPTIONS: { keySeparator: false; nsSeparator: false } = {
  keySeparator: false,
  nsSeparator: false,
};

interface PageShellProps {
  // The form's name. Left out on a screen that has no form to name.
  heading?: string | undefined;
  // For the page to move focus to the heading; see FormPage.
  headingRef?: React.RefObject<HTMLHeadingElement> | undefined;
  // A card holding one short message rather than a form.
  isNarrow?: boolean | undefined;
  // The form's own logo and what it says. Without one, the OneUptime logo.
  logo?: PublicFormImage | undefined;
  logoAltText?: string | undefined;
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
        <PublicFormLogo logo={props.logo} altText={props.logoAltText} />
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

const FormPage: () => JSX.Element = () => {
  const { t, i18n } = useTranslation();
  const params: Readonly<Params<string>> = useParams();

  const shareKey: string | null = normalizeFormShareKey(params["shareKey"]);

  const [form, setForm] = useState<PublicForm | null>(null);
  const [loadFailure, setLoadFailure] = useState<FormFailure | null>(null);

  // Bumped by "Try again" on a form that could not be loaded.
  const [loadAttempt, setLoadAttempt] = useState<number>(0);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const [submitFailure, setSubmitFailure] = useState<FormFailure | null>(null);

  const [result, setResult] = useState<PublicFormSubmissionResult | null>(null);

  // Bumped by "Submit another response": a new key is a fresh, empty form.
  const [formInstance, setFormInstance] = useState<number>(0);

  const [captchaResetSignal, setCaptchaResetSignal] = useState<number>(0);

  /*
   * Where focus goes when the page swaps one view for another. The button
   * that had it - Submit, "Submit another response", "Try again" - leaves
   * with the view it was in, and focus would fall to <body>: a screen reader
   * user would hear nothing of what replaced it - not even that the
   * submission went through, or its reference number.
   */
  const successHeadingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);
  const pageHeadingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);
  // Set by "Try again": the view that loads next takes focus on its heading.
  const focusHeadingOnLoadRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const referenceId: string = useId();

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
   * refuses the submission with its own message, which is shown as it is.
   */
  const isCaptchaShown: boolean = Boolean(
    form && form.isCaptchaRequired && CAPTCHA_ENABLED && CAPTCHA_SITE_KEY,
  );

  useEffect(() => {
    /*
     * Not a key at all: say what the server would say about it, without
     * asking - see normalizeFormShareKey for why it must not be.
     */
    if (!shareKey) {
      setForm(null);
      setLoadFailure({
        kind: FormFailureKind.NotAvailable,
        retryAfterSeconds: 0,
      });
      return;
    }

    // A slow answer for a link the visitor already left must not land.
    let isCurrent: boolean = true;

    setForm(null);
    setLoadFailure(null);

    loadPublicForm(shareKey)
      .then((loadedForm: PublicForm) => {
        if (isCurrent) {
          setForm(loadedForm);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadFailure(getFormFailure(error));
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

  /*
   * The form's favicon is the tab's icon while it is open, and the page's
   * own comes back on the way out.
   */
  const favicon: PublicFormImage | undefined = form?.favicon;

  useEffect(() => {
    if (!favicon) {
      return;
    }

    return showPublicFormFavicon({ document: document, favicon: favicon });
  }, [favicon]);

  type TranslateMessageFunction = (message: string) => string;

  // Only the sentences a locale file has are looked up; see FormMessage.
  const translateMessage: TranslateMessageFunction = (
    message: string,
  ): string => {
    if (!isKnownFormMessage(message)) {
      return message;
    }

    return t(message, { ...FLAT_KEY_OPTIONS, defaultValue: message });
  };

  type DescribeFailureFunction = (data: {
    failure: FormFailure;
    stage: FormStage;
  }) => { message: string; retryAfter: string | null };

  // What to tell the submitter, in their language, and when to come back.
  const describeFailure: DescribeFailureFunction = (data: {
    failure: FormFailure;
    stage: FormStage;
  }): { message: string; retryAfter: string | null } => {
    const when: string | null =
      data.failure.kind === FormFailureKind.RateLimited
        ? formatFormRetryAfter(
            data.failure.retryAfterSeconds,
            i18n.resolvedLanguage || i18n.language,
          )
        : null;

    return {
      message: translateMessage(getFormFailureMessage(data)),
      retryAfter: when ? t("form.retryAfter", { when: when }) : null,
    };
  };

  const fields: Fields<JSONObject> = useMemo((): Fields<JSONObject> => {
    if (!form) {
      return [];
    }

    const formFields: Fields<JSONObject> = buildPublicFormFields(form);

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

  // The option a question chooses to begin with (the form's own severity).
  const initialValues: JSONObject = useMemo((): JSONObject => {
    return form ? getPublicFormInitialValues(form) : {};
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
      const submitted: PublicFormSubmissionResult = await submitPublicForm(
        shareKey,
        buildFormSubmissionRequest({
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
      setSubmitFailure(getFormFailure(error));

      /*
       * A captcha answer is good for one request, and the server checks it
       * before it reads the answers - so even a submission refused for its
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

  const startAnotherResponse: () => void = (): void => {
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
        stage: FormStage.Load,
      });

    // Worth another go: a limit that lapses, a server that comes back.
    const canTryAgain: boolean =
      loadFailure.kind === FormFailureKind.RateLimited ||
      loadFailure.kind === FormFailureKind.Unavailable;

    let icon: IconProp = IconProp.Alert;

    if (loadFailure.kind === FormFailureKind.NotAvailable) {
      icon = IconProp.ClipboardDocumentList;
    } else if (loadFailure.kind === FormFailureKind.NetworkNotAllowed) {
      icon = IconProp.Lock;
    } else if (loadFailure.kind === FormFailureKind.RateLimited) {
      icon = IconProp.Clock;
    }

    return (
      <PageShell isNarrow={true}>
        <div className="text-center" data-testid="form-load-failure">
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
                title={t("form.tryAgain")}
                buttonStyle={ButtonStyleType.NORMAL}
                icon={IconProp.Refresh}
                className="md:!ml-0"
                dataTestId="form-try-again"
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
      <PageShell
        heading={form.name}
        logo={form.logo}
        logoAltText={form.logoAltText}
      >
        <div className="text-center" data-testid="form-success">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <Icon
              icon={IconProp.CheckCircle}
              className="h-7 w-7 text-emerald-600"
            />
          </div>
          {/* Read out with the reference number, when there is one. */}
          <h2
            ref={successHeadingRef}
            tabIndex={-1}
            aria-describedby={result.reference ? referenceId : undefined}
            className="mt-4 text-lg font-semibold text-gray-900 focus:outline-none"
          >
            {t("form.successTitle")}
          </h2>
          {result.reference ? (
            <p
              id={referenceId}
              className="mt-2 text-sm text-gray-600"
              data-testid="form-reference"
            >
              {t("form.reference", {
                reference: result.reference,
              })}
            </p>
          ) : (
            <></>
          )}
        </div>
        {result.successMessage ? (
          <div
            className="mt-6 border-t border-gray-100 pt-6 text-sm text-gray-700"
            data-testid="form-success-message"
          >
            <MarkdownViewer text={result.successMessage} />
          </div>
        ) : (
          <></>
        )}
        <div className="mt-8 flex justify-center">
          <Button
            title={t("form.submitAnother")}
            buttonStyle={ButtonStyleType.NORMAL}
            className="md:!ml-0"
            dataTestId="form-submit-another"
            onClick={startAnotherResponse}
          />
        </div>
      </PageShell>
    );
  }

  const submitError: { message: string; retryAfter: string | null } | null =
    submitFailure
      ? describeFailure({
          failure: submitFailure,
          stage: FormStage.Submit,
        })
      : null;

  return (
    <PageShell
      heading={form.name}
      headingRef={pageHeadingRef}
      logo={form.logo}
      logoAltText={form.logoAltText}
    >
      {form.description ? (
        <div
          className="mb-6 border-b border-gray-100 pb-6 text-sm text-gray-700"
          data-testid="form-about"
        >
          <MarkdownViewer text={form.description} />
        </div>
      ) : (
        <></>
      )}
      <BasicForm
        key={formInstance}
        id="public-form"
        fields={fields}
        initialValues={initialValues}
        showAsColumns={1}
        maxPrimaryButtonWidth={true}
        /*
         * Not on arrival - the submitter reads what the form is for first -
         * but the fresh form "Submit another response" opens starts at its
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
                dataTestId="form-submit-error"
                title={
                  /*
                   * An element, not a string: Alert would look a string up in
                   * the locale files, and the server's words can quote a
                   * question's label. translateMessage already did the
                   * looking up.
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

export default FormPage;
