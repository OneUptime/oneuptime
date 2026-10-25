import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import { ProjectAiNoticeContext } from "../../Components/AISettings/ProjectAiSettingsCopy";
import {
  EXTERNAL_MCP_SERVERS_PAGE_COPY,
  EXTERNAL_MCP_SERVER_TEST_COPY,
} from "../../Components/ExternalMcpServer/ExternalMcpServerCopy";
import {
  getExternalMcpServerFormFields,
  getExternalMcpServerFormSteps,
} from "../../Components/ExternalMcpServer/ExternalMcpServerFormFields";
import ExternalMcpServerStatus from "../../Components/ExternalMcpServer/ExternalMcpServerStatus";
import { getExternalMcpServerTestGate } from "../../Components/ExternalMcpServer/ExternalMcpServerTestApi";
import TestExternalMcpServerModal from "../../Components/ExternalMcpServer/TestExternalMcpServerModal";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import Route from "Common/Types/API/Route";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Project Settings → AI → External MCP Servers: the MCP servers outside
 * OneUptime whose tools OneUptime AI may use - AWS, Azure, GitHub, one of
 * the team's own. The maintainer: "have a way where OneUptime AI can
 * integrate with MCP tools or MCP servers ... in project settings".
 *
 * A server is a name, its address and how OneUptime signs in. Once added,
 * OneUptime connects at once (the Test dialog opens by itself) and says what
 * it found; the list then says how each server is doing. Which servers an
 * investigation or a fix may use is the rules' to say, under More fields -
 * all of them unless a rule picks some.
 *
 * The card says what the page is not, too: OneUptime's own MCP server, the
 * one AI assistants connect to, is on the MCP Server page.
 */
const ExternalMcpServersPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // The server whose Test dialog is open.
  const [testedServerId, setTestedServerId] = useState<string | null>(null);

  // Flipped after a test, so the list shows what it found.
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  const testGate: PermissionGateResult = getExternalMcpServerTestGate();

  const mcpServerRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_MCP_SERVER] as Route,
  );

  return (
    <Fragment>
      <ProjectAiNotice context={ProjectAiNoticeContext.ExternalMcpServers} />

      <ModelTable<ExternalMcpServer>
        modelType={ExternalMcpServer}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="external-mcp-servers-table"
        userPreferencesKey="settings-external-mcp-servers-table"
        name="Settings > External MCP Servers"
        saveFilterProps={{
          tableId: "settings-external-mcp-servers-table",
        }}
        isDeleteable={true}
        isEditable={false}
        isViewable={true}
        /*
         * "View External MCP Server" took 200px of every row: at 1280px
         * beside the side menu, a long URL then pushed Status under the
         * row's buttons, out of sight.
         */
        viewButtonText="View"
        isCreateable={true}
        refreshToggle={refreshToggle.toString()}
        actionButtons={[
          {
            title: EXTERNAL_MCP_SERVER_TEST_COPY.test,
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            isVisible: (): boolean => {
              return testGate.isAllowed || Boolean(testGate.disabledReason);
            },
            disabled: !testGate.isAllowed,
            // Locked, it says who may; unlocked, its dialog says what it does.
            tooltip: testGate.isAllowed ? undefined : testGate.disabledReason,
            onClick: (
              item: ExternalMcpServer,
              onCompleteAction: VoidFunction,
            ) => {
              setTestedServerId(item.id?.toString() || null);
              onCompleteAction();
            },
          },
        ]}
        cardProps={{
          title: EXTERNAL_MCP_SERVERS_PAGE_COPY.title,
          description: (
            <span>
              <span className="block">
                {translator.translateText(
                  EXTERNAL_MCP_SERVERS_PAGE_COPY.description,
                )}
              </span>
              <span className="mt-1 block">
                <TranslatedSentence
                  template={EXTERNAL_MCP_SERVERS_PAGE_COPY.ownServerNote}
                  slots={{
                    mcpServerLink: (
                      <Link
                        to={mcpServerRoute}
                        className="underline"
                        dataTestId="external-mcp-servers-own-server-link"
                      >
                        {translator.translateText("MCP Server")}
                      </Link>
                    ),
                  }}
                />
              </span>
            </span>
          ),
        }}
        documentationLink={Route.fromString("/docs/ai/external-mcp-servers")}
        noItemsMessage={EXTERNAL_MCP_SERVERS_PAGE_COPY.noItemsMessage}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={getExternalMcpServerFormSteps()}
        formFields={getExternalMcpServerFormFields()}
        /*
         * Added, OneUptime connects at once and says what it found: the
         * Test dialog opens by itself.
         */
        onCreateSuccess={async (
          item: ExternalMcpServer,
          modalType?: ModalType,
        ): Promise<ExternalMcpServer> => {
          if (modalType === ModalType.Create && item.id && testGate.isAllowed) {
            setTestedServerId(item.id.toString());
          }

          return item;
        }}
        showRefreshButton={true}
        // The Status column reads these.
        selectMoreFields={{
          isEnabled: true,
          lastError: true,
          tools: true,
        }}
        searchableFields={["name", "description", "url"]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
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
              url: true,
            },
            title: "URL",
            type: FieldType.Text,
            /*
             * The address takes less room than a name: the name says which
             * server a row is. The column is capped through the table's
             * wrapping cap (a cap in contentClassName is the #3585 overlap
             * TableWrapContentInvariants forbids), and the address itself
             * stays one line, cut short with an ellipsis - whole under the
             * pointer, and on the server's page. 20rem let a long one push
             * the German table past its card at 1280px.
             */
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[16rem] 2xl:max-w-[24rem]",
            getElement: (item: ExternalMcpServer): ReactElement => {
              return (
                <span
                  // On the row's 24px line, level with the name beside it.
                  className="block truncate font-mono text-xs leading-6 text-gray-700"
                  title={item.url || undefined}
                  data-testid="external-mcp-server-url-cell"
                >
                  {item.url || ""}
                </span>
              );
            },
          },
          {
            field: {
              lastConnectedAt: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: ExternalMcpServer): ReactElement => {
              return (
                <ExternalMcpServerStatus server={item} showToolCount={true} />
              );
            },
          },
        ]}
      />

      {testedServerId ? (
        <TestExternalMcpServerModal
          externalMcpServerId={testedServerId}
          onTested={() => {
            setRefreshToggle((previous: boolean): boolean => {
              return !previous;
            });
          }}
          onClose={() => {
            setTestedServerId(null);
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default ExternalMcpServersPage;
