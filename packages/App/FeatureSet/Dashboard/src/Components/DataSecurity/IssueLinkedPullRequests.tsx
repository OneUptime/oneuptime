import FixProductionVerdict from "../AI/FixProductionVerdict";
import {
  ISSUE_LINKED_PULL_REQUESTS_TEST_ID,
  LINKED_ISSUE_PULL_REQUEST_TOAST,
  LINKED_PULL_REQUESTS_TITLE,
  LINK_ISSUE_PULL_REQUEST_DESCRIPTION,
  LINK_PULL_REQUEST,
  LINK_PULL_REQUEST_FIELD_DESCRIPTION,
  LINK_PULL_REQUEST_FIELD_TITLE,
  PULL_REQUEST_LINKED_BY,
  UNLINKED_ISSUE_PULL_REQUEST_TOAST,
  UNLINK_ISSUE_PULL_REQUEST_LABEL,
} from "./IssueLinkedPullRequestsCopy";
import {
  LINKED_PULL_REQUEST_SELECT,
  LinkedPullRequestState,
  getLinkedPullRequestAuthor,
  getLinkedPullRequestName,
  getLinkedPullRequestProduction,
  getLinkedPullRequestState,
} from "./IssueLinkedPullRequestsModel";
import DataSecurityIssuePullRequest from "Common/Models/DatabaseModels/DataSecurityIssuePullRequest";
import FixProductionReport from "Common/Types/AI/FixProductionReport";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  PullRequestLink,
  getPullRequestLinkName,
  parsePullRequestLink,
} from "Common/Types/CodeRepository/PullRequestLink";
import { DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX } from "Common/Types/DataSecurity/DataSecurityIssuePullRequestLink";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A PERSON'S OWN FIX OF AN ISSUE (#10831), on its How to Fix card: the pull
 * requests linked to it, each with where it stands on its host and - once
 * merged - what production showed, as an AI fix of the issue shows it
 * (FixProductionVerdict), with a way to take it off; and the one dialog
 * that links another, one field: its address. The server makes sure
 * OneUptime can follow it (a repository connected under Code that the
 * person may read, a pull request that is there and was not closed
 * unmerged) and says why not, in the reader's language.
 */

const URL_FIELD: string = "pullRequestUrl";

// An address that names its scheme; one that does not is read as https.
const HAS_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface IssueLinkedPullRequestsProps {
  issueId: ObjectID;
  refreshToggle?: boolean | string | number | undefined;
  // Told once a link is taken off, so the page reads the issue again.
  onChanged?: (() => void) | undefined;
}

// One linked pull request: its name, its state, who linked it, Take Off - and production's verdict.
const LinkedPullRequestLine: FunctionComponent<{
  row: DataSecurityIssuePullRequest;
  canRemove: boolean;
  isRemoving: boolean;
  isRemoveDisabled: boolean;
  onRemove: () => void;
}> = (props: {
  row: DataSecurityIssuePullRequest;
  canRemove: boolean;
  isRemoving: boolean;
  isRemoveDisabled: boolean;
  onRemove: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const row: DataSecurityIssuePullRequest = props.row;
  const name: string = getLinkedPullRequestName(row);
  const state: LinkedPullRequestState = getLinkedPullRequestState(row);
  const production: FixProductionReport | undefined =
    getLinkedPullRequestProduction(row);
  const author: string = getLinkedPullRequestAuthor(row);
  const url: URL | undefined = row.pullRequestUrl;

  return (
    <li
      className="space-y-2"
      data-testid={`${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-item`}
      data-pull-request-state={row.pullRequestState || ""}
      data-production-status={row.productionStatus || ""}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Icon icon={IconProp.Code} className="h-4 w-4 shrink-0 text-gray-400" />
        {url ? (
          <Link
            to={url}
            openInNewTab={true}
            className="min-w-0 break-all font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId={`${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-link`}
          >
            <span dir="ltr">{name}</span>
          </Link>
        ) : (
          <span className="min-w-0 break-all font-medium text-gray-700">
            {name}
          </span>
        )}
        <Pill text={state.label} tone={state.tone} />
        {author ? (
          <span className="text-xs text-gray-500">
            {translator.translateTemplate(
              PULL_REQUEST_LINKED_BY,
              { name: author },
              { setsValuesApart: true },
            )}
          </span>
        ) : (
          <></>
        )}
        {props.canRemove ? (
          <Button
            buttonStyle={ButtonStyleType.ICON}
            buttonSize={ButtonSize.Small}
            icon={IconProp.Close}
            ariaLabel={translator.translateTemplate(
              UNLINK_ISSUE_PULL_REQUEST_LABEL,
              { pullRequest: name },
            )}
            isAriaLabelTranslated={true}
            isLoading={props.isRemoving}
            disabled={props.isRemoveDisabled}
            dataTestId={`${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-remove`}
            onClick={props.onRemove}
          />
        ) : (
          <></>
        )}
      </div>
      {production ? (
        <FixProductionVerdict
          production={production}
          testId={`${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-production`}
          className="ml-6"
        />
      ) : (
        <></>
      )}
    </li>
  );
};

/*
 * The issue's linked pull requests, read for the reader, the newest last.
 * Nothing is drawn for an issue with none: the card's Link Pull Request
 * says what to do.
 */
const IssueLinkedPullRequests: FunctionComponent<
  IssueLinkedPullRequestsProps
> = (props: IssueLinkedPullRequestsProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [rows, setRows] = useState<Array<DataSecurityIssuePullRequest>>([]);
  const [removingId, setRemovingId] = useState<string>("");
  const [readToken, setReadToken] = useState<number>(0);
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new DataSecurityIssuePullRequest(),
    ModelAction.Delete,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const read: ListResult<DataSecurityIssuePullRequest> =
          await ModelAPI.getList<DataSecurityIssuePullRequest>({
            modelType: DataSecurityIssuePullRequest,
            query: { dataSecurityIssueId: props.issueId },
            select: LINKED_PULL_REQUEST_SELECT,
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX,
          });

        if (isCurrent) {
          setRows(read.data);
        }
      } catch {
        // The section keeps what it knew; it asks again at the next read.
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [props.issueId.toString(), props.refreshToggle, readToken]);

  const remove: (row: DataSecurityIssuePullRequest) => Promise<void> = async (
    row: DataSecurityIssuePullRequest,
  ): Promise<void> => {
    const id: string = row._id?.toString() || row.id?.toString() || "";

    if (!id) {
      return;
    }

    setRemovingId(id);

    try {
      await ModelAPI.deleteItem<DataSecurityIssuePullRequest>({
        modelType: DataSecurityIssuePullRequest,
        id: new ObjectID(id),
      });

      Toast.success(
        translator.translateTemplate(UNLINKED_ISSUE_PULL_REQUEST_TOAST, {
          pullRequest: getLinkedPullRequestName(row),
        }),
      );
      setReadToken((token: number) => {
        return token + 1;
      });
      props.onChanged?.();
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    }

    setRemovingId("");
  };

  if (rows.length === 0) {
    return <></>;
  }

  return (
    <section data-testid={ISSUE_LINKED_PULL_REQUESTS_TEST_ID}>
      <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(LINKED_PULL_REQUESTS_TITLE)}
      </h4>
      <ul className="mt-2 space-y-3">
        {rows.map((row: DataSecurityIssuePullRequest): ReactElement => {
          const id: string = row._id?.toString() || row.id?.toString() || "";

          return (
            <LinkedPullRequestLine
              key={id}
              row={row}
              canRemove={deleteGate.isAllowed}
              isRemoving={removingId === id}
              isRemoveDisabled={Boolean(removingId)}
              onRemove={() => {
                void remove(row);
              }}
            />
          );
        })}
      </ul>
    </section>
  );
};

export default IssueLinkedPullRequests;

export interface LinkIssuePullRequestModalProps {
  issueId: ObjectID;
  onClose: () => void;
  // Told once the link is kept, so the page reads the issue and its links again.
  onLinked: () => void;
}

// Link Pull Request: one field, the pull request's address.
export const LinkIssuePullRequestModal: FunctionComponent<
  LinkIssuePullRequestModalProps
> = (props: LinkIssuePullRequestModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  return (
    <BasicFormModal<JSONObject>
      title={LINK_PULL_REQUEST}
      description={LINK_ISSUE_PULL_REQUEST_DESCRIPTION}
      name="Data Security > Issue > Link Pull Request"
      submitButtonText={LINK_PULL_REQUEST}
      isSubmitting={isSubmitting}
      error={error || undefined}
      onClose={props.onClose}
      onSubmit={async (values: JSONObject) => {
        setError("");
        setIsSubmitting(true);

        const address: string = String(values[URL_FIELD] || "").trim();

        try {
          const link: DataSecurityIssuePullRequest =
            new DataSecurityIssuePullRequest();
          link.dataSecurityIssueId = props.issueId;
          link.pullRequestUrl = URL.fromString(
            HAS_SCHEME.test(address) ? address : `https://${address}`,
          );

          await ModelAPI.create<DataSecurityIssuePullRequest>({
            model: link,
            modelType: DataSecurityIssuePullRequest,
          });

          const parsed: PullRequestLink | null = parsePullRequestLink(address);

          Toast.success(
            translator.translateTemplate(LINKED_ISSUE_PULL_REQUEST_TOAST, {
              pullRequest: parsed ? getPullRequestLinkName(parsed) : address,
            }),
          );

          props.onLinked();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        } finally {
          setIsSubmitting(false);
        }
      }}
      formProps={{
        name: "Link Pull Request",
        initialValues: { [URL_FIELD]: "" },
        fields: [
          {
            field: { [URL_FIELD]: true },
            title: LINK_PULL_REQUEST_FIELD_TITLE,
            description: LINK_PULL_REQUEST_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Text,
            placeholder: "https://github.com/acme/checkout/pull/482",
            required: true,
          },
        ],
      }}
    />
  );
};
