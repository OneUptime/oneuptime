import Route from "Common/Types/API/Route";
import { getCloudResourceTypeText } from "Common/Types/Cloud/CloudResourceCatalog";
import {
  CloudTagMissingJSON,
  CloudTagUntaggedResourceJSON,
} from "Common/Types/Cloud/CloudTagCoverage";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { formatCloudMoney } from "./CloudCostWords";
import {
  COMMAND_COPIED,
  COPY_COMMAND,
  SUGGESTED_VALUE,
  UNTAGGED_DECLARED_IN_CODE,
  UNTAGGED_DESCRIPTION,
  UNTAGGED_EMPTY,
  UNTAGGED_MORE,
  UNTAGGED_NO_SPEND,
  UNTAGGED_TITLE,
  getMissingProblemText,
  getSuggestionSourceText,
} from "./CloudTagWords";

/*
 * THE RESOURCES THAT LACK A REQUIRED TAG, THE COSTLIEST FIRST (#11012).
 *
 * Each says what it is, what it cost over the last 30 days, which tags it
 * lacks (or carries a value not allowed for), the value OneUptime suggests
 * and where that comes from, and how to apply it: the code that declares
 * it, when its tags say - a tag set in the cloud would be taken off by the
 * next deploy - or else the one command that tags it in its cloud, to
 * copy. Nothing here changes the cloud.
 */

export const UNTAGGED_CARD_ID: string = "missing-tags";

// The commands that apply a resource's suggested tags, one a line.
export function getUntaggedCommands(
  resource: Pick<CloudTagUntaggedResourceJSON, "missing" | "declaredCode">,
): string {
  if (resource.declaredCode) {
    return "";
  }

  return resource.missing
    .map((missing: CloudTagMissingJSON): string => {
      return missing.command || "";
    })
    .filter((command: string): boolean => {
      return command.length > 0;
    })
    .join("\n");
}

const MissingTag: FunctionComponent<{
  missing: CloudTagMissingJSON;
}> = (props: { missing: CloudTagMissingJSON }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li
      className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs"
      data-testid="cloud-untagged-missing"
      data-key={props.missing.key}
      data-problem={props.missing.problem}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <bdi className="font-mono font-semibold text-gray-900">
          {props.missing.key}
        </bdi>
        <span className="text-amber-700">
          {getMissingProblemText({ missing: props.missing, translator })}
        </span>
        {props.missing.suggestion ? (
          <span
            className="text-gray-700"
            data-testid="cloud-untagged-suggestion"
          >
            <TranslatedSentence
              template={SUGGESTED_VALUE}
              slots={{
                value: (
                  <bdi className="font-mono font-semibold text-emerald-700">
                    {props.missing.suggestion.value}
                  </bdi>
                ),
              }}
            />
          </span>
        ) : (
          <></>
        )}
      </div>
      {props.missing.suggestion ? (
        <p className="mt-0.5 text-gray-500">
          {getSuggestionSourceText({
            suggestion: props.missing.suggestion,
            translator,
          })}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
};

const UntaggedRow: FunctionComponent<{
  resource: CloudTagUntaggedResourceJSON;
  showAccount: boolean;
}> = (props: {
  resource: CloudTagUntaggedResourceJSON;
  showAccount: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const resource: CloudTagUntaggedResourceJSON = props.resource;
  const commands: string = getUntaggedCommands(resource);

  return (
    <li
      className="py-4 first:pt-0 last:pb-0"
      data-testid="cloud-untagged-row"
      data-resource={resource.cloudResourceId}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
              { modelId: new ObjectID(resource.cloudResourceId) },
            )}
            className="break-words text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <bdi>{resource.name}</bdi>
          </AppLink>
          <p className="mt-0.5 text-xs text-gray-500">
            <span>
              {getCloudResourceTypeText(
                resource.provider,
                resource.type,
                translator,
              )}
            </span>
            {props.showAccount && resource.accountName ? (
              <>
                <span aria-hidden="true">{" · "}</span>
                <bdi>{resource.accountName}</bdi>
              </>
            ) : (
              <></>
            )}
          </p>
        </div>
        <span
          className={`text-sm tabular-nums ${
            resource.spend === null
              ? "text-gray-500"
              : "font-semibold text-gray-900"
          }`}
          data-testid="cloud-untagged-spend"
        >
          {resource.spend === null
            ? translator.translateText(UNTAGGED_NO_SPEND) || UNTAGGED_NO_SPEND
            : formatCloudMoney({
                amount: resource.spend,
                currency: resource.currency,
                translator,
              })}
        </span>
      </div>

      <ul className="mt-2 flex flex-wrap gap-2">
        {resource.missing.map((missing: CloudTagMissingJSON): ReactElement => {
          return <MissingTag key={missing.key} missing={missing} />;
        })}
      </ul>

      {resource.declaredCode ? (
        <div
          className="mt-2 flex items-start gap-2 text-xs text-gray-600"
          data-testid="cloud-untagged-declared"
        >
          <Icon
            icon={IconProp.Code}
            className="mt-px h-4 w-4 flex-none text-gray-500"
          />
          <span className="min-w-0">
            {translator.translateTemplate(UNTAGGED_DECLARED_IN_CODE, {
              code: resource.declaredCode,
            })}
          </span>
        </div>
      ) : commands ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2"
          data-testid="cloud-untagged-command"
        >
          <code
            className="min-w-0 max-w-full flex-1 truncate rounded bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100"
            dir="ltr"
          >
            {commands.split("\n")[0]}
          </code>
          <CopyTextButton
            textToBeCopied={commands}
            size="sm"
            variant="soft"
            label={translator.translateText(COPY_COMMAND) || COPY_COMMAND}
            copiedLabel={
              translator.translateText(COMMAND_COPIED) || COMMAND_COPIED
            }
          />
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

export const CloudUntaggedResourcesCard: FunctionComponent<{
  resources: Array<CloudTagUntaggedResourceJSON>;
  count: number;
  showAccount: boolean;
}> = (props: {
  resources: Array<CloudTagUntaggedResourceJSON>;
  count: number;
  showAccount: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div id={UNTAGGED_CARD_ID}>
      <Card title={UNTAGGED_TITLE} description={UNTAGGED_DESCRIPTION}>
        <div data-testid="cloud-untagged" data-count={props.count}>
          {props.resources.length === 0 ? (
            <p
              className="text-sm text-gray-500"
              data-testid="cloud-untagged-empty"
            >
              {translator.translateText(UNTAGGED_EMPTY) || UNTAGGED_EMPTY}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100">
                {props.resources.map(
                  (resource: CloudTagUntaggedResourceJSON): ReactElement => {
                    return (
                      <UntaggedRow
                        key={resource.cloudResourceId}
                        resource={resource}
                        showAccount={props.showAccount}
                      />
                    );
                  },
                )}
              </ul>
              {props.count > props.resources.length ? (
                <p
                  className="mt-4 text-xs text-gray-500"
                  data-testid="cloud-untagged-more"
                >
                  {translator.translateTemplate(UNTAGGED_MORE, {
                    shown: translator.formatNumber(props.resources.length),
                    count: translator.formatNumber(props.count),
                  })}
                </p>
              ) : (
                <></>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
};
