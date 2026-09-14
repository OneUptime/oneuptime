import React from "react";
import TestRenderer, {
  act,
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer";
import { findNodeHandle } from "react-native";
import MobileReplayRecorder from "../src/MobileReplayRecorder";
import {
  OneUptimeReplayProvider,
  ReplayMask,
  touchPointFromEvent,
} from "../src/ReplayProvider";
import { FakeAppState, FakeNativeViewTree, MemoryStorage } from "./TestUtils";

function recorder(): MobileReplayRecorder {
  return new MobileReplayRecorder({
    storage: new MemoryStorage(),
    nativeViewTree: new FakeNativeViewTree(),
    appState: new FakeAppState(),
  });
}

describe("OneUptimeReplayProvider", () => {
  test("prefers page coordinates because nested location values are not root-relative", () => {
    expect(
      touchPointFromEvent({
        nativeEvent: {
          pageX: 120,
          pageY: 240,
          locationX: 3,
          locationY: 4,
        },
      } as never),
    ).toEqual({ x: 120, y: 240 });
  });

  test("registers its non-collapsable root and forwards touch phases", async () => {
    const instance: MobileReplayRecorder = recorder();
    const setRootTag: jest.SpiedFunction<MobileReplayRecorder["setRootTag"]> =
      jest.spyOn(instance, "setRootTag");
    const recordTouch: jest.SpiedFunction<MobileReplayRecorder["recordTouch"]> =
      jest.spyOn(instance, "recordTouch");
    let renderer: ReactTestRenderer;
    await act(async (): Promise<void> => {
      renderer = TestRenderer.create(
        <OneUptimeReplayProvider recorder={instance} stopOnUnmount={false}>
          <ReplayMask>
            <React.Fragment>secret subtree</React.Fragment>
          </ReplayMask>
        </OneUptimeReplayProvider>,
      );
    });

    expect(findNodeHandle).toHaveBeenCalled();
    expect(setRootTag).toHaveBeenCalledWith(101);
    const views: Array<ReactTestInstance> = renderer!.root.findAll(
      (node: ReactTestInstance): boolean => {
        return String(node.type) === "View";
      },
    );
    const providerRoot: ReactTestInstance | undefined = views.find(
      (node: ReactTestInstance): boolean => {
        return typeof node.props["onTouchStart"] === "function";
      },
    );
    expect(providerRoot?.props["collapsable"]).toBe(false);
    act((): void => {
      providerRoot?.props["onTouchStart"]({
        nativeEvent: {
          pageX: 33,
          pageY: 44,
          locationX: 1,
          locationY: 2,
          target: 201,
          identifier: 7,
        },
      });
      providerRoot?.props["onTouchMove"]({
        nativeEvent: { pageX: 34, pageY: 45, target: 201, identifier: 7 },
      });
      providerRoot?.props["onTouchEnd"]({
        nativeEvent: { pageX: 35, pageY: 46, target: 201, identifier: 7 },
      });
    });
    expect(recordTouch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        phase: "start",
        x: 33,
        y: 44,
        targetTag: 201,
        pointerId: 7,
      }),
    );
    expect(recordTouch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ phase: "move", x: 34, y: 45 }),
    );
    expect(recordTouch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ phase: "end", x: 35, y: 46 }),
    );
    await act(async (): Promise<void> => {
      return renderer!.unmount();
    });
    expect(setRootTag).toHaveBeenLastCalledWith(null);
  });

  test("ReplayMask emits an unoverrideable native traversal boundary", async () => {
    let renderer: ReactTestRenderer;
    await act(async (): Promise<void> => {
      renderer = TestRenderer.create(
        <ReplayMask>
          <React.Fragment>never serialized</React.Fragment>
        </ReplayMask>,
      );
    });
    const view: ReactTestInstance = renderer!.root.find(
      (node: ReactTestInstance): boolean => {
        return String(node.type) === "View";
      },
    );
    expect(view.props).toMatchObject({
      collapsable: false,
      nativeID: "oneuptime-replay-mask",
      testID: "oneuptime-replay-mask",
    });
    await act(async (): Promise<void> => {
      return renderer!.unmount();
    });
  });
});
