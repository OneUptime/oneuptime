import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import IconProp from "Common/Types/Icon/IconProp";
import {
  LlmConnectionDefinition,
  LlmConnectionKind,
  getLlmConnectionDefinitionsOfKind,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import LockedReason, {
  LOCKED_CONTROL_CLASS_NAME,
} from "Common/UI/Components/Tooltip/LockedReason";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import LlmConnectionLogo from "./LlmConnectionLogo";

/*
 * The providers or tools of one kind, one tile each: what connecting it
 * does, and whether the project has connected it already. A click opens
 * that provider's form. A provider can be connected more than once (two
 * OpenAI organizations, two Azure subscriptions).
 */

export interface ComponentProps {
  kind: LlmConnectionKind;
  connectionCounts: Partial<Record<LlmConnectionProvider, number>>;
  canConnect: boolean;
  /*
   * Why connecting is refused, as the permission check (PermissionGate)
   * words it: in the reader's language already, so its tooltip draws it as
   * given (#8423).
   */
  connectDisabledReason?: string | undefined;
  onConnect: (provider: LlmConnectionProvider) => void;
}

const LlmConnectionTiles: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const definitions: Array<LlmConnectionDefinition> =
    getLlmConnectionDefinitionsOfKind(props.kind);

  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid={`llm-connection-tiles-${props.kind}`}
    >
      {definitions.map((definition: LlmConnectionDefinition): ReactElement => {
        const count: number = props.connectionCounts[definition.provider] || 0;

        // Locked with a reason: the wrapper around it takes the pointer.
        const isExplainedLock: boolean =
          !props.canConnect && Boolean(props.connectDisabledReason);

        const tile: ReactElement = (
          <button
            type="button"
            disabled={!props.canConnect}
            data-testid={`llm-connection-tile-${definition.provider}`}
            onClick={() => {
              props.onConnect(definition.provider);
            }}
            className={`flex h-full w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
              {
                isLocked: !props.canConnect,
                hoverClassName: "hover:border-indigo-300 hover:shadow",
              },
            )}${isExplainedLock ? ` ${LOCKED_CONTROL_CLASS_NAME}` : ""}`}
          >
            <LlmConnectionLogo provider={definition.provider} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-gray-900">
                  {translator.translateText(definition.title)}
                </span>
                {count > 0 ? (
                  <Pill
                    dataTestId={`llm-connection-tile-connected-${definition.provider}`}
                    text={
                      count > 1
                        ? translator.translateTemplate(
                            "Connected ({{count}})",
                            {
                              count: String(count),
                            },
                          )
                        : translator.translateText("Connected") ?? "Connected"
                    }
                    isUserContent={true}
                    tone={PillTone.Success}
                    icon={IconProp.Check}
                  />
                ) : (
                  <></>
                )}
              </div>
              <div className="mt-1 text-sm text-gray-600">
                {translator.translateText(definition.description)}
              </div>
              <div className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-600">
                {count > 0
                  ? translator.translateText("Connect another")
                  : translator.translateText("Connect")}
                <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
              </div>
            </div>
          </button>
        );

        return (
          <li key={definition.provider} className="min-w-0">
            {isExplainedLock && props.connectDisabledReason ? (
              <LockedReason
                reason={props.connectDisabledReason}
                layoutClassName="flex h-full w-full"
                dataTestId={`llm-connection-tile-locked-${definition.provider}`}
              >
                {tile}
              </LockedReason>
            ) : (
              tile
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default LlmConnectionTiles;
