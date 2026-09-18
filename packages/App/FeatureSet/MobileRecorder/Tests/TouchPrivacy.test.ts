import { NativeViewKind, NativeViewTreeNode } from "../src/NativeViewTree";
import {
  CONSERVATIVE_TOUCH_PRIVACY_MAP,
  deriveTouchPrivacyMap,
  isTouchPrivate,
  TouchPrivacyMap,
} from "../src/TouchPrivacy";

function root(children: Array<NativeViewTreeNode>): NativeViewTreeNode {
  return {
    nativeId: 1,
    kind: "view",
    x: 0,
    y: 0,
    touchOriginX: 50,
    touchOriginY: 100,
    width: 390,
    height: 844,
    children,
  };
}

describe("opaque-region touch privacy", () => {
  test("uses the nonzero RootReactView-relative origin, never a window/screen offset", () => {
    const tree: NativeViewTreeNode = root([
      {
        nativeId: 2,
        kind: "masked",
        x: 5,
        y: 7,
        width: 40,
        height: 50,
        children: [],
      },
    ]);
    tree["screenX"] = 250;
    tree["screenY"] = 300;
    const map: TouchPrivacyMap = deriveTouchPrivacyMap(tree);
    expect(isTouchPrivate(map, 60, 115)).toBe(true);
    expect(isTouchPrivate(map, 260, 315)).toBe(false);
  });

  test("accumulates nested parent-relative geometry from the native root origin", () => {
    const map: TouchPrivacyMap = deriveTouchPrivacyMap(
      root([
        {
          nativeId: 2,
          kind: "view",
          x: 10,
          y: 20,
          width: 200,
          height: 200,
          children: [
            {
              nativeId: 3,
              kind: "masked",
              masked: true,
              x: 5,
              y: 7,
              width: 40,
              height: 50,
              children: [],
            },
          ],
        },
      ]),
    );
    expect(map).toEqual({
      suppressAll: false,
      regions: [{ left: 65, top: 127, right: 105, bottom: 177 }],
    });
    expect(isTouchPrivate(map, 80, 140)).toBe(true);
    expect(isTouchPrivate(map, 64, 140)).toBe(false);
  });

  test.each(["image", "webview", "canvas", "masked"])(
    "treats %s frames as opaque",
    (kind: string) => {
      const map: TouchPrivacyMap = deriveTouchPrivacyMap(
        root([
          {
            nativeId: 2,
            kind: kind as NativeViewKind,
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            children: [],
          },
        ]),
      );
      expect(isTouchPrivate(map, 65, 115)).toBe(true);
    },
  );

  test("fails closed when an opaque rectangle cannot be aligned", () => {
    const tree: NativeViewTreeNode = root([
      {
        nativeId: 2,
        kind: "image",
        x: 1,
        y: 2,
        width: 10,
        height: 10,
        children: [],
      },
    ]);
    delete tree.touchOriginX;
    delete tree.touchOriginY;
    expect(deriveTouchPrivacyMap(tree).suppressAll).toBe(true);
    expect(isTouchPrivate(CONSERVATIVE_TOUCH_PRIVACY_MAP, 0, 0)).toBe(true);
  });
});
