import { useOutletContext } from "react-router-dom";

/*
 * What a database's view layout hands its tabs through the router outlet.
 * The page header ("Database - <name>") is read once by the layout's
 * ModelPage, so a tab that renames the database asks the layout to read it
 * again — otherwise the header kept the old name until a reload.
 */
export interface DatabaseViewOutletContext {
  refreshDatabaseHeader: () => void;
}

const NO_OP_CONTEXT: DatabaseViewOutletContext = {
  refreshDatabaseHeader: (): void => {},
};

/**
 * The layout's context, or a no-op one for a tab rendered outside the
 * layout (tests, a future embed), so callers never have to check.
 */
export function useDatabaseViewOutletContext(): DatabaseViewOutletContext {
  const context: DatabaseViewOutletContext | undefined = useOutletContext<
    DatabaseViewOutletContext | undefined
  >();
  return context && typeof context.refreshDatabaseHeader === "function"
    ? context
    : NO_OP_CONTEXT;
}
