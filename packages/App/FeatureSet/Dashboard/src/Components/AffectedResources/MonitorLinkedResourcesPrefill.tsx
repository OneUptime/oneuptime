import {
  AffectedResourcesPayloadKey,
  buildPrefillPayload,
  getLinkedResourcesOfMonitors,
  getLinkedResourcesToAdd,
  getPrefilledResourcesStillPresent,
  MONITOR_LINKED_RESOURCES_SELECT,
  MonitorLinkedResource,
  PREFILLED_FROM_MONITORS_LABEL,
  UNNAMED_LINKED_RESOURCE,
} from "./MonitorLinkedResourcesPrefillRules";
import { getMonitorIdsFromFormValue } from "../StatusPage/StatusPageSuggestionRules";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Includes from "Common/Types/BaseDatabase/Includes";
import { FieldFooterProps } from "Common/UI/Components/Forms/Types/Field";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * What the form has already done, kept by the page rather than by this
 * footer: a wizard unmounts a step's fields when someone moves to another
 * step, and a monitor's resources must not come back when they return to
 * this one after removing some of them.
 */
export interface MonitorLinkedResourcesPrefillState {
  // Monitors whose linked resources were read (or are being read).
  seenMonitorIds: Set<string>;
  // What was added, for the line under the field.
  added: Array<MonitorLinkedResource>;
}

export const useMonitorLinkedResourcesPrefillState: () => MutableRefObject<MonitorLinkedResourcesPrefillState> =
  (): MutableRefObject<MonitorLinkedResourcesPrefillState> => {
    return useRef<MonitorLinkedResourcesPrefillState>({
      seenMonitorIds: new Set<string>(),
      added: [],
    });
  };

export interface ComponentProps {
  // The picked monitors, in whatever shape the form holds them.
  monitorIds: unknown;
  // The form's values as they are now.
  values: Record<string, unknown>;
  // Sets the Other Affected Resources field the way picking in it would.
  footer?: FieldFooterProps | undefined;
  // The relations that field writes.
  payloadKeys: Array<AffectedResourcesPayloadKey>;
  state: MutableRefObject<MonitorLinkedResourcesPrefillState>;
}

/*
 * Drawn under a create form's Other Affected Resources: adds what the
 * picked monitors are linked to (MonitorLinkedResourcesPrefillRules), and
 * says what it added that the form still holds.
 */
const MonitorLinkedResourcesPrefill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // The latest values and setter, for an answer that lands later.
  const valuesRef: MutableRefObject<Record<string, unknown>> = useRef<
    Record<string, unknown>
  >(props.values);
  valuesRef.current = props.values;
  const footerRef: MutableRefObject<FieldFooterProps | undefined> = useRef<
    FieldFooterProps | undefined
  >(props.footer);
  footerRef.current = props.footer;

  const [, setAddedCount] = useState<number>(0);

  const monitorIds: Array<string> = getMonitorIdsFromFormValue(
    props.monitorIds,
  );
  const monitorIdsKey: string = monitorIds.join(",");

  useEffect(() => {
    const state: MonitorLinkedResourcesPrefillState = props.state.current;
    const newMonitorIds: Array<string> = monitorIds.filter(
      (id: string): boolean => {
        return !state.seenMonitorIds.has(id);
      },
    );

    if (newMonitorIds.length === 0) {
      return;
    }

    for (const id of newMonitorIds) {
      state.seenMonitorIds.add(id);
    }

    ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        _id: new Includes(newMonitorIds),
      } as Query<Monitor>,
      select: MONITOR_LINKED_RESOURCES_SELECT as Select<Monitor>,
      limit: newMonitorIds.length,
      skip: 0,
      sort: {},
    })
      .then((result: ListResult<Monitor>): void => {
        const toAdd: Array<MonitorLinkedResource> = getLinkedResourcesToAdd({
          values: valuesRef.current,
          linked: getLinkedResourcesOfMonitors(result.data),
        });

        if (toAdd.length === 0 || !footerRef.current) {
          return;
        }

        state.added.push(...toAdd);
        footerRef.current.setValue(
          buildPrefillPayload({
            values: valuesRef.current,
            toAdd: toAdd,
            payloadKeys: props.payloadKeys,
          }),
        );
        setAddedCount(state.added.length);
      })
      .catch((): void => {
        /*
         * Prefilling is a convenience: on a failed read the form is as it
         * was, and the monitors may be read again if picked again.
         */
        for (const id of newMonitorIds) {
          state.seenMonitorIds.delete(id);
        }
      });
  }, [monitorIdsKey]);

  const stillPresent: Array<MonitorLinkedResource> =
    getPrefilledResourcesStillPresent({
      values: props.values,
      added: props.state.current.added,
    });

  if (stillPresent.length === 0) {
    return <></>;
  }

  return (
    <p
      className="mt-2 text-sm text-gray-500"
      data-testid="monitor-linked-resources-prefilled"
    >
      {translator.translatePlural(
        PREFILLED_FROM_MONITORS_LABEL,
        monitorIds.length || 1,
        {
          names: stillPresent
            .map((resource: MonitorLinkedResource): string => {
              return (
                resource.name ||
                translator.translateText(UNNAMED_LINKED_RESOURCE) ||
                UNNAMED_LINKED_RESOURCE
              );
            })
            .join(", "),
        },
      )}
    </p>
  );
};

export default MonitorLinkedResourcesPrefill;
