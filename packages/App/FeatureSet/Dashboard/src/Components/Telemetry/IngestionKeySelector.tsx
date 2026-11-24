import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import API from "Common/UI/Utils/API/API";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  IngestionKeyFormOptions,
  getDefaultIngestionKeyName,
  getIngestionKeyFormFields,
  getIngestionKeyFormSteps,
  getUniqueIngestionKeyName,
  prepareIngestionKeyForCreate,
} from "./IngestionKeyForm";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { withSearch } from "Common/UI/Components/EntityDropdown/EntityDropdownQuery";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import OneUptimeDate from "Common/Types/Date";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

/*
 * Why a key cannot send right now (issue #6378): turned off, or past its
 * expiry. Everything sent with it is refused, so the picker says so beside
 * its name and under its token, and does not pick it on its own.
 */
export type IngestionKeyUnusableReason = "turned-off" | "expired";

export function getIngestionKeyUnusableReason(
  key: TelemetryIngestionKey,
  now: Date,
): IngestionKeyUnusableReason | null {
  if (key.isEnabled === false) {
    return "turned-off";
  }

  const expiresAt: Date | null = key.expiresAt
    ? OneUptimeDate.fromString(key.expiresAt)
    : null;

  if (
    expiresAt &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() <= now.getTime()
  ) {
    return "expired";
  }

  return null;
}

/*
 * The keys in the picker's order: those that can send first, then those
 * everything sent with is refused - still there, and still said why - each
 * group in the order it came.
 */
export function getIngestionKeysUsableFirst(
  keys: ReadonlyArray<TelemetryIngestionKey>,
  now: Date,
): Array<TelemetryIngestionKey> {
  const isUsable: (key: TelemetryIngestionKey) => boolean = (
    key: TelemetryIngestionKey,
  ): boolean => {
    return getIngestionKeyUnusableReason(key, now) === null;
  };

  return [
    ...keys.filter(isUsable),
    ...keys.filter((key: TelemetryIngestionKey): boolean => {
      return !isUsable(key);
    }),
  ];
}

const UNUSABLE_KEY_LABELS: Readonly<
  Record<IngestionKeyUnusableReason, string>
> = {
  "turned-off": translationKey("{{name}} (turned off)"),
  expired: translationKey("{{name}} (expired)"),
};

// What the picker calls a key that has no name.
export const UNNAMED_KEY: string = translationKey("Unnamed Key");

/*
 * A key as the picker offers it: its name, with why it is refused when it
 * is ("prod (expired)", in the reader's words). Each label says how it
 * reads, so it is looked up exactly once (Dropdown's isUserContent):
 *
 *   - a refused key's label is a sentence translated here, its name - or,
 *     for a key with no name, the reader's word for "Unnamed Key" - inside
 *     it, drawn as given. An unnamed refused key read "Unnamed Key" inside
 *     a Spanish sentence, and the translated sentence was looked up a
 *     second time (#8297);
 *   - a usable key's label is its name, as written, or "Unnamed Key", the
 *     product's word, which the Dropdown looks up.
 */
export function getIngestionKeyOption(
  key: TelemetryIngestionKey,
  now: Date,
  translator: Translator,
): DropdownOption {
  const unusable: IngestionKeyUnusableReason | null =
    getIngestionKeyUnusableReason(key, now);
  const value: string = key.id?.toString() || "";

  if (unusable) {
    return {
      value: value,
      label: translator.translateTemplate(
        UNUSABLE_KEY_LABELS[unusable],
        { name: key.name || translatableTerm(UNNAMED_KEY) },
        { setsValuesApart: true },
      ),
      isUserContent: true,
    };
  }

  return {
    value: value,
    label: key.name || UNNAMED_KEY,
    isUserContent: Boolean(key.name),
  };
}

const UNUSABLE_KEY_CAUTIONS: Readonly<
  Record<IngestionKeyUnusableReason, string>
> = {
  "turned-off": translationKey(
    "This key is turned off, so everything sent with it is refused. Pick another key, or turn it back on in Project Settings > Telemetry & APM > Ingestion Keys.",
  ),
  expired: translationKey(
    "This key has expired, so everything sent with it is refused. Pick another key, or change its expiry date in Project Settings > Telemetry & APM > Ingestion Keys.",
  ),
};

/*
 * What the reader is told under a picked key's token: where the key may go,
 * and what it can send from there (#6458, #6457). Plain words - what it
 * sends, from where, and what the listed origins mean - in place of
 * "intended for client distribution" and "self-asserted identities".
 */
export const BROWSER_KEY_CAUTION: string = translationKey(
  "Browser key: safe to put in a web page. It can send traces, logs, metrics, session replays and Sentry events, and only from: {{identities}}. An app:// entry lets a React Native app send session replays only, and anyone who has the app can send as it.",
);

export const BROWSER_KEY_WITHOUT_ORIGINS_CAUTION: string = translationKey(
  "This browser key has no allowed origins, so every request made with it is refused. Add your web origins or exact app:// mobile identities in Project Settings > Telemetry & APM > Ingestion Keys before using this snippet.",
);

export const MOBILE_KEY_CAUTION: string = translationKey(
  "Mobile key: safe to ship in your app. It can send only traces, logs, metrics and session replays, all filed under {{service}}, and never from a web page. Anyone who has the app can copy it, so it is rate limited, and you can turn it off at any time.",
);

export const SERVER_KEY_CAUTION: string = translationKey(
  "Server key: keep it secret. It can send every kind of telemetry to this project from anywhere, so put it only in server environment variables and collector settings. Never put it in a web page or a mobile app: use a Browser key in a page and a Mobile key in an app.",
);

/*
 * How many keys one read lists: the first ones by name, and what a search
 * finds (#10646).
 */
export const INGESTION_KEYS_READ_LIMIT: number = 50;
const INGESTION_KEY_SEARCH_DEBOUNCE_MS: number = 250;

// What a key is read with: its token, and what the panel under it says.
export const INGESTION_KEY_SELECT: Select<TelemetryIngestionKey> = {
  _id: true,
  name: true,
  secretKey: true,
  description: true,
  /*
   * Not shown as a column anywhere - it decides which caution the token
   * panel prints. Rendering a secret without saying which kind of secret it
   * is is how a server key ends up in a page.
   */
  keyType: true,
  allowedOrigins: true,
  // A Mobile key's caution names the app it files everything under.
  pinnedServiceName: true,
  // A key that is off or expired is refused: said, and not picked.
  isEnabled: true,
  expiresAt: true,
};

/*
 * "Which key do I send this with, and where do I send it?" — step one of
 * every ingestion guide in the product.
 *
 * Extracted from Components/Telemetry/Documentation.tsx so the security
 * events guide could ask the same question without a second copy of the
 * list/select/create-key flow. The endpoint row is a prop rather than a
 * telemetry-type switch: OTLP, Pyroscope and the security-events ingest
 * URL are three different addresses, and a component that had to know
 * about all of them would grow a branch for every future pillar.
 */

export interface ComponentProps {
  endpointLabel: string;
  endpointValue: string;
  endpointHint?: string | undefined;

  /*
   * The one class of key the guide's snippet works with: the picker lists
   * only those, and a key created here is of that type without asking.
   *
   * Every guide knows the answer. An agent, a collector or a server SDK
   * sends no Origin header, so a Browser key is refused on every export
   * (422): those guides pass Server. A guide whose snippet ends up in a page
   * the public can read (a browser SDK, a session replay tag) passes
   * Browser, so the list cannot offer a server secret for pasting into a
   * page in the first place - the warning below the token is the second
   * line of defence, not the first.
   */
  keyTypeFilter: TelemetryIngestionKeyType;

  /*
   * The name a key created here starts with: what the guide is for, as the
   * English text of a translation key - translationKey("Kubernetes key").
   * Shown in the reader's language, and numbered when the list already has
   * a key of that name. The reader can change it before creating the key.
   */
  newKeyName: string;

  /*
   * The service.name a Mobile key created here is pinned to, when the
   * guide knows the app (its Documentation tab). Left out, the form asks.
   */
  newKeyPinnedServiceName?: string | undefined;

  /*
   * Fires with the key the snippets should be rendered with, and with
   * null while none is selectable (still loading, load failed, or the
   * project has no keys yet) so callers fall back to their placeholder
   * instead of showing a stale secret from a previous selection.
   */
  onSelectedKeyChange: (key: TelemetryIngestionKey | null) => void;

  /*
   * Only the key picker, without the endpoint and the token under it: for a
   * guide whose one command already carries both (Add Host).
   */
  hideValues?: boolean | undefined;
}

const IngestionKeySelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // The first keys by name, the usable ones first.
  const [ingestionKeys, setIngestionKeys] = useState<
    Array<TelemetryIngestionKey>
  >([]);
  // What a search of the keys found, past the first ones (#10646).
  const [foundKeys, setFoundKeys] = useState<Array<TelemetryIngestionKey>>([]);
  /*
   * The key picked, as it was read: kept whole, wherever it was found, so a
   * key past the first ones stays picked, its token shown, whatever is
   * searched next.
   */
  const [pickedKey, setPickedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );
  const [isLoadingKeys, setIsLoadingKeys] = useState<boolean>(true);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");
  const searchTimerRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  const searchSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const isBrowserKeyOnly: boolean =
    props.keyTypeFilter === TelemetryIngestionKeyType.Browser;
  const isMobileKeyOnly: boolean =
    props.keyTypeFilter === TelemetryIngestionKeyType.Mobile;

  // The keys the guide's snippet works with: its type only.
  const getKeyQuery: () => Query<TelemetryIngestionKey> =
    (): Query<TelemetryIngestionKey> => {
      const query: Query<TelemetryIngestionKey> = {
        projectId: ProjectUtil.getCurrentProjectId()!,
      };

      if (props.keyTypeFilter) {
        query.keyType = props.keyTypeFilter;
      }

      return query;
    };

  // The keys read, also handed back: none when the read failed.
  const loadIngestionKeys: () => Promise<
    Array<TelemetryIngestionKey>
  > = async (): Promise<Array<TelemetryIngestionKey>> => {
    try {
      setIsLoadingKeys(true);
      setKeyError("");

      /*
       * The first keys by name (#10646). The read was unsorted, so it was
       * the newest 50, and an older key could not be picked at all; the
       * picker searches the rest on the server as it is typed in.
       */
      const result: ListResult<TelemetryIngestionKey> =
        await ModelAPI.getList<TelemetryIngestionKey>({
          modelType: TelemetryIngestionKey,
          query: getKeyQuery(),
          limit: INGESTION_KEYS_READ_LIMIT,
          skip: 0,
          select: INGESTION_KEY_SELECT,
          sort: { name: SortOrder.Ascending },
        });

      // Keys that can send come first: a refused one is not the first offered.
      const keys: Array<TelemetryIngestionKey> = getIngestionKeysUsableFirst(
        result.data,
        OneUptimeDate.getCurrentDate(),
      );

      setIngestionKeys(keys);
      setFoundKeys([]);

      /*
       * Keep the key picked while it is still one the guide works with;
       * otherwise pick the first key. A guide that narrows the list to
       * another key type (a browser snippet, then a mobile one) reads it
       * again, and the key picked before is not of that type - keeping it
       * would hand the snippets a key they cannot use.
       */
      setPickedKey(
        (
          current: TelemetryIngestionKey | null,
        ): TelemetryIngestionKey | null => {
          if (
            current &&
            (!props.keyTypeFilter || current.keyType === props.keyTypeFilter)
          ) {
            return (
              keys.find((key: TelemetryIngestionKey): boolean => {
                return key.id?.toString() === current.id?.toString();
              }) || current
            );
          }

          /*
           * The first key is one that can send: a key everything sent with
           * is refused is picked only when it is all there is.
           */
          return keys[0] || null;
        },
      );

      return keys;
    } catch (err) {
      setKeyError(API.getFriendlyErrorMessage(err as Error));
      return [];
    } finally {
      setIsLoadingKeys(false);
    }
  };

  /*
   * What is typed into the picker, searched on the server (#10646): the
   * keys of the guide's type whose name holds it, by name. The keys read
   * first are offered still.
   */
  const searchIngestionKeys: (text: string) => void = (text: string): void => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }

    const trimmed: string = text.trim();

    if (!trimmed) {
      return;
    }

    const sequence: number = ++searchSequenceRef.current;

    searchTimerRef.current = window.setTimeout(() => {
      ModelAPI.getList<TelemetryIngestionKey>({
        modelType: TelemetryIngestionKey,
        query: withSearch(
          getKeyQuery() as Record<string, unknown>,
          "name",
          trimmed,
        ) as Query<TelemetryIngestionKey>,
        limit: INGESTION_KEYS_READ_LIMIT,
        skip: 0,
        select: INGESTION_KEY_SELECT,
        sort: { name: SortOrder.Ascending },
      })
        .then((result: ListResult<TelemetryIngestionKey>) => {
          if (sequence === searchSequenceRef.current) {
            setFoundKeys(result.data);
          }
        })
        .catch(() => {
          // The keys read first are still offered.
        });
    }, INGESTION_KEY_SEARCH_DEBOUNCE_MS);
  };

  /*
   * A key created here, picked: from the keys just read when it sorts among
   * them, and otherwise read by its id - a key named past the first ones
   * is picked all the same (#10646).
   */
  const pickCreatedKey: (
    id: ObjectID,
    read: Array<TelemetryIngestionKey>,
  ) => Promise<void> = async (
    id: ObjectID,
    read: Array<TelemetryIngestionKey>,
  ): Promise<void> => {
    const listed: TelemetryIngestionKey | undefined = read.find(
      (key: TelemetryIngestionKey): boolean => {
        return key.id?.toString() === id.toString();
      },
    );

    const created: TelemetryIngestionKey | null =
      listed ||
      (await ModelAPI.getItem<TelemetryIngestionKey>({
        modelType: TelemetryIngestionKey,
        id: id,
        select: INGESTION_KEY_SELECT,
      }));

    if (created) {
      setPickedKey(created);
    }
  };

  /*
   * Fetch on mount, and again if the caller narrows to a different key type -
   * the filter is part of the query, so a stale list would offer keys the
   * guide has just said it does not want.
   */
  useEffect(() => {
    loadIngestionKeys().catch(() => {});
  }, [props.keyTypeFilter]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const selectedKey: TelemetryIngestionKey | undefined = pickedKey || undefined;

  /*
   * The keys the picker offers, each once: the first ones read, what the
   * search found, and the one picked.
   */
  const offeredKeys: Array<TelemetryIngestionKey> = useMemo(() => {
    const seen: Set<string> = new Set<string>();
    const offered: Array<TelemetryIngestionKey> = [];

    for (const key of [
      ...ingestionKeys,
      ...getIngestionKeysUsableFirst(foundKeys, OneUptimeDate.getCurrentDate()),
      ...(pickedKey ? [pickedKey] : []),
    ]) {
      const id: string = key.id?.toString() || "";

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      offered.push(key);
    }

    return offered;
  }, [ingestionKeys, foundKeys, pickedKey]);

  /*
   * Held in a ref so the notify effect can depend on the selection alone.
   * Callers pass an inline arrow, which is a new function on every parent
   * render; in the dependency array that would re-notify the parent with
   * an unchanged key, and a parent that sets state from it would loop.
   */
  const onSelectedKeyChangeRef: React.MutableRefObject<
    (key: TelemetryIngestionKey | null) => void
  > = useRef(props.onSelectedKeyChange);
  onSelectedKeyChangeRef.current = props.onSelectedKeyChange;

  useEffect(() => {
    onSelectedKeyChangeRef.current(selectedKey || null);
  }, [selectedKey]);

  /*
   * What a key created here starts as: of the guide's type, and named after
   * what the guide is for - "Kubernetes key", or "Kubernetes key 2" when the
   * list already has one, so the two can be told apart in the picker.
   */
  const createKeyFormOptions: IngestionKeyFormOptions =
    useMemo((): IngestionKeyFormOptions => {
      return {
        keyType: props.keyTypeFilter,
        keyName: getUniqueIngestionKeyName({
          name: props.newKeyName
            ? translator.translateText(props.newKeyName) || props.newKeyName
            : getDefaultIngestionKeyName(props.keyTypeFilter),
          existingNames: ingestionKeys.map(
            (key: TelemetryIngestionKey): string | undefined => {
              return key.name;
            },
          ),
        }),
        pinnedServiceName: props.newKeyPinnedServiceName,
      };
    }, [
      props.keyTypeFilter,
      props.newKeyName,
      props.newKeyPinnedServiceName,
      ingestionKeys,
    ]);

  const createKeyFormSteps: Array<FormStep<TelemetryIngestionKey>> =
    useMemo((): Array<FormStep<TelemetryIngestionKey>> => {
      return getIngestionKeyFormSteps(createKeyFormOptions);
    }, [createKeyFormOptions]);

  const createKeyFormFields: Array<ModelField<TelemetryIngestionKey>> =
    useMemo((): Array<ModelField<TelemetryIngestionKey>> => {
      return getIngestionKeyFormFields(createKeyFormOptions);
    }, [createKeyFormOptions]);

  /*
   * Printed directly under the token, every time, on every guide that uses
   * this component. A token on screen is a token about to be pasted
   * somewhere, and the one thing the reader cannot tell by looking at it is
   * whether the place they are about to paste it is safe.
   */
  const renderSelectedKeyCaution: (
    key: TelemetryIngestionKey,
  ) => ReactElement = (key: TelemetryIngestionKey): ReactElement => {
    const unusable: IngestionKeyUnusableReason | null =
      getIngestionKeyUnusableReason(key, OneUptimeDate.getCurrentDate());

    if (unusable) {
      return (
        <div
          className="text-xs text-red-600 mt-2 leading-relaxed"
          data-testid="ingestion-key-unusable"
        >
          {translator.translateText(UNUSABLE_KEY_CAUTIONS[unusable])}
        </div>
      );
    }

    if (key.keyType === TelemetryIngestionKeyType.Browser) {
      /*
       * A browser key with no origins is refused on every request, so
       * handing someone a snippet built around one only produces a
       * confusing 403 later. Say so here, while they are still on the page
       * that can fix it.
       */
      if (!key.allowedOrigins || key.allowedOrigins.length === 0) {
        return (
          <div
            className="text-xs text-red-600 mt-2 leading-relaxed"
            data-testid="ingestion-key-caution"
          >
            {translator.translateText(BROWSER_KEY_WITHOUT_ORIGINS_CAUTION)}
          </div>
        );
      }

      /*
       * The identities are set apart: in a sentence read right to left, a
       * list of web addresses would otherwise pull its full stop away.
       */
      return (
        <div
          className="text-xs text-gray-500 mt-2 leading-relaxed"
          data-testid="ingestion-key-caution"
        >
          {translator.translateTemplate(
            BROWSER_KEY_CAUTION,
            { identities: key.allowedOrigins.join(", ") },
            { setsValuesApart: true },
          )}
        </div>
      );
    }

    /*
     * A Mobile key (issue #6457) is public too, but bound to one app: say
     * which, so the reader sees where everything it sends is filed.
     */
    if (key.keyType === TelemetryIngestionKeyType.Mobile) {
      return (
        <div
          className="text-xs text-gray-500 mt-2 leading-relaxed"
          data-testid="ingestion-key-caution"
        >
          {translator.translateTemplate(
            MOBILE_KEY_CAUTION,
            { service: key.pinnedServiceName || key.name || "" },
            { setsValuesApart: true },
          )}
        </div>
      );
    }

    return (
      <div
        className="text-xs text-amber-700 mt-2 leading-relaxed"
        data-testid="ingestion-key-caution"
      >
        {translator.translateText(SERVER_KEY_CAUTION)}
      </div>
    );
  };

  // A key as the picker offers it, with why it is refused when it is.
  const getKeyOption: (key: TelemetryIngestionKey) => DropdownOption = (
    key: TelemetryIngestionKey,
  ): DropdownOption => {
    return getIngestionKeyOption(
      key,
      OneUptimeDate.getCurrentDate(),
      translator,
    );
  };

  const renderContent: () => ReactElement = (): ReactElement => {
    if (isLoadingKeys) {
      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-500">
            {translator.translateText("Loading ingestion keys...")}
          </p>
        </div>
      );
    }

    if (keyError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">
            <ErrorSentence
              template="Failed to load ingestion keys: {{error}}"
              error={keyError}
            />
          </p>
          <button
            type="button"
            onClick={() => {
              loadIngestionKeys().catch(() => {});
            }}
            className="mt-2 text-sm text-red-700 underline hover:text-red-800"
          >
            {translator.translateText("Retry")}
          </button>
        </div>
      );
    }

    if (ingestionKeys.length === 0) {
      return (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-3">
            <Icon icon={IconProp.Key} className="w-5 h-5 text-indigo-600" />
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">
            {isBrowserKeyOnly
              ? translator.translateText("No browser ingestion keys yet")
              : isMobileKeyOnly
                ? translator.translateText("No mobile ingestion keys yet")
                : translator.translateText("No ingestion keys yet")}
          </p>
          <p className="text-xs text-gray-500 mb-4">
            {isBrowserKeyOnly
              ? translator.translateText(
                  "A browser key is the one safe to publish in a page: it is accepted only from the origins you list, and it can only write browser telemetry.",
                )
              : isMobileKeyOnly
                ? translator.translateText(
                    "A mobile key is the one safe to ship in an app: it is pinned to the app, and it can only send that app's traces, logs, metrics and session replays.",
                  )
                : translator.translateText(
                    "Create an ingestion key to authenticate your telemetry data.",
                  )}
          </p>
          <Button
            title="Create Ingestion Key"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.PRIMARY}
            onClick={() => {
              setShowCreateModal(true);
            }}
          />
        </div>
      );
    }

    return (
      <div>
        {/*
         * Key selector row. Where the picker would get narrower than a key's
         * name (a phone, a dialog), New Key goes under it instead.
         */}
        <div
          className={`flex flex-wrap items-center gap-2 ${props.hideValues ? "" : "mb-3"}`}
          data-testid="ingestion-key-picker-row"
        >
          <div className="min-w-[min(14rem,100%)] flex-1">
            <Dropdown
              options={offeredKeys.map(getKeyOption)}
              value={selectedKey ? getKeyOption(selectedKey) : undefined}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const picked: TelemetryIngestionKey | undefined = value
                  ? offeredKeys.find((key: TelemetryIngestionKey) => {
                      return key.id?.toString() === value.toString();
                    })
                  : undefined;

                if (picked) {
                  setPickedKey(picked);
                }
              }}
              // A key past the first ones read is searched on the server.
              onSearchTextChange={searchIngestionKeys}
              placeholder="Select an ingestion key"
              ariaLabel="Select ingestion key"
              /*
               * A refused key's "(turned off)" or "(expired)" follows its
               * name, and a phone's narrow picker cut it off with an
               * ellipsis (#6458): the pick wraps instead, whole.
               */
              wrapsPickedValue={true}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors flex-shrink-0"
          >
            <Icon icon={IconProp.Add} className="w-4 h-4" />
            {translator.translateText("New Key")}
          </button>
        </div>

        {/* Credentials display */}
        {selectedKey && !props.hideValues && (
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="grid grid-cols-1 divide-y divide-gray-100">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon
                    icon={IconProp.Globe}
                    className="w-4 h-4 text-blue-600"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {translator.translateText(props.endpointLabel) ||
                      props.endpointLabel}
                  </div>
                  <div className="text-sm text-gray-900 font-mono mt-0.5 break-all select-all">
                    {props.endpointValue}
                  </div>
                  {props.endpointHint && (
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {translator.translateText(props.endpointHint) ||
                        props.endpointHint}
                    </div>
                  )}
                </div>
              </div>
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon
                    icon={IconProp.Key}
                    className="w-4 h-4 text-amber-600"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {translator.translateText("Ingestion Token")}
                  </div>
                  <div className="text-sm text-gray-900 font-mono mt-0.5 break-all select-all">
                    {selectedKey.secretKey?.toString() || <TableEmptyValue />}
                  </div>
                  {renderSelectedKeyCaution(selectedKey)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {renderContent()}

      {/*
       * The create dialog every door shares (Telemetry/IngestionKeyForm):
       * the guide's name for the key already filled in, its type not asked,
       * the description under Advanced - one page and one click for a
       * Server key, a Browser key's origins on that same page, and the Free
       * plan's pricing as a step of its own.
       */}
      {showCreateModal && (
        <ModelFormModal<TelemetryIngestionKey>
          modelType={TelemetryIngestionKey}
          name="Create Ingestion Key"
          title={
            isBrowserKeyOnly
              ? "Create Browser Ingestion Key"
              : isMobileKeyOnly
                ? "Create Mobile Ingestion Key"
                : "Create Ingestion Key"
          }
          description={
            isBrowserKeyOnly
              ? "Create a browser telemetry ingestion key. It is safe to publish in your page, and is accepted only from the origins you list below."
              : isMobileKeyOnly
                ? "Create a mobile telemetry ingestion key. It is safe to ship in your app: it sends only the traces, logs, metrics and session replays of the app it is pinned to."
                : "Create a new telemetry ingestion key for sending data to OneUptime."
          }
          onClose={() => {
            setShowCreateModal(false);
          }}
          submitButtonText="Create Ingestion Key"
          onSuccess={(item: TelemetryIngestionKey) => {
            setShowCreateModal(false);
            // Refresh the list and select the new key, read by its id.
            loadIngestionKeys()
              .then(async (read: Array<TelemetryIngestionKey>) => {
                if (item.id) {
                  await pickCreatedKey(item.id, read);
                }
              })
              .catch(() => {});
          }}
          formProps={{
            name: "Create Ingestion Key",
            modelType: TelemetryIngestionKey,
            id: "create-ingestion-key",
            steps: createKeyFormSteps,
            fields: createKeyFormFields,
            formType: FormType.Create,
          }}
          onBeforeCreate={(
            item: TelemetryIngestionKey,
          ): Promise<TelemetryIngestionKey> => {
            item.projectId = ProjectUtil.getCurrentProjectId()!;

            return Promise.resolve(
              prepareIngestionKeyForCreate(item, createKeyFormOptions),
            );
          }}
        />
      )}
    </div>
  );
};

export default IngestionKeySelector;
