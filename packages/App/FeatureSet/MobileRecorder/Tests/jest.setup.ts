import React from "react";

(globalThis as unknown as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] =
  true;

const asyncStorageValues: Map<string, string> = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => {
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string): Promise<string | null> => {
        return asyncStorageValues.get(key) ?? null;
      }),
      setItem: jest.fn(async (key: string, value: string): Promise<void> => {
        asyncStorageValues.set(key, value);
      }),
      removeItem: jest.fn(async (key: string): Promise<void> => {
        asyncStorageValues.delete(key);
      }),
    },
  };
});

jest.mock("react-native", () => {
  const listeners: Set<(state: string) => void> = new Set();
  const View: React.ForwardRefExoticComponent<
    Record<string, unknown> & React.RefAttributes<unknown>
  > = React.forwardRef(
    (props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) => {
      return React.createElement(
        "View",
        { ...props, ref },
        props["children"] as React.ReactNode,
      );
    },
  );
  View.displayName = "View";

  return {
    AppState: {
      currentState: "active",
      addEventListener: jest.fn(
        (_type: string, listener: (state: string) => void) => {
          listeners.add(listener);
          return {
            remove: (): void => {
              return void listeners.delete(listener);
            },
          };
        },
      ),
      __emit: (state: string): void => {
        for (const listener of listeners) {
          listener(state);
        }
      },
    },
    Dimensions: {
      get: jest.fn(() => {
        return { width: 390, height: 844 };
      }),
    },
    NativeModules: {},
    Platform: { OS: "ios", Version: "18.0" },
    View,
    findNodeHandle: jest.fn(() => {
      return 101;
    }),
  };
});

beforeEach((): void => {
  asyncStorageValues.clear();
});
