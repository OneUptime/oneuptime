import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

const ENTERPRISE_OVERVIEW_URL: string =
  "https://oneuptime.com/enterprise/overview";
const ENTERPRISE_DOCS_URL: string =
  "https://oneuptime.com/docs/self-hosted/enterprise";

export interface Benefit {
  icon: IconProp;
  title: string;
  subtitle: string;
}

export interface ComponentProps {
  title: string;
  description: string;
  featureName: string;
  featureDescription?: string | undefined;
  benefits: Array<Benefit>;
}

/*
 * Admin-dashboard variant of the enterprise upsell card. The admin dashboard is
 * an instance-level (self-hosted) surface with no project/plan context, so this
 * gates purely on the Enterprise Edition build rather than a billing plan.
 */
const EnterpriseFeatureUpgrade: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Each benefit's words in the reader's language: drawn in a tile of the
   * card's own, not a shared component that looks them up (#8227).
   */
  const translator: Translator = useTranslator();
  const featureName: string =
    translator.translateText(props.featureName) || props.featureName;

  return (
    <Card
      title={props.title}
      description={props.description}
      /*
       * The same call to action as the one under the pitch below, so it is
       * drawn plain: one card, one primary button.
       */
      rightElement={
        <Button
          title="Learn about Enterprise Edition"
          buttonStyle={ButtonStyleType.NORMAL}
          icon={IconProp.Info}
          onClick={() => {
            window.open(ENTERPRISE_OVERVIEW_URL, "_blank");
          }}
        />
      }
    >
      <div className="flex flex-col items-start gap-4 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <Icon
              icon={IconProp.ShieldCheck}
              size={SizeProp.Large}
              thick={ThickProp.Thick}
              className="h-6 w-6"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">
                {featureName}
              </h3>
              <Pill
                text="Enterprise"
                tone={PillTone.Warning}
                icon={IconProp.Star}
              />
            </div>
            {props.featureDescription ? (
              <p className="text-xs text-gray-500 mt-0.5">
                {translator.translateText(props.featureDescription)}
              </p>
            ) : null}
          </div>
        </div>

        <p className="text-sm text-gray-700">
          {translator.translateTemplate(
            "{{feature}} is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable it.",
            { feature: featureName },
            { setsValuesApart: true },
          )}
        </p>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {props.benefits.map((benefit: Benefit): ReactElement => {
            return (
              <div
                key={benefit.title}
                className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm"
              >
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                  <Icon
                    icon={benefit.icon}
                    size={SizeProp.Small}
                    thick={ThickProp.Thick}
                    className="h-4 w-4"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-900">
                    {translator.translateText(benefit.title) || benefit.title}
                  </div>
                  <div className="text-xs leading-snug text-gray-500 mt-0.5">
                    {translator.translateText(benefit.subtitle) ||
                      benefit.subtitle}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/*
         * The first button starts under the pitch, and the row's gap
         * alone spaces the two.
         */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            title="Learn about Enterprise Edition"
            buttonStyle={ButtonStyleType.PRIMARY}
            icon={IconProp.Info}
            onClick={() => {
              window.open(ENTERPRISE_OVERVIEW_URL, "_blank");
            }}
          />
          <Button
            title="Read docs"
            buttonStyle={ButtonStyleType.OUTLINE}
            icon={IconProp.Book}
            onClick={() => {
              window.open(ENTERPRISE_DOCS_URL, "_blank");
            }}
          />
        </div>
      </div>
    </Card>
  );
};

export default EnterpriseFeatureUpgrade;
