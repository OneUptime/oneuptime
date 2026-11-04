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
 * and links to the step of the guide that gives the agent a credential that can. The fix
 * is the same whatever is closed, so it is said once.
 */

const OPENSTACK_ACCESS_FIX: string = translationKey(
  "Each service answers, and shows this credential none of them, so these are closed to it rather than empty. They take the Full view or Infrastructure only credential. Give the agent one of those, then run troubleshoot.sh on its machine to see what it can read.",
);

export interface ComponentProps {
  gaps: Array<OpenStackAccessGap>;
  // The cloud's setup guide.
  documentationRoute: Route;
}

const OpenStackAccessNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.gaps.length === 0) {
    return <></>;
  }

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
            {translator.translateText(OPENSTACK_ACCESS_FIX) ||
              OPENSTACK_ACCESS_FIX}
          </p>
          <Link
            to={getRouteToPageAnchor(
              props.documentationRoute,
              OPENSTACK_CREDENTIAL_STEP_ANCHOR,
            )}
            dataTestId="openstack-access-guide"
            className="mt-3 inline-flex text-sm font-medium text-amber-900 underline hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {translator.translateText("See which credential can read what") ||
              "See which credential can read what"}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default OpenStackAccessNotice;
