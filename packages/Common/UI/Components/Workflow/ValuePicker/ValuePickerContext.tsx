/*
 * Everything the value picker needs to know about where it is: the step being
 * edited, the steps that run before it, the workflow's variables.
 *
 * A step's settings form provides this once (ArgumentsForm), and every field
 * in it - a message box, a key/value row, a cell of the record editor - reads
 * it, rather than each being handed a list of strings to offer.
 */

import ObjectID from "../../../../Types/ObjectID";
import {
  ComponentType,
  NodeDataProp,
} from "../../../../Types/Workflow/Component";
import {
  ParsedReferencePath,
  ReferenceRootType,
  parseReferencePath,
} from "../../../../Types/Workflow/TemplateSyntax";
import API from "../../../Utils/API/API";
import { createDefaultValueSources } from "./DefaultValueSources";
import {
  ReferenceDescription,
  describeReference as describeReferenceFor,
} from "./ReferenceDescription";
import { StepValueSources } from "./StepGraph";
import {
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionSource,
  mergeSuggestionGroups,
} from "./ValueSuggestion";
import { VARIABLE_SOURCE_ID } from "./VariableValueSource";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export enum ChildrenStatus {
  Idle = "Idle",
  Loading = "Loading",
  Loaded = "Loaded",
  Failed = "Failed",
}

export interface ChildrenState {
  status: ChildrenStatus;
  items: Array<ValueSuggestion>;
  error?: string | undefined;
}

const IDLE_CHILDREN: ChildrenState = { status: ChildrenStatus.Idle, items: [] };

export interface ValuePickerContextValue {
  /** False outside a provider: there is nothing to pick from. */
  isAvailable: boolean;
  /** Every group from every source, merged and in order. */
  groups: Array<ValueSuggestionGroup>;
  /** True while a source that needs a request is still loading. */
  isLoading: boolean;
  /** One sentence per source that failed to load. */
  loadErrors: Array<string>;
  /** False while nothing is connected into the step: it can only read the trigger. */
  hasIncomingConnection: boolean;
  /** The step being edited is a trigger, which runs first and reads nothing. */
  isTrigger: boolean;
  /** The chip's words for a reference; null for text that is not a chip. */
  describeReference: (reference: string) => ReferenceDescription | null;
  getChildren: (item: ValueSuggestion) => ChildrenState;
  /** Start loading what is inside a value. Does nothing if it already has. */
  loadChildren: (item: ValueSuggestion) => void;
  /**
   * Ask one source again, keeping what it gave until the new answer is in:
   * the list does this while a note waits for something that can arrive at
   * any moment, such as a webhook's first request.
   */
  refreshSource: (sourceId: string) => void;
}

const DEFAULT_CONTEXT: ValuePickerContextValue = {
  isAvailable: false,
  groups: [],
  isLoading: false,
  loadErrors: [],
  hasIncomingConnection: true,
  isTrigger: false,
  describeReference: (reference: string) => {
    return describeReferenceFor(reference, {});
  },
  getChildren: () => {
    return IDLE_CHILDREN;
  },
  loadChildren: () => {},
  refreshSource: () => {},
};

const ValuePickerContext: React.Context<ValuePickerContextValue> =
  React.createContext<ValuePickerContextValue>(DEFAULT_CONTEXT);

export type UseValuePickerFunction = () => ValuePickerContextValue;

export const useValuePicker: UseValuePickerFunction =
  (): ValuePickerContextValue => {
    return useContext(ValuePickerContext);
  };

export interface ValuePickerProviderProps {
  workflowId?: ObjectID | undefined;
  /** The step whose settings are open. */
  component?: NodeDataProp | undefined;
  /** Every step in the workflow, for naming references. */
  graphComponents: Array<NodeDataProp>;
  /**
   * Which steps run before and after this one (see StepGraph). Without it the
   * picker cannot tell, and offers every other step.
   */
  valueSources?: StepValueSources | undefined;
  /**
   * Where values come from. Defaults to the steps, what they held the last
   * times they ran, and the variables.
   */
  sources?: Array<ValueSuggestionSource> | undefined;
  /**
   * The workflow's webhook URL, when the reader may see it, so a Webhook
   * nothing has called yet can offer a test request to copy.
   */
  webhookUrl?: string | undefined;
  children: ReactNode;
}

interface LoadedGroups {
  groups: Array<ValueSuggestionGroup>;
  error?: string | undefined;
  isLoading: boolean;
  /** A background source's: never shown as loading or as failed. */
  isBackground?: boolean | undefined;
}

export const ValuePickerProvider: FunctionComponent<
  ValuePickerProviderProps
> = (props: ValuePickerProviderProps): ReactElement => {
  const [defaultSources] = useState<Array<ValueSuggestionSource>>(() => {
    return createDefaultValueSources();
  });

  const sources: Array<ValueSuggestionSource> = props.sources || defaultSources;

  const editedId: string | undefined = props.component?.id;

  const upstreamComponents: Array<NodeDataProp> = useMemo(() => {
    if (props.valueSources) {
      return props.valueSources.upstream;
    }

    return (props.graphComponents || []).filter((step: NodeDataProp) => {
      return Boolean(step?.id) && step.id !== editedId;
    });
  }, [props.valueSources, props.graphComponents, editedId]);

  const suggestionContext: ValueSuggestionContext = useMemo(() => {
    return {
      workflowId: props.workflowId,
      component: props.component,
      upstreamComponents: upstreamComponents,
      webhookUrl: props.webhookUrl,
    };
  }, [
    props.workflowId?.toString(),
    props.component,
    upstreamComponents,
    props.webhookUrl,
  ]);

  /*
   * What a refresh reads: the context and sources as they are when it runs,
   * not as they were when the list opened.
   */
  const suggestionContextRef: React.MutableRefObject<ValueSuggestionContext> =
    useRef<ValueSuggestionContext>(suggestionContext);
  suggestionContextRef.current = suggestionContext;

  const sourcesRef: React.MutableRefObject<Array<ValueSuggestionSource>> =
    useRef<Array<ValueSuggestionSource>>(sources);
  sourcesRef.current = sources;

  const syncGroups: Array<ValueSuggestionGroup> = useMemo(() => {
    return sources.flatMap((source: ValueSuggestionSource) => {
      return source.getGroups ? source.getGroups(suggestionContext) : [];
    });
  }, [sources, suggestionContext]);

  /*
   * The sources that need a request load as the settings open, so the list is
   * ready by the time anyone opens it. Keyed on what they are told, so a
   * different step or workflow loads again.
   */
  const loadKey: string = [
    props.workflowId?.toString() || "",
    editedId || "",
    upstreamComponents
      .map((step: NodeDataProp) => {
        return step.id;
      })
      .join(","),
    props.webhookUrl || "",
  ].join("|");

  const [loaded, setLoaded] = useState<Record<string, LoadedGroups>>({});

  /*
   * Bumped whenever the sources are asked afresh, so a refresh still in
   * flight from before cannot overwrite what they now say.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  const refreshingRef: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set<string>());

  useEffect(() => {
    let cancelled: boolean = false;
    loadGenerationRef.current++;
    refreshingRef.current = new Set<string>();

    const asyncSources: Array<ValueSuggestionSource> = sources.filter(
      (source: ValueSuggestionSource) => {
        return Boolean(source.loadGroups);
      },
    );

    setLoaded(() => {
      const next: Record<string, LoadedGroups> = {};

      for (const source of asyncSources) {
        next[source.id] = {
          groups: [],
          isLoading: true,
          isBackground: Boolean(source.isBackground),
        };
      }

      return next;
    });

    type LoadSourceFunction = (source: ValueSuggestionSource) => Promise<void>;

    const loadSource: LoadSourceFunction = async (
      source: ValueSuggestionSource,
    ): Promise<void> => {
      try {
        const groups: Array<ValueSuggestionGroup> =
          await source.loadGroups!(suggestionContext);

        if (!cancelled) {
          setLoaded((previous: Record<string, LoadedGroups>) => {
            return {
              ...previous,
              [source.id]: {
                groups: groups,
                isLoading: false,
                isBackground: Boolean(source.isBackground),
              },
            };
          });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setLoaded((previous: Record<string, LoadedGroups>) => {
            return {
              ...previous,
              [source.id]: {
                groups: [],
                isLoading: false,
                isBackground: Boolean(source.isBackground),
                error: API.getFriendlyMessage(err),
              },
            };
          });
        }
      }
    };

    asyncSources.forEach((source: ValueSuggestionSource) => {
      void loadSource(source);
    });

    return () => {
      cancelled = true;
    };
  }, [loadKey, sources]);

  const groups: Array<ValueSuggestionGroup> = useMemo(() => {
    return mergeSuggestionGroups([
      ...syncGroups,
      ...Object.values(loaded).flatMap((entry: LoadedGroups) => {
        return entry.groups;
      }),
    ]);
  }, [syncGroups, loaded]);

  // A background source is never waited on, nor reported when it fails.
  const isLoading: boolean = Object.values(loaded).some(
    (entry: LoadedGroups) => {
      return entry.isLoading && !entry.isBackground;
    },
  );

  const loadErrors: Array<string> = Object.values(loaded)
    .filter((entry: LoadedGroups) => {
      return !entry.isBackground;
    })
    .map((entry: LoadedGroups) => {
      return entry.error;
    })
    .filter((error: string | undefined): error is string => {
      return Boolean(error);
    });

  const refreshSource: (sourceId: string) => void = useCallback(
    (sourceId: string): void => {
      const source: ValueSuggestionSource | undefined = sourcesRef.current.find(
        (candidate: ValueSuggestionSource) => {
          return candidate.id === sourceId && Boolean(candidate.loadGroups);
        },
      );

      // One request at a time per source: a slow answer is not asked over.
      if (!source || refreshingRef.current.has(sourceId)) {
        return;
      }

      const generation: number = loadGenerationRef.current;
      const refreshing: Set<string> = refreshingRef.current;

      refreshing.add(sourceId);

      void (async (): Promise<void> => {
        try {
          const groups: Array<ValueSuggestionGroup> = await source.loadGroups!(
            suggestionContextRef.current,
          );

          if (generation !== loadGenerationRef.current) {
            return;
          }

          setLoaded((previous: Record<string, LoadedGroups>) => {
            return {
              ...previous,
              [sourceId]: {
                groups: groups,
                isLoading: false,
                isBackground: Boolean(source.isBackground),
              },
            };
          });
        } catch {
          // Keep what it said last; the next refresh asks again.
        } finally {
          refreshing.delete(sourceId);
        }
      })();
    },
    [],
  );

  /*
   * The variable names that exist, for flagging a reference to one that does
   * not. Only once the variables have actually loaded: a failed or pending
   * load says nothing about which names exist.
   */
  const variableNames:
    | { workflow: Array<string>; global: Array<string> }
    | undefined = useMemo(() => {
    const variables: LoadedGroups | undefined = loaded[VARIABLE_SOURCE_ID];

    if (!variables || variables.isLoading || variables.error) {
      return undefined;
    }

    const names: { workflow: Array<string>; global: Array<string> } = {
      workflow: [],
      global: [],
    };

    for (const group of variables.groups) {
      for (const item of group.items) {
        const parsed: ParsedReferencePath = parseReferencePath(
          item.reference.slice(2, -2),
        );

        if (parsed.rootType === ReferenceRootType.LocalVariable) {
          names.workflow.push(parsed.variableName || "");
        }

        if (parsed.rootType === ReferenceRootType.GlobalVariable) {
          names.global.push(parsed.variableName || "");
        }
      }
    }

    return names;
  }, [loaded]);

  const downstreamIds: Array<string> | undefined =
    props.valueSources?.downstreamIds;

  const describeReference: (reference: string) => ReferenceDescription | null =
    useCallback(
      (reference: string): ReferenceDescription | null => {
        return describeReferenceFor(reference, {
          graphComponents: props.graphComponents,
          editedComponentId: editedId,
          downstreamIds: downstreamIds,
          variableNames: variableNames,
        });
      },
      [props.graphComponents, editedId, downstreamIds, variableNames],
    );

  const [childrenByReference, setChildrenByReference] = useState<
    Record<string, ChildrenState>
  >({});

  /*
   * What has been asked for, kept outside state: two asks before the next
   * render would both see an idle entry in state, and load it twice.
   */
  const requestedRef: React.MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  const getChildren: (item: ValueSuggestion) => ChildrenState = useCallback(
    (item: ValueSuggestion): ChildrenState => {
      return childrenByReference[item.reference] || IDLE_CHILDREN;
    },
    [childrenByReference],
  );

  const loadChildren: (item: ValueSuggestion) => void = useCallback(
    (item: ValueSuggestion): void => {
      const loader: (() => Promise<Array<ValueSuggestion>>) | undefined =
        item.drillIn?.loadChildren;

      if (!loader || requestedRef.current.has(item.reference)) {
        return;
      }

      requestedRef.current.add(item.reference);

      setChildrenByReference((previous: Record<string, ChildrenState>) => {
        return {
          ...previous,
          [item.reference]: { status: ChildrenStatus.Loading, items: [] },
        };
      });

      void (async (): Promise<void> => {
        try {
          const items: Array<ValueSuggestion> = await loader();

          setChildrenByReference((previous: Record<string, ChildrenState>) => {
            return {
              ...previous,
              [item.reference]: { status: ChildrenStatus.Loaded, items: items },
            };
          });
        } catch (err: unknown) {
          // Asked again - the list opened again - it is tried again.
          requestedRef.current.delete(item.reference);

          setChildrenByReference((previous: Record<string, ChildrenState>) => {
            return {
              ...previous,
              [item.reference]: {
                status: ChildrenStatus.Failed,
                items: [],
                error: API.getFriendlyMessage(err),
              },
            };
          });
        }
      })();
    },
    [],
  );

  const value: ValuePickerContextValue = useMemo(() => {
    return {
      isAvailable: true,
      groups: groups,
      isLoading: isLoading,
      loadErrors: loadErrors,
      hasIncomingConnection: props.valueSources
        ? props.valueSources.hasIncomingConnection
        : true,
      isTrigger: props.component?.componentType === ComponentType.Trigger,
      describeReference: describeReference,
      getChildren: getChildren,
      loadChildren: loadChildren,
      refreshSource: refreshSource,
    };
  }, [
    groups,
    isLoading,
    loadErrors.join("\n"),
    props.valueSources,
    props.component?.componentType,
    describeReference,
    getChildren,
    loadChildren,
    refreshSource,
  ]);

  return (
    <ValuePickerContext.Provider value={value}>
      {props.children}
    </ValuePickerContext.Provider>
  );
};

export default ValuePickerContext;
