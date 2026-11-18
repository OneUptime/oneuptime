import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { normalizeProductAnalyticsUserPropertyKeys } from "Common/Types/Rum/ProductAnalyticsEvents";
import {
  DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  getProductAnalyticsRetentionMonths,
} from "Common/Types/Rum/ProductAnalytics";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { foldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import {
  PRODUCT_ANALYTICS_MORE_SETTINGS_TEST_ID,
  PRODUCT_ANALYTICS_RETENTION_DESCRIPTION,
  PRODUCT_ANALYTICS_RETENTION_FIELD_DESCRIPTION,
  PRODUCT_ANALYTICS_RETENTION_LINE_TEST_ID,
  PRODUCT_ANALYTICS_RETENTION_TITLE,
  formatProductAnalyticsRetention,
  getProductAnalyticsRetentionOptions,
} from "../../../Components/ProductAnalytics/ProductAnalyticsRetention";
import ProductAnalyticsEventsSwitchCopy, {
  PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN,
  PRODUCT_ANALYTICS_EVENTS_SWITCH_TEST_ID,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsSwitchCopy";
import { ProductAnalyticsReplayOffNote } from "../../../Components/ProductAnalytics/ProductAnalyticsEventsGate";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * Product Analytics > Analytics Settings (issue #6444, part two): whether
 * the recorders send the application's events - its sessions' starts, its
 * page views, its track() and metric() calls - and which identify() traits
 * the events keep for breakdowns and segments.
 */

export function ProductAnalyticsUserPropertyChips(props: {
  keys: Array<string> | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const keys: Array<string> = normalizeProductAnalyticsUserPropertyKeys(
    props.keys,
  );

  if (keys.length === 0) {
    return (
      <span className="text-sm text-gray-500">
        {translator.translateText(
          ProductAnalyticsEventsSwitchCopy.noProperties,
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key: string): ReactElement => {
        return (
          <code
            key={key}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-800"
            dir="auto"
          >
            {key}
          </code>
        );
      })}
    </div>
  );
}

const RumApplicationProductAnalyticsSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /* Route is ":id/product-analytics-settings": the id is one segment before the end. */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * How long the application keeps its numbers (issue #6626), once the card
   * has read it: the folded header names it while it is not the default.
   */
  const [retentionMonths, setRetentionMonths] = useState<number>(
    DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  );

  return (
    <Fragment>
      <ModelSwitchCard<RumApplication>
        modelType={RumApplication}
        modelId={modelId}
        column={PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN}
        cardTitle={ProductAnalyticsEventsSwitchCopy.cardTitle}
        cardDescription={ProductAnalyticsEventsSwitchCopy.cardDescription}
        title={ProductAnalyticsEventsSwitchCopy.switchTitle}
        getDescription={(): string => {
          return ProductAnalyticsEventsSwitchCopy.switchDescription;
        }}
        select={{ isSessionReplayEnabled: true }}
        /*
         * Session Replay off: its recorder, which sends the events, never
         * loads - said under the switch, with the way to turn it on.
         */
        getDetails={(item: RumApplication): ReactElement | null => {
          if (item.isSessionReplayEnabled !== false) {
            return null;
          }

          return (
            <div className="flex items-start gap-1.5 text-sm text-amber-800">
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-none text-amber-600"
              />
              <ProductAnalyticsReplayOffNote rumApplicationId={modelId} />
            </div>
          );
        }}
        dataTestId={PRODUCT_ANALYTICS_EVENTS_SWITCH_TEST_ID}
      />
      <CardModelDetail<RumApplication>
        name={ProductAnalyticsEventsSwitchCopy.propertiesCardTitle}
        cardProps={{
          title: ProductAnalyticsEventsSwitchCopy.propertiesCardTitle,
          description:
            ProductAnalyticsEventsSwitchCopy.propertiesCardDescription,
        }}
        isEditable={true}
        editButtonText="Edit User Properties"
        editModalTitle="Edit User Properties"
        formFields={[
          {
            field: { productAnalyticsUserPropertyKeys: true },
            title: ProductAnalyticsEventsSwitchCopy.propertiesFieldTitle,
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            placeholder: '["plan", "role"]',
            description:
              ProductAnalyticsEventsSwitchCopy.propertiesFieldDescription,
          },
        ]}
        modelDetailProps={{
          modelType: RumApplication,
          id: "model-detail-rum-application-product-analytics-properties",
          fields: [
            {
              field: { productAnalyticsUserPropertyKeys: true },
              title: ProductAnalyticsEventsSwitchCopy.propertiesFieldTitle,
              fieldType: FieldType.Element,
              getElement: (item: RumApplication): ReactElement => {
                return (
                  <ProductAnalyticsUserPropertyChips
                    keys={item.productAnalyticsUserPropertyKeys}
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
      {/*
       * How long product analytics keeps the application's numbers: 13
       * months unless someone chose otherwise, which few need - so it waits
       * folded, named in the header with its value while it is not the
       * default.
       */}
      <AdvancedPageSection
        items={[
          foldedSectionItem(PRODUCT_ANALYTICS_RETENTION_TITLE, {
            isSet:
              retentionMonths !== DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS,
            value: formatProductAnalyticsRetention(retentionMonths, translator),
          }),
        ]}
        dataTestId={PRODUCT_ANALYTICS_MORE_SETTINGS_TEST_ID}
      >
        <CardModelDetail<RumApplication>
          name={PRODUCT_ANALYTICS_RETENTION_TITLE}
          cardProps={{
            title: PRODUCT_ANALYTICS_RETENTION_TITLE,
            description: PRODUCT_ANALYTICS_RETENTION_DESCRIPTION,
          }}
          isEditable={true}
          editButtonText="Edit Retention"
          editModalTitle="Edit Retention"
          formFields={[
            {
              field: { productAnalyticsRetentionInMonths: true },
              title: "Retention",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: getProductAnalyticsRetentionOptions(translator),
              required: true,
              description: PRODUCT_ANALYTICS_RETENTION_FIELD_DESCRIPTION,
            },
          ]}
          modelDetailProps={{
            modelType: RumApplication,
            id: "model-detail-rum-application-product-analytics-retention",
            onItemLoaded: (item: RumApplication): void => {
              setRetentionMonths(
                getProductAnalyticsRetentionMonths(
                  item.productAnalyticsRetentionInMonths,
                ),
              );
            },
            fields: [
              {
                field: { productAnalyticsRetentionInMonths: true },
                title: "Retention",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span
                      className="text-sm text-gray-900"
                      data-testid={PRODUCT_ANALYTICS_RETENTION_LINE_TEST_ID}
                    >
                      {formatProductAnalyticsRetention(
                        item.productAnalyticsRetentionInMonths,
                        translator,
                      )}
                    </span>
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default RumApplicationProductAnalyticsSettings;
