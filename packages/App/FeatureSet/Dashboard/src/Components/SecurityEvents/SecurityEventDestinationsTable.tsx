import { SECURITY_EVENT_DESTINATION_SCOPE_TEXTS } from "./SecurityConnectionsCopy";
import SecurityEventDestinationFormModal from "./SecurityEventDestinationFormModal";
import { SecurityEventDestinationTestModal } from "./SecurityEventDestinationTest";
import {
  SECURITY_EVENT_DESTINATION_HEALTH_TEXTS,
  SecurityEventDestinationHealth,
  getSecurityEventDestinationHealth,
  getSecurityEventDestinationHealthColor,
} from "./SecurityEventDestinationUtil";
import SecurityEventDestination from "Common/Models/DatabaseModels/SecurityEventDestination";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEventDestinationCatalog,
  getSecurityEventDestinationTitle,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import { isSecurityEventDestinationScope } from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

export const SECURITY_EVENT_DESTINATIONS_TABLE_ID: string =
  "security-event-destinations-table";

/*
 * What the empty table says: who this is for, what is sent, and one button
 * that opens the form.
 */
export const SecurityEventDestinationsEmptyState: FunctionComponent<{
  canCreate: boolean;
  createDisabledReason?: string | undefined;
  onAdd: () => void;
}> = (props: {
  canCreate: boolean;
  createDisabledReason?: string | undefined;
  onAdd: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const firstTitle: string = SecurityEventDestinationCatalog[0]?.title || "";

  return (
    <div
      className="flex flex-col items-center px-4 py-8 text-center"
      data-testid="security-event-destinations-empty"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
        <Icon icon={IconProp.PaperAirplane} className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-medium text-gray-900">
        {translator.translateText("Already use a SIEM?")}
      </p>
      <p className="mt-1 max-w-lg text-sm text-gray-600">
        {translator.translateText(
          "Send what OneUptime finds to the SIEM your team already works in, as it happens. Google SecOps is supported today.",
        )}
      </p>
      <div className="mt-4 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
        <Button
          title={
            SecurityEventDestinationCatalog.length === 1
              ? translator.translateTemplate("Send to {{name}}", {
                  name: firstTitle,
                })
              : "Send to your SIEM"
          }
          icon={IconProp.PaperAirplane}
          buttonStyle={ButtonStyleType.NORMAL}
          disabled={!props.canCreate}
          tooltip={props.canCreate ? undefined : props.createDisabledReason}
          dataTestId="security-event-destinations-empty-add"
          onClick={props.onAdd}
        />
      </div>
    </div>
  );
};

/*
 * "Send to your SIEM": the SIEMs OneUptime sends its security events to, as
 * it finds them (Server/Utils/SecurityEvent/Destinations). Each row says
 * what it is sent and how sending is going; Send a test event shows one
 * arrive before anything real does.
 */
const SecurityEventDestinationsTable: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [formDestination, setFormDestination] = useState<
    SecurityEventDestination | "new" | null
  >(null);
  const [testDestination, setTestDestination] =
    useState<SecurityEventDestination | null>(null);
  const [viewingError, setViewingError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  const refresh: VoidFunction = (): void => {
    setRefreshCounter((value: number): number => {
      return value + 1;
    });
  };

  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityEventDestination(),
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityEventDestination(),
    ModelAction.Update,
  );

  const openCreateForm: VoidFunction = (): void => {
    setFormDestination("new");
  };

  return (
    <Fragment>
      <ModelTable<SecurityEventDestination>
        modelType={SecurityEventDestination}
        refreshToggle={String(refreshCounter)}
        selectMoreFields={{
          projectId: true,
          provider: true,
          config: true,
          sendScope: true,
          isEnabled: true,
          lastAttemptAt: true,
          lastSentAt: true,
          lastError: true,
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id={SECURITY_EVENT_DESTINATIONS_TABLE_ID}
        name="Security Events > SIEM Destinations"
        userPreferencesKey={SECURITY_EVENT_DESTINATIONS_TABLE_ID}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Send to your SIEM",
          description:
            "Already use a SIEM? OneUptime sends what it finds there too, as it happens - only its detections, or every security event.",
          buttons: [
            {
              title: "Add destination",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              disabled: !createGate.isAllowed,
              tooltip: createGate.isAllowed
                ? undefined
                : createGate.disabledReason,
              onClick: openCreateForm,
            },
          ],
        }}
        noItemsMessage={
          <SecurityEventDestinationsEmptyState
            canCreate={createGate.isAllowed}
            createDisabledReason={createGate.disabledReason}
            onAdd={openCreateForm}
          />
        }
        showRefreshButton={true}
        actionButtons={[
          {
            title: "View Error",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
            isVisible: (item: SecurityEventDestination): boolean => {
              return Boolean(item.lastError);
            },
            onClick: (
              item: SecurityEventDestination,
              onCompleteAction: VoidFunction,
            ): void => {
              setViewingError(item.lastError || null);
              onCompleteAction();
            },
          },
          {
            title: "Send a test event",
            icon: IconProp.PaperAirplane,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Send one event marked as a test with the saved settings."
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventDestination,
              onCompleteAction: VoidFunction,
            ): void => {
              setTestDestination(item);
              onCompleteAction();
            },
          },
          {
            title: "Edit",
            icon: IconProp.Edit,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? undefined
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventDestination,
              onCompleteAction: VoidFunction,
            ): void => {
              setFormDestination(item);
              onCompleteAction();
            },
          },
        ]}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            getElement: (item: SecurityEventDestination): ReactElement => {
              return (
                <div>
                  <span>{item.name}</span>
                  <div className="text-xs text-gray-500">
                    {getSecurityEventDestinationTitle(item.provider)}
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              sendScope: true,
            },
            title: "Sends",
            type: FieldType.Text,
            getElement: (item: SecurityEventDestination): ReactElement => {
              const scope: string | undefined = item.sendScope;

              return (
                <span>
                  {isSecurityEventDestinationScope(scope)
                    ? translator.translateText(
                        SECURITY_EVENT_DESTINATION_SCOPE_TEXTS[scope].title,
                      )
                    : ""}
                </span>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: SecurityEventDestination): ReactElement => {
              const health: SecurityEventDestinationHealth =
                getSecurityEventDestinationHealth(item);

              return (
                <Pill
                  color={getSecurityEventDestinationHealthColor(health)}
                  text={
                    translator.translateText(
                      SECURITY_EVENT_DESTINATION_HEALTH_TEXTS[health].title,
                    ) || health
                  }
                  tooltip={
                    translator.translateText(
                      SECURITY_EVENT_DESTINATION_HEALTH_TEXTS[health]
                        .description,
                    ) || undefined
                  }
                />
              );
            },
          },
          {
            field: {
              lastSentAt: true,
            },
            title: "Last Sent",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
        ]}
      />

      {formDestination ? (
        <SecurityEventDestinationFormModal
          key={
            formDestination === "new"
              ? "new"
              : formDestination.id?.toString() || "edit"
          }
          destination={formDestination === "new" ? undefined : formDestination}
          onClose={(): void => {
            setFormDestination(null);
          }}
          onSaved={(): void => {
            setFormDestination(null);
            refresh();
          }}
        />
      ) : (
        <></>
      )}

      {testDestination?.id ? (
        <SecurityEventDestinationTestModal
          key={testDestination.id.toString()}
          destinationId={testDestination.id.toString()}
          destinationName={
            testDestination.name ||
            getSecurityEventDestinationTitle(testDestination.provider)
          }
          onClose={(): void => {
            setTestDestination(null);
          }}
        />
      ) : (
        <></>
      )}

      {viewingError ? (
        <Modal
          title="Last Error"
          description="What the SIEM answered the last time OneUptime sent to it. Keys are never shown."
          modalWidth={ModalWidth.Large}
          onClose={(): void => {
            setViewingError(null);
          }}
          closeButtonText="Close"
          leftFooterElement={
            <CopyTextButton
              textToBeCopied={viewingError}
              label="Copy Error"
              size="md"
              variant="solid"
            />
          }
        >
          <pre
            aria-label={translator.translateText("Full error message")}
            tabIndex={0}
            className="whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm text-gray-800"
          >
            {viewingError}
          </pre>
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SecurityEventDestinationsTable;
