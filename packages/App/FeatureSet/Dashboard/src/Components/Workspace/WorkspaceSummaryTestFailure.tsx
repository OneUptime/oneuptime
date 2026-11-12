import React, { FunctionComponent, ReactElement } from "react";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import {
  BULK_RESULT_MORE_NAMES,
  BulkItemGroup,
  getBulkResultNamesShown,
  groupItemsByReason,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { WorkspaceSummaryTestChannel } from "Common/Types/Workspace/NotificationSummary/WorkspaceSummaryTestChannel";

/*
 * SEND TEST NOW'S "TEST FAILED", CHANNEL BY CHANNEL (#6920).
 *
 * The test route answers a test that a channel did not get with each
 * channel and what became of it there (WorkspaceSummaryTestChannel). The
 * dialog says, in the reader's language, how many channels did not get it
 * - the red line at its top - then lists each of them under the reason the
 * workspace gave, in its own words, and ends with what to do next. Channels
 * that share a reason (a project not connected, a Microsoft Teams team not
 * found) are listed under it once, as a bulk action lists its failures
 * (groupItemsByReason). Before, the server's one English paragraph ran
 * every channel and reason together.
 */

// How many channels did not get the test, when none got it.
export const WORKSPACE_SUMMARY_TEST_NOT_POSTED: PluralTemplate = {
  one: "The test summary was not posted.",
  other: "The test summary was not posted in any of its {{count}} channels.",
};

// How many channels did not get the test, when the others did.
export const WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME: PluralTemplate = {
  one: "The test summary was not posted in {{failed}} of its {{count}} channel.",
  other:
    "The test summary was not posted in {{failed}} of its {{count}} channels.",
};

/*
 * What to do next, under the reasons: one for a failure that has one
 * reason, the other for one with several.
 */
export const WORKSPACE_SUMMARY_TEST_NEXT_STEP: PluralTemplate = {
  one: "Fix the problem above, then send the test again.",
  other: "Fix the problems above, then send the test again.",
};

export const WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID: string =
  "workspace-summary-test-channels";

// The channels of a test that were not posted in.
export const getChannelsNotPostedIn: (
  channels: Array<WorkspaceSummaryTestChannel>,
) => Array<WorkspaceSummaryTestChannel> = (
  channels: Array<WorkspaceSummaryTestChannel>,
): Array<WorkspaceSummaryTestChannel> => {
  return channels.filter((channel: WorkspaceSummaryTestChannel): boolean => {
    return !channel.isPosted;
  });
};

/*
 * The channels not posted in, under the reason each was given, in the
 * order the summary names them.
 */
export const getNotPostedGroups: (
  channels: Array<WorkspaceSummaryTestChannel>,
) => Array<BulkItemGroup> = (
  channels: Array<WorkspaceSummaryTestChannel>,
): Array<BulkItemGroup> => {
  return groupItemsByReason(
    getChannelsNotPostedIn(channels).map(
      (channel: WorkspaceSummaryTestChannel) => {
        return {
          name: channel.channelName,
          message: channel.reason || "",
        };
      },
    ),
  );
};

/*
 * The red line at the top of Test Failed: how many of the summary's
 * channels did not get the test, in the reader's language. Undefined when
 * every channel got it - there is no failure to say.
 */
export const getWorkspaceSummaryTestLead: (
  translator: Translator,
  channels: Array<WorkspaceSummaryTestChannel>,
) => string | undefined = (
  translator: Translator,
  channels: Array<WorkspaceSummaryTestChannel>,
): string | undefined => {
  const notPostedCount: number = getChannelsNotPostedIn(channels).length;

  if (notPostedCount === 0) {
    return undefined;
  }

  if (notPostedCount === channels.length) {
    return translator.translatePlural(
      WORKSPACE_SUMMARY_TEST_NOT_POSTED,
      channels.length,
    );
  }

  return translator.translatePlural(
    WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME,
    channels.length,
    { failed: translator.formatNumber(notPostedCount) },
  );
};

/*
 * Whether the channels' names go unsaid: two or more channels, none of
 * which got the test, all for one reason - a project not connected, a
 * Microsoft Teams team not found, Slack refusing every post. That reason is
 * the summary's, not a channel's, so it is said once, without listing every
 * channel the line above has counted. A summary of one channel keeps its
 * name, over whatever the workspace said of it.
 */
export const isOneReasonForEveryChannel: (
  channels: Array<WorkspaceSummaryTestChannel>,
) => boolean = (channels: Array<WorkspaceSummaryTestChannel>): boolean => {
  return (
    channels.length > 1 &&
    getChannelsNotPostedIn(channels).length === channels.length &&
    getNotPostedGroups(channels).length === 1
  );
};

// What to do next, for a failure with this many reasons.
export const getWorkspaceSummaryTestNextStep: (
  translator: Translator,
  reasonCount: number,
) => string = (translator: Translator, reasonCount: number): string => {
  return translator.translatePlural(
    WORKSPACE_SUMMARY_TEST_NEXT_STEP,
    Math.max(reasonCount, 1),
  );
};

export interface ComponentProps {
  // Every channel of the test, posted in or not, in the summary's order.
  channels: Array<WorkspaceSummaryTestChannel>;
}

const WorkspaceSummaryTestFailure: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const groups: Array<BulkItemGroup> = getNotPostedGroups(props.channels);
  const isNamesLeftOut: boolean = isOneReasonForEveryChannel(props.channels);

  return (
    <div className="space-y-4 whitespace-normal">
      <ul
        className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200"
        data-testid={WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}
      >
        {groups.map((group: BulkItemGroup, index: number): ReactElement => {
          // A long group's first channels, and how many more it holds.
          const shownNames: Array<string> = isNamesLeftOut
            ? []
            : getBulkResultNamesShown(group.names);
          const moreCount: number = isNamesLeftOut
            ? 0
            : group.names.length - shownNames.length;
          const reason: string =
            typeof group.message === "string" ? group.message : "";

          /*
           * A channel's name and the workspace's reason - English, as the
           * workspace wrote it - read the way they are written: on an
           * Arabic page each is a block of its own at the page's start,
           * each of its lines from its own start (IsolatedLine), so a long
           * name or reason that wraps still reads as one.
           */
          return (
            <li
              key={index}
              className="px-4 py-3"
              data-testid={`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-group`}
            >
              {shownNames.length > 0 ? (
                <ul className="space-y-0.5">
                  {shownNames.map((name: string, nameIndex: number) => {
                    return (
                      <li key={nameIndex}>
                        <IsolatedLine
                          text={name}
                          className="break-words font-medium text-gray-900 [overflow-wrap:anywhere]"
                          dataTestId={`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <></>
              )}
              {moreCount > 0 ? (
                <p className="mt-0.5 font-medium text-gray-500">
                  {translator.translateTemplate(BULK_RESULT_MORE_NAMES, {
                    remaining: translator.formatNumber(moreCount),
                  })}
                </p>
              ) : (
                <></>
              )}
              {reason ? (
                <IsolatedLine
                  as="p"
                  text={reason}
                  className={`${shownNames.length > 0 ? "mt-1 " : ""}break-words text-gray-600 [overflow-wrap:anywhere]`}
                  dataTestId={`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`}
                />
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
      <p data-testid="workspace-summary-test-next-step">
        {getWorkspaceSummaryTestNextStep(translator, groups.length)}
      </p>
    </div>
  );
};

export default WorkspaceSummaryTestFailure;
