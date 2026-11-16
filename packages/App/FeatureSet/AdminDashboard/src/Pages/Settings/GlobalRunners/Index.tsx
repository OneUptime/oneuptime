import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
} from "Common/Types/Runner/RunnerLiveStatus";
import {
  RunnerCodeFixRefusal,
  getRunnerCodeFixRefusal,
} from "Common/Types/Runner/RunnerCodeFixes";
import {
  GlobalRunnerSandboxShortfall,
  getGlobalRunnerSandboxShortfalls,
  parseGlobalRunnerSandboxReport,
} from "Common/Types/Runner/GlobalRunnerSandbox";
import { getGlobalRunnerDockerCommand } from "Common/Types/Runner/RunnerContainer";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import RunnerCodeFixesOffSetting from "Common/UI/Components/Runner/RunnerCodeFixesOffSetting";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Runner from "Common/Models/DatabaseModels/Runner";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

// The line under a global Runner's status when it takes no AI code fixes.
export const GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID: string =
  "global-runner-takes-no-code-fixes";

/*
 * The line under a global Runner's status when its JavaScript steps run as
 * the Runner's own user, or share its network, and what to change (#8911,
 * #8910). Drawn from what the Runner says on its heartbeat
 * (Common/Types/Runner/GlobalRunnerSandbox).
 */
export const GLOBAL_RUNNER_SANDBOX_SHORTFALL_TEST_ID: string =
  "global-runner-sandbox-shortfall";

/*
 * What each shortfall says under a global Runner's status: what the step
 * gets and what to change, in whole sentences the Admin Dashboard's locale
 * files hold (English keys, as the code-fix lines above have them). A step
 * that runs as the Runner's own user says so and how to give it a user; one
 * whose process shares the Runner's network says so and how to keep it off
 * the network. Each follows the same words as the Runner's own log
 * (SandboxIdentity's OWN_USER_REMEDY, SandboxNetwork's NO_NETWORK_REMEDY).
 */
export const GLOBAL_RUNNER_SANDBOX_COPY: Record<
  GlobalRunnerSandboxShortfall,
  string
> = {
  [GlobalRunnerSandboxShortfall.OwnUserNoPrivilege]:
    "Runs JavaScript steps as its own user: let its container switch users (allowPrivilegeEscalation, SETUID and SETGID).",
  [GlobalRunnerSandboxShortfall.OwnUserNotInNodeGroup]:
    "Runs JavaScript steps as its own user: run its container as the image's own user, node.",
  [GlobalRunnerSandboxShortfall.OwnUserNotInstalled]:
    "Runs JavaScript steps as its own user: run the Runner image, not its sources.",
  [GlobalRunnerSandboxShortfall.OwnUserCheckFailed]:
    "Runs JavaScript steps as its own user: its sandbox check failed, and its log says why.",
  [GlobalRunnerSandboxShortfall.SharedNetworkNoSeccomp]:
    "JavaScript steps share its network: let its container use seccomp, as Docker's and Kubernetes' default profiles do.",
  [GlobalRunnerSandboxShortfall.SharedNetworkNotInstalled]:
    "JavaScript steps share its network: run the Runner image, not its sources.",
  [GlobalRunnerSandboxShortfall.SharedNetworkCheckFailed]:
    "JavaScript steps share its network: its network filter's check failed, and its log says why.",
  [GlobalRunnerSandboxShortfall.NotInstalled]:
    "Runs JavaScript steps as its own user and on its network: run the Runner image, not its sources.",
};

/*
 * Why a global Runner takes no AI code fixes, said as what makes it take
 * them, in whole sentences the locale files hold (English keys, as
 * Health's visitor addresses have them): the setting its host turned them
 * off with is the {{setting}} value, drawn as code. One turned off here
 * (Runs AI Code Fixes, the row's own switch) says so plainly: that is a
 * choice, not a fault.
 */
export const GLOBAL_RUNNER_CODE_FIXES_COPY: {
  olderRelease: string;
  turnedOff: string;
  turnedOffHere: string;
} = {
  olderRelease: "Takes no AI code fixes: update it to this server's version.",
  turnedOff:
    "Takes no AI code fixes: remove {{setting}} from its host and restart it.",
  turnedOffHere: "Takes no AI code fixes: they are turned off for this Runner.",
};

/*
 * The switch a master admin keeps a global Runner off AI code fixes with
 * (Runner.canRunCodeFixes): on by default, folded under More fields, as a
 * project Runner's Runs Runbooks is. Off, the server grants it no code
 * fixes and hands it no repository token, so it runs JavaScript steps only.
 */
export const GLOBAL_RUNNER_CODE_FIXES_SWITCH: {
  title: string;
  description: string;
} = {
  title: "Runs AI Code Fixes",
  description:
    "Lets it take OneUptime AI's code fixes, with a token for each repository. Off, it runs JavaScript steps only.",
};

const MORE_FIELDS: FormFieldCollapsibleSection<Runner> =
  getAdvancedFormSection<Runner>();

/*
 * The Status column wraps (Column.wrapContent): its line is a sentence, and
 * a cell that never wraps cut it off behind the row's buttons. Between a
 * floor that keeps the line a few words wide (a table short of room gives a
 * wrapping column its longest word, and the setting broke onto four lines)
 * and a cap that keeps it a status, not a paragraph across the table.
 */
export const GLOBAL_RUNNER_STATUS_COLUMN_MIN_WIDTH_CLASS_NAME: string =
  "min-w-[14rem]";

export const GLOBAL_RUNNER_STATUS_COLUMN_MAX_WIDTH_CLASS_NAME: string =
  "max-w-xs";

/*
 * Settings -> Runbooks -> Global Runners: the Runners OneUptime runs for
 * every project, which only a master admin creates. A global Runner is the
 * ordinary Runner image started with the id and key this page shows (Show ID
 * and Key gives the whole command); the server tells it that it is global,
 * and from then on it runs the JavaScript steps of every project that uses
 * global Runners - each in a sandbox of its own that reaches the internet
 * only - and the AI code fixes of the repositories that work on a global
 * Runner, never running a repository's own commands. Every project lists
 * these on its own Runners page. A global Runner that takes no AI code
 * fixes - one of a release from before global Runners took them, or one
 * whose host turned them off - says so under its status, with what to do:
 * the repositories on the Global Runner say no global Runner online takes
 * them, and this is where the admin finds which one, and why. Runs AI Code
 * Fixes, under More fields, keeps one off them altogether, enforced by the
 * server (its key then proves no code-fix identity): a multi-tenant install
 * keeps repository tokens off the hosts that run every project's
 * JavaScript with it.
 */
const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();
  const [currentRunner, setCurrentRunner] = useState<Runner | null>(null);

  const renderLiveStatus: (item: Runner) => ReactElement = (
    item: Runner,
  ): ReactElement => {
    const status: RunnerLiveStatus = getRunnerLiveStatus(item.lastAlive);

    if (status === RunnerLiveStatus.Connected) {
      return (
        <Statusbubble
          text={t("common.connected")}
          isUserContent={true}
          color={Green}
          shouldAnimate={true}
        />
      );
    }

    // Grey for a Runner nobody has started yet: it has not failed at anything.
    if (status === RunnerLiveStatus.NeverConnected) {
      return (
        <Statusbubble
          text={t("pages.settings.globalRunners.neverConnected")}
          isUserContent={true}
          color={Gray500}
          shouldAnimate={false}
        />
      );
    }

    return (
      <Statusbubble
        text={t("common.disconnected")}
        isUserContent={true}
        color={Red}
        shouldAnimate={false}
      />
    );
  };

  /*
   * How it is doing, and - for one that takes no AI code fixes, as it said
   * on its last heartbeat or as its release does - why, and what to do.
   */
  // Why a global Runner takes no AI code fixes, under its status; null when none.
  const renderCodeFixLine: (item: Runner) => ReactElement | null = (
    item: Runner,
  ): ReactElement | null => {
    const refusal: RunnerCodeFixRefusal | null = getRunnerCodeFixRefusal({
      isGlobalRunner: true,
      canRunCodeFixes: item.canRunCodeFixes,
      takesCodeFixes: item.takesCodeFixes,
      agentVersion: item.agentVersion,
      lastAlive: item.lastAlive,
    });

    if (!refusal) {
      return null;
    }

    // Turned off here on purpose: said in grey, as a fact, not a fault.
    if (refusal === RunnerCodeFixRefusal.TurnedOffInOneUptime) {
      return (
        <p
          className="mt-1 break-words text-xs leading-5 text-gray-500"
          data-testid={GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID}
        >
          {translator.translateText(
            GLOBAL_RUNNER_CODE_FIXES_COPY.turnedOffHere,
          )}
        </p>
      );
    }

    return (
      <p
        className="mt-1 break-words text-xs leading-5 text-amber-700"
        data-testid={GLOBAL_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID}
      >
        {refusal === RunnerCodeFixRefusal.OlderRelease ? (
          translator.translateText(GLOBAL_RUNNER_CODE_FIXES_COPY.olderRelease)
        ) : (
          <TranslatedSentence
            template={GLOBAL_RUNNER_CODE_FIXES_COPY.turnedOff}
            slots={{ setting: <RunnerCodeFixesOffSetting /> }}
          />
        )}
      </p>
    );
  };

  /*
   * How a global Runner keeps each project's JavaScript steps apart, under
   * its status: when a step runs as the Runner's own user, or shares its
   * network, one amber line each says so and what to change (#8911, #8910),
   * from what the Runner says on its heartbeat. Nothing when each step gets a
   * user of its own and no network, or for a Runner of a release that does
   * not say.
   */
  const renderSandboxShortfalls: (item: Runner) => Array<ReactElement> = (
    item: Runner,
  ): Array<ReactElement> => {
    const shortfalls: Array<GlobalRunnerSandboxShortfall> =
      getGlobalRunnerSandboxShortfalls(
        parseGlobalRunnerSandboxReport(item.hostInfo),
      );

    return shortfalls.map(
      (
        shortfall: GlobalRunnerSandboxShortfall,
        index: number,
      ): ReactElement => {
        return (
          <p
            key={shortfall}
            className="mt-1 break-words text-xs leading-5 text-amber-700"
            data-testid={`${GLOBAL_RUNNER_SANDBOX_SHORTFALL_TEST_ID}-${index}`}
          >
            {translator.translateText(GLOBAL_RUNNER_SANDBOX_COPY[shortfall])}
          </p>
        );
      },
    );
  };

  const renderStatus: (item: Runner) => ReactElement = (
    item: Runner,
  ): ReactElement => {
    const codeFixLine: ReactElement | null = renderCodeFixLine(item);
    const sandboxLines: Array<ReactElement> = renderSandboxShortfalls(item);

    if (!codeFixLine && sandboxLines.length === 0) {
      return renderLiveStatus(item);
    }

    return (
      <div>
        {renderLiveStatus(item)}
        {codeFixLine}
        {sandboxLines}
      </div>
    );
  };

  return (
    <Page
      title={t("pages.settings.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.globalRunners"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_RUNNERS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <ModelTable<Runner>
        userPreferencesKey={"admin-global-runners-table"}
        modelType={Runner}
        id="global-runners-table"
        name="Settings > Global Runners"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: t("pages.settings.globalRunners.cardTitle"),
          description: t("pages.settings.globalRunners.cardDescription"),
        }}
        documentationLink={Route.fromString(
          "/docs/runbooks/agents#global-runners",
        )}
        query={{
          projectId: new IsNull(),
          isGlobalRunner: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={t("pages.settings.globalRunners.noItems")}
        showRefreshButton={true}
        onBeforeCreate={(item: Runner) => {
          item.isGlobalRunner = true;
          return Promise.resolve(item);
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "global-runner-eu",
            validation: {
              minLength: 2,
            },
            /*
             * The column's description is about a project's Runners (the
             * reserved kubernetes-agent/ names); the title and placeholder
             * say what this is.
             */
            hideColumnDescription: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Runs JavaScript steps and AI code fixes for every project.",
            // The column only said "Optional description for this agent".
            hideColumnDescription: true,
          },
          {
            field: {
              canRunCodeFixes: true,
            },
            title: GLOBAL_RUNNER_CODE_FIXES_SWITCH.title,
            description: GLOBAL_RUNNER_CODE_FIXES_SWITCH.description,
            collapsibleSection: MORE_FIELDS,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            // As the column: every global Runner takes them until turned off.
            defaultValue: true,
          },
        ]}
        selectMoreFields={{
          key: true,
          lastAlive: true,
          /*
           * Whether it takes AI code fixes: turned off here, what it said,
           * or its release.
           */
          canRunCodeFixes: true,
          takesCodeFixes: true,
          agentVersion: true,
          /*
           * How it keeps each project's JavaScript steps apart, as it said on
           * its heartbeat (Common/Types/Runner/GlobalRunnerSandbox): whether a
           * step gets a user of its own and no network, and why not.
           */
          hostInfo: true,
        }}
        actionButtons={[
          {
            title: t("pages.settings.globalRunners.showIdKey"),
            icon: IconProp.Key,
            buttonStyleType: ButtonStyleType.NORMAL,
            // Reveals the ID, key and command for copying - a utility, never the row button.
            placement: ActionButtonPlacement.MoreMenu,
            onClick: async (
              item: Runner,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentRunner(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              lastAlive: true,
            },
            title: "Status",
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName:
              GLOBAL_RUNNER_STATUS_COLUMN_MAX_WIDTH_CLASS_NAME,
            contentClassName: GLOBAL_RUNNER_STATUS_COLUMN_MIN_WIDTH_CLASS_NAME,
            getElement: renderStatus,
          },
        ]}
      />

      {/*
       * As wide as a project's Runner setup dialog (ModalWidth.Medium), so
       * the command's lines are read and copied whole rather than cut off
       * behind its copy button.
       */}
      {currentRunner ? (
        <Modal
          title={t("pages.settings.globalRunners.keyModalTitle")}
          isTitleTranslated={true}
          modalWidth={ModalWidth.Medium}
          closeButtonText={t("common.close")}
          onClose={() => {
            setCurrentRunner(null);
          }}
        >
          <div
            className="space-y-4 text-sm text-gray-600"
            data-testid="global-runner-key-details"
          >
            <p>{t("pages.settings.globalRunners.keyModalDescription")}</p>
            <p>
              <b className="text-gray-900">
                {t("pages.settings.globalRunners.runnerIdLabel")}
              </b>{" "}
              <span className="font-mono">{currentRunner._id?.toString()}</span>
            </p>
            <p>
              <b className="text-gray-900">
                {t("pages.settings.globalRunners.runnerKeyLabel")}
              </b>{" "}
              <span className="font-mono">{currentRunner.key?.toString()}</span>
            </p>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t("pages.settings.globalRunners.commandLabel")}
              </p>
              <CodeBlock
                language="bash"
                code={getGlobalRunnerDockerCommand({
                  runnerId: currentRunner._id?.toString() || "",
                  runnerKey: currentRunner.key?.toString() || "",
                  oneuptimeUrl: `${HTTP_PROTOCOL}${HOST}`,
                })}
              />
            </div>
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
