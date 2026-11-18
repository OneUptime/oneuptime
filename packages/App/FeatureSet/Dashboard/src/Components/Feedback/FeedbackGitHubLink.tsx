import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "ALSO TELL ONEUPTIME IN A PUBLIC GITHUB ISSUE" (issues #6832, #7462).
 *
 * On a self-hosted server, once words were sent to its admins, the person
 * may also tell OneUptime: a new issue on OneUptime's GitHub with their
 * words, the page and the version filled in (FeedbackPage's
 * getFeedbackGitHubIssueUrl). The link says it is public, and the line
 * under it that nothing is posted until they post it themselves: "Also
 * tell OneUptime on GitHub" sat under "nothing leaves this server", which
 * read as if it were about the link (#7462). It is drawn only after the
 * words were sent, below what was said of where they went.
 */

export interface ComponentProps {
  href: string;
  dataTestId: string;
}

export const FEEDBACK_GITHUB_HINT_TEST_ID: string = "feedback-github-hint";

const FeedbackGitHubLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="space-y-0.5">
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        data-testid={props.dataTestId}
      >
        {translator.translateText(
          "Also tell OneUptime in a public GitHub issue",
        )}
        <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5 shrink-0" />
      </a>
      <p
        className="text-xs text-gray-500"
        data-testid={FEEDBACK_GITHUB_HINT_TEST_ID}
      >
        {translator.translateText(
          "It opens with your words filled in, and nothing is posted until you post it.",
        )}
      </p>
    </div>
  );
};

export default FeedbackGitHubLink;
