import UserElement from "./User";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  users?: Array<User>;
  prefix?: string | undefined;
  suffix?: string | undefined;
  suffixClassName?: string | undefined;
  usernameClassName?: string | undefined;
  prefixClassName?: string | undefined;
  emailClassName?: string | undefined;
  hideEmail?: boolean | undefined;
}

const UsersElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.users || props.users.length === 0) {
    return <p>{translator.translateText("No users.")}</p>;
  }

  return (
    <div className="space-y-2 mt-2 mb-2">
      {props.users?.map((user: User) => {
        return (
          <UserElement
            key={user.id?.toString()}
            user={user}
            prefix={props.prefix}
            suffix={props.suffix}
            suffixClassName={props.suffixClassName}
            usernameClassName={props.usernameClassName}
            prefixClassName={props.prefixClassName}
            emailClassName={props.emailClassName}
            hideEmail={props.hideEmail}
          />
        );
      })}
    </div>
  );
};

export default UsersElement;
