import { useOutletContext } from "react-router-dom";

/*
 * What a queue's view layout hands its tabs through the router outlet. The
 * page header ("Queue - <name>") is read once by the layout's ModelPage, so
 * a tab that renames the queue asks the layout to read it again — otherwise
 * the header kept the old name until a reload.
 */
export interface MessageQueueViewOutletContext {
  refreshMessageQueueHeader: () => void;
}

const NO_OP_CONTEXT: MessageQueueViewOutletContext = {
  refreshMessageQueueHeader: (): void => {},
};

/**
 * The layout's context, or a no-op one for a tab rendered outside the
 * layout (tests, a future embed), so callers never have to check.
 */
export function useMessageQueueViewOutletContext(): MessageQueueViewOutletContext {
  const context: MessageQueueViewOutletContext | undefined = useOutletContext<
    MessageQueueViewOutletContext | undefined
  >();
  return context && typeof context.refreshMessageQueueHeader === "function"
    ? context
    : NO_OP_CONTEXT;
}
