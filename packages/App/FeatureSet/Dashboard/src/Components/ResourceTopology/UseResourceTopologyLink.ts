import { useEffect, useState } from "react";
import {
  ResourceTopologyEntity,
  ResourceTopologyLink,
  hasResourceTopology,
  resolveResourceTopologyLink,
} from "./ResourceTopologyLinks";

/*
 * The link from a master Topology entity to its resource's own topology,
 * once it is found; null while it is looked up, and for an entity whose
 * resource has none (or whose row the reader cannot see).
 */
export default function useResourceTopologyLink(
  entity: ResourceTopologyEntity | null | undefined,
): ResourceTopologyLink | null {
  const [link, setLink] = useState<ResourceTopologyLink | null>(null);
  const identity: string = entity
    ? JSON.stringify([
        entity.entityType || "",
        entity.displayName || "",
        entity.resourceId || "",
        entity.identifyingAttributes || {},
      ])
    : "";

  useEffect(() => {
    setLink(null);

    if (!entity || !hasResourceTopology(entity.entityType)) {
      return undefined;
    }

    let current: boolean = true;

    resolveResourceTopologyLink(entity)
      .then((resolved: ResourceTopologyLink | null) => {
        if (current) {
          setLink(resolved);
        }
      })
      .catch(() => {
        // Best effort: no link.
      });

    return () => {
      current = false;
    };
  }, [identity]);

  return link;
}
