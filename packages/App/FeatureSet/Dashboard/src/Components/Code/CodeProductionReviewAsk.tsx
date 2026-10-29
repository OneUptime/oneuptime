import CodeApi from "./CodeApi";
import { getTaskRoute } from "./CodePaths";
import {
  PRODUCTION_REVIEW_ASK_COPY,
  inReviewHostWords,
} from "./CodeProductionReviewCopy";
import { ProductionReviewUtil } from "Common/Types/CodeRepository/ProductionReview";
import Exception from "Common/Types/Exception/Exception";
import IconProp from "Common/Types/Icon/IconProp";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const CODE_PRODUCTION_REVIEW_ASK_TEST_ID: string =
  "code-production-review-ask";

export interface ComponentProps {
  repositoryId: string;
  // Where the repository is hosted: GitLab's words say merge request.
  provider?: string | undefined;
}

/*
 * Review a pull request, on a repository's Production Reviews page: a quiet
 * button beside the list's heading that asks for one number - any of the
 * repository's open pull requests, one from a fork, a bot or anyone else
 * too, which is never reviewed on its own - then opens the review's page,
 * where it is reviewed within a minute. The number may be written as the
 * host writes it ("#12", GitLab's "!12"). What the server refuses (no such
 * pull request, a closed one, a connection that stopped working) is said in
 * the dialog, which keeps what was typed.
 */
const CodeProductionReviewAsk: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: (sentence: string) => string = (sentence: string): string => {
    const inHostWords: string = inReviewHostWords(sentence, props.provider);

    return translator.translateText(inHostWords) || inHostWords;
  };

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [number, setNumber] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const isNumber: boolean =
    ProductionReviewUtil.readPullRequestNumber(number) !== null;

  const ask: () => Promise<void> = async (): Promise<void> => {
    const pullRequestNumber: number | null =
      ProductionReviewUtil.readPullRequestNumber(number);

    if (pullRequestNumber === null || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const taskId: string = await CodeApi.reviewPullRequest({
        repositoryId: props.repositoryId,
        number: pullRequestNumber,
      });

      Navigation.navigate(getTaskRoute(taskId));
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid={CODE_PRODUCTION_REVIEW_ASK_TEST_ID}
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
        className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon
          icon={IconProp.DocumentMagnifyingGlass}
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
        />
        {words(PRODUCTION_REVIEW_ASK_COPY.button)}
      </button>
      {isOpen ? (
        <Modal
          title={words(PRODUCTION_REVIEW_ASK_COPY.button)}
          modalWidth={ModalWidth.Normal}
          onClose={() => {
            setIsOpen(false);
            setIsLoading(false);
          }}
          onSubmit={() => {
            void ask();
          }}
          submitButtonText={translator.translateText(
            PRODUCTION_REVIEW_ASK_COPY.submit,
          )}
          isLoading={isLoading}
          disableSubmitButton={!isNumber}
          error={error || undefined}
        >
          <div data-testid="code-production-review-ask-dialog">
            <FieldLabelElement
              title={inReviewHostWords(
                PRODUCTION_REVIEW_ASK_COPY.numberTitle,
                props.provider,
              )}
              htmlFor="code-production-review-ask-number"
              required={true}
              description={inReviewHostWords(
                PRODUCTION_REVIEW_ASK_COPY.numberDescription,
                props.provider,
              )}
            />
            <div className="mt-2">
              <Input
                id="code-production-review-ask-number"
                dataTestId="code-production-review-ask-number"
                type={InputType.TEXT}
                value={number}
                placeholder="12"
                disableSpellCheck={true}
                autoComplete="off"
                onChange={(value: string) => {
                  setNumber(value);
                }}
                onEnterPress={() => {
                  void ask();
                }}
              />
            </div>
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </>
  );
};

export default CodeProductionReviewAsk;
