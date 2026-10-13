import React, { FunctionComponent, ReactElement, useState } from "react";
import User from "../../../Models/DatabaseModels/User";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import Image from "../Image/Image";
import BlankProfilePic from "../../Images/users/blank-profile.svg";
import UserUtil from "../../Utils/User";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Tooltip from "../Tooltip/Tooltip";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ConfirmModal from "../Modal/ConfirmModal";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export interface FeedItemProps {
  key: string;
  textInMarkdown: string;
  element?: ReactElement;
  moreTextInMarkdown?: string;
  user?: User | undefined;
  /*
   * The project API key that made the change, by the name it had then,
   * when no person did (IncidentFeed.apiKeyName): shown in the author's
   * place, marked as an API key.
   */
  apiKeyName?: string | undefined;
  itemDateTime: Date;
  icon: IconProp;
  color: Color;
  safeMode?: boolean | undefined;
}

export interface ComponentProps extends FeedItemProps {
  isLastItem: boolean;
}

const FeedItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showMoreInformationModal, setShowMoreInformationModal] =
    useState<boolean>(false);

  const getMoreInformationModal: GetReactElementFunction = (): ReactElement => {
    if (showMoreInformationModal) {
      return (
        <ConfirmModal
          title={`More Information`}
          description={
            <div>
              <MarkdownViewer
                text={props.moreTextInMarkdown || ""}
                safeMode={props.safeMode === true}
              />
            </div>
          }
          isLoading={false}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setShowMoreInformationModal(false);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      );
    }

    return <></>;
  };

  const getUserIcon: GetReactElementFunction = (): ReactElement => {
    const userImageUrl: string = props.user?.id
      ? UserUtil.getProfilePictureRoute(props.user.id as ObjectID).toString()
      : BlankProfilePic;

    return (
      <div>
        <Image
          className="flex size-10 items-center justify-center rounded-full bg-gray-400 ring-8 ring-white"
          imageUrl={userImageUrl}
        />

        {props.icon && (
          <span className="absolute -bottom-0.5 -right-1 rounded-tl bg-white px-0.5 py-px">
            <Icon
              className="size-5 text-gray-500"
              icon={props.icon}
              color={props.color}
            />
          </span>
        )}
      </div>
    );
  };

  // The author when it is an API key: a key in the avatar's place.
  const getApiKeyIcon: GetReactElementFunction = (): ReactElement => {
    return (
      <div data-testid="feed-item-api-key-avatar">
        <div className="flex size-10 items-center justify-center rounded-full bg-gray-100 ring-8 ring-white">
          <Icon className="size-5 text-gray-500" icon={IconProp.Key} />
        </div>

        {props.icon && (
          <span className="absolute -bottom-0.5 -right-1 rounded-tl bg-white px-0.5 py-px">
            <Icon
              className="size-5 text-gray-500"
              icon={props.icon}
              color={props.color}
            />
          </span>
        )}
      </div>
    );
  };

  const apiKeyName: string = (!props.user && props.apiKeyName?.trim()) || "";

  const getItem: GetReactElementFunction = (): ReactElement => {
    return (
      <li key={props.key}>
        <div className="relative pb-8">
          {!props.isLastItem && (
            <span
              className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-gray-200"
              aria-hidden="true"
            ></span>
          )}
          <div className="relative flex items-start space-x-3">
            <div className="relative">
              {props.user && getUserIcon()}
              {!props.user && apiKeyName && getApiKeyIcon()}
              {!props.user && !apiKeyName && props.icon && getIconItem()}
            </div>
            <div className="min-w-0 flex-1">
              <div>
                {props.user?.name && (
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">
                      {props.user?.name?.toString() ||
                        translator.translateText("Unknown User")}
                    </div>
                  </div>
                )}
                {apiKeyName && (
                  <div
                    className="flex flex-wrap items-center gap-x-2 text-sm"
                    data-testid="feed-item-api-key"
                  >
                    <span className="break-all font-medium text-gray-900">
                      {apiKeyName}
                    </span>
                    <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                      {translator.translateText("API key")}
                    </span>
                  </div>
                )}
                <div className="mt-0.5 text-sm text-gray-500 w-fit">
                  <Tooltip
                    text={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      props.itemDateTime,
                    )}
                  >
                    <div className="w-fit">
                      {OneUptimeDate.fromNow(props.itemDateTime)}
                    </div>
                  </Tooltip>
                </div>
              </div>
              <div className="mt-2 text-sm text-gray-700">
                {props.textInMarkdown && (
                  <div>
                    <MarkdownViewer
                      text={props.textInMarkdown}
                      safeMode={props.safeMode === true}
                    />
                  </div>
                )}
                {props.element && <div>{props.element}</div>}
                {props.moreTextInMarkdown && (
                  <div className="-ml-3 w-fit">
                    <Button
                      onClick={() => {
                        return setShowMoreInformationModal(true);
                      }}
                      title="More Information"
                      buttonStyle={ButtonStyleType.NORMAL}
                      buttonSize={ButtonSize.Small}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {getMoreInformationModal()}
      </li>
    );
  };

  const getIconItem: GetReactElementFunction = (): ReactElement => {
    if (!props.icon) {
      return <></>;
    }
    return (
      <div className="flex size-10 items-center justify-center rounded-full bg-gray-100 ring-10 ring-white">
        <Icon
          className="size-5 text-gray-500"
          icon={props.icon}
          color={props.color}
        />
      </div>
    );
  };

  return getItem();
};

export default FeedItem;
