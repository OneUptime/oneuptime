import {
  RrwebEvent,
  RrwebEventType,
  RrwebIncrementalSource,
  SessionReplayFidelityNotice,
} from "../src/Contract";
import { NativeViewTreeNode } from "../src/NativeViewTree";
import ViewTreeSerializer, {
  SerializedCapture,
} from "../src/ViewTreeSerializer";

function baseTree(
  overrides: Partial<NativeViewTreeNode> = {},
): NativeViewTreeNode {
  return {
    nativeId: 1,
    kind: "view",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    children: [],
    ...overrides,
  };
}

function capture(
  serializer: ViewTreeSerializer,
  tree: NativeViewTreeNode,
): SerializedCapture {
  return serializer.capture(tree, {
    timestamp: 10_000,
    url: "app://com.example.checkout/cart",
    viewportWidth: 390,
    viewportHeight: 844,
  });
}

describe("synthetic rrweb view-tree serialization", () => {
  test("emits rrweb Meta + FullSnapshot with a mobile document shell", () => {
    const result: SerializedCapture = capture(
      new ViewTreeSerializer(),
      baseTree(),
    );
    expect(result.hasFullSnapshot).toBe(true);
    expect(
      result.events.map((event: RrwebEvent) => {
        return event.type;
      }),
    ).toEqual([RrwebEventType.Meta, RrwebEventType.FullSnapshot]);
    expect(result.events[0]?.data).toEqual({
      href: "app://com.example.checkout/cart",
      width: 390,
      height: 844,
    });
    expect(JSON.stringify(result.events[1])).toContain(
      '"data-oneuptime-recorder-kind":"rn-view-tree"',
    );
    expect(result.fidelityNotices).toContain(
      SessionReplayFidelityNotice.MobileAnimationSampled,
    );
  });

  test("never serializes Text/TextInput values or arbitrary native fields", () => {
    const tree: NativeViewTreeNode = baseTree({
      text: "STATIC SECRET 4092",
      accessibilityLabel: "accessible secret",
      children: [
        {
          nativeId: 2,
          kind: "text",
          x: 10,
          y: 20,
          width: 100,
          height: 20,
          text: "account alice@example.com",
          children: [],
        },
        {
          nativeId: 3,
          kind: "input",
          x: 10,
          y: 50,
          width: 200,
          height: 40,
          value: "hunter2",
          placeholder: "card number",
          children: [],
        },
      ],
    });

    const wire: string = JSON.stringify(
      capture(new ViewTreeSerializer(), tree),
    );
    expect(wire).not.toContain("STATIC SECRET");
    expect(wire).not.toContain("accessible secret");
    expect(wire).not.toContain("alice@example.com");
    expect(wire).not.toContain("hunter2");
    expect(wire).not.toContain("card number");
    expect(wire).toContain('data-oneuptime-mobile-view":"text');
    expect(wire).toContain("background-color:#94a3b826");
  });

  test("ReplayMask and opaque surfaces are hard subtree boundaries", () => {
    const secretChild: NativeViewTreeNode = {
      nativeId: 99,
      kind: "text",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: "must never exist",
      children: [],
    };
    const result: SerializedCapture = capture(
      new ViewTreeSerializer(),
      baseTree({
        children: [
          baseTree({
            nativeId: 2,
            kind: "masked",
            masked: true,
            children: [secretChild],
          }),
          baseTree({ nativeId: 3, kind: "image", children: [secretChild] }),
          baseTree({ nativeId: 4, kind: "webview", children: [secretChild] }),
          baseTree({ nativeId: 5, kind: "canvas", children: [secretChild] }),
        ],
      }),
    );
    const wire: string = JSON.stringify(result.events);
    expect(wire).not.toContain("must never exist");
    expect(wire.match(/data-oneuptime-replay-placeholder/g)).toHaveLength(4);
    expect(result.fidelityNotices).toEqual(
      expect.arrayContaining([
        SessionReplayFidelityNotice.MobileImagesOpaque,
        SessionReplayFidelityNotice.MobileWebViewOpaque,
        SessionReplayFidelityNotice.MobileCanvasOpaque,
      ]),
    );
  });

  test("allows only canonical colors and bounded numeric visual styles", () => {
    const serializer: ViewTreeSerializer = new ViewTreeSerializer();
    const safe: string = JSON.stringify(
      capture(
        serializer,
        baseTree({
          backgroundColor: "#AABBCCDD",
          borderColor: "#112233",
          borderWidth: 2,
          borderRadius: 8,
          opacity: 0.5,
          zIndex: 12,
        }),
      ).events,
    );
    expect(safe).toContain("background-color:#aabbccdd");
    expect(safe).toContain("border:2px solid #112233");
    expect(safe).toContain("border-radius:8px");
    expect(safe).toContain("opacity:0.5");
    expect(safe).toContain("z-index:12");

    const unsafe: string = JSON.stringify(
      capture(
        new ViewTreeSerializer(),
        baseTree({
          backgroundColor: "url(javascript:alert(secret))",
          borderColor: "red;content:'secret'",
          borderWidth: Number.POSITIVE_INFINITY,
          opacity: Number.NaN,
        }),
      ).events,
    );
    expect(unsafe).not.toContain("javascript");
    expect(unsafe).not.toContain("content");
    expect(unsafe).not.toContain("Infinity");
    expect(unsafe).not.toContain("NaN");
  });

  test("preserves parent-relative geometry for nested absolute divs", () => {
    const wire: string = JSON.stringify(
      capture(
        new ViewTreeSerializer(),
        baseTree({
          x: 0,
          y: 0,
          children: [
            baseTree({
              nativeId: 2,
              x: 100,
              y: 200,
              width: 200,
              height: 200,
              children: [
                baseTree({
                  nativeId: 3,
                  x: 10,
                  y: 20,
                  width: 30,
                  height: 40,
                }),
              ],
            }),
          ],
        }),
      ).events,
    );
    expect(wire).toContain("left:100px;top:200px");
    expect(wire).toContain("left:10px;top:20px");
    expect(wire).not.toContain("left:110px;top:220px");
  });

  test("diffs layout, additions, and removals as rrweb mutations", () => {
    const serializer: ViewTreeSerializer = new ViewTreeSerializer();
    capture(
      serializer,
      baseTree({
        children: [baseTree({ nativeId: 2, x: 10, width: 20, height: 20 })],
      }),
    );
    const changed: SerializedCapture = serializer.capture(
      baseTree({
        children: [
          baseTree({ nativeId: 2, x: 30, width: 20, height: 20 }),
          baseTree({ nativeId: 3, x: 50, width: 20, height: 20 }),
        ],
      }),
      {
        timestamp: 10_500,
        url: "app://com.example.checkout/cart",
        viewportWidth: 390,
        viewportHeight: 844,
      },
    );
    expect(changed.events).toHaveLength(1);
    const mutation: {
      source: number;
      attributes: Array<unknown>;
      adds: Array<unknown>;
      texts: Array<unknown>;
    } = changed.events[0]?.data as {
      source: number;
      attributes: Array<unknown>;
      adds: Array<unknown>;
      texts: Array<unknown>;
    };
    expect(mutation.source).toBe(RrwebIncrementalSource.Mutation);
    expect(mutation.attributes).toHaveLength(1);
    expect(mutation.adds).toHaveLength(1);
    expect(mutation.texts).toEqual([]);

    const removed: SerializedCapture = serializer.capture(baseTree(), {
      timestamp: 11_000,
      url: "app://com.example.checkout/cart",
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(
      (removed.events[0]?.data as { removes: Array<unknown> }).removes,
    ).toHaveLength(2);
  });

  test("emits no event for an unchanged sample and resets to a new checkout", () => {
    const serializer: ViewTreeSerializer = new ViewTreeSerializer();
    capture(serializer, baseTree());
    expect(capture(serializer, baseTree()).events).toEqual([]);
    serializer.reset();
    expect(capture(serializer, baseTree()).hasFullSnapshot).toBe(true);
  });

  test("prunes dynamic-list node identities and resets ids at forced checkouts", () => {
    const serializer: ViewTreeSerializer = new ViewTreeSerializer();
    for (let index: number = 0; index < 1_000; index += 1) {
      serializer.capture(
        baseTree({
          children: [
            baseTree({
              nativeId: `row-${index}`,
              width: 100,
              height: 20,
            }),
          ],
        }),
        {
          timestamp: 10_000 + index,
          url: "app://com.example.checkout/list",
          viewportWidth: 390,
          viewportHeight: 844,
        },
      );
    }
    const internal: {
      nodeIds: Map<string, number>;
      nextNodeId: number;
    } = serializer as unknown as {
      nodeIds: Map<string, number>;
      nextNodeId: number;
    };
    expect(internal.nodeIds.size).toBeLessThanOrEqual(2);
    expect(internal.nextNodeId).toBeGreaterThan(1_000);

    serializer.capture(baseTree({ nativeId: "fresh-root" }), {
      timestamp: 20_000,
      url: "app://com.example.checkout/list",
      viewportWidth: 390,
      viewportHeight: 844,
      forceFullSnapshot: true,
    });
    expect(internal.nodeIds.size).toBe(1);
    expect(internal.nextNodeId).toBe(11);
  });

  test("turns native traversal truncation into an honest fidelity notice", () => {
    const result: SerializedCapture = capture(
      new ViewTreeSerializer(),
      baseTree({ truncatedNodes: 17 }),
    );
    expect(result.droppedNodes).toBe(17);
    expect(result.fidelityNotices).toContain(
      SessionReplayFidelityNotice.BufferOverflow,
    );
  });
});
