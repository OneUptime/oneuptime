import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { DOCS_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Protocol from "Common/Types/API/Protocol";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * "There are no recordings — what now?"
 *
 * Shown in place of an empty session list. An empty list has two very
 * different causes and the list itself cannot tell them apart: either the
 * recorder was never installed, or it is installed and working and simply
 * has not seen a session worth uploading yet (the default capture trigger
 * only uploads when something goes wrong, so a healthy hour produces
 * nothing). Somebody looking at zero rows needs both explanations and the
 * snippet, right there — not a link to go and find them.
 *
 * The install snippet is duplicated from InstallationTestPanel rather than
 * shared, and deliberately so for now: that panel's version is rendered
 * from server-confirmed ingest status and belongs with its checks, while
 * this one is a first-run instruction. If a third copy ever appears, they
 * should be pulled into one component.
 */

/*
 * The identifier is interpolated into an HTML attribute the customer will
 * copy-paste into their own page, and it originates from whatever
 * service.name arrived on telemetry — attacker-writable with a scraped
 * ingestion key. Anything outside this closed charset is not interpolated.
 * Same guard, and the same reason, as InstallationTestPanel.
 */
const SAFE_APP_IDENTIFIER: RegExp = new RegExp("^[A-Za-z0-9._-]{1,100}$");

export interface ComponentProps {
  rumApplicationId: ObjectID;
}

function Step(props: {
  index: number;
  title: string;
  children: ReactElement | Array<ReactElement>;
}): ReactElement {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
        {props.index}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <div className="text-sm font-medium text-gray-900">{props.title}</div>
        <div className="mt-1.5 text-sm text-gray-600">{props.children}</div>
      </div>
    </div>
  );
}

function CodeBlock(props: { children: string }): ReactElement {
  return (
    <pre className="mt-2 overflow-x-auto whitespace-pre rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
      {props.children}
    </pre>
  );
}

const SessionReplaySetupGuide: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [appIdentifier, setAppIdentifier] = useState<string>("");

  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const oneuptimeUrl: string = HOST
    ? `${httpProtocol}://${HOST}`
    : "<YOUR_ONEUPTIME_URL>";

  useEffect(() => {
    /*
     * Best-effort: the guide is useful without the real identifier, so a
     * failure here leaves the placeholder in the snippet rather than
     * replacing the whole page with an error. The list above has already
     * loaded successfully, so a failure here is not the user's problem to
     * solve.
     */
    ModelAPI.getItem<RumApplication>({
      modelType: RumApplication,
      id: props.rumApplicationId,
      select: {
        appIdentifier: true,
      },
    })
      .then((item: RumApplication | null): void => {
        setAppIdentifier((item?.appIdentifier as string) || "");
      })
      .catch((): void => {
        /*
         * Swallowed on purpose, and nothing is rendered about it. The
         * snippet keeps its YOUR_APP_IDENTIFIER placeholder, which is
         * still correct instructions - surfacing an error here would put
         * a failure banner on a page whose entire job is to explain how
         * to get started.
         */
        setAppIdentifier("");
      });
  }, [props.rumApplicationId.toString()]);

  const identifierForSnippet: string = SAFE_APP_IDENTIFIER.test(appIdentifier)
    ? appIdentifier
    : "YOUR_APP_IDENTIFIER";

  return (
    <Card
      title="No recordings yet — here's how to get them"
      description="Session replay needs one script tag on your site. Nothing is recorded until it loads."
    >
      <div className="mt-2">
        <Step index={1} title="Create a telemetry ingestion key">
          <>
            The recorder authenticates with an ingestion key. Create one under{" "}
            <Link
              className="text-indigo-600 hover:text-indigo-800"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route,
              )}
            >
              Project Settings → Telemetry Ingestion Keys
            </Link>
            , then open it to read the token. It sits in your page&apos;s
            JavaScript, so treat it as public — it grants ingestion only and
            cannot read anything back out of your project.
          </>
        </Step>

        <Step index={2} title="Add the script tag to your site">
          <>
            Put this in your page&apos;s <code>&lt;head&gt;</code>, on every
            page you want recorded.
            <CodeBlock>
              {`<script
  src="${oneuptimeUrl}/telemetry/session-replay/v1/recorder.js"
  data-oneuptime-host="${oneuptimeUrl}"
  data-oneuptime-token="YOUR_TELEMETRY_INGESTION_KEY"
  data-oneuptime-app-identifier="${identifierForSnippet}"
  async
></script>`}
            </CodeBlock>
            <div className="mt-2">
              <code>data-oneuptime-app-identifier</code> must match this
              application&apos;s identifier — the same value you use for{" "}
              <code>service.name</code>.
            </div>
          </>
        </Step>

        <Step index={3} title="Allow the recorder through your CSP">
          <>
            If your site sets a Content-Security-Policy,{" "}
            <code>script-src &apos;self&apos;</code> blocks the recorder from
            loading and <code>connect-src &apos;self&apos;</code> blocks it from
            uploading. Both fail silently in your users&apos; browsers, so this
            is the most common cause of a list that stays empty. Allow:
            <CodeBlock>
              {`script-src  ${oneuptimeUrl};
connect-src ${oneuptimeUrl};`}
            </CodeBlock>
          </>
        </Step>

        <Step index={4} title="Trigger something worth recording">
          <>
            By default the recorder keeps a rolling buffer in memory and only
            uploads when an error or a frustration signal (rage click, dead
            click, refresh rage) fires. A visit where nothing goes wrong
            produces no recording at all — that is the intended behaviour, not a
            broken install. To record every session instead, set the capture
            trigger to <em>Always</em> or raise the sample percentage in this
            application&apos;s settings.
          </>
        </Step>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-start gap-2">
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
          />
          <div className="text-xs text-gray-600">
            <span className="font-medium text-gray-800">
              Still empty after all that?
            </span>{" "}
            The server cannot see a recorder that never loaded, so the
            installation test under Real User Monitoring &gt; Settings &gt;
            Session Replay is the definitive check — it reports every switch and
            the moment the last chunk actually landed.
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            title="Run the installation test"
            icon={IconProp.Check}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={(): void => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route,
                ),
              );
            }}
          />
          <Button
            title="This application's settings"
            icon={IconProp.Settings}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={(): void => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[
                    PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
                  ] as Route,
                  { modelId: props.rumApplicationId },
                ),
              );
            }}
          />
          {/*
           * A Link rather than a Button: the docs live on a different
           * host, and Navigation.navigate is for in-app routes. Styled to
           * sit level with the two buttons beside it.
           */}
          <Link
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            openInNewTab={true}
            to={URL.fromString(
              `${DOCS_URL.toString()}/telemetry/session-replay`,
            )}
          >
            <>
              <Icon icon={IconProp.Book} className="h-4 w-4" />
              Full documentation
            </>
          </Link>
        </div>
      </div>
    </Card>
  );
};

export default SessionReplaySetupGuide;
