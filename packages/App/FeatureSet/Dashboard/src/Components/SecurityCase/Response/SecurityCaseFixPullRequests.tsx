import {
  LINKED_PULL_REQUEST_TOAST,
  LINK_PULL_REQUEST,
  LINK_PULL_REQUEST_DESCRIPTION,
  LINK_PULL_REQUEST_FIELD_DESCRIPTION,
  LINK_PULL_REQUEST_FIELD_TITLE,
  SECURITY_CASE_RESPONSE_TEST_IDS,
  UNLINK_PULL_REQUEST_LABEL,
} from "./SecurityCaseResponseCopy";
import {
  FixPullRequestStanding,
  getFixPullRequestName,
  getFixPullRequestStanding,
} from "./SecurityCaseFixPullRequestsModel";
import SecurityCasePullRequest from "Common/Models/DatabaseModels/SecurityCasePullRequest";
import URL from "Common/Types/API/URL";
import {
  getPullRequestLinkName,
  parsePullRequestLink,
  PullRequestLink,
} from "Common/Types/CodeRepository/PullRequestLink";
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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A PERSON'S OWN FIX, LINKED TO THE CASE'S FIX STEP (#10604): the pull
 * requests linked to it, each with where it stands and a way to take it off,
 * and the one dialog that links another - one field, its address. The server
 * makes sure OneUptime can follow it (a repository connected under Code, a
 * pull request that is there and was not closed unmerged) and says why not.
 */

const URL_FIELD: string = "pullRequestUrl";

// An address that names its scheme; one that does not is read as https.
const HAS_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface FixPullRequestListProps {
  rows: Array<SecurityCasePullRequest>;
  // Whether the reader may take a link off; a closed case keeps its links as they are.
  canRemove: boolean;
  // The link being taken off, while it is.
  removingId: string;
  onRemove: (row: SecurityCasePullRequest) => void;
}

// The linked pull requests, one line each: its name, where it stands, and Take Off.
export const FixPullRequestList: FunctionComponent<FixPullRequestListProps> = (
  props: FixPullRequestListProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.rows.length === 0) {
    return <></>;
  }

  return (
    <ul
      className="space-y-1"
      data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.pullRequests}
    >
      {props.rows.map((row: SecurityCasePullRequest): ReactElement => {
        const id: string = row._id?.toString() || row.id?.toString() || "";
        const name: string = getFixPullRequestName(row);
        const standing: FixPullRequestStanding = getFixPullRequestStanding(row);
        const url: URL | undefined = row.pullRequestUrl;

        return (
          <li
            key={id}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.pullRequest}
            data-pull-request-state={row.pullRequestState || ""}
          >
            <Icon
              icon={IconProp.Code}
              className="h-3.5 w-3.5 shrink-0 text-gray-400"
            />
            {url ? (
              <Link
                to={url}
                openInNewTab={true}
                className="min-w-0 break-all font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span className="min-w-0 break-all font-medium text-gray-700">
                {name}
              </span>
            )}
            <Pill
              text={standing.label}
              tone={standing.tone}
              tooltip={
                standing.tooltip
                  ? translator.translateTemplate(
                      standing.tooltip.template,
                      standing.tooltip.values,
                    )
                  : undefined
              }
            />
            {props.canRemove ? (
              <Button
                buttonStyle={ButtonStyleType.ICON}
                buttonSize={ButtonSize.Small}
                icon={IconProp.Close}
                ariaLabel={translator.translateTemplate(
                  UNLINK_PULL_REQUEST_LABEL,
                  { pullRequest: name },
                )}
                isAriaLabelTranslated={true}
                isLoading={props.removingId === id}
                disabled={Boolean(props.removingId)}
                dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.unlinkPullRequest}
                onClick={() => {
                  props.onRemove(row);
                }}
              />
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export interface LinkPullRequestModalProps {
  securityCaseId: ObjectID;
  onClose: () => void;
  // Told once the link is kept, so the card reads it.
  onLinked: () => void;
}

// Link Pull Request: one field, the pull request's address.
export const LinkPullRequestModal: FunctionComponent<
  LinkPullRequestModalProps
> = (props: LinkPullRequestModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  return (
    <BasicFormModal<JSONObject>
      title={LINK_PULL_REQUEST}
      description={LINK_PULL_REQUEST_DESCRIPTION}
      name="Security Case > Response Plan > Link Pull Request"
      submitButtonText={LINK_PULL_REQUEST}
      isSubmitting={isSubmitting}
      error={error || undefined}
      onClose={props.onClose}
      onSubmit={async (values: JSONObject) => {
        setError("");
        setIsSubmitting(true);

        const address: string =
          typeof values[URL_FIELD] === "string"
            ? (values[URL_FIELD] as string).trim()
            : String(values[URL_FIELD] || "").trim();

        try {
          const link: SecurityCasePullRequest = new SecurityCasePullRequest();
          link.securityCaseId = props.securityCaseId;
          link.pullRequestUrl = URL.fromString(
            HAS_SCHEME.test(address) ? address : `https://${address}`,
          );

          await ModelAPI.create<SecurityCasePullRequest>({
            model: link,
            modelType: SecurityCasePullRequest,
          });

          const parsed: PullRequestLink | null = parsePullRequestLink(address);

          Toast.success(
            translator.translateTemplate(LINKED_PULL_REQUEST_TOAST, {
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
            placeholder: "https://github.com/acme/search/pull/482",
            required: true,
          },
        ],
      }}
    />
  );
};

export interface LinkPullRequestButtonProps {
  isDisabled: boolean;
  tooltip?: string | undefined;
  onClick: () => void;
}

// The step's one action: Link Pull Request.
export const LinkPullRequestButton: FunctionComponent<
  LinkPullRequestButtonProps
> = (props: LinkPullRequestButtonProps): ReactElement => {
  return (
    <Button
      title={LINK_PULL_REQUEST}
      buttonStyle={ButtonStyleType.NORMAL}
      buttonSize={ButtonSize.Small}
      icon={IconProp.Link}
      disabled={props.isDisabled}
      tooltip={props.tooltip}
      dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.linkPullRequest}
      onClick={props.onClick}
    />
  );
};
