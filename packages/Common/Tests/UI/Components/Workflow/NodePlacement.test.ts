import {
  DEFAULT_NODE_HEIGHT,
  NEW_NODE_HEIGHT_ESTIMATE,
  WORKFLOW_NODE_WIDTH,
  WorkflowCanvasNode,
  WorkflowCanvasRect,
  WorkflowCanvasSize,
  WorkflowCanvasViewport,
  getNewWorkflowNodePosition,
  getViewportToRevealNode,
  getViewportToRevealTrigger,
  isWorkflowNodeInView,
} from "../../../../UI/Components/Workflow/NodePlacement";
import { ComponentType, NodeType } from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";
import { Node } from "reactflow";

type MakeNodeFunction = (
  id: string,
  x: number,
  y: number,
  height?: number,
) => Node;

const makeNode: MakeNodeFunction = (
  id: string,
  x: number,
  y: number,
  height?: number,
): Node => {
  return {
    id,
    position: { x, y },
    ...(height === undefined ? {} : { height }),
    data: {
      nodeType: NodeType.Node,
      componentType: ComponentType.Component,
    },
  };
};

describe("Workflow node placement", () => {
  test.each([ComponentType.Trigger, ComponentType.Component])(
    "places a first %s on an empty canvas",
    (componentType: ComponentType) => {
      expect(getNewWorkflowNodePosition([], componentType)).toEqual({
        x: 100,
        y: 100,
      });
    },
  );

  test("places a component below the measured height of the existing card", () => {
    expect(
      getNewWorkflowNodePosition(
        [makeNode("first", 320, 100, 360)],
        ComponentType.Component,
      ),
    ).toEqual({ x: 320, y: 540 });
  });

  test.each([undefined, 0])(
    "reserves room when a card's height is %s during its first render",
    (height: number | undefined) => {
      expect(
        getNewWorkflowNodePosition(
          [makeNode("first", 200, 200, height)],
          ComponentType.Component,
        ),
      ).toEqual({ x: 200, y: 480 });
    },
  );

  test("uses the lowest bottom edge, not insertion order or the lowest top edge", () => {
    const nodes: Array<Node> = [
      makeNode("short-low", 400, 400, 100),
      makeNode("tall-high", 100, 200, 500),
      makeNode("last", 800, 100, 100),
    ];

    expect(getNewWorkflowNodePosition(nodes, ComponentType.Component)).toEqual({
      x: 100,
      y: 780,
    });
  });

  test("keeps spacing when the canvas contains negative coordinates", () => {
    expect(
      getNewWorkflowNodePosition(
        [makeNode("first", -800, -600, 100)],
        ComponentType.Component,
      ),
    ).toEqual({ x: -800, y: -420 });
  });

  test("successive additions do not stack even before React Flow measures them", () => {
    const nodes: Array<Node> = [makeNode("existing", 100, 100)];

    for (let index: number = 0; index < 5; index++) {
      const position: { x: number; y: number } = getNewWorkflowNodePosition(
        nodes,
        ComponentType.Component,
      );

      for (const node of nodes) {
        expect(position.y).toBeGreaterThanOrEqual(node.position.y + 280);
      }

      nodes.push(makeNode(`new-${index}`, position.x, position.y));
    }
  });

  test.each([NodeType.PlaceholderNode, NodeType.Node])(
    "replaces a %s trigger in place without moving the other steps",
    (nodeType: NodeType) => {
      const trigger: Node = makeNode("trigger", 432, -180);
      trigger.data.nodeType = nodeType;
      if (nodeType === NodeType.Node) {
        trigger.data.componentType = ComponentType.Trigger;
      }
      const nodes: Array<Node> = [makeNode("action", 100, 500), trigger];

      const position: { x: number; y: number } = getNewWorkflowNodePosition(
        nodes,
        ComponentType.Trigger,
      );

      expect(position).toEqual({ x: 432, y: -180 });
      expect(position).not.toBe(trigger.position);
      expect(nodes[0]?.position).toEqual({ x: 100, y: 500 });
    },
  );

  test("places a missing trigger above the first existing component", () => {
    expect(
      getNewWorkflowNodePosition(
        [makeNode("last", 800, 1000), makeNode("first", 432, -180)],
        ComponentType.Trigger,
      ),
    ).toEqual({ x: 432, y: -460 });
  });

  test("does not mutate the caller's nodes or their order", () => {
    const nodes: Array<Node> = [
      makeNode("last", 400, 1000),
      makeNode("first", 100, 100),
    ];
    const before: string = JSON.stringify(nodes);
    Object.freeze(nodes);
    nodes.forEach((node: Node) => {
      Object.freeze(node);
      Object.freeze(node.position);
    });

    getNewWorkflowNodePosition(nodes, ComponentType.Trigger);
    getNewWorkflowNodePosition(nodes, ComponentType.Component);

    expect(JSON.stringify(nodes)).toBe(before);
  });
});

/*
 * Bringing a step that was just added into view. The canvas below is
 * 1000 x 600 on screen; a step is 256 wide and, before the canvas has
 * measured it, taken to be 220 tall. Steps must stay 24px clear of the edges.
 */

test("a new step is taken to be as tall as a card with its setup prompt", () => {
  expect(WORKFLOW_NODE_WIDTH).toBe(256);
  expect(NEW_NODE_HEIGHT_ESTIMATE).toBe(220);
  expect(NEW_NODE_HEIGHT_ESTIMATE).toBeGreaterThan(DEFAULT_NODE_HEIGHT);
});
const CANVAS: WorkflowCanvasSize = { width: 1000, height: 600 };
const AT_ORIGIN: WorkflowCanvasViewport = { x: 0, y: 0, zoom: 1 };

describe("Workflow node reveal: is the new step in view", () => {
  test("a step well inside the canvas is in view", () => {
    expect(
      isWorkflowNodeInView({
        position: { x: 100, y: 100 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
      }),
    ).toBe(true);
  });

  test.each([
    ["exactly at the top-left margin", { x: 24, y: 24 }, true],
    ["one pixel past the left margin", { x: 23, y: 24 }, false],
    ["one pixel past the top margin", { x: 24, y: 23 }, false],
    ["exactly at the bottom-right margin", { x: 720, y: 356 }, true],
    ["one pixel past the right margin", { x: 721, y: 356 }, false],
    ["one pixel past the bottom margin", { x: 720, y: 357 }, false],
  ])(
    "a step %s",
    (_label: string, position: { x: number; y: number }, inView: boolean) => {
      expect(
        isWorkflowNodeInView({
          position: position,
          viewport: AT_ORIGIN,
          canvasSize: CANVAS,
        }),
      ).toBe(inView);
    },
  );

  test("reads the canvas through its pan and zoom", () => {
    // Canvas point (400, 500) is drawn at (400 * 0.5 + 100, 500 * 0.5 - 50).
    expect(
      isWorkflowNodeInView({
        position: { x: 400, y: 500 },
        viewport: { x: 100, y: -50, zoom: 0.5 },
        canvasSize: CANVAS,
      }),
    ).toBe(true);
    expect(
      isWorkflowNodeInView({
        position: { x: 400, y: 500 },
        viewport: { x: 100, y: -50, zoom: 2 },
        canvasSize: CANVAS,
      }),
    ).toBe(false);
  });

  test("a step's measured size counts when it is known", () => {
    const position: { x: number; y: number } = { x: 100, y: 400 };

    expect(
      isWorkflowNodeInView({
        position: position,
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
      }),
    ).toBe(false);
    expect(
      isWorkflowNodeInView({
        position: position,
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
        height: 140,
      }),
    ).toBe(true);
  });

  test("nothing is in view on a canvas that has no size yet", () => {
    expect(
      isWorkflowNodeInView({
        position: { x: 0, y: 0 },
        viewport: AT_ORIGIN,
        canvasSize: { width: 0, height: 0 },
      }),
    ).toBe(false);
  });

  test("a step under the minimap is not in view", () => {
    const minimap: WorkflowCanvasRect = {
      left: 600,
      top: 430,
      width: 200,
      height: 150,
    };

    expect(
      isWorkflowNodeInView({
        position: { x: 500, y: 300 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
        overlays: [minimap],
      }),
    ).toBe(false);
  });

  test("an overlay off to the side of the step does not matter", () => {
    expect(
      isWorkflowNodeInView({
        position: { x: 100, y: 300 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
        overlays: [{ left: 760, top: 430, width: 200, height: 150 }],
      }),
    ).toBe(true);
  });

  test("an overlay with no size, as on a page that is not drawn, is ignored", () => {
    expect(
      isWorkflowNodeInView({
        position: { x: 100, y: 300 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
        overlays: [{ left: 0, top: 0, width: 0, height: 0 }],
      }),
    ).toBe(true);
  });
});

describe("Workflow node reveal: where the canvas moves to", () => {
  test("a step in view does not move the canvas at all", () => {
    expect(
      getViewportToRevealNode({
        position: { x: 100, y: 100 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
      }),
    ).toBeNull();
  });

  test("a step below the canvas is brought up only until its bottom is in", () => {
    const viewport: WorkflowCanvasViewport | null = getViewportToRevealNode({
      position: { x: 100, y: 500 },
      viewport: AT_ORIGIN,
      canvasSize: CANVAS,
    });

    // Its bottom was at 720 and may be at 576 at most: 144 pixels up.
    expect(viewport).toEqual({ x: 0, y: -144, zoom: 1 });
  });

  test("the step above the new one stays on screen, rather than being scrolled away by centring", () => {
    const previous: { x: number; y: number } = { x: 100, y: 220 };
    const added: { x: number; y: number } = {
      x: 100,
      y: previous.y + DEFAULT_NODE_HEIGHT + 80,
    };

    const viewport: WorkflowCanvasViewport = getViewportToRevealNode({
      position: added,
      viewport: AT_ORIGIN,
      canvasSize: CANVAS,
    }) as WorkflowCanvasViewport;

    expect(
      isWorkflowNodeInView({
        position: added,
        viewport: viewport,
        canvasSize: CANVAS,
      }),
    ).toBe(true);
    expect(
      isWorkflowNodeInView({
        position: previous,
        viewport: viewport,
        canvasSize: CANVAS,
      }),
    ).toBe(true);
  });

  test("a step above the canvas is brought down to the top margin", () => {
    // It is drawn at y = 100 - 100 = 0, and comes down to 24.
    expect(
      getViewportToRevealNode({
        position: { x: 100, y: 100 },
        viewport: { x: 50, y: -100, zoom: 1 },
        canvasSize: CANVAS,
      }),
    ).toEqual({ x: 50, y: -76, zoom: 1 });
  });

  test("a step off to the right comes in from the right", () => {
    expect(
      getViewportToRevealNode({
        position: { x: 900, y: 100 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
      }),
    ).toEqual({ x: -180, y: 0, zoom: 1 });
  });

  test("a step off to the left comes in from the left", () => {
    expect(
      getViewportToRevealNode({
        position: { x: -300, y: 100 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
      }),
    ).toEqual({ x: 324, y: 0, zoom: 1 });
  });

  test.each([0.5, 0.75, 1.5])(
    "keeps the builder's zoom of %s instead of resetting it",
    (zoom: number) => {
      const position: { x: number; y: number } = { x: 100, y: 2000 };
      const viewport: WorkflowCanvasViewport = getViewportToRevealNode({
        position: position,
        viewport: { x: 0, y: 0, zoom: zoom },
        canvasSize: CANVAS,
      }) as WorkflowCanvasViewport;

      expect(viewport.zoom).toBe(zoom);
      expect(
        isWorkflowNodeInView({
          position: position,
          viewport: viewport,
          canvasSize: CANVAS,
        }),
      ).toBe(true);
    },
  );

  test("a step too big for the canvas shows its top-left corner", () => {
    // At zoom 2 a step is 512 x 400, on a 500 x 300 canvas.
    expect(
      getViewportToRevealNode({
        position: { x: 1000, y: 1000 },
        viewport: { x: 0, y: 0, zoom: 2 },
        canvasSize: { width: 500, height: 300 },
      }),
    ).toEqual({ x: 24 - 2000, y: 24 - 2000, zoom: 2 });
  });

  test("a step taller than the canvas but not wider comes in by its nearer side", () => {
    // 512 x 400 on a 600 x 300 canvas: it fits across, not down.
    expect(
      getViewportToRevealNode({
        position: { x: 1000, y: 1000 },
        viewport: { x: 0, y: 0, zoom: 2 },
        canvasSize: { width: 600, height: 300 },
      }),
    ).toEqual({ x: 576 - 2512, y: 24 - 2000, zoom: 2 });
  });

  test("on a phone, a new step is lifted above the minimap and zoom buttons", () => {
    const phone: WorkflowCanvasSize = { width: 360, height: 620 };
    const controls: WorkflowCanvasRect = {
      left: 15,
      top: 455,
      width: 48,
      height: 150,
    };
    const minimap: WorkflowCanvasRect = {
      left: 145,
      top: 455,
      width: 200,
      height: 150,
    };
    const position: { x: number; y: number } = { x: 52, y: 300 };

    // It fits the canvas, but sits under both overlays.
    expect(
      isWorkflowNodeInView({
        position: position,
        viewport: AT_ORIGIN,
        canvasSize: phone,
      }),
    ).toBe(true);

    const viewport: WorkflowCanvasViewport | null = getViewportToRevealNode({
      position: position,
      viewport: AT_ORIGIN,
      canvasSize: phone,
      overlays: [controls, minimap],
    });

    // Its bottom was at 520 and may be at 455 - 24 = 431 at most.
    expect(viewport).toEqual({ x: 0, y: -89, zoom: 1 });
    expect(
      isWorkflowNodeInView({
        position: position,
        viewport: viewport as WorkflowCanvasViewport,
        canvasSize: phone,
        overlays: [controls, minimap],
      }),
    ).toBe(true);
  });

  test("the overlays that matter are the ones over where the step ends up", () => {
    const minimap: WorkflowCanvasRect = {
      left: 760,
      top: 430,
      width: 200,
      height: 150,
    };

    /*
     * The step starts off to the right, clear of the minimap. Brought in from
     * the right, it ends up over the minimap, so it has to come up as well.
     */
    const viewport: WorkflowCanvasViewport | null = getViewportToRevealNode({
      position: { x: 1200, y: 300 },
      viewport: AT_ORIGIN,
      canvasSize: CANVAS,
      overlays: [minimap],
    });

    // Its bottom, at 520, has to come up to 430 - 24 = 406.
    expect(viewport).toEqual({ x: -480, y: -114, zoom: 1 });
  });

  test("an overlay along the top lowers where a step may start", () => {
    const banner: WorkflowCanvasRect = {
      left: 0,
      top: 10,
      width: 1000,
      height: 50,
    };

    expect(
      getViewportToRevealNode({
        position: { x: 100, y: 40 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
        overlays: [banner],
      }),
    ).toEqual({ x: 0, y: 44, zoom: 1 });
  });

  test("uses the step card's real width for the right-hand edge", () => {
    expect(
      getViewportToRevealNode({
        position: { x: 1000 - 24 - WORKFLOW_NODE_WIDTH + 1, y: 100 },
        viewport: AT_ORIGIN,
        canvasSize: CANVAS,
      }),
    ).toEqual({ x: -1, y: 0, zoom: 1 });
  });

  test("does not change the viewport it was given", () => {
    const viewport: WorkflowCanvasViewport = { x: 10, y: 20, zoom: 1 };
    Object.freeze(viewport);

    getViewportToRevealNode({
      position: { x: 100, y: 5000 },
      viewport: viewport,
      canvasSize: CANVAS,
    });

    expect(viewport).toEqual({ x: 10, y: 20, zoom: 1 });
  });
});

/*
 * A workflow too big to fit at the smallest zoom - the Huntress template on
 * a laptop - is fitted on its middle, with the trigger above the top edge:
 * once the canvas has opened, it moves just far enough to bring the trigger
 * in, at the fit's zoom. One that fits is left as fitted.
 */
describe("Workflow canvas on open: the trigger in view", () => {
  /*
   * The Huntress template fitted at React Flow's smallest zoom, 0.5, on a
   * 1250 x 500 canvas: its middle shows, and its trigger (x 100, y 100) is
   * drawn at y = 100 * 0.5 - 210 = -160.
   */
  const FITTED: WorkflowCanvasViewport = { x: 677, y: -210, zoom: 0.5 };
  const LAPTOP: WorkflowCanvasSize = { width: 1250, height: 500 };

  const trigger: WorkflowCanvasNode = {
    position: { x: 100, y: 100 },
    width: WORKFLOW_NODE_WIDTH,
    height: 184,
    isTrigger: true,
  };

  const step: (x: number, y: number) => WorkflowCanvasNode = (
    x: number,
    y: number,
  ): WorkflowCanvasNode => {
    return {
      position: { x, y },
      width: WORKFLOW_NODE_WIDTH,
      height: 200,
      isTrigger: false,
    };
  };

  test("a trigger above the top edge comes down to the top margin, at the same zoom and across", () => {
    expect(
      getViewportToRevealTrigger({
        nodes: [step(18, 300), trigger, step(-1050, 540)],
        viewport: FITTED,
        canvasSize: LAPTOP,
      }),
    ).toEqual({ x: 677, y: -26, zoom: 0.5 });
  });

  test("once moved, the trigger is in view - all of it, by its measured height", () => {
    const moved: WorkflowCanvasViewport = getViewportToRevealTrigger({
      nodes: [trigger],
      viewport: FITTED,
      canvasSize: LAPTOP,
    }) as WorkflowCanvasViewport;

    expect(
      isWorkflowNodeInView({
        position: trigger.position,
        width: trigger.width as number,
        height: trigger.height as number,
        viewport: moved,
        canvasSize: LAPTOP,
      }),
    ).toBe(true);
  });

  test("a workflow that fits, its trigger in view, stays as it was fitted", () => {
    expect(
      getViewportToRevealTrigger({
        nodes: [trigger, step(100, 400)],
        viewport: { x: 200, y: 20, zoom: 1 },
        canvasSize: { width: 1250, height: 900 },
      }),
    ).toBeNull();
  });

  test("the trigger is found wherever it is in the list, and only the trigger is brought in", () => {
    // A step far below would pull the view down; the trigger is what counts.
    expect(
      getViewportToRevealTrigger({
        nodes: [step(100, 5000), step(100, -4000), trigger],
        viewport: FITTED,
        canvasSize: LAPTOP,
      }),
    ).toEqual({ x: 677, y: -26, zoom: 0.5 });
  });

  test("a trigger off to the side comes in from that side", () => {
    // Drawn from x = 2600 * 0.5 = 1300 to 1428; it may end at 1250 - 24 = 1226.
    expect(
      getViewportToRevealTrigger({
        nodes: [{ ...trigger, position: { x: 2600, y: 100 } }],
        viewport: { x: 0, y: 0, zoom: 0.5 },
        canvasSize: LAPTOP,
      }),
    ).toEqual({ x: -202, y: 0, zoom: 0.5 });
  });

  test("no trigger, or a canvas not measured yet: nothing moves", () => {
    expect(
      getViewportToRevealTrigger({
        nodes: [step(100, 100), step(100, 5000)],
        viewport: FITTED,
        canvasSize: LAPTOP,
      }),
    ).toBeNull();
    expect(
      getViewportToRevealTrigger({
        nodes: [],
        viewport: FITTED,
        canvasSize: LAPTOP,
      }),
    ).toBeNull();
    expect(
      getViewportToRevealTrigger({
        nodes: [trigger],
        viewport: FITTED,
        canvasSize: { width: 0, height: 0 },
      }),
    ).toBeNull();
  });

  test("a trigger not measured yet is taken at a new step's size", () => {
    expect(
      getViewportToRevealTrigger({
        nodes: [{ ...trigger, width: null, height: null }],
        viewport: FITTED,
        canvasSize: LAPTOP,
      }),
    ).toEqual(
      getViewportToRevealNode({
        position: trigger.position,
        viewport: FITTED,
        canvasSize: LAPTOP,
      }),
    );
  });
});
