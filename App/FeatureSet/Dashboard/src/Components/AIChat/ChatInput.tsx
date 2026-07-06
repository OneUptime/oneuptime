import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  isSending: boolean;
  onSend: (content: string) => void;
}

const ChatInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [content, setContent] = useState<string>("");

  const send: () => void = (): void => {
    if (!content.trim() || props.isSending) {
      return;
    }
    props.onSend(content.trim());
    setContent("");
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <TextArea
        value={content}
        placeholder="Ask about your logs, traces, metrics, incidents…"
        onChange={(value: string) => {
          setContent(value);
        }}
      />
      <div className="mt-2 flex justify-end">
        <Button
          title="Send"
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={props.isSending}
          disabled={!content.trim()}
          onClick={() => {
            send();
          }}
        />
      </div>
    </div>
  );
};

export default ChatInput;
