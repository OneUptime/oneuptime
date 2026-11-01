import {
  AUTOMATIC_REMEDIATION_SETTINGS_LINKS,
  AutomaticRemediationSettings,
  getAutomaticRemediationSentence,
} from "./AutomaticRemediationLine";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The project's automatic fixing switches, drawn: one sentence that says
 * which of new incidents and new alerts the project fixes automatically,
 * and a "Turn on" link for each switch that is off, to the signal's AI
 * settings page that holds it. A Kubernetes cluster's AI agent page, every
 * resource's, and a cloud account's Let AI fix problems dialog draw this
 * one component, so the words and the links never drift apart.
 */

export type AutomaticRemediationSwitch = keyof AutomaticRemediationSettings;

// Where each switch is turned on.
export const AUTOMATIC_REMEDIATION_SETTINGS_PAGES: Readonly<
  Record<AutomaticRemediationSwitch, PageMap>
> = {
  incidents: PageMap.INCIDENTS_SETTINGS_AI,
  alerts: PageMap.ALERTS_SETTINGS_AI,
};

const SWITCHES: ReadonlyArray<AutomaticRemediationSwitch> = [
  "incidents",
  "alerts",
];

export interface ComponentProps {
  settings: AutomaticRemediationSettings;
  dataTestId: string;
}

const AutomaticRemediationNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const sentence: string = getAutomaticRemediationSentence(props.settings);
  const switchesOff: Array<AutomaticRemediationSwitch> = SWITCHES.filter(
    (kind: AutomaticRemediationSwitch): boolean => {
      return !props.settings[kind];
    },
  );

  /*
   * Laid out by the room the note itself has, never the window: under a
   * resource's fixes beside the side menu (768 to 1100 wide) the box is a
   * few hundred pixels, in a dialog or a wide page it is not. The sentence
   * takes the line and at least 16rem of it; the links go beside it while
   * they fit, under it when they do not, and wrap one under the other on a
   * phone - never a sentence squeezed to a word a line, nor a link past
   * the box's edge.
   */
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border border-gray-200 px-3 py-2"
      data-testid={props.dataTestId}
    >
      <p
        className="min-w-0 flex-[1_1_16rem] text-xs leading-5 text-gray-600"
        data-testid={`${props.dataTestId}-sentence`}
      >
        {translator.translateText(sentence) || sentence}
      </p>
      {switchesOff.length > 0 ? (
        <div
          className="flex min-w-0 max-w-full flex-[0_1_auto] flex-wrap gap-x-4 gap-y-1"
          data-testid={`${props.dataTestId}-links`}
        >
          {switchesOff.map((kind: AutomaticRemediationSwitch): ReactElement => {
            return (
              <Link
                key={kind}
                to={RouteUtil.populateRouteParams(
                  RouteMap[AUTOMATIC_REMEDIATION_SETTINGS_PAGES[kind]] as Route,
                )}
                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-indigo-600 hover:text-indigo-800"
                dataTestId={`${props.dataTestId}-turn-on-${kind}`}
              >
                <span>
                  {translator.translateText(
                    AUTOMATIC_REMEDIATION_SETTINGS_LINKS[kind],
                  )}
                </span>
                <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
              </Link>
            );
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default AutomaticRemediationNote;
