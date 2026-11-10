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
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProductAnalyticsEventsSwitchCopy, {
  PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN,
  PRODUCT_ANALYTICS_EVENTS_SWITCH_TEST_ID,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsSwitchCopy";

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
  /* Route is ":id/product-analytics-settings": the id is one segment before the end. */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
    </Fragment>
  );
};

export default RumApplicationProductAnalyticsSettings;
