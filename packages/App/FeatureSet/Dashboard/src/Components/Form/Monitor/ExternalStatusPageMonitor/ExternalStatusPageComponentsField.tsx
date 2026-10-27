import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import IconProp from "Common/Types/Icon/IconProp";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ExternalStatusPageComponentNames from "Common/Utils/Monitor/ExternalStatusPageComponentNames";
import { ExternalStatusPageComponent } from "Common/Utils/Monitor/ExternalStatusPageReading";
import ExternalStatusPageScope from "Common/Utils/Monitor/ExternalStatusPageScope";
import ExternalStatusPageComponentCatalog, {
  ExternalStatusPageCatalog,
  ExternalStatusPageCatalogError,
  ExternalStatusPageCatalogProblem,
} from "../../../../Utils/ExternalStatusPageComponentCatalog";
import ExternalStatusPageComponentsCopy, {
  ComponentChoiceOptions,
} from "./ExternalStatusPageComponentsCopy";

/*
 * THE COMPONENTS AN EXTERNAL STATUS PAGE MONITOR WATCHES (issue #5156).
 *
 * A status page reports on many components; a monitor may depend on a few
 * (GitHub's Git Operations and Pull Requests, not Copilot). This field
 * picks them: left empty, the monitor watches the whole page, as it always
 * did; with components chosen, only their statuses and incidents count.
 *
 * The page's own list is read when the field's menu first opens - by the
 * person's browser, as the probe would read it
 * (ExternalStatusPageComponentCatalog) - and its components are offered in
 * the page's groups, each one not operational saying so. A name the page
 * does not list can be typed and added: for a page that cannot be read from
 * here, an RSS or Atom feed (whose items' titles are matched), or a
 * pattern, where * stands for any text. A line under the field says what
 * was read, which chosen names the page does not have, or why nothing could
 * be read, with Try again.
 */

export interface ComponentProps {
  statusPageUrl: string;
  provider: ExternalStatusPageProviderType;
  componentGroupName?: string | undefined;
  componentNames: Array<string>;
  onChange: (componentNames: Array<string>) => void;
  // The id of the field's label, for the box to be named by it.
  labelId: string;
  // The id of the field's description, for the box to be described by it.
  descriptionId: string;
  // Test seam: how the page's components are read.
  readCatalog?:
    | ((data: {
        statusPageUrl: string;
        provider: ExternalStatusPageProviderType;
        signal: AbortSignal;
      }) => Promise<ExternalStatusPageCatalog>)
    | undefined;
}

type ReadState =
  | { kind: "idle" }
  | { kind: "loading"; key: string; host: string }
  | { kind: "loaded"; key: string; catalog: ExternalStatusPageCatalog }
  | {
      kind: "failed";
      key: string;
      host: string;
      problem: ExternalStatusPageCatalogProblem;
    };

export const COMPONENTS_FIELD_TEST_ID: string =
  "external-status-page-components-field";
export const COMPONENTS_STATUS_TEST_ID: string =
  "external-status-page-components-status";
export const COMPONENTS_UNMATCHED_TEST_ID: string =
  "external-status-page-components-unmatched";
export const COMPONENTS_RETRY_TEST_ID: string =
  "external-status-page-components-retry";

// What a read is for: the page's address and how it is read.
const readKey: (statusPageUrl: string, provider: string) => string = (
  statusPageUrl: string,
  provider: string,
): string => {
  return `${provider || ExternalStatusPageProviderType.Auto}|${statusPageUrl.trim()}`;
};

const ExternalStatusPageComponentsField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [readState, setReadState] = useState<ReadState>({ kind: "idle" });
  const abortRef: React.MutableRefObject<AbortController | null> =
    useRef<AbortController | null>(null);

  const currentKey: string = readKey(props.statusPageUrl, props.provider);
  const host: string =
    ExternalStatusPageComponentCatalog.getAddress(props.statusPageUrl)?.host ||
    "";

  // A read of another address or provider says nothing of this one.
  const state: ReadState =
    readState.kind !== "idle" && readState.key !== currentKey
      ? { kind: "idle" }
      : readState;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const read: () => void = (): void => {
    abortRef.current?.abort();

    const key: string = currentKey;
    const controller: AbortController = new AbortController();
    abortRef.current = controller;

    const reader: NonNullable<ComponentProps["readCatalog"]> =
      props.readCatalog ||
      ((data: {
        statusPageUrl: string;
        provider: ExternalStatusPageProviderType;
        signal: AbortSignal;
      }): Promise<ExternalStatusPageCatalog> => {
        return ExternalStatusPageComponentCatalog.read(data);
      });

    setReadState({ kind: "loading", key: key, host: host });

    reader({
      statusPageUrl: props.statusPageUrl,
      provider: props.provider,
      signal: controller.signal,
    })
      .then((catalog: ExternalStatusPageCatalog): void => {
        if (!controller.signal.aborted) {
          setReadState({ kind: "loaded", key: key, catalog: catalog });
        }
      })
      .catch((error: unknown): void => {
        if (controller.signal.aborted) {
          return;
        }

        setReadState({
          kind: "failed",
          key: key,
          host: host,
          problem:
            error instanceof ExternalStatusPageCatalogError
              ? error.problem
              : ExternalStatusPageCatalogProblem.NotRead,
        });
      });
  };

  /*
   * The page is read when the menu first opens for this address: nothing is
   * asked of it until the person wants to pick from it. A read that failed
   * is read again only with Try again.
   */
  const onMenuOpen: () => void = (): void => {
    if (state.kind !== "idle") {
      return;
    }

    if (!host) {
      return;
    }

    if (
      props.provider === ExternalStatusPageProviderType.RSS ||
      props.provider === ExternalStatusPageProviderType.Atom
    ) {
      return;
    }

    read();
  };

  const catalog: ExternalStatusPageCatalog | null =
    state.kind === "loaded" ? state.catalog : null;

  // The page's components a monitor of this group can pick.
  const offered: Array<ExternalStatusPageComponent> = catalog
    ? catalog.components.filter(
        (component: ExternalStatusPageComponent): boolean => {
          return ExternalStatusPageScope.isInGroup(
            component.groupName,
            props.componentGroupName,
          );
        },
      )
    : [];

  const choiceOptions: ComponentChoiceOptions =
    ExternalStatusPageComponentsCopy.getOptions({
      components: offered,
      translator: translator,
    });

  const options: Array<DropdownOption | DropdownOptionGroup> = [
    ...choiceOptions.ungrouped,
    ...choiceOptions.groups,
  ];

  // Each chosen name as the page spells it, when the page has it.
  const selected: Array<DropdownOption> = props.componentNames.map(
    (name: string): DropdownOption => {
      const onPage: ExternalStatusPageComponent | undefined = offered.find(
        (component: ExternalStatusPageComponent): boolean => {
          return (
            !ExternalStatusPageComponentNames.isPattern(name) &&
            ExternalStatusPageComponentNames.matchesComponent(
              name,
              component.name,
            )
          );
        },
      );
      const spelled: string = onPage ? onPage.name : name;

      return { value: spelled, label: spelled, isUserContent: true };
    },
  );

  const unmatched: Array<string> = catalog
    ? ExternalStatusPageComponentNames.unmatched(
        props.componentNames,
        offered.map((component: ExternalStatusPageComponent): string => {
          return component.name;
        }),
      )
    : [];

  const isFeed: boolean =
    props.provider === ExternalStatusPageProviderType.RSS ||
    props.provider === ExternalStatusPageProviderType.Atom;

  const noOptionsMessage: (inputValue: string) => string = (): string => {
    if (isFeed) {
      return ExternalStatusPageComponentsCopy.feedMessage(translator);
    }

    if (!host) {
      return ExternalStatusPageComponentsCopy.noAddressMessage(translator);
    }

    if (state.kind === "failed") {
      return ExternalStatusPageComponentsCopy.failureMessage(
        translator,
        state.problem,
        state.host,
      );
    }

    if (catalog && offered.length > 0) {
      return ExternalStatusPageComponentsCopy.allChosenMessage(translator);
    }

    return ExternalStatusPageComponentsCopy.typeNamesMessage(translator);
  };

  return (
    <div data-testid={COMPONENTS_FIELD_TEST_ID}>
      <FieldLabelElement
        id={props.labelId}
        title="Components"
        description={ExternalStatusPageComponentsCopy.DESCRIPTION}
        descriptionId={props.descriptionId}
        tooltip={ExternalStatusPageComponentsCopy.TOOLTIP}
        required={false}
      />
      <Dropdown
        isMultiSelect={true}
        isCreatable={true}
        /* Several are picked in a row: the list stays open for the next. */
        closeMenuOnSelect={false}
        ariaLabelledby={props.labelId}
        ariaDescribedby={props.descriptionId}
        placeholder="All components"
        options={options}
        value={selected}
        isLoading={state.kind === "loading"}
        loadingMessage={translator.translateTemplate(
          ExternalStatusPageComponentsCopy.READING,
          { host: host },
        )}
        noOptionsMessage={noOptionsMessage}
        formatCreateLabel={(inputValue: string): string => {
          return ExternalStatusPageComponentsCopy.addLabel(
            translator,
            inputValue,
          );
        }}
        onMenuOpen={onMenuOpen}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          const names: Array<string> = (
            Array.isArray(value) ? value : value === null ? [] : [value]
          ).map((item: DropdownValue): string => {
            return item.toString();
          });

          props.onChange(ExternalStatusPageComponentNames.normalize(names));
        }}
      />
      {state.kind === "loaded" && (
        <p
          className="mt-1 break-words text-xs text-gray-500"
          role="status"
          data-testid={COMPONENTS_STATUS_TEST_ID}
        >
          {ExternalStatusPageComponentsCopy.readSentence({
            translator: translator,
            count: offered.length,
            host: state.catalog.host,
            componentGroupName: props.componentGroupName,
          })}
        </p>
      )}
      {unmatched.length > 0 && (
        <p
          className="mt-1 flex items-start gap-1.5 break-words text-xs text-amber-700"
          data-testid={COMPONENTS_UNMATCHED_TEST_ID}
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-3.5 w-3.5 flex-none"
          />
          <span className="min-w-0">
            {ExternalStatusPageComponentsCopy.unmatchedSentence(
              translator,
              unmatched,
            )}
          </span>
        </p>
      )}
      {state.kind === "failed" && (
        <div
          className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500"
          role="status"
          data-testid={COMPONENTS_STATUS_TEST_ID}
          data-problem={state.problem}
        >
          <span className="min-w-0 break-words">
            {ExternalStatusPageComponentsCopy.failureMessage(
              translator,
              state.problem,
              state.host,
            )}
          </span>
          {ExternalStatusPageComponentsCopy.canTryAgain(state.problem) && (
            <button
              type="button"
              data-testid={COMPONENTS_RETRY_TEST_ID}
              onClick={(): void => {
                read();
              }}
              className="-mx-1 inline-flex flex-none items-center gap-1 rounded px-1 py-0.5 font-medium text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Icon icon={IconProp.Refresh} className="h-3 w-3" />
              <span>{translator.translateText("Try again")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ExternalStatusPageComponentsField;
