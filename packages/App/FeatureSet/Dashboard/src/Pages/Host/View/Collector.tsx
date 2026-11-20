import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import { getHostCollectorOsType } from "Common/Types/HostCollector/HostCollector";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Select from "Common/Types/BaseDatabase/Select";
import HostDocumentationCard from "../../../Components/Host/DocumentationCard";
import AddHostGuide from "../../../Components/HostCollector/AddHostGuide";
import HostCollectorCard, {
  HOST_COLLECTOR_CARD_SELECT,
} from "../../../Components/HostCollector/HostCollectorCard";
import HostCollectorOnHostCard from "../../../Components/HostCollector/HostCollectorOnHostCard";
import {
  HostCollectorState,
  getHostCollectorState,
  isHostCollectorManaged,
} from "../../../Components/HostCollector/HostCollectorStatus";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import IconProp from "Common/Types/Icon/IconProp";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import URL from "Common/Types/API/URL";
import { DOCS_URL } from "Common/UI/Config";
import HostOperatingSystem from "Common/Utils/Host/HostOperatingSystem";

// The Android agent's docs page: how it is deployed, what it reads, and how to grant it more.
export const ANDROID_AGENT_DOCS_PATH: string = "/telemetry/android-agent";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A host's Collector page.
 *
 *   - A host whose collector OneUptime installed: where the collector
 *     stands, the config it runs and how it was chosen (Change config), why
 *     a config failed (Try again), and how to check on it on the host.
 *   - A host whose collector was installed by hand: the one command that
 *     hands it over to OneUptime (it stops the hand-installed collector),
 *     and the manual guide, for keeping config.yaml on the host.
 */

// While the collector is on its way to a config, the page follows it.
const TRANSITIONAL_REFRESH_INTERVAL_MS: number = 10 * 1000;

const HostCollector: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<Host>({
      modelType: Host,
      id: modelId,
      select: {
        ...HOST_COLLECTOR_CARD_SELECT,
        hostIdentifier: true,
      } as Select<Host>,
    })
      .then((item: Host | null) => {
        if (isCurrent) {
          setHost(item);
          setError("");
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshToken]);

  const state: HostCollectorState | null = host
    ? getHostCollectorState(host)
    : null;
  const isTransitional: boolean =
    state === HostCollectorState.Waiting ||
    state === HostCollectorState.Applying;

  useEffect(() => {
    if (!isTransitional) {
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setRefreshToken((token: number): number => {
        return token + 1;
      });
    }, TRANSITIONAL_REFRESH_INTERVAL_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [isTransitional, refreshToken]);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setIsLoading(true);
          setRefreshToken((token: number): number => {
            return token + 1;
          });
        }}
      />
    );
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const hostName: string = host.hostIdentifier || host.name || "";

  /*
   * An Android device runs no collector: it reports through the OneUptime
   * Android agent, which its device manager installs and configures. The
   * menu leaves this page out for it; a link to it says so, rather than
   * telling someone to install a collector on a kiosk (#9804).
   */
  if (HostOperatingSystem.isAndroid(host.osType)) {
    return (
      <EmptyState
        id="host-collector-android"
        icon={IconProp.Android}
        title="This device reports through the Android agent"
        description="An Android device runs no OpenTelemetry Collector: the OneUptime Android agent sends its health, restarts, apps and logs."
        footer={
          <Link
            to={URL.fromString(
              `${DOCS_URL.toString()}${ANDROID_AGENT_DOCS_PATH}`,
            )}
            openInNewTab={true}
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-indigo-600"
          >
            {translator.translateText("Android Agent docs")}
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
          </Link>
        }
      />
    );
  }

  if (isHostCollectorManaged(host)) {
    return (
      <Fragment>
        <HostCollectorCard
          host={host}
          onChanged={() => {
            setRefreshToken((token: number): number => {
              return token + 1;
            });
          }}
        />
        <HostCollectorOnHostCard
          osType={host.osType}
          hostId={modelId}
          hostName={hostName}
          onHostConnected={() => {
            setRefreshToken((token: number): number => {
              return token + 1;
            });
          }}
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <AddHostGuide
        title="Let OneUptime manage this collector"
        description={translator.translateTemplate(
          "Run one command on {{host}}: it installs the collector OneUptime keeps configured, and stops the one installed by hand. No config.yaml to keep on the host.",
          { host: hostName },
        )}
        osType={getHostCollectorOsType(host.osType)}
        replaceExisting={true}
        hideManualInstallTopic={true}
        hostId={modelId}
        onHostConnected={() => {
          setRefreshToken((token: number): number => {
            return token + 1;
          });
        }}
      />
      <FoldedSection
        title="Install the collector yourself"
        icon={IconProp.Book}
        summary={translator.translateTemplate(
          "Or keep this host ({{host}}) on a collector you install and configure: the OpenTelemetry Collector with a config.yaml you keep on the host.",
          { host: hostName },
        )}
        isElevated={true}
        dataTestId="host-manual-guide"
      >
        <HostDocumentationCard
          title="Install the collector yourself"
          description=""
          isBare={true}
        />
      </FoldedSection>
    </Fragment>
  );
};

export default HostCollector;
