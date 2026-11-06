import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { OPENSTACK_CREDENTIAL_STEP_ANCHOR } from "../../Pages/OpenStack/Utils/DocumentationMarkdown";
import { OpenStackAccessGap } from "../../Pages/OpenStack/Utils/OpenStackServices";

/*
 * What this credential can't list, and how to fix it. A list a credential cannot read
 * looks empty, and "0 hypervisors" would be a lie, so a page says what it could not read,
 * and links to where a better credential goes: the step of the guide that gives the agent
 * one, or a cloud's Settings page when a probe collects it. The fix is the same whatever is
 * closed, so it is said once.
 */

const OPENSTACK_ACCESS_CLOSED: string = translationKey(
  "Each service answers, and shows this credential none of them, so these are closed to it rather than empty.",
);

const OPENSTACK_ACCESS_TAKES_INFRASTRUCTURE: string = translationKey(
  "These take the Full view or Infrastructure only credential.",
);

// Infrastructure only never reads these, so a page must not send anyone to it for them.
const OPENSTACK_ACCESS_TAKES_FULL_VIEW: string = translationKey(
  "Cinder's services and storage pools take the Full view credential alone: Cinder's own code asks for an admin, whatever the policy says, so Infrastructure only goes without them.",
);

const OPENSTACK_ACCESS_FIX: string = translationKey(
  "To read them, give the agent that credential, then run troubleshoot.sh on its machine to see what it can read.",
);

const OPENSTACK_ACCESS_FIX_ON_A_PROBE: string = translationKey(
  "To read them, give the probe that credential with Edit Connection, and Test Connection says what it can read.",
);

export interface ComponentProps {
  gaps: Array<OpenStackAccessGap>;
  // The cloud's setup guide.
  documentationRoute: Route;
  // A probe collects this cloud, so the credential is on its Settings page.
  settingsRouteOfProbeCloud?: Route | null | undefined;
}

const OpenStackAccessNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.gaps.length === 0) {
    return <></>;
  }

  const words: Array<string> = [
    OPENSTACK_ACCESS_CLOSED,
    ...(props.gaps.some((gap: OpenStackAccessGap): boolean => {
      return !gap.isFullViewOnly;
    })
      ? [OPENSTACK_ACCESS_TAKES_INFRASTRUCTURE]
      : []),
    ...(props.gaps.some((gap: OpenStackAccessGap): boolean => {
      return gap.isFullViewOnly;
    })
      ? [OPENSTACK_ACCESS_TAKES_FULL_VIEW]
      : []),
    props.settingsRouteOfProbeCloud
      ? OPENSTACK_ACCESS_FIX_ON_A_PROBE
      : OPENSTACK_ACCESS_FIX,
  ];

  return (
    <div
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm"
      data-testid="openstack-access-notice"
    >
      <div className="flex items-start gap-3">
        <Icon
          icon={IconProp.Alert}
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600"
        />
        <div className="min-w-0 flex-1">
          <ul className="space-y-1">
            {props.gaps.map((gap: OpenStackAccessGap): ReactElement => {
              return (
                <li
                  key={gap.key}
                  data-testid="openstack-access-gap"
                  data-key={gap.key}
                  className="text-sm font-medium text-amber-900"
                >
                  {translator.translateText(gap.title) || gap.title}
                </li>
              );
            })}
          </ul>
          <p
            className="mt-2 text-sm text-amber-800"
            data-testid="openstack-access-fix"
          >
            {words
              .map((word: string): string => {
                return translator.translateText(word) || word;
              })
              .join(" ")}
          </p>
          <Link
            to={
              props.settingsRouteOfProbeCloud ||
              getRouteToPageAnchor(
                props.documentationRoute,
                OPENSTACK_CREDENTIAL_STEP_ANCHOR,
              )
            }
            dataTestId="openstack-access-guide"
            className="mt-3 inline-flex text-sm font-medium text-amber-900 underline hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {props.settingsRouteOfProbeCloud
              ? translator.translateText("Open Data Collection")
              : translator.translateText("See which credential can read what")}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default OpenStackAccessNotice;
