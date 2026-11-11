import Query from "../../../Types/BaseDatabase/Query";
import ModelAPI, { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../Utils/Project";
import { BadgeType } from "../Badge/Badge";
import SideMenuItem from "./SideMenuItem";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import React, {
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import GlobalEvents from "../../Utils/GlobalEvents";
import {
  REFRESH_SIDEBAR_COUNT_EVENT,
  refreshSideMenuCounts,
} from "./SideMenuCountRefresh";
import useLiveCount from "./UseLiveCount";

/*
 * Where every change that can move a count asks for it (SideMenuCountRefresh).
 * Exported from here too: the pages that ask import them from this file.
 */
export { REFRESH_SIDEBAR_COUNT_EVENT, refreshSideMenuCounts };

export interface ComponentProps<TBaseModel extends BaseModel> {
  link: Link;
  activeRoute?: Link["to"] | undefined;
  modelType?: { new (): TBaseModel } | undefined;
  badgeType?: BadgeType | undefined;
  countQuery?: Query<TBaseModel> | undefined;
  requestOptions?: RequestOptions | undefined;
  icon?: undefined | IconProp;
  className?: undefined | string;
  onCountFetchInit?: (() => void) | undefined;
}

// What one read of the count asks the server, and whom it tells it started.
interface CountQuestion<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel } | undefined;
  countQuery: Query<TBaseModel> | undefined;
  requestOptions: RequestOptions | undefined;
  onCountFetchInit: (() => void) | undefined;
}

/*
 * A SIDE-MENU ENTRY WITH THE COUNT OF WHAT ITS LIST HOLDS.
 *
 * The count is read when the entry is drawn, and again:
 *
 *   - when the question changes by value (countQuery, requestOptions) -
 *     not on every render: side menus rebuild those as fresh object literals
 *     on every parent render, which happens on every in-section navigation;
 *   - when the page asks every count to count again, as each change made
 *     from a list does (SideMenuCountRefresh);
 *   - when the server announces a change to a record of its kind, for a kind
 *     it announces (UseLiveCount).
 *
 * Counting the same question again keeps the count on show until the new
 * one arrives: a count that blinked out and back on every change would
 * flicker through a bulk action. A new question shows nothing until it is
 * answered - the old count is not its answer.
 *
 * Reads can finish out of order - a slow one started before a change can
 * land after a quick one started after it - so every read is numbered and
 * only the latest one's answer is shown. A recount that fails keeps the count
 * on show; the next change counts again. A first read that fails shows no
 * count: a side-menu entry with a red error where a number should be is a
 * worse outcome than a missing count, and the page behind it works either
 * way.
 */
const CountModelSideMenuItem: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  // The count on show; undefined draws none.
  const [count, setCount] = useState<number | undefined>(undefined);

  // What a read asks, as of now: a read started later counts what is asked then.
  const question: CountQuestion<TBaseModel> = {
    modelType: props.modelType,
    countQuery: props.countQuery,
    requestOptions: props.requestOptions,
    onCountFetchInit: props.onCountFetchInit,
  };
  const questionRef: MutableRefObject<CountQuestion<TBaseModel>> =
    useRef<CountQuestion<TBaseModel>>(question);
  questionRef.current = question;

  // The number of the latest read; only its answer is shown.
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  type ReadCountFunction = (options: { isRecount: boolean }) => Promise<void>;

  const readCount: ReadCountFunction = useCallback(
    async (options: { isRecount: boolean }): Promise<void> => {
      const current: CountQuestion<TBaseModel> = questionRef.current;

      if (!current.modelType || !current.countQuery) {
        return;
      }

      latestReadRef.current += 1;
      const readNumber: number = latestReadRef.current;

      if (!options.isRecount) {
        // A new question: the count on show is not its answer.
        setCount(undefined);
      }

      if (current.onCountFetchInit) {
        current.onCountFetchInit();
      }

      try {
        const value: number = await ModelAPI.count<BaseModel>({
          modelType: current.modelType,
          query: current.countQuery,
          requestOptions: current.requestOptions,
        });

        // A later read is on its way, or the entry has gone.
        if (readNumber !== latestReadRef.current) {
          return;
        }

        setCount(value);
      } catch {
        if (readNumber !== latestReadRef.current) {
          return;
        }

        /*
         * A first read that failed has nothing to show; a recount that
         * failed keeps the count it had.
         */
        if (!options.isRecount) {
          setCount(undefined);
        }
      }
    },
    [],
  );

  /*
   * Read only when the question changed by value (or on first mount) - the
   * same JSON.stringify-in-a-ref pattern BaseModelTable uses for its
   * `props.query`. Recounts (below) count whatever is asked when they run.
   */
  const lastReadModelTypeRef: MutableRefObject<
    { new (): TBaseModel } | undefined
  > = useRef<{ new (): TBaseModel } | undefined>(undefined);
  const lastReadQueryJsonRef: MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  const queryJson: string = JSON.stringify({
    countQuery: props.countQuery || null,
    requestOptions: props.requestOptions || null,
  });

  useEffect(() => {
    if (
      lastReadModelTypeRef.current === props.modelType &&
      lastReadQueryJsonRef.current === queryJson
    ) {
      return;
    }

    lastReadModelTypeRef.current = props.modelType;
    lastReadQueryJsonRef.current = queryJson;

    if (!props.modelType || !props.countQuery) {
      // Nothing to count any more: no count, and no read still on its way.
      latestReadRef.current += 1;
      setCount(undefined);
      return;
    }

    void readCount({ isRecount: false });
  }, [props.modelType, queryJson, readCount]);

  // Whatever is on its way when the entry goes is not shown.
  useEffect(() => {
    return () => {
      latestReadRef.current += 1;
    };
  }, []);

  // The page asks every count to count again.
  useEffect(() => {
    const onRefresh: () => void = (): void => {
      void readCount({ isRecount: true });
    };

    GlobalEvents.addEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onRefresh);

    return () => {
      GlobalEvents.removeEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onRefresh);
    };
  }, [readCount]);

  // A record of its kind changed, here or anywhere else.
  useLiveCount({
    modelType: props.modelType as { new (): BaseModel } | undefined,
    isEnabled: Boolean(props.modelType && props.countQuery),
    getTenantId: (): ObjectID | null => {
      return ProjectUtil.getCurrentProjectId();
    },
    recount: (): Promise<void> => {
      return readCount({ isRecount: true });
    },
  });

  return (
    <SideMenuItem
      link={props.link}
      activeRoute={props.activeRoute}
      badge={count}
      badgeType={props.badgeType}
      icon={props.icon}
      className={props.className}
    />
  );
};

export default CountModelSideMenuItem;
