import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import InstallationHealthUtil, {
  INSTALLATION_HEALTH_ALL_RIGHT,
  InstallationHealthAnswer,
  InstallationHealthFinding,
  InstallationHealthLevel,
} from "Common/Types/InstallationHealth/InstallationHealth";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/Types/Translator";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT NEEDS ATTENTION ON THIS SERVER, AT THE TOP OF ONEUPTIME HEALTH (#6826).
 *
 * The same findings `npm run doctor` prints and diagnose.sh prints on
 * Kubernetes (Common/Types/InstallationHealth): PostgreSQL, ClickHouse and
 * Valkey, the migrations, ClickHouse's disk, the queues, the version, and the
 * server setup checklist's open steps, worst first, each with its fix. This
 * card reads them with a GET of /admin/health/doctor, as a master admin; those
 * two ask with a POST and the cluster key. Every edition: the yes/no answers
 * and their fixes are not an upsell; the live charts and the deep pages below
 * keep their edition rules.
 *
 * The checklist's steps are said in its own words and fixed on its own page
 * (/admin/setup): this card does not become a second checklist.
 */

export const INSTALLATION_HEALTH_API_ROUTE: string = "/admin/health/doctor";

export const INSTALLATION_HEALTH_COPY: {
  title: string;
  description: string;
  allRight: string;
  loadError: string;
  readTheGuide: string;
} = {
  title: translationKey("What needs attention"),
  description: translationKey(
    "Checked just now, worst first. On the server, npm run doctor also checks the containers, the address and the certificate.",
  ),
  allRight: INSTALLATION_HEALTH_ALL_RIGHT,
  loadError: translationKey(
    "What needs attention could not be read. Reload the page to try again.",
  ),
  readTheGuide: translationKey("Read the guide"),
};

// The card's state: still loading, the answer, or a read that failed.
export type InstallationHealthState =
  | { kind: "loading" }
  | { kind: "answer"; answer: InstallationHealthAnswer }
  | { kind: "failed" };

export const readInstallationHealth: () => Promise<InstallationHealthState> =
  async (): Promise<InstallationHealthState> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            INSTALLATION_HEALTH_API_ROUTE,
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        return { kind: "failed" };
      }

      const answer: InstallationHealthAnswer | null =
        InstallationHealthUtil.parseAnswer(response.data);

      return answer ? { kind: "answer", answer: answer } : { kind: "failed" };
    } catch {
      return { kind: "failed" };
    }
  };

// A step of the server setup checklist: fixed on its page.
export const isServerSetupFinding: (
  finding: InstallationHealthFinding,
) => boolean = (finding: InstallationHealthFinding): boolean => {
  return finding.id.startsWith("setup-");
};

export const FindingRow: FunctionComponent<{
  finding: InstallationHealthFinding;
}> = (props: { finding: InstallationHealthFinding }): ReactElement => {
  const translator: Translator = useTranslator();
  const finding: InstallationHealthFinding = props.finding;
  const isFix: boolean = finding.level === InstallationHealthLevel.Fix;
  const title: string = translator.translateTemplate(finding.title);
  const fix: string | null = finding.fix
    ? translator.translateTemplate(finding.fix, finding.values)
    : null;

  return (
    <li
      className="flex items-start gap-3 px-4 py-3"
      data-testid={`installation-health-${finding.id}`}
      data-level={finding.level}
    >
      <Icon
        icon={isFix ? IconProp.CircleClose : IconProp.ExclaimationCircle}
        size={SizeProp.Regular}
        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${isFix ? "text-red-500" : "text-amber-500"}`}
      />
      <div className="min-w-0 space-y-1 text-sm">
        <div className="text-gray-900">
          {finding.adminPath && !isServerSetupFinding(finding) ? (
            <Link
              to={new Route(finding.adminPath)}
              className="font-semibold text-indigo-600 hover:underline"
            >
              {title}
            </Link>
          ) : (
            <span className="font-semibold">{title}</span>
          )}
          <span className="text-gray-700">
            {" "}
            {translator.translateTemplate(finding.words, finding.values)}
          </span>
        </div>
        {fix && isServerSetupFinding(finding) ? (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVER_SETUP] as Route,
            )}
            className="text-indigo-600 hover:underline"
          >
            {fix}
          </Link>
        ) : fix ? (
          <p className="text-gray-600">{fix}</p>
        ) : (
          <></>
        )}
        {finding.guidePath && !isServerSetupFinding(finding) ? (
          <Link
            to={new Route(finding.guidePath)}
            openInNewTab={true}
            className="block text-indigo-600 hover:underline"
          >
            {translator.translateTemplate(
              INSTALLATION_HEALTH_COPY.readTheGuide,
            )}
          </Link>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

const InstallationHealthSummary: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<InstallationHealthState>({
    kind: "loading",
  });

  useEffect(() => {
    let isCurrent: boolean = true;

    readInstallationHealth()
      .then((next: InstallationHealthState): void => {
        if (isCurrent) {
          setState(next);
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setState({ kind: "failed" });
        }
      });

    return (): void => {
      isCurrent = false;
    };
  }, []);

  if (state.kind === "loading") {
    return <></>;
  }

  return (
    <Card
      title={INSTALLATION_HEALTH_COPY.title}
      description={INSTALLATION_HEALTH_COPY.description}
    >
      <div data-testid="installation-health">
        {state.kind === "failed" ? (
          <ErrorMessage
            message={translator.translateTemplate(
              INSTALLATION_HEALTH_COPY.loadError,
            )}
          />
        ) : state.answer.findings.length === 0 ? (
          <div
            className="flex items-center gap-2 text-sm text-gray-700"
            data-testid="installation-health-all-right"
          >
            <Icon
              icon={IconProp.CheckCircle}
              size={SizeProp.Regular}
              className="h-5 w-5 flex-shrink-0 text-green-500"
            />
            {translator.translateTemplate(INSTALLATION_HEALTH_COPY.allRight)}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {state.answer.findings.map(
              (finding: InstallationHealthFinding): ReactElement => {
                return <FindingRow key={finding.id} finding={finding} />;
              },
            )}
          </ul>
        )}
      </div>
    </Card>
  );
};

export default InstallationHealthSummary;
