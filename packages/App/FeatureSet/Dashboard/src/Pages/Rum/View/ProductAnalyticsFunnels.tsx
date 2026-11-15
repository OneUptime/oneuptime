import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import { ProductAnalyticsEventKind } from "Common/Types/Rum/ProductAnalyticsEvents";
import {
  ProductAnalyticsFunnelDefinition,
  ProductAnalyticsSavedViewType,
} from "Common/Types/Rum/ProductAnalyticsSavedViews";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS,
  ProductAnalyticsEventNameDto,
  ProductAnalyticsEventNamesDto,
  ProductAnalyticsEventPropertiesDto,
  ProductAnalyticsEventRef,
  ProductAnalyticsFunnelDto,
  ProductAnalyticsSegmentFilter,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  COUNTING_SINCE_EVENTS,
  ProductAnalyticsCountingSince,
  ProductAnalyticsToolbar,
} from "../../../Components/ProductAnalytics/ProductAnalyticsFrame";
import {
  ProductAnalyticsUrlState,
  buildProductAnalyticsUrl,
  readProductAnalyticsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsUrlState";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../../Components/ProductAnalytics/useProductAnalyticsRead";
import {
  PRODUCT_ANALYTICS_FUNNEL_WINDOW_LABELS,
  ProductAnalyticsEventsUrlState,
  SESSION_START_EVENT,
  encodeProductAnalyticsEvent,
  readProductAnalyticsEventsUrlState,
  writeProductAnalyticsEventsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsFormat";
import {
  fetchProductAnalyticsEventNames,
  fetchProductAnalyticsEventProperties,
  fetchProductAnalyticsFunnel,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsApi";
import ProductAnalyticsEventPicker from "../../../Components/ProductAnalytics/ProductAnalyticsEventPicker";
import ProductAnalyticsSegmentBar from "../../../Components/ProductAnalytics/ProductAnalyticsSegmentBar";
import ProductAnalyticsFunnelChart, {
  describeProductAnalyticsFunnelCompletion,
} from "../../../Components/ProductAnalytics/ProductAnalyticsFunnelChart";
import {
  ProductAnalyticsEventsSwitchPanel,
  ProductAnalyticsEventsSwitchState,
  ProductAnalyticsNothingKept,
  useProductAnalyticsEventsSwitch,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsGate";
import {
  ProductAnalyticsSavedView,
  applyProductAnalyticsFunnelDefinition,
  toProductAnalyticsFunnelDefinition,
  writeProductAnalyticsSavedViewId,
} from "../../../Components/ProductAnalytics/ProductAnalyticsSavedViews";
import ProductAnalyticsSavedViewsMenu, {
  ProductAnalyticsSavedViewNotice,
  ProductAnalyticsSavedViewState,
  useProductAnalyticsSavedViewState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsSavedViewsMenu";

/*
 * Product Analytics > Funnels (issue #6444, part two): of the people who
 * did a first event in the range, how many then did each next one, in
 * order, within a time of their first - where they went on, where they
 * dropped off, and how long the ones who went on took. A funnel is saved
 * under a name from the toolbar, to open again here or show on a
 * dashboard (issue #6630).
 */

/*
 * The steps a funnel opens with when its address names none: a session's
 * start, then the application's most frequent event of its own, else its
 * most viewed page. With neither, a session's start twice: who came back
 * for another session within the window.
 */
export function pickDefaultProductAnalyticsFunnelSteps(
  events: ReadonlyArray<ProductAnalyticsEventNameDto>,
): Array<ProductAnalyticsEventRef> {
  for (const kind of [
    ProductAnalyticsEventKind.Custom,
    ProductAnalyticsEventKind.Page,
  ]) {
    const first: ProductAnalyticsEventNameDto | undefined = events.find(
      (event: ProductAnalyticsEventNameDto): boolean => {
        return event.kind === kind;
      },
    );

    if (first) {
      return [SESSION_START_EVENT, { kind: first.kind, name: first.name }];
    }
  }

  return [SESSION_START_EVENT, SESSION_START_EVENT];
}

/*
 * The step Add step adds: the application's most frequent event of its own
 * that is not a step yet, else its most viewed page that is not, else a
 * session's start - never a copy of a step already there while another
 * event is left.
 */
export function pickNextProductAnalyticsFunnelStep(
  events: ReadonlyArray<ProductAnalyticsEventNameDto>,
  steps: ReadonlyArray<ProductAnalyticsEventRef>,
): ProductAnalyticsEventRef {
  const taken: Set<string> = new Set<string>(
    steps.map(encodeProductAnalyticsEvent),
  );

  for (const kind of [
    ProductAnalyticsEventKind.Custom,
    ProductAnalyticsEventKind.Page,
  ]) {
    const next: ProductAnalyticsEventNameDto | undefined = events.find(
      (event: ProductAnalyticsEventNameDto): boolean => {
        return (
          event.kind === kind &&
          !taken.has(
            encodeProductAnalyticsEvent({ kind: event.kind, name: event.name }),
          )
        );
      },
    );

    if (next) {
      return { kind: next.kind, name: next.name };
    }
  }

  return SESSION_START_EVENT;
}

/* The segment a funnel or a cohort can take: fields every event carries, and user properties. */
export function toProductAnalyticsPersonProperties(
  properties: ProductAnalyticsEventPropertiesDto | null,
): ProductAnalyticsEventPropertiesDto | null {
  return properties
    ? { propertyKeys: [], userPropertyKeys: properties.userPropertyKeys }
    : null;
}

const RumApplicationProductAnalyticsFunnels: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /* Route is ":id/product-analytics-funnels": the id is one segment before the end. */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [range, setRange] = useState<ProductAnalyticsUrlState>(
    (): ProductAnalyticsUrlState => {
      return readProductAnalyticsUrlState(window.location.search);
    },
  );
  const [state, setState] = useState<ProductAnalyticsEventsUrlState>(
    (): ProductAnalyticsEventsUrlState => {
      return readProductAnalyticsEventsUrlState(window.location.search);
    },
  );
  const [reloadToken, setReloadToken] = useState<number>(0);
  const analytics: ProductAnalyticsEventsSwitchState =
    useProductAnalyticsEventsSwitch(modelId);
  const saved: ProductAnalyticsSavedViewState =
    useProductAnalyticsSavedViewState(ProductAnalyticsSavedViewType.Funnel);

  useEffect((): void => {
    window.history.replaceState(
      window.history.state,
      "",
      writeProductAnalyticsSavedViewId(
        writeProductAnalyticsEventsUrlState(
          buildProductAnalyticsUrl(window.location.href, {
            timeRange: range.timeRange,
          }),
          {
            steps: state.steps,
            windowMs: state.windowMs,
            filters: state.filters,
          },
        ),
        saved.savedViewId,
      ),
    );
  }, [range.timeRange, state, saved.savedViewId]);

  /* The window, fixed when the range is picked or refreshed, so "now" does not drift. */
  const period: InBetween<Date> = useMemo((): InBetween<Date> => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(range.timeRange);
  }, [range.timeRange, reloadToken]);

  const windowKey: string = `${modelId.toString()}|${period.startValue.getTime()}|${period.endValue.getTime()}|${reloadToken}`;

  const names: ProductAnalyticsRead<ProductAnalyticsEventNamesDto> =
    useProductAnalyticsRead<ProductAnalyticsEventNamesDto>(
      windowKey,
      (): Promise<ProductAnalyticsEventNamesDto> => {
        return fetchProductAnalyticsEventNames({
          rumApplicationId: modelId,
          startTime: period.startValue,
          endTime: period.endValue,
        });
      },
    );

  const dataStartedAt: number | null = names.data?.dataStartedAt ?? null;
  /* Nothing kept at all: the page says why, and reads nothing more. */
  const isEmpty: boolean = Boolean(names.data && dataStartedAt === null);

  /*
   * The steps the address names, else the default once the events are
   * known - none while a saved funnel the address named is being opened.
   */
  const steps: Array<ProductAnalyticsEventRef> | null =
    isEmpty || saved.isOpening
      ? null
      : state.steps.length >= PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS
        ? state.steps
        : names.data
          ? pickDefaultProductAnalyticsFunnelSteps(names.data.events)
          : null;
  const stepsKey: string = steps
    ? steps.map(encodeProductAnalyticsEvent).join("|")
    : "";
  const firstStep: ProductAnalyticsEventRef | null = steps?.[0] || null;

  const properties: ProductAnalyticsRead<ProductAnalyticsEventPropertiesDto | null> =
    useProductAnalyticsRead<ProductAnalyticsEventPropertiesDto | null>(
      `${windowKey}|${firstStep ? encodeProductAnalyticsEvent(firstStep) : ""}`,
      (): Promise<ProductAnalyticsEventPropertiesDto | null> => {
        return firstStep
          ? fetchProductAnalyticsEventProperties({
              rumApplicationId: modelId,
              startTime: period.startValue,
              endTime: period.endValue,
              event: firstStep,
            })
          : Promise.resolve(null);
      },
    );

  const funnel: ProductAnalyticsRead<ProductAnalyticsFunnelDto | null> =
    useProductAnalyticsRead<ProductAnalyticsFunnelDto | null>(
      `${windowKey}|${stepsKey}|${state.windowMs}|${JSON.stringify(state.filters)}`,
      (): Promise<ProductAnalyticsFunnelDto | null> => {
        return steps
          ? fetchProductAnalyticsFunnel({
              rumApplicationId: modelId,
              startTime: period.startValue,
              endTime: period.endValue,
              steps: steps,
              filters: state.filters,
              windowMs: state.windowMs,
            })
          : Promise.resolve(null);
      },
    );

  // What is on screen, as the saved funnels keep it.
  const definition: ProductAnalyticsFunnelDefinition | null =
    toProductAnalyticsFunnelDefinition({
      steps: steps,
      windowMs: state.windowMs,
      filters: state.filters,
    });

  const refresh: () => void = (): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  };

  const setSteps: (next: Array<ProductAnalyticsEventRef>) => void = (
    next: Array<ProductAnalyticsEventRef>,
  ): void => {
    setState((previous: ProductAnalyticsEventsUrlState) => {
      return { ...previous, steps: next };
    });
  };

  const windowOptions: Array<DropdownOption> =
    PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS.map((windowMs: number) => {
      return {
        value: String(windowMs),
        label: PRODUCT_ANALYTICS_FUNNEL_WINDOW_LABELS[windowMs] || "",
      };
    });

  const completion: string | null =
    funnel.data && !funnel.error
      ? describeProductAnalyticsFunnelCompletion({
          funnel: funnel.data,
          translator: translator,
        })
      : null;
  let body: ReactElement;

  if (names.error) {
    body = <ErrorMessage message={names.error} onRefreshClick={refresh} />;
  } else if (isEmpty) {
    body = (
      <ProductAnalyticsNothingKept
        rumApplicationId={modelId}
        analytics={analytics}
      />
    );
  } else {
    const shownSteps: Array<ProductAnalyticsEventRef> = steps || [];

    body = (
      <div className="space-y-5" data-testid="product-analytics-funnels-page">
        <ProductAnalyticsEventsSwitchPanel
          rumApplicationId={modelId}
          analytics={analytics}
        />
        <ProductAnalyticsCountingSince
          dataStartedAt={dataStartedAt}
          startTime={period.startValue}
          template={COUNTING_SINCE_EVENTS}
        />
        <div className="space-y-4" data-testid="product-analytics-funnel-steps">
          {steps ? (
            <></>
          ) : (
            /* The steps come with the application's events: two rows to come. */
            <div
              className="space-y-2"
              data-testid="product-analytics-funnel-steps-loading"
              aria-hidden="true"
            >
              {[0, 1].map((row: number): ReactElement => {
                return (
                  <div key={row} className="flex items-center gap-2">
                    <div className="h-6 w-6 flex-none animate-pulse rounded-full bg-gray-100" />
                    <div className="h-[38px] min-w-0 flex-1 animate-pulse rounded-md bg-gray-100 sm:max-w-md" />
                  </div>
                );
              })}
            </div>
          )}
          <ol className="space-y-2">
            {shownSteps.map(
              (step: ProductAnalyticsEventRef, index: number): ReactElement => {
                const stepName: string = translator.translateTemplate(
                  "Step {{number}}",
                  { number: translator.formatNumber(index + 1) },
                );

                return (
                  <li
                    key={index}
                    className="flex items-center gap-2"
                    data-testid="product-analytics-funnel-step"
                  >
                    <span
                      className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-700"
                      aria-hidden="true"
                    >
                      {translator.formatNumber(index + 1)}
                    </span>
                    <div className="min-w-0 flex-1 sm:max-w-md">
                      <ProductAnalyticsEventPicker
                        events={names.data?.events || []}
                        value={step}
                        ariaLabel={stepName}
                        isAriaLabelTranslated={true}
                        dataTestId={`product-analytics-funnel-step-${index + 1}`}
                        onChange={(picked: ProductAnalyticsEventRef): void => {
                          const next: Array<ProductAnalyticsEventRef> = [
                            ...shownSteps,
                          ];
                          next[index] = picked;
                          setSteps(next);
                        }}
                      />
                    </div>
                    {shownSteps.length > PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS ? (
                      <button
                        type="button"
                        className="flex-none rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={translator.translateTemplate(
                          "Remove {{step}}",
                          { step: stepName },
                        )}
                        title={translator.translateTemplate("Remove {{step}}", {
                          step: stepName,
                        })}
                        data-testid="product-analytics-funnel-step-remove"
                        onClick={(): void => {
                          setSteps(
                            shownSteps.filter(
                              (
                                _candidate: ProductAnalyticsEventRef,
                                candidateIndex: number,
                              ): boolean => {
                                return candidateIndex !== index;
                              },
                            ),
                          );
                        }}
                      >
                        <Icon icon={IconProp.Close} className="h-4 w-4" />
                      </button>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              },
            )}
          </ol>
          <div>
            <Button
              title="Add step"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.Small}
              disabled={
                !steps ||
                shownSteps.length >= PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS
              }
              tooltip={
                shownSteps.length >= PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS
                  ? translator.translatePlural(
                      {
                        one: "A funnel has at most {{count}} step.",
                        other: "A funnel has at most {{count}} steps.",
                      },
                      PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
                    )
                  : undefined
              }
              dataTestId="product-analytics-funnel-add-step"
              onClick={(): void => {
                setSteps([
                  ...shownSteps,
                  pickNextProductAnalyticsFunnelStep(
                    names.data?.events || [],
                    shownSteps,
                  ),
                ]);
              }}
            />
          </div>
          <div className="w-full space-y-1 sm:w-56">
            <span className="block text-xs font-medium text-gray-500">
              {translator.translateText("Time to finish the funnel")}
            </span>
            <Dropdown
              options={windowOptions}
              value={windowOptions.find((option: DropdownOption): boolean => {
                return option.value === String(state.windowMs);
              })}
              isClearable={false}
              ariaLabel="Time to finish the funnel"
              dataTestId="product-analytics-funnel-window"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                const windowMs: number = Number(value);

                if (PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS.includes(windowMs)) {
                  setState((previous: ProductAnalyticsEventsUrlState) => {
                    return { ...previous, windowMs: windowMs };
                  });
                }
              }}
            />
          </div>
          <ProductAnalyticsSegmentBar
            filters={state.filters}
            properties={toProductAnalyticsPersonProperties(
              properties.data ?? null,
            )}
            onChange={(filters: Array<ProductAnalyticsSegmentFilter>): void => {
              setState((previous: ProductAnalyticsEventsUrlState) => {
                return { ...previous, filters: filters };
              });
            }}
            dataTestId="product-analytics-funnel-segment"
          />
        </div>
        <div
          className="space-y-4 border-t border-gray-100 pt-5"
          data-testid="product-analytics-funnel-result"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-medium text-gray-900">
              {translator.translateText("Conversion")}
            </h3>
            {completion ? (
              <span
                className="text-sm text-gray-600"
                data-testid="product-analytics-funnel-completion"
              >
                {completion}
              </span>
            ) : (
              <></>
            )}
          </div>
          {funnel.error ? (
            <ErrorMessage
              message={funnel.error}
              onRefreshClick={funnel.reload}
            />
          ) : funnel.data ? (
            funnel.data.steps[0] && funnel.data.steps[0].people === 0 ? (
              <p
                className="text-sm text-gray-500"
                data-testid="product-analytics-funnel-nobody"
              >
                {translator.translateText(
                  "Nobody did the first step in this range and segment.",
                )}
              </p>
            ) : (
              <div
                className={
                  funnel.isLoading ? "opacity-60 transition-opacity" : ""
                }
              >
                <ProductAnalyticsFunnelChart
                  funnel={funnel.data}
                  dataTestId="product-analytics-funnel-chart"
                />
              </div>
            )
          ) : (
            <div className="h-40 animate-pulse rounded-md bg-gray-50" />
          )}
        </div>
      </div>
    );
  }

  return (
    <Card
      title="Funnels"
      description="Of the people who did the first step in this range, how many went on to do each next step in order, within the time you choose."
      headerLayout="toolbar"
      buttons={[
        <ProductAnalyticsToolbar
          key="product-analytics-funnels-toolbar"
          dataTestId="product-analytics-funnels-toolbar"
          timeRange={range.timeRange}
          onTimeRangeChange={(timeRange: RangeStartAndEndDateTime): void => {
            setRange((previous: ProductAnalyticsUrlState) => {
              return { ...previous, timeRange: timeRange };
            });
          }}
          onRefresh={refresh}
          savedViews={
            <ProductAnalyticsSavedViewsMenu
              rumApplicationId={modelId}
              viewType={ProductAnalyticsSavedViewType.Funnel}
              definition={definition}
              savedViewId={saved.savedViewId}
              isDefinitionInAddress={saved.address.isDefinitionInAddress}
              isSettled={saved.isSettled}
              onOpen={(
                view: ProductAnalyticsSavedView<ProductAnalyticsSavedViewType.Funnel>,
              ): void => {
                const opened: ProductAnalyticsFunnelDefinition | null =
                  view.definition;

                if (opened) {
                  setState((previous: ProductAnalyticsEventsUrlState) => {
                    return applyProductAnalyticsFunnelDefinition(
                      previous,
                      opened,
                    );
                  });
                  saved.setSavedViewId(view.id);
                }
              }}
              onSelect={saved.setSavedViewId}
              onNotice={saved.setNotice}
              onSettled={saved.settle}
              dataTestId="product-analytics-funnels-saved"
            />
          }
        />,
      ]}
    >
      <Fragment>
        <ProductAnalyticsSavedViewNotice
          notice={saved.notice}
          onClose={(): void => {
            saved.setNotice(null);
          }}
        />
        {body}
      </Fragment>
    </Card>
  );
};

export default RumApplicationProductAnalyticsFunnels;
