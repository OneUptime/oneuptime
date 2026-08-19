import API from "../../Utils/API/API";
import Query from "../../../Types/BaseDatabase/Query";
import ModelAPI, { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";
import { BadgeType } from "../Badge/Badge";
import SideMenuItem from "./SideMenuItem";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import GlobalEvents from "../../Utils/GlobalEvents";

export const REFRESH_SIDEBAR_COUNT_EVENT: string = "REFRESH_SIDEBAR_COUNTS";

export interface ComponentProps<TBaseModel extends BaseModel> {
  link: Link;
  modelType?: { new (): TBaseModel } | undefined;
  badgeType?: BadgeType | undefined;
  countQuery?: Query<TBaseModel> | undefined;
  requestOptions?: RequestOptions | undefined;
  icon?: undefined | IconProp;
  className?: undefined | string;
  onCountFetchInit?: (() => void) | undefined;
}

const CountModelSideMenuItem: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [count, setCount] = useState<number>(0);

  const fetchCount: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      if (!props.modelType) {
        return;
      }

      if (!props.countQuery) {
        return;
      }

      setError("");
      setIsLoading(true);

      if (props.onCountFetchInit) {
        props.onCountFetchInit();
      }

      try {
        const count: number = await ModelAPI.count<BaseModel>({
          modelType: props.modelType,
          query: props.countQuery,
          requestOptions: props.requestOptions,
        });

        setCount(count);
        setError("");
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    }, [
      props.modelType,
      props.countQuery,
      props.requestOptions,
      props.onCountFetchInit,
    ]);

  /*
   * Side menus rebuild `countQuery` / `requestOptions` as fresh object
   * literals on every render, so their identity changes on every parent
   * re-render (which happens on every in-section navigation). Guard the fetch
   * with a value-level compare - the same JSON.stringify-in-a-ref pattern
   * BaseModelTable uses for its `props.query` - so only a real change
   * re-issues the count request. The global refresh event below still forces
   * a refetch regardless of this guard.
   */
  const lastFetchedModelTypeRef: MutableRefObject<
    { new (): TBaseModel } | undefined
  > = useRef<{ new (): TBaseModel } | undefined>(undefined);
  const lastFetchedQueryJsonRef: MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  useEffect(() => {
    const queryJson: string = JSON.stringify({
      countQuery: props.countQuery || null,
      requestOptions: props.requestOptions || null,
    });

    // only fetch if the query has changed by value (or on first mount).
    if (
      lastFetchedModelTypeRef.current === props.modelType &&
      lastFetchedQueryJsonRef.current === queryJson
    ) {
      return;
    }

    lastFetchedModelTypeRef.current = props.modelType;
    lastFetchedQueryJsonRef.current = queryJson;

    fetchCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchCount]);

  // Listen for global refresh events
  useEffect(() => {
    const handleRefresh: () => void = (): void => {
      fetchCount().catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
    };

    GlobalEvents.addEventListener(REFRESH_SIDEBAR_COUNT_EVENT, handleRefresh);

    return () => {
      GlobalEvents.removeEventListener(
        REFRESH_SIDEBAR_COUNT_EVENT,
        handleRefresh,
      );
    };
  }, [fetchCount]);

  return (
    <SideMenuItem
      link={props.link}
      badge={!isLoading && !error ? count : undefined}
      badgeType={props.badgeType}
      icon={props.icon}
      className={props.className}
    />
  );
};

export default CountModelSideMenuItem;
