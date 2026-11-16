import { getIncomingRequestSecretAccessFormFields } from "../../../Components/IncomingRequestSecret/IncomingRequestSecretAccessFormFields";
import IncomingRequestSecretsCopy from "../../../Components/IncomingRequestSecret/IncomingRequestSecretsCopy";
import RequireIncomingRequestSecretCard from "../../../Components/IncomingRequestSecret/RequireIncomingRequestSecretCard";
import RequestsWithoutSecretTable, {
  getCheckingSince,
} from "../../../Components/IncomingRequestSecret/RequestsWithoutSecretTable";
import MonitorSecretAccessElement from "../../../Components/MonitorSecret/MonitorSecretAccessElement";
import PageComponentProps from "../../PageComponentProps";
import IncomingRequestSecret from "Common/Models/DatabaseModels/IncomingRequestSecret";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
  INCOMING_REQUEST_SECRET_MAX_LENGTH,
  INCOMING_REQUEST_SECRET_MIN_LENGTH,
} from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "Common/Types/ObjectID";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Monitors -> Settings -> Incoming Request Secrets (issue #7526): whether
 * every Incoming Request monitor of the project requires a secret, and the
 * secrets its senders may send.
 *
 * The switch comes first, as the page's one decision; the secrets under it
 * are what it needs before it can be turned on. A secret is created with a
 * name alone - OneUptime generates the value - and shown with a copy button
 * to paste into a sender. A value of one's own, to match a sender already
 * set up, folds under More fields. A secret is never edited: to replace one,
 * create the next beside it, move the senders, then delete the old one when
 * its Last Used stops moving.
 *
 * Between the two, the Incoming Request monitors that got a request without a
 * valid secret in the last day (RequestsWithoutSecretTable, issue #8498):
 * before the switch is turned on, the senders to fix first; after, the
 * requests it refuses. Turning the switch on says how many those are
 * (issue #8564), counted again each time the secrets' list loads.
 *
 * A secret covers every Incoming Request monitor of the project unless it is
 * limited to some, or to the ones with some labels (issue #8501): for a
 * project shared by tenants, each sending its own secret. That question
 * starts on All monitors and folds under More fields with the value.
 */

const MonitorIncomingRequestSecrets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
  // Since when requests are checked: read from the secrets' list each time it loads.
  const [checkingSince, setCheckingSince] = useState<Date | null | undefined>(
    undefined,
  );
  // How many times the secrets' list has loaded: the switch counts again then.
  const [secretsLoadCount, setSecretsLoadCount] = useState<number>(0);
  const moreFields: FormFieldCollapsibleSection<IncomingRequestSecret> =
    getAdvancedFormSection<IncomingRequestSecret>();

  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  return (
    <Fragment>
      <RequireIncomingRequestSecretCard
        projectId={projectId}
        checkingSince={checkingSince}
        secretsLoadCount={secretsLoadCount}
      />

      <RequestsWithoutSecretTable
        projectId={projectId}
        checkingSince={checkingSince}
      />

      <ModelTable<IncomingRequestSecret>
        modelType={IncomingRequestSecret}
        query={{
          projectId: projectId,
        }}
        id="incoming-request-secrets-table"
        name="Monitors > Settings > Incoming Request Secrets"
        userPreferencesKey="incoming-request-secrets-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={false}
        singularName="Secret"
        cardProps={{
          title: IncomingRequestSecretsCopy.tableTitle,
          description: IncomingRequestSecretsCopy.tableDescription,
        }}
        emptyState={{
          title: IncomingRequestSecretsCopy.noSecretsTitle,
          description: IncomingRequestSecretsCopy.noSecretsDescription,
        }}
        documentationLink={Route.fromString(
          "/docs/monitor/incoming-request-monitor#require-a-secret-on-every-request",
        )}
        viewPageRoute={Navigation.getCurrentRoute()}
        sortBy="createdAt"
        sortOrder={SortOrder.Ascending}
        onFetchSuccess={(
          secrets: Array<IncomingRequestSecret>,
          totalCount: number,
        ): void => {
          setCheckingSince(getCheckingSince(secrets, totalCount));
          setSecretsLoadCount((count: number): number => {
            return count + 1;
          });
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: IncomingRequestSecretsCopy.namePlaceholder,
            description: IncomingRequestSecretsCopy.nameDescription,
            hideColumnDescription: true,
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              secretValue: true,
            },
            title: IncomingRequestSecretsCopy.secretTitle,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            doNotShowWhenEditing: true,
            placeholder: IncomingRequestSecretsCopy.secretPlaceholder,
            description: IncomingRequestSecretsCopy.secretDescription,
            hideColumnDescription: true,
            disableSpellCheck: true,
            validation: {
              minLength: INCOMING_REQUEST_SECRET_MIN_LENGTH,
              maxLength: INCOMING_REQUEST_SECRET_MAX_LENGTH,
              noSpaces: true,
            },
            collapsibleSection: moreFields,
          },
          ...getIncomingRequestSecretAccessFormFields({
            translate,
            collapsibleSection: moreFields,
          }),
        ]}
        showRefreshButton={true}
        filters={[]}
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
              secretValue: true,
            },
            title: IncomingRequestSecretsCopy.secretTitle,
            type: FieldType.Element,
            getElement: (item: IncomingRequestSecret): ReactElement => {
              if (!item.secretValue) {
                return <TableEmptyValue />;
              }

              return <HiddenText text={item.secretValue} isCopyable={true} />;
            },
          },
          {
            field: {
              monitorAccess: true,
              monitors: {
                name: true,
                _id: true,
                projectId: true,
              },
              labels: {
                name: true,
                color: true,
                _id: true,
              },
            },
            // Which monitors accept it: all, or the ones it is limited to.
            title: "Monitors",
            type: FieldType.Element,
            getElement: (item: IncomingRequestSecret): ReactElement => {
              return (
                <MonitorSecretAccessElement
                  secret={item}
                  defaultAccess={INCOMING_REQUEST_SECRET_DEFAULT_ACCESS}
                />
              );
            },
          },
          {
            field: {
              lastUsedAt: true,
            },
            /*
             * "Is anything still sending this secret?" - what to answer
             * before deleting one. Empty means no request has been accepted
             * with it yet, hence "Never" rather than the dash.
             */
            noValueMessage: IncomingRequestSecretsCopy.lastUsedNever,
            title: IncomingRequestSecretsCopy.lastUsedTitle,
            type: FieldType.DateTime,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default MonitorIncomingRequestSecrets;
