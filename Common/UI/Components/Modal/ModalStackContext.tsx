import React, { Context, useContext } from "react";

export interface ModalStackValue {
  depth: number;
  ownerId: string | null;
}

const defaultModalStackValue: ModalStackValue = {
  depth: 0,
  ownerId: null,
};

/*
 * Tracks how many modal surfaces contain the current component. React context
 * is preserved through portals, which lets nested dialogs and their floating
 * controls share one deterministic overlay scale.
 */
export const ModalStackContext: Context<ModalStackValue> =
  React.createContext<ModalStackValue>(defaultModalStackValue);

export const useModalStack: () => ModalStackValue = (): ModalStackValue => {
  return useContext(ModalStackContext);
};

export const useModalStackDepth: () => number = (): number => {
  return useModalStack().depth;
};
