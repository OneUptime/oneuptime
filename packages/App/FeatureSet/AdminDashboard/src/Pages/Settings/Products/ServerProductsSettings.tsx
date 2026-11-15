import {
  PRESET_DESCRIPTIONS,
  SERVER_PRODUCTS_INGESTION_STOPPED_TEST_ID,
  SERVER_PRODUCTS_ONE_BY_ONE_TOGGLE_TEST_ID,
  SERVER_PRODUCTS_OWN_CHOICE_TEST_ID,
  SERVER_PRODUCTS_PAGE_TEST_ID,
  SERVER_PRODUCTS_STARTING_VALUE_TEST_ID,
  SERVER_PRODUCTS_SUGGEST_STOPPING_TEST_ID,
  ServerProductsCopy,
  getPresetTestId,
  getServerProductSwitchTestId,
} from "./ServerProductsCopy";
import {
  fetchServerProducts,
  postServerProductSwitched,
  postServerProductsPreset,
} from "./ServerProductsApi";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PRODUCT_CATEGORIES,
  ProductCategory,
  getProductTitle,
} from "Common/Types/Product/ProductCatalog";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  PRESET_TITLES,
  PRODUCTS_OF_PRESET,
  SERVER_PRODUCTS_PRESETS,
  SWITCHABLE_PRODUCTS,
  ServerProductOffReason,
  ServerProductsPreset,
  isSwitchableProduct,
} from "Common/Types/Product/ServerProducts";
import {
  ServerProductsAnswer,
  ServerProductsSource,
} from "Common/Types/Product/ServerProductsAnswer";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ADMIN DASHBOARD > SETTINGS > PRODUCTS (issue #6815, #2471): the products
 * every project on this server offers.
 *
 * What most admins need comes first: three presets, each one click -
 * Monitoring and status pages, Incident response, Everything - with the
 * current one marked. What switching off does is said right under them:
 * nothing is deleted, what runs keeps running, the API refuses changes.
 * The switch per product is folded away below ("Choose products one by
 * one"), for the admin who wants a choice of their own; each saves the
 * moment it is flipped.
 *
 * Where it ties to what the server runs, it says so: while telemetry
 * ingestion is stopped the telemetry products are off, with the setting
 * that starts it; when every telemetry product is switched off while
 * ingestion still runs, it suggests stopping ingestion to save memory.
 * Until an admin saves this page, SERVER_PRODUCTS gives the starting value,
 * and the page says that too.
 */

const ServerProductsSettings: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] = useState<ServerProductsAnswer | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [savingPreset, setSavingPreset] = useState<ServerProductsPreset | null>(
    null,
  );
  const [savingProduct, setSavingProduct] = useState<ProductKey | null>(null);
  const [error, setError] = useState<string>("");
  const [isOneByOneOpen, setIsOneByOneOpen] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchServerProducts()
      .then((loaded: ServerProductsAnswer) => {
        if (isCurrent) {
          setAnswer(loaded);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (!answer) {
    return (
      <div data-testid={SERVER_PRODUCTS_PAGE_TEST_ID}>
        {loadError ? (
          <Card title={ServerProductsCopy.cardTitle}>
            <ErrorMessage
              message={
                loadError ||
                translator.translateText(ServerProductsCopy.loadError) ||
                ServerProductsCopy.loadError
              }
            />
          </Card>
        ) : (
          <PageLoader isVisible={true} />
        )}
      </div>
    );
  }

  const isSwitchedOn: (product: ProductKey) => boolean = (
    product: ProductKey,
  ): boolean => {
    return !answer.switchedOff.includes(product);
  };

  const onCount: number = SWITCHABLE_PRODUCTS.filter(isSwitchedOn).length;
  const totalCount: number = SWITCHABLE_PRODUCTS.length;
  const isSaving: boolean = savingPreset !== null || savingProduct !== null;

  const applyPreset: (preset: ServerProductsPreset) => Promise<void> = async (
    preset: ServerProductsPreset,
  ): Promise<void> => {
    setSavingPreset(preset);
    setError("");

    try {
      setAnswer(await postServerProductsPreset(preset));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setSavingPreset(null);
  };

  const switchProduct: (
    product: ProductKey,
    isOn: boolean,
  ) => Promise<void> = async (
    product: ProductKey,
    isOn: boolean,
  ): Promise<void> => {
    setSavingProduct(product);
    setError("");

    try {
      setAnswer(await postServerProductSwitched({ product, isOn }));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setSavingProduct(null);
  };

  const renderPreset: (preset: ServerProductsPreset) => ReactElement = (
    preset: ServerProductsPreset,
  ): ReactElement => {
    const isCurrent: boolean = answer.preset === preset;
    const productCount: number = PRODUCTS_OF_PRESET[preset].length;

    return (
      <div
        key={preset}
        data-testid={getPresetTestId(preset)}
        data-current={isCurrent ? "true" : "false"}
        className={`flex flex-col justify-between gap-3 rounded-lg border p-4 ${
          isCurrent
            ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
            : "border-gray-200 bg-white"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText(PRESET_TITLES[preset])}
            </h3>
            <span className="flex-none text-xs text-gray-500">
              {translator.translatePlural(
                ServerProductsCopy.presetProductCount,
                productCount,
              )}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {translator.translateText(PRESET_DESCRIPTIONS[preset])}
          </p>
        </div>
        <div>
          {isCurrent ? (
            <span
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700"
              data-testid={`${getPresetTestId(preset)}-current`}
            >
              <Icon icon={IconProp.Check} className="h-4 w-4" />
              {translator.translateText(ServerProductsCopy.current)}
            </span>
          ) : (
            <Button
              title={translator.translateText(ServerProductsCopy.apply)}
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={savingPreset === preset}
              disabled={isSaving}
              dataTestId={`${getPresetTestId(preset)}-apply`}
              onClick={() => {
                applyPreset(preset).catch(() => {
                  // Said under the presets.
                });
              }}
            />
          )}
        </div>
      </div>
    );
  };

  const renderProduct: (product: ProductKey) => ReactElement = (
    product: ProductKey,
  ): ReactElement => {
    const offReason: ServerProductOffReason | undefined = answer.off[product];
    const isIngestionStopped: boolean =
      offReason === ServerProductOffReason.TelemetryIngestionStopped;

    return (
      <div key={product} className="py-3">
        <Toggle
          title={getProductTitle(product)}
          ariaLabel={getProductTitle(product)}
          value={isIngestionStopped ? false : isSwitchedOn(product)}
          disabled={isIngestionStopped || isSaving}
          description={
            isIngestionStopped
              ? translator.translateText(
                  ServerProductsCopy.offWhileIngestionStopped,
                )
              : undefined
          }
          dataTestId={getServerProductSwitchTestId(product)}
          onChange={(isOn: boolean) => {
            switchProduct(product, isOn).catch(() => {
              // Said under the presets.
            });
          }}
        />
      </div>
    );
  };

  return (
    <div data-testid={SERVER_PRODUCTS_PAGE_TEST_ID}>
      <Card
        title={ServerProductsCopy.cardTitle}
        description={ServerProductsCopy.cardDescription}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {SERVER_PRODUCTS_PRESETS.map(renderPreset)}
          </div>

          {answer.preset === null ? (
            <p
              className="text-sm text-gray-600"
              data-testid={SERVER_PRODUCTS_OWN_CHOICE_TEST_ID}
            >
              {translator.translatePlural(
                ServerProductsCopy.ownChoice,
                totalCount,
                { on: translator.formatNumber(onCount) },
              )}
            </p>
          ) : (
            <></>
          )}

          {answer.source === ServerProductsSource.StartingValue &&
          answer.startingValue ? (
            <p
              className="text-sm text-gray-600"
              data-testid={SERVER_PRODUCTS_STARTING_VALUE_TEST_ID}
            >
              {translator.translateTemplate(ServerProductsCopy.startingValue, {
                value: answer.startingValue,
              })}
              {answer.startingValueUnknownNames.length > 0 ? (
                <span className="mt-1 block">
                  {translator.translateTemplate(
                    ServerProductsCopy.startingValueUnknown,
                    { names: answer.startingValueUnknownNames.join(", ") },
                  )}
                </span>
              ) : (
                <></>
              )}
            </p>
          ) : (
            <></>
          )}

          {error ? <ErrorMessage message={error} /> : <></>}

          <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
            <p className="font-medium text-gray-900">
              {translator.translateText(ServerProductsCopy.whatOffMeansTitle)}
            </p>
            <ul className="mt-1 list-disc space-y-1 ps-5">
              <li>
                {translator.translateText(ServerProductsCopy.nothingDeleted)}
              </li>
              <li>
                {translator.translateText(ServerProductsCopy.keepsRunning)}
              </li>
              <li>{translator.translateText(ServerProductsCopy.apiRefuses)}</li>
            </ul>
          </div>
        </div>
      </Card>

      {answer.isTelemetryIngestionStopped ? (
        <Alert
          type={AlertType.INFO}
          dataTestId={SERVER_PRODUCTS_INGESTION_STOPPED_TEST_ID}
          title={
            translator.translateText(ServerProductsCopy.ingestionStopped) ||
            ServerProductsCopy.ingestionStopped
          }
        />
      ) : answer.shouldSuggestStoppingIngestion ? (
        <Alert
          type={AlertType.INFO}
          dataTestId={SERVER_PRODUCTS_SUGGEST_STOPPING_TEST_ID}
          title={
            translator.translateText(
              ServerProductsCopy.suggestStoppingIngestion,
            ) || ServerProductsCopy.suggestStoppingIngestion
          }
        />
      ) : (
        <></>
      )}

      <Card
        title={ServerProductsCopy.oneByOneTitle}
        description={translator.translatePlural(
          ServerProductsCopy.oneByOneDescription,
          totalCount,
          { on: translator.formatNumber(onCount) },
        )}
        rightElement={
          <Button
            title={translator.translateText(
              isOneByOneOpen
                ? ServerProductsCopy.hideProducts
                : ServerProductsCopy.showProducts,
            )}
            buttonStyle={ButtonStyleType.NORMAL}
            icon={isOneByOneOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
            ariaExpanded={isOneByOneOpen}
            dataTestId={SERVER_PRODUCTS_ONE_BY_ONE_TOGGLE_TEST_ID}
            onClick={() => {
              setIsOneByOneOpen(!isOneByOneOpen);
            }}
          />
        }
      >
        {isOneByOneOpen ? (
          <div className="space-y-6">
            {PRODUCT_CATEGORIES.map(
              (category: ProductCategory): ReactElement => {
                const products: Array<ProductKey> =
                  category.products.filter(isSwitchableProduct);

                if (products.length === 0) {
                  return (
                    <div key={category.title}>
                      <h3 className="text-sm font-semibold text-gray-900">
                        {translator.translateText(
                          ServerProductsCopy.alwaysOnTitle,
                        )}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {translator.translateText(ServerProductsCopy.alwaysOn)}
                      </p>
                    </div>
                  );
                }

                return (
                  <div key={category.title}>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {translator.translateText(category.title)}
                    </h3>
                    <div className="divide-y divide-gray-100">
                      {products.map(renderProduct)}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default ServerProductsSettings;
