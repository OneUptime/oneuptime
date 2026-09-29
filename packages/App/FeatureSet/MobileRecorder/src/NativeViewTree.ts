import { Dimensions, NativeModules, Platform } from "react-native";

export type NativeViewKind =
  | "view"
  | "scroll"
  | "button"
  | "text"
  | "input"
  | "image"
  | "webview"
  | "canvas"
  | "masked"
  | "unknown";

export interface NativeViewTreeNode {
  nativeId: number | string;
  kind: NativeViewKind | string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Root-only origin in React Native pageX/pageY coordinates; never uploaded. */
  touchOriginX?: number;
  /** Root-only origin in React Native pageX/pageY coordinates; never uploaded. */
  touchOriginY?: number;
  opaque?: boolean;
  masked?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  zIndex?: number;
  /** Count omitted by the bounded native traversal, present on the root. */
  truncatedNodes?: number;
  children?: Array<NativeViewTreeNode>;
  /* Unknown native fields are deliberately ignored by the serialiser. */
  [key: string]: unknown;
}

export interface NativeAppMetadata {
  appName: string;
  appVersion: string;
  osName: string;
  osVersion: string;
}

export interface NativeViewTreeAdapter {
  isAvailable?(): boolean;
  captureViewTree(rootTag: number): Promise<NativeViewTreeNode>;
  getAppMetadata(): Promise<NativeAppMetadata>;
  isTouchTargetPrivate?(
    targetTag: number,
    replayRootTag: number,
  ): Promise<boolean>;
}

interface NativeModuleShape {
  captureViewTree?(rootTag: number): Promise<NativeViewTreeNode>;
  getAppMetadata?(): Promise<Partial<NativeAppMetadata>>;
  isTouchTargetPrivate?(
    targetTag: number,
    replayRootTag: number,
  ): Promise<boolean>;
}

function viewport(): { width: number; height: number } {
  const dimensions: { width?: number; height?: number } = Dimensions.get(
    "window",
  ) as { width?: number; height?: number };
  return {
    width:
      typeof dimensions.width === "number" && Number.isFinite(dimensions.width)
        ? dimensions.width
        : 0,
    height:
      typeof dimensions.height === "number" &&
      Number.isFinite(dimensions.height)
        ? dimensions.height
        : 0,
  };
}

export class ReactNativeViewTreeAdapter implements NativeViewTreeAdapter {
  public isAvailable(): boolean {
    const nativeModule: NativeModuleShape | undefined = (
      NativeModules as Record<string, NativeModuleShape | undefined>
    )["OneUptimeReplayViewTree"];
    return typeof nativeModule?.captureViewTree === "function";
  }

  public async captureViewTree(rootTag: number): Promise<NativeViewTreeNode> {
    const nativeModule: NativeModuleShape | undefined = (
      NativeModules as Record<string, NativeModuleShape | undefined>
    )["OneUptimeReplayViewTree"];

    if (nativeModule?.captureViewTree) {
      return await nativeModule.captureViewTree(rootTag);
    }

    throw new Error(
      "OneUptime replay native module is unavailable. Expo Go is not supported; use an autolinked native or Expo development build.",
    );
  }

  public async getAppMetadata(): Promise<NativeAppMetadata> {
    const nativeModule: NativeModuleShape | undefined = (
      NativeModules as Record<string, NativeModuleShape | undefined>
    )["OneUptimeReplayViewTree"];
    let metadata: Partial<NativeAppMetadata> = {};

    try {
      metadata = (await nativeModule?.getAppMetadata?.()) ?? {};
    } catch {
      metadata = {};
    }

    return {
      appName:
        typeof metadata.appName === "string"
          ? metadata.appName
          : "React Native",
      appVersion:
        typeof metadata.appVersion === "string"
          ? metadata.appVersion
          : "unknown",
      osName:
        typeof metadata.osName === "string" ? metadata.osName : Platform.OS,
      osVersion:
        typeof metadata.osVersion === "string"
          ? metadata.osVersion
          : String(Platform.Version),
    };
  }

  public async isTouchTargetPrivate(
    targetTag: number,
    replayRootTag: number,
  ): Promise<boolean> {
    const nativeModule: NativeModuleShape | undefined = (
      NativeModules as Record<string, NativeModuleShape | undefined>
    )["OneUptimeReplayViewTree"];
    if (typeof nativeModule?.isTouchTargetPrivate !== "function") {
      return true;
    }
    try {
      return (
        (await nativeModule.isTouchTargetPrivate(targetTag, replayRootTag)) !==
        false
      );
    } catch {
      return true;
    }
  }
}

export const defaultNativeViewTreeAdapter: NativeViewTreeAdapter =
  new ReactNativeViewTreeAdapter();

export function getViewport(): { width: number; height: number } {
  return viewport();
}
