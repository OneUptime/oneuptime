import Reseller from "Common/Models/DatabaseModels/Reseller";
import Project from "Common/Models/DatabaseModels/Project";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import {
  TranslatableTerm,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a product page shows when the project's plan was bought from a
 * reseller whose plan leaves out the products that read what your services
 * send (Reseller.enableTelemetryFeatures off): Logs, Traces, Metrics,
 * Exceptions, Profiles, AI / LLM, Security Events and Cloud Monitoring.
 *
 * It used to be a red error on each of those pages, the same sentence copied
 * into every one: "Looks like you have bought this plan from a reseller. It
 * did not include telemetry features in your plan. Telemetry features are
 * disabled for this project." Nothing had failed, "telemetry" is a word
 * nobody in the menu uses, and it named no way forward although the project
 * knows who sold it the plan (#9129). It now says what the plan leaves out,
 * as information, and who to ask: the reseller by name, with their contact
 * when they gave one, and their Change Plan page when they have one.
 */

export const NOT_INCLUDED_TITLE: string = translationKey(
  "Your plan does not include {{product}}",
);

export const CONTACT_RESELLER_AT: string = translationKey(
  "Contact {{reseller}} at {{contact}} to add {{product}} to your plan.",
);

export const CONTACT_RESELLER: string = translationKey(
  "Contact {{reseller}}, the company you bought your plan from, to add {{product}} to it.",
);

export const CONTACT_UNNAMED_RESELLER: string = translationKey(
  "Contact the company you bought your plan from to add {{product}} to it.",
);

export interface NextStepInput {
  translator: Translator;
  reseller: Reseller | null | undefined;
  // The product's name as the Products menu writes it: "Logs", "AI / LLM".
  product: string;
}

// The sentence that says who adds the product to the plan.
export const getResellerNextStep: (input: NextStepInput) => string = (
  input: NextStepInput,
): string => {
  const product: TranslatableTerm = translatableTerm(input.product, {
    inSentence: true,
  });
  const name: string = input.reseller?.name?.trim() || "";
  const contact: string = input.reseller?.description?.trim() || "";

  if (name && contact) {
    return input.translator.translateTemplate(CONTACT_RESELLER_AT, {
      reseller: name,
      contact: contact,
      product: product,
    });
  }

  if (name) {
    return input.translator.translateTemplate(CONTACT_RESELLER, {
      reseller: name,
      product: product,
    });
  }

  return input.translator.translateTemplate(CONTACT_UNNAMED_RESELLER, {
    product: product,
  });
};

export interface ComponentProps {
  project: Project | null | undefined;
  // The product's name as the Products menu writes it: "Logs", "AI / LLM".
  product: string;
}

const ResellerPlanNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const reseller: Reseller | undefined = props.project?.reseller;
  const changePlanLink: URL | undefined = reseller?.changePlanLink;

  return (
    <EmptyState
      id="reseller-plan-notice"
      icon={IconProp.Info}
      paddingClassName="py-16"
      showSolidBackground={true}
      title={
        <>
          {translator.translateTemplate(NOT_INCLUDED_TITLE, {
            product: translatableTerm(props.product, { inSentence: true }),
          })}
        </>
      }
      description={
        <>
          {getResellerNextStep({
            translator,
            reseller,
            product: props.product,
          })}
        </>
      }
      footer={
        changePlanLink ? (
          <Button
            title="Change Plan"
            icon={IconProp.ExternalLink}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId="reseller-plan-notice-change-plan"
            onClick={() => {
              Navigation.navigate(changePlanLink, { openInNewTab: true });
            }}
          />
        ) : undefined
      }
    />
  );
};

export default ResellerPlanNotice;
