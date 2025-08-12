declare module "elkjs/lib/elk.bundled.js" {
  export interface ElkNode {
    id?: string;
    x?: number;
    y?: number;
    width?: number | undefined;
    height?: number | undefined;
    layoutOptions?: Record<string, string>;
    children?: ElkNode[];
    edges?: Array<ElkPrimitiveEdge | ElkExtendedEdge>;
  }

  export interface ElkPrimitiveEdge {
    id: string;
    sources: string[];
    targets: string[];
  }

  export interface ElkExtendedEdge extends ElkPrimitiveEdge {
    sections?: Array<{
      startPoint?: { x: number; y: number };
      endPoint?: { x: number; y: number };
      bendPoints?: Array<{ x: number; y: number }>;
    }>;
  }

  export default class ELK {
    public layout(graph: ElkNode): Promise<ElkNode>;
  }
}
