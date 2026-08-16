import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MapViewport,
  MAX_ZOOM,
  WORLD_VIEWPORT,
  clampViewport,
  countPointsInViewport,
  fitViewportToPoints,
  panViewport,
  screenLengthToViewportLength,
  shouldUseDetailGeometry,
  shouldUseSubdivisionGeometry,
  viewBoxOfViewport,
  viewportsMatch,
  zoomOfViewport,
  zoomViewport,
} from "./Geo/GeoViewport";
import {
  BuildPinsResult,
  CONTAINER_SIDE_FACTOR,
  ClusterColorKey,
  DEFAULT_MAP_LINK_COLOR,
  DrawableMapLink,
  MapMarker,
  LABEL_FONT_SIZE,
  LabelPlacement,
  PlacedMapMarker,
  buildMapLinks,
  buildMapMarkers,
  buildPins,
  GENERIC_SITE_TYPE_LABEL,
  clusterCellSize,
  describeMapCoverage,
  layoutMapMarkers,
  mapLinkPath,
  mapPinFingerprint,
  pluralizeSiteType,
  resolveMarkerLabels,
} from "./SiteMapViewModel";
import {
  MapLinkView,
  MapSiteView,
  MapUnplacedSiteView,
  SiteMapMode,
} from "./SiteHierarchyTypes";
import {
  GeometryFeature,
  getCachedGeometryFeatures,
  loadGeometryFeatures,
} from "./Geo/WorldGeometry";

/*
 * Inline-SVG world map of network sites: checked-in country outlines
 * (projected offline with the exact math in Geo/GeoProjection.ts, so pins
 * projected at runtime land precisely on them) with clustered site markers on
 * top. Pure render — the projection, viewport, cluster and color decisions
 * live in the react-free Geo/ modules and SiteMapViewModel so they stay
 * unit-testable.
 *
 * ONE MAP, FRAMED TO THE DATA
 *
 * There is no region picker. The map opens framed to wherever this project's
 * sites actually are: a network inside one country fills the frame with that
 * country, a network across continents opens on the world, and nobody has to
 * be told which of those they are. See Geo/GeoViewport.ts for why the old
 * "United States / World" toggle was the wrong axis to put in front of a
 * customer.
 *
 * Zoom and pan are the manual override on that frame, and zoom does real
 * work: clusters are bucketed at a constant SCREEN distance, so zooming in
 * genuinely splits a lump of nearby sites into individual markers rather
 * than magnifying one blob. Markers, strokes and labels are sized in screen
 * units for the same reason. Clicking a single-site marker drills straight
 * in; clicking a multi-site cluster opens a small popover to pick the site.
 *
 * Zoom also brings in reference frames as they become useful: the finer
 * country outlines at continent scale, then the state and province lines
 * inside them, because "somewhere in the middle of that country" stops being
 * a useful answer once the country fills the frame.
 *
 * SVG styling mirrors NetworkDeviceGraph: theme CSS variables with hex
 * fallbacks.
 */

/*
 * The outlines themselves — and the on-demand loader that fetches them once
 * per tab — live in Geo/WorldGeometry.ts, so this component and the Network
 * Map dashboard widget share one cache rather than fetching a copy each.
 */

const CLUSTER_COLORS: Record<ClusterColorKey, string> = {
  none: "#9ca3af", // gray-400
  ok: "#10b981", // emerald-500
  down: "#ef4444", // red-500
  mixed: "#f59e0b", // amber-500
};

/*
 * Legend entries, in the order a reader scans for trouble: healthy first,
 * then the two degrees of "look at me", then the absence of data. The
 * labels describe what a marker of that color means for the sites under
 * it, which is also what decideClusterColorKey decides.
 */
const LEGEND: Array<{ key: ClusterColorKey; label: string }> = [
  { key: "ok", label: "Operational" },
  { key: "mixed", label: "Degraded" },
  { key: "down", label: "Offline" },
  { key: "none", label: "No status" },
];

// One click of the zoom controls, and one press of an arrow key.
const ZOOM_STEP: number = 2;
const KEYBOARD_PAN_FRACTION: number = 0.2;

/*
 * A pointer that moved less than this (in screen px) between down and up was
 * a click, not a drag — otherwise the tiny movement in an ordinary click
 * would swallow every marker activation.
 */
const DRAG_THRESHOLD_PX: number = 4;

/*
 * How many unplaceable children are named under the map before the rest
 * collapse into a count. Enough to be actionable on a normal level, few
 * enough that a hierarchy imported entirely without coordinates does not
 * push the map off the screen.
 */
const UNPLACED_NAMES_SHOWN: number = 6;

const dotColorForSite: (site: MapSiteView) => string = (
  site: MapSiteView,
): string => {
  if (site.isOperational === false) {
    return CLUSTER_COLORS["down"];
  }
  if (site.isOperational === true) {
    return CLUSTER_COLORS["ok"];
  }
  return CLUSTER_COLORS["none"];
};

interface OpenCluster {
  // Cluster centre in viewBox coordinates — anchors the popover.
  x: number;
  y: number;
  ids: Array<string>;
}

interface HoveredCluster {
  x: number;
  y: number;
  label: string;
}

/*
 * Anchor an overlay (hover tooltip / site picker) to a marker, as
 * percentages of the SVG box the overlay shares. Positions are relative to
 * the CURRENT viewport, not the whole world, so an overlay tracks its marker
 * through a pan. Markers near an edge would push a centred overlay outside
 * the card, so the horizontal anchor is clamped and the overlay flips above
 * markers in the lower part of the map.
 */
const overlayPosition: (
  x: number,
  y: number,
  viewport: MapViewport,
  offsetPx: number,
) => React.CSSProperties = (
  x: number,
  y: number,
  viewport: MapViewport,
  offsetPx: number,
): React.CSSProperties => {
  const leftPercent: number = Math.min(
    88,
    Math.max(12, ((x - viewport.x) / viewport.width) * 100),
  );
  const topPercent: number = ((y - viewport.y) / viewport.height) * 100;
  const flipAbove: boolean = topPercent > 62;
  return {
    left: `${leftPercent}%`,
    top: `${topPercent}%`,
    transform: flipAbove
      ? `translate(-50%, calc(-100% - ${offsetPx}px))`
      : `translate(-50%, ${offsetPx}px)`,
  };
};

// One button of the zoom/frame control cluster overlaid on the map.
const MapControlButton: FunctionComponent<{
  label: string;
  icon: IconProp;
  disabled: boolean;
  onClick: () => void;
}> = (props: {
  label: string;
  icon: IconProp;
  disabled: boolean;
  onClick: () => void;
}): ReactElement => {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      data-testid={`site-geo-map-control-${props.label
        .toLowerCase()
        .replace(/[^a-z]+/g, "-")}`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent"
      onClick={props.onClick}
    >
      <Icon className="h-4 w-4" icon={props.icon} />
    </button>
  );
};

export interface ComponentProps {
  sites: Array<MapSiteView>;
  /*
   * The site links between those sites, drawn as lines between the markers.
   * A link with no monitor attached is still drawn — the monitor decides
   * the line's color, not whether the connection exists.
   */
  links: Array<MapLinkView>;
  /*
   * What the rows in `sites` ARE — grouped markers (one per child of the
   * level in view) or every located site under it. This drives the drawing.
   */
  mode: SiteMapMode;
  /*
   * What the reader last ASKED for. The two differ for the moment between
   * pressing the switch and the new payload landing, and the switch has to
   * follow the press rather than the payload: a control that springs back
   * under the pointer reads as a control that did not work.
   */
  selectedMode: SiteMapMode;
  onModeChange: (mode: SiteMapMode) => void;
  /*
   * Children of this level that have no coordinates anywhere beneath them.
   * Listed under the map instead of being silently absent — "where did
   * Region 2100 go" is a support ticket, and the answer is actionable.
   */
  unplacedSites: Array<MapUnplacedSiteView>;
  /*
   * What the markers are, in this project's own words ("Regions",
   * "Markets", "Sites") — used in the switch and the counts so the map
   * never invents vocabulary the customer has not used.
   */
  childTypeLabel: string;
  /*
   * What the page's search box is narrowing `sites` to, if anything. The map
   * does no filtering of its own — it is handed the survivors — but it has to
   * know a filter is on, or an empty result reads as "you have no sites"
   * rather than as "nothing matches what you typed".
   */
  searchText?: string | undefined;
  onSiteClick: (siteId: string) => void;
}

/*
 * The grouped/all switch. Two options, both always meaningful, so this is a
 * segmented control rather than a dropdown: the alternative is visible
 * without a click, which is the whole point when a customer's first
 * reaction to the map is "this is not my network".
 */
const MapModeSwitch: FunctionComponent<{
  mode: SiteMapMode;
  childTypeLabel: string;
  onModeChange: (mode: SiteMapMode) => void;
}> = (props: {
  mode: SiteMapMode;
  childTypeLabel: string;
  onModeChange: (mode: SiteMapMode) => void;
}): ReactElement => {
  /*
   * A level whose children are all Regions gets "Regions | All sites",
   * which says exactly what the two views are. A level that MIXES types has
   * no name of its own to offer, and "Sites | All sites" is two labels for
   * what reads as the same thing — so it falls back to naming the
   * behaviour instead.
   */
  const isGenericLabel: boolean =
    props.childTypeLabel.toLowerCase() === GENERIC_SITE_TYPE_LABEL;

  const options: Array<{ value: SiteMapMode; label: string; hint: string }> = [
    {
      value: "grouped",
      /*
       * The button says the plural; the sentence under it says the
       * singular. Both are built from the customer's own singular type
       * name — pre-pluralizing at the call site is what turns the hint into
       * "One marker per regions at this level".
       */
      label: isGenericLabel
        ? "Grouped"
        : pluralizeSiteType(props.childTypeLabel),
      hint: `One marker per ${props.childTypeLabel.toLowerCase()} at this level`,
    },
    {
      value: "all",
      label: "All sites",
      hint: "Every site below this level, individually",
    },
  ];

  return (
    <div
      role="group"
      aria-label="Map grouping"
      className="inline-flex flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
    >
      {options.map(
        (option: {
          value: SiteMapMode;
          label: string;
          hint: string;
        }): ReactElement => {
          const isActive: boolean = props.mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={isActive}
              data-testid={`site-geo-map-mode-${option.value}`}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                /*
                 * The ring is load-bearing in dark mode: the "raised" pill
                 * (--ou-surface-primary) is actually DARKER than the track
                 * it sits in (--ou-surface-secondary), so without a border
                 * the selected option is a 1.1:1 edge — invisible. Every
                 * other segmented control in the Dashboard carries the same
                 * ring for the same reason.
                 */
                isActive
                  ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-500 hover:text-gray-800"
              }`}
              onClick={() => {
                props.onModeChange(option.value);
              }}
            >
              {option.label}
            </button>
          );
        },
      )}
    </div>
  );
};

const SiteGeoMap: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [openCluster, setOpenCluster] = useState<OpenCluster | null>(null);
  const [hovered, setHovered] = useState<HoveredCluster | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [overviewFeatures, setOverviewFeatures] =
    useState<Array<GeometryFeature> | null>(
      getCachedGeometryFeatures("overview"),
    );
  const [detailFeatures, setDetailFeatures] =
    useState<Array<GeometryFeature> | null>(
      getCachedGeometryFeatures("detail"),
    );
  const [subdivisionFeatures, setSubdivisionFeatures] =
    useState<Array<GeometryFeature> | null>(
      getCachedGeometryFeatures("subdivisions"),
    );

  /*
   * Pin geometry, keyed by an order-independent fingerprint rather than by
   * the sites array's identity: the page's 60-second background poll hands
   * us a brand-new array every minute even when nothing moved, and neither
   * re-framing the map under someone who has zoomed in, nor closing the site
   * picker they are scrolling, is a data update.
   */
  const pinFingerprint: string = useMemo(() => {
    return mapPinFingerprint(props.sites);
  }, [props.sites]);

  const sitesRef: React.MutableRefObject<Array<MapSiteView>> = useRef<
    Array<MapSiteView>
  >(props.sites);
  sitesRef.current = props.sites;

  const { pins, unmappableCount }: BuildPinsResult = useMemo(() => {
    return buildPins(sitesRef.current);
  }, [pinFingerprint]);

  // The frame the sites themselves ask for — the opening view, and "Fit".
  const fittedViewport: MapViewport = useMemo(() => {
    return fitViewportToPoints(pins);
  }, [pins]);

  const [viewport, setViewport] = useState<MapViewport>(fittedViewport);

  /*
   * A new set of sites is a new map: re-frame it, and drop a popover that is
   * anchored to a cluster which may no longer exist.
   *
   * A change of MODE is not a new map, though — both modes cover the same
   * subtree and the same ground, so switching to "All sites" to look at the
   * stores inside the region you just zoomed into must not throw that zoom
   * away and bounce you back out to the whole estate.
   */
  const framedMode: React.MutableRefObject<SiteMapMode> = useRef<SiteMapMode>(
    props.mode,
  );
  useEffect(() => {
    const isModeChange: boolean = framedMode.current !== props.mode;
    framedMode.current = props.mode;
    if (!isModeChange) {
      setViewport(fittedViewport);
    }
    setOpenCluster(null);
    setHovered(null);
  }, [fittedViewport, props.mode]);

  const zoom: number = zoomOfViewport(viewport);

  /*
   * Clustering depends on the zoom but NOT on where the frame sits — the
   * grid is anchored to the world, so panning never re-buckets anything.
   * Memoizing on the cell size rather than on the viewport keeps a drag
   * from re-bucketing every site on every pointer move.
   *
   * Grouped markers are never clustered, so the cell size is pinned to 0
   * there: without that, every zoom step would rebuild a marker set that
   * cannot change.
   */
  const cellSize: number = props.mode === "all" ? clusterCellSize(viewport) : 0;

  /*
   * Keyed on the SITES, not on the pin fingerprint. The fingerprint is
   * deliberately geometry-only — a site going down recolours its marker but
   * does not move it, and re-framing the map or closing a popover under
   * someone every minute would be worse than a stale colour. But a marker's
   * colour, its rollup and its tooltip are all baked in here, so keying this
   * memo on geometry would freeze exactly the thing the 60-second poll
   * exists to refresh: an outage would never reach the map.
   */
  const markers: Array<MapMarker> = useMemo(() => {
    return buildMapMarkers({
      sites: props.sites,
      mode: props.mode,
      cellSize: cellSize,
    });
  }, [props.sites, props.mode, cellSize]);

  /*
   * Where each marker is DRAWN — which is not always where it is. Markers
   * that would cover each other are pushed apart until they do not, and the
   * ones that moved keep a line back to their real position (drawn below).
   * Everything from here on works off the placed positions: the labels, the
   * hover tooltip, the site picker and the focus ring all have to point at
   * the marker the reader can actually see.
   *
   * Keyed on the zoom, like the labels: zooming genuinely separates markers
   * so the displacement melts away as you go in, while panning must not
   * re-lay-out anything — markers keep their relative distances as the frame
   * moves, and a map that reshuffled under a drag would be unusable.
   */
  const placedMarkers: Array<PlacedMapMarker> = useMemo(() => {
    return layoutMapMarkers(markers, zoom);
  }, [markers, zoom]);

  /*
   * Which names fit without landing on each other. Keyed on the zoom rather
   * than on the whole viewport: markers keep their relative distances as the
   * frame moves, so panning must not re-decide which names are shown — that
   * would make labels flicker in and out under the pointer.
   */
  const labelPlacements: Map<string, LabelPlacement> = useMemo(() => {
    return resolveMarkerLabels(placedMarkers, zoom);
  }, [placedMarkers, zoom]);

  /*
   * The lines between the markers. Built from the PLACED markers so a line
   * ends where its marker is actually drawn, and rebuilt with the zoom
   * because the bow that keeps parallel links apart is a screen distance.
   */
  const linkLines: Array<DrawableMapLink> = useMemo(() => {
    return buildMapLinks({
      links: props.links,
      markers: placedMarkers,
      zoom: zoom,
    });
  }, [props.links, placedMarkers, zoom]);

  // Whether the legend has to explain the leader lines this frame.
  const hasNudgedMarkers: boolean = placedMarkers.some(
    (marker: PlacedMapMarker): boolean => {
      return marker.needsLeaderLine;
    },
  );

  /*
   * And whether it has to explain the OTHER kind of line: the thread from a
   * marker to a name that could not fit against it.
   */
  const hasThreadedLabels: boolean = Array.from(labelPlacements.values()).some(
    (placement: LabelPlacement): boolean => {
      return placement.leaderLine !== null;
    },
  );

  /*
   * Zoom changes which sites share a marker, so an open picker's list can go
   * stale under it — close it rather than let it drill into a cluster that
   * no longer exists.
   */
  const changeViewport: (next: MapViewport) => void = useCallback(
    (next: MapViewport): void => {
      setViewport(next);
      setOpenCluster(null);
      setHovered(null);
    },
    [],
  );

  // Overview outlines are fetched on demand (see loadGeometryFeatures).
  useEffect(() => {
    let isCurrent: boolean = true;

    loadGeometryFeatures("overview")
      .then((loaded: Array<GeometryFeature>) => {
        if (isCurrent) {
          setOverviewFeatures(loaded);
        }
      })
      .catch(() => {
        /*
         * The outlines are backdrop, not data: if the chunk fails to load
         * (offline, a stale deploy), draw the markers on a bare viewBox
         * rather than blocking the map on decoration.
         */
        if (isCurrent) {
          setOverviewFeatures([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  /*
   * The detail tier is fetched the first time the map is zoomed in far
   * enough to want it, and then kept — zooming back out and in again must
   * not re-download it. Until it arrives the overview stays on screen, so
   * this is an upgrade in place with nothing to wait for.
   */
  const needsDetail: boolean = shouldUseDetailGeometry(viewport);
  useEffect(() => {
    if (!needsDetail || detailFeatures) {
      return;
    }
    let isCurrent: boolean = true;

    loadGeometryFeatures("detail")
      .then((loaded: Array<GeometryFeature>) => {
        if (isCurrent) {
          setDetailFeatures(loaded);
        }
      })
      .catch(() => {
        // Keep the overview rather than blanking the map.
      });

    return () => {
      isCurrent = false;
    };
  }, [needsDetail, detailFeatures]);

  const isDrawingDetail: boolean = Boolean(needsDetail && detailFeatures);
  const features: Array<GeometryFeature> | null = isDrawingDetail
    ? detailFeatures
    : overviewFeatures;

  /*
   * State and province lines, fetched the first time the map is zoomed in
   * far enough to want them and then kept, exactly like the detail tier.
   *
   * A country outline is the whole map when you are looking at the world, and
   * an empty field once you have zoomed into one country — a marker in the
   * middle of it has nothing to be located against. These lines are that
   * missing reference frame, and they cost nothing until somebody zooms.
   */
  const needsSubdivisions: boolean = shouldUseSubdivisionGeometry(viewport);
  useEffect(() => {
    if (!needsSubdivisions || subdivisionFeatures) {
      return;
    }
    let isCurrent: boolean = true;

    loadGeometryFeatures("subdivisions")
      .then((loaded: Array<GeometryFeature>) => {
        if (isCurrent) {
          setSubdivisionFeatures(loaded);
        }
      })
      .catch(() => {
        // Backdrop, like the outlines: draw the map without them.
      });

    return () => {
      isCurrent = false;
    };
  }, [needsSubdivisions, subdivisionFeatures]);

  /*
   * Drawn only over the DETAIL outlines. Both are generated from the same
   * 1:50m source, so they agree along every coast; over the coarse overview
   * outlines these same lines would cross the coastline they end on. That
   * only happens in the window where the detail tier is still in flight, so
   * the lines arrive with the outlines they belong to rather than briefly
   * hanging off the edge of a country.
   */
  const subdivisions: Array<GeometryFeature> =
    needsSubdivisions && isDrawingDetail && subdivisionFeatures
      ? subdivisionFeatures
      : [];

  const siteById: Map<string, MapSiteView> = useMemo(() => {
    const map: Map<string, MapSiteView> = new Map<string, MapSiteView>();
    for (const site of props.sites) {
      map.set(site.id, site);
    }
    return map;
  }, [props.sites]);

  /*
   * Pan by dragging, zoom by wheel — the same interaction model, and the
   * same hard-won details, as NetworkDeviceGraph.
   *
   * Pointer deltas convert through the SVG's own rendered box: because every
   * viewport carries the world's aspect ratio (clampViewport guarantees it),
   * the SVG is never letterboxed and one screen pixel is exactly
   * viewport.width / renderedWidth viewBox units.
   */
  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const dragState: React.MutableRefObject<{
    pointerId: number;
    x: number;
    y: number;
    moved: number;
  } | null> = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  /*
   * Read by the markers: releasing a drag on top of a marker still fires a
   * click, and drilling into a site because a pan happened to end there is a
   * genuinely bad surprise. Cleared on the next pointerdown rather than on
   * pointerup — the click that must be ignored has not been dispatched yet.
   */
  const suppressClick: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const endDrag: (pointerId: number) => void = (pointerId: number): void => {
    if (dragState.current && dragState.current.pointerId === pointerId) {
      dragState.current = null;
      setIsDragging(false);
    }
  };

  /*
   * Wheel zoom needs a NATIVE non-passive listener: React's synthetic wheel
   * handler cannot preventDefault, so the page would scroll underneath the
   * map. The point under the cursor is held still.
   */
  useEffect(() => {
    const element: HTMLDivElement | null = containerRef.current;
    if (!element) {
      return undefined;
    }
    const onWheel: (event: WheelEvent) => void = (event: WheelEvent): void => {
      event.preventDefault();
      const svg: SVGSVGElement | null = element.querySelector("svg");
      const rect: DOMRect = (svg || element).getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return;
      }
      setViewport((current: MapViewport): MapViewport => {
        const focus: { x: number; y: number } = {
          x:
            current.x +
            ((event.clientX - rect.left) / rect.width) * current.width,
          y:
            current.y +
            ((event.clientY - rect.top) / rect.height) * current.height,
        };
        return zoomViewport(current, Math.exp(-event.deltaY * 0.0015), focus);
      });
      setOpenCluster(null);
      setHovered(null);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  const onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => void = (
    event: React.PointerEvent<SVGSVGElement>,
  ): void => {
    // One drag at a time — a second touch must not corrupt the pan.
    if (event.button !== 0 || dragState.current) {
      return;
    }
    dragState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: 0,
    };
    setIsDragging(true);
    suppressClick.current = false;
    /*
     * Capture is NOT taken here: pointer capture retargets the eventual
     * click to the SVG (Chromium/Safari retarget to the capture element,
     * Firefox to the common ancestor), which would stop the markers'
     * onClick from ever firing. It is taken in onPointerMove once the
     * pointer has actually moved — the same threshold that suppresses the
     * click.
     */
  };

  const onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => void = (
    event: React.PointerEvent<SVGSVGElement>,
  ): void => {
    const drag: {
      pointerId: number;
      x: number;
      y: number;
      moved: number;
    } | null = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const rect: DOMRect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const deltaX: number = event.clientX - drag.x;
    const deltaY: number = event.clientY - drag.y;
    drag.moved += Math.abs(deltaX) + Math.abs(deltaY);
    drag.x = event.clientX;
    drag.y = event.clientY;

    if (drag.moved > DRAG_THRESHOLD_PX) {
      /*
       * A real pan is in progress: the click is suppressed anyway, so
       * capturing now (and not on pointerdown) keeps the drag tracking
       * outside the SVG without eating stationary clicks on markers.
       */
      suppressClick.current = true;
      if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      setHovered(null);
    }

    /*
     * The map follows the pointer, so the frame moves the opposite way:
     * dragging the world to the right shows what was to its left.
     */
    setViewport((current: MapViewport): MapViewport => {
      return panViewport(
        current,
        (-deltaX / rect.width) * current.width,
        (-deltaY / rect.height) * current.height,
      );
    });
  };

  const onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => void = (
    event: React.KeyboardEvent<SVGSVGElement>,
  ): void => {
    const panX: number = viewport.width * KEYBOARD_PAN_FRACTION;
    const panY: number = viewport.height * KEYBOARD_PAN_FRACTION;

    switch (event.key) {
      case "ArrowLeft":
        changeViewport(panViewport(viewport, -panX, 0));
        break;
      case "ArrowRight":
        changeViewport(panViewport(viewport, panX, 0));
        break;
      case "ArrowUp":
        changeViewport(panViewport(viewport, 0, -panY));
        break;
      case "ArrowDown":
        changeViewport(panViewport(viewport, 0, panY));
        break;
      case "+":
      case "=":
        changeViewport(zoomViewport(viewport, ZOOM_STEP));
        break;
      case "-":
      case "_":
        changeViewport(zoomViewport(viewport, 1 / ZOOM_STEP));
        break;
      case "0":
        changeViewport(fittedViewport);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  /*
   * Nothing to draw: say so instead of shipping a blank map. With grouped
   * markers this is a genuinely common state — a hierarchy imported without
   * coordinates has plenty of sites and no geography — so the empty state
   * names the sites it could not place and says what to do about it.
   */
  if (markers.length === 0) {
    const hasSites: boolean = props.sites.length > 0;
    const unplacedCount: number = props.unplacedSites.length;
    const searchText: string = (props.searchText || "").trim();
    /*
     * A search that matched nothing is not the same emptiness as a project
     * with no coordinates on it, and telling somebody to go add latitudes
     * when the real answer is "that name is not here" sends them off to fix
     * something that is not broken.
     */
    if (searchText && !hasSites) {
      return (
        <div className="w-full rounded-lg border border-gray-200 bg-white shadow-sm">
          <EmptyState
            id="site-geo-map-no-search-match"
            icon={IconProp.Search}
            title="No sites here match your search"
            description={
              <span className="mx-auto block max-w-md">
                {`Nothing at this level matches “${searchText}”. The results under the search box look through your whole network, not just this level.`}
              </span>
            }
          />
        </div>
      );
    }
    return (
      <div className="w-full rounded-lg border border-gray-200 bg-white shadow-sm">
        <EmptyState
          id="site-geo-map-empty"
          icon={IconProp.Globe}
          title={
            hasSites
              ? "No sites can be placed on the map"
              : "Nothing to put on the map yet"
          }
          description={
            hasSites ? (
              <span className="mx-auto block max-w-md">
                {unmappableCount} site
                {unmappableCount === 1 ? " has" : "s have"} coordinates the map
                cannot read. Check the latitude and longitude on{" "}
                {unmappableCount === 1 ? "that site" : "those sites"}.
              </span>
            ) : (
              <span className="mx-auto block max-w-md">
                {unplacedCount > 0
                  ? `${unplacedCount} ${
                      unplacedCount === 1 ? "site has" : "sites have"
                    } no coordinates — neither on ${
                      unplacedCount === 1 ? "it" : "them"
                    } nor on anything beneath. Add a latitude and longitude to the sites at the bottom of your hierarchy and everything above them lands on the map automatically.`
                  : "Sites with a latitude and longitude appear here. Add coordinates to a site to place it on the map."}
              </span>
            )
          }
        />
      </div>
    );
  }

  /*
   * Count the same thing the coverage line NAMES. In "all" mode it talks
   * about sites, and a marker there can stand for a dozen of them — counting
   * markers against a site total would report "40 of 1400 sites in view" for
   * a frame holding every one of them.
   */
  const inViewCount: number = countPointsInViewport(
    props.mode === "all" ? pins : markers,
    viewport,
  );
  const isFitted: boolean = viewportsMatch(viewport, fittedViewport);
  const isWholeWorld: boolean = viewportsMatch(viewport, WORLD_VIEWPORT);
  const coverageLabel: string = describeMapCoverage({
    mode: props.mode,
    markerCount: markers.length,
    inViewCount: inViewCount,
    siteCount: pins.length,
    childTypeLabel: props.childTypeLabel,
  });

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="p-3 sm:p-4">
        {/*
         * What the markers mean, and the one control that changes it. A
         * customer looking at a map that does not match their network needs
         * the answer to "what am I looking at" before anything else — so it
         * is written above the map, not buried in a legend below it.
         */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-xs text-gray-500">
            {props.mode === "grouped"
              ? `Each marker is one ${props.childTypeLabel.toLowerCase()} — click to open it.`
              : "Each marker is one site. Nearby sites share a marker; zoom in to separate them."}
          </p>
          <MapModeSwitch
            mode={props.selectedMode}
            childTypeLabel={props.childTypeLabel}
            onModeChange={props.onModeChange}
          />
        </div>
        {/*
         * This wrapper is exactly the SVG's box, so the percentage-anchored
         * overlays below line up with the markers they point at. It also
         * owns the native wheel listener and the touch-action opt-out that
         * lets a finger drag the map instead of scrolling the page.
         */}
        <div
          ref={containerRef}
          className="relative"
          style={{ touchAction: "none" }}
        >
          {/*
           * Outlines still in flight. The SVG underneath already holds the
           * map's exact box, so a skeleton laid over it keeps the card from
           * jumping and stops half-drawn markers showing on bare white. No
           * copy on purpose — a "loading" line would read as a failure
           * state for what is usually a sub-100ms chunk fetch.
           */}
          {overviewFeatures === null ? (
            <div
              aria-hidden="true"
              data-testid="site-geo-map-skeleton"
              className="absolute inset-0 z-30 animate-pulse rounded-md bg-gray-100"
            />
          ) : (
            <></>
          )}
          <svg
            role="img"
            tabIndex={0}
            aria-label="World network site map. Arrow keys pan, plus and minus zoom, zero refits the map to your sites."
            viewBox={viewBoxOfViewport(viewport)}
            preserveAspectRatio="xMidYMid meet"
            className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            style={{
              width: "100%",
              height: "auto",
              minWidth: "480px",
              cursor: isDragging ? "grabbing" : "grab",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event: React.PointerEvent<SVGSVGElement>) => {
              endDrag(event.pointerId);
            }}
            onPointerCancel={(event: React.PointerEvent<SVGSVGElement>) => {
              endDrag(event.pointerId);
            }}
            onPointerLeave={(event: React.PointerEvent<SVGSVGElement>) => {
              endDrag(event.pointerId);
            }}
            onKeyDown={onKeyDown}
          >
            {/* Land outlines under the pins. */}
            <g>
              {(features || []).map(
                (feature: GeometryFeature): ReactElement => {
                  return (
                    <path
                      key={feature.id}
                      d={feature.path}
                      fillRule="evenodd"
                      fill="var(--ou-surface-quaternary, #e5e7eb)"
                      stroke="var(--ou-chart-tick, #6b7280)"
                      strokeWidth={0.6 / zoom}
                      strokeOpacity={0.8}
                    >
                      <title>{feature.name}</title>
                    </path>
                  );
                },
              )}
            </g>

            {/*
             * State and province lines, over the land and under everything
             * else. Thinner and fainter than the country outlines on purpose:
             * this is the second level of a reference frame, not a second set
             * of countries, and it has to stay quieter than both the borders
             * above it and the markers it exists to locate.
             *
             * Open polylines, so fill MUST be none — these paths are the
             * boundaries interior to a country, not closed shapes, and
             * filling them would flood the map with wedges.
             *
             * Decoration, not data: no <title> to compete with the outline's
             * tooltip underneath, aria-hidden for the same reason the map's
             * one aria-label already describes the whole picture, and no
             * pointer events, so a state line can never swallow a click meant
             * for a marker.
             */}
            <g
              data-testid="site-geo-map-subdivisions"
              aria-hidden="true"
              style={{ pointerEvents: "none" }}
            >
              {subdivisions.map((feature: GeometryFeature): ReactElement => {
                return (
                  <path
                    key={`subdivision-${feature.id}`}
                    d={feature.path}
                    fill="none"
                    stroke="var(--ou-chart-tick, #6b7280)"
                    strokeWidth={0.4 / zoom}
                    strokeOpacity={0.55}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}
            </g>

            {/*
             * Site links, under everything else on the map.
             *
             * This is the network's shape — what is connected to what —
             * which geography alone cannot show. A link is drawn WHETHER OR
             * NOT a monitor is attached to it: the monitor decides the
             * color, never whether the connection exists. Unmonitored links
             * are dashed and neutral, so "nothing is watching this" reads
             * differently from "something is watching this and it is fine"
             * even for a customer whose operational color is a grey.
             *
             * Each line is drawn over a white under-stroke, the same trick
             * the leader lines and the name labels use, so it survives a
             * coastline or a dark landmass.
             */}
            <g data-testid="site-geo-map-links">
              {linkLines.map((link: DrawableMapLink): ReactElement => {
                const path: string = mapLinkPath(link);
                return (
                  <g key={`link-${link.key}`}>
                    <path
                      d={path}
                      fill="none"
                      stroke="var(--ou-surface-primary, #ffffff)"
                      strokeWidth={4 / zoom}
                      strokeOpacity={0.85}
                      strokeLinecap="round"
                      style={{ pointerEvents: "none" }}
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke={link.color}
                      strokeWidth={1.75 / zoom}
                      strokeOpacity={0.95}
                      strokeLinecap="round"
                      strokeDasharray={
                        link.hasMonitor ? undefined : `${5 / zoom} ${4 / zoom}`
                      }
                      style={{ pointerEvents: "none" }}
                    />
                    {/*
                     * The hit area. A 2px line is unhoverable in practice,
                     * and the name of a link is the whole reason to hover
                     * one — so the pointer target is a fat invisible stroke
                     * over the same path.
                     */}
                    <path
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12 / zoom}
                      strokeLinecap="round"
                      onMouseEnter={() => {
                        if (dragState.current) {
                          return;
                        }
                        setHovered({
                          x: link.midX,
                          y: link.midY,
                          label: link.tooltip,
                        });
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                      }}
                    >
                      <title>{link.tooltip}</title>
                    </path>
                  </g>
                );
              })}
            </g>

            {/*
             * Leader lines, under the markers they belong to.
             *
             * A marker that had to be moved off its real position keeps a
             * thread back to it, ending in a dot on the exact spot. Without
             * this the map would be quietly wrong — a store drawn twenty
             * pixels from where it is, with nothing saying so. With it, the
             * displacement is legible: the marker is the thing you click,
             * the dot is the place it is.
             *
             * Drawn in the marker's own colour so a nudged outage still
             * reads red at a glance, over a white under-stroke so the thread
             * survives a coastline or a dark landmass — the same trick the
             * name labels use.
             */}
            <g style={{ pointerEvents: "none" }}>
              {placedMarkers
                .filter((marker: PlacedMapMarker): boolean => {
                  return marker.needsLeaderLine;
                })
                .map((marker: PlacedMapMarker): ReactElement => {
                  const color: string = CLUSTER_COLORS[marker.colorKey];
                  return (
                    <g key={`leader-${marker.key}`} aria-hidden="true">
                      <line
                        x1={marker.anchorX}
                        y1={marker.anchorY}
                        x2={marker.x}
                        y2={marker.y}
                        stroke="var(--ou-surface-primary, #ffffff)"
                        strokeWidth={3.5 / zoom}
                        strokeOpacity={0.9}
                        strokeLinecap="round"
                      />
                      <line
                        x1={marker.anchorX}
                        y1={marker.anchorY}
                        x2={marker.x}
                        y2={marker.y}
                        stroke={color}
                        strokeWidth={1.25 / zoom}
                        strokeOpacity={0.9}
                        strokeLinecap="round"
                      />
                      {/* The exact spot: a white pip so the dot reads on
                       * land, and the marker's colour inside it. */}
                      <circle
                        cx={marker.anchorX}
                        cy={marker.anchorY}
                        r={2.25 / zoom}
                        fill="var(--ou-surface-primary, #ffffff)"
                      />
                      <circle
                        cx={marker.anchorX}
                        cy={marker.anchorY}
                        r={1.25 / zoom}
                        fill={color}
                      />
                    </g>
                  );
                })}
            </g>

            {/*
             * The markers. A CONTAINER — a region, a market, "Corp" — is
             * drawn as a rounded square, the same shape as the cards it
             * opens into; a single site stays a round pin. The difference is
             * a shape, not a hue, so "this is a level you can go into"
             * survives both a color-blind reader and a grayscale print.
             *
             * Positions come from the collision layout above, so no marker
             * is ever hidden under another one — see layoutMapMarkers.
             */}
            <g>
              {placedMarkers.map((marker: PlacedMapMarker): ReactElement => {
                const color: string = CLUSTER_COLORS[marker.colorKey];
                /*
                 * Sized on screen, then converted for this zoom: the marker
                 * is UI, not geography, so it must not grow with the map.
                 */
                const radius: number = screenLengthToViewportLength(
                  marker.screenRadius,
                  viewport,
                );
                const hasCount: boolean = marker.count > 1;
                const key: string = marker.key;
                /*
                 * Where this marker's name goes — position, anchor and the
                 * thread back to the marker when the name could not fit
                 * against it. All of it comes from resolveMarkerLabels:
                 * re-deriving any of it here would let the map draw a name
                 * somewhere the collision pass never checked.
                 */
                const labelPlacement: LabelPlacement | undefined =
                  labelPlacements.get(key);
                const activate: () => void = (): void => {
                  if (marker.ids.length === 1) {
                    setOpenCluster(null);
                    props.onSiteClick(marker.ids[0]!);
                  } else {
                    setOpenCluster({
                      x: marker.x,
                      y: marker.y,
                      ids: marker.ids,
                    });
                  }
                };
                /*
                 * A square of side 2r covers a good deal more ink than a
                 * circle of radius r, so containers are drawn slightly
                 * tighter to keep the two shapes reading at one weight. The
                 * factor is shared with the label and collision geometry,
                 * which both have to know the same square.
                 */
                const side: number = radius * CONTAINER_SIDE_FACTOR;
                const haloSide: number = side + ((hasCount ? 4 : 3) * 2) / zoom;

                return (
                  <g
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={marker.tooltip}
                    style={{ cursor: "pointer", outline: "none" }}
                    onClick={() => {
                      // A pan that happened to end on a marker is not a click.
                      if (suppressClick.current) {
                        return;
                      }
                      activate();
                    }}
                    onKeyDown={(event: React.KeyboardEvent<SVGGElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        activate();
                      }
                    }}
                    onMouseEnter={() => {
                      if (dragState.current) {
                        return;
                      }
                      setHovered({
                        x: marker.x,
                        y: marker.y,
                        label: marker.tooltip,
                      });
                    }}
                    onMouseLeave={() => {
                      setHovered(null);
                    }}
                    onFocus={() => {
                      setFocusedKey(key);
                      setHovered({
                        x: marker.x,
                        y: marker.y,
                        label: marker.tooltip,
                      });
                    }}
                    onBlur={() => {
                      setFocusedKey(null);
                      setHovered(null);
                    }}
                  >
                    {/*
                     * Soft halo in the marker's own color: lifts the marker
                     * off both a pale landmass and a dark one, and gives a
                     * marker that stands for many sites visible extra weight.
                     */}
                    {marker.isContainer ? (
                      <rect
                        x={marker.x - haloSide / 2}
                        y={marker.y - haloSide / 2}
                        width={haloSide}
                        height={haloSide}
                        rx={haloSide * 0.28}
                        fill={color}
                        fillOpacity={0.18}
                      />
                    ) : (
                      <circle
                        cx={marker.x}
                        cy={marker.y}
                        r={radius + (hasCount ? 4 : 3) / zoom}
                        fill={color}
                        fillOpacity={0.18}
                      />
                    )}

                    {marker.isContainer ? (
                      <rect
                        x={marker.x - side / 2}
                        y={marker.y - side / 2}
                        width={side}
                        height={side}
                        rx={side * 0.26}
                        fill={color}
                        fillOpacity={0.95}
                        stroke="var(--ou-chart-marker-ring, #ffffff)"
                        strokeWidth={(hasCount ? 2.5 : 2) / zoom}
                        /*
                         * An inferred position is drawn as a dashed edge —
                         * the marker is where this region's sites average
                         * out, not somewhere anybody pinned.
                         */
                        strokeDasharray={
                          marker.isApproximate
                            ? `${5 / zoom} ${3 / zoom}`
                            : undefined
                        }
                      />
                    ) : (
                      <circle
                        cx={marker.x}
                        cy={marker.y}
                        r={radius}
                        fill={color}
                        fillOpacity={0.95}
                        stroke="var(--ou-chart-marker-ring, #ffffff)"
                        strokeWidth={(hasCount ? 2.5 : 2) / zoom}
                      />
                    )}

                    {hasCount ? (
                      <text
                        x={marker.x}
                        y={marker.y}
                        dy="0.36em"
                        textAnchor="middle"
                        fontSize={
                          (marker.screenRadius >= 14
                            ? 13
                            : marker.screenRadius >= 10
                              ? 11
                              : 10) / zoom
                        }
                        fontWeight={700}
                        fill="#ffffff"
                        style={{ pointerEvents: "none" }}
                      >
                        {marker.count}
                      </text>
                    ) : (
                      <></>
                    )}

                    {/*
                     * The name, by the marker. This is the difference
                     * between a map of your network and a scatter of dots:
                     * "Region 1000" is on the map, where the customer put
                     * it, instead of only in a tooltip.
                     *
                     * Position and anchor come straight off the placement —
                     * offsets are screen units, like everything else that
                     * must not grow with the map, so they are divided by the
                     * zoom and added to where the marker is drawn.
                     *
                     * paint-order draws the stroke first, so the halo sits
                     * BEHIND the glyphs and the label stays readable over a
                     * coastline, a landmass or another marker.
                     */}
                    {marker.label && labelPlacement ? (
                      <>
                        {/*
                         * A name that could not fit against its marker keeps
                         * a thread back to it — the same bargain the marker
                         * leader lines make with position, and what lets a
                         * dozen units in one retail park all keep their
                         * names. Neutral rather than the marker's colour: a
                         * name is typography, not status, and a second
                         * coloured thread beside the anchor line would read
                         * as a second claim about the site.
                         */}
                        {labelPlacement.leaderLine ? (
                          <g aria-hidden="true">
                            <line
                              x1={
                                marker.x + labelPlacement.leaderLine.x1 / zoom
                              }
                              y1={
                                marker.y + labelPlacement.leaderLine.y1 / zoom
                              }
                              x2={
                                marker.x + labelPlacement.leaderLine.x2 / zoom
                              }
                              y2={
                                marker.y + labelPlacement.leaderLine.y2 / zoom
                              }
                              stroke="var(--ou-surface-primary, #ffffff)"
                              strokeWidth={3 / zoom}
                              strokeOpacity={0.9}
                              strokeLinecap="round"
                            />
                            <line
                              x1={
                                marker.x + labelPlacement.leaderLine.x1 / zoom
                              }
                              y1={
                                marker.y + labelPlacement.leaderLine.y1 / zoom
                              }
                              x2={
                                marker.x + labelPlacement.leaderLine.x2 / zoom
                              }
                              y2={
                                marker.y + labelPlacement.leaderLine.y2 / zoom
                              }
                              stroke="var(--ou-chart-tick, #6b7280)"
                              strokeWidth={0.9 / zoom}
                              strokeOpacity={0.75}
                              strokeLinecap="round"
                            />
                          </g>
                        ) : (
                          <></>
                        )}
                        <text
                          x={marker.x + labelPlacement.offsetX / zoom}
                          /*
                           * The label's CENTRE, matching the box
                           * resolveMarkerLabels reserved for it — dy centres
                           * the glyphs on it the same way the count inside
                           * the marker is centred.
                           */
                          y={marker.y + labelPlacement.offsetY / zoom}
                          dy="0.36em"
                          textAnchor={labelPlacement.textAnchor}
                          fontSize={LABEL_FONT_SIZE / zoom}
                          fontWeight={600}
                          fill="var(--ou-text-secondary, #374151)"
                          stroke="var(--ou-surface-primary, #ffffff)"
                          strokeWidth={3 / zoom}
                          strokeLinejoin="round"
                          paintOrder="stroke"
                          style={{ pointerEvents: "none" }}
                        >
                          {marker.label}
                        </text>
                      </>
                    ) : (
                      <></>
                    )}

                    {/* Keyboard focus ring — the marker has no CSS box to outline. */}
                    {focusedKey === key ? (
                      marker.isContainer ? (
                        <rect
                          x={marker.x - side / 2 - 5 / zoom}
                          y={marker.y - side / 2 - 5 / zoom}
                          width={side + 10 / zoom}
                          height={side + 10 / zoom}
                          rx={(side + 10 / zoom) * 0.26}
                          fill="none"
                          stroke="var(--ou-link, #4f46e5)"
                          strokeWidth={2 / zoom}
                          style={{ pointerEvents: "none" }}
                        />
                      ) : (
                        <circle
                          cx={marker.x}
                          cy={marker.y}
                          r={radius + 5 / zoom}
                          fill="none"
                          stroke="var(--ou-link, #4f46e5)"
                          strokeWidth={2 / zoom}
                          style={{ pointerEvents: "none" }}
                        />
                      )
                    ) : (
                      <></>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Zoom and framing controls. */}
          <div className="absolute right-2 top-2 z-10 flex flex-col rounded-lg border border-gray-200 bg-white/95 p-0.5 shadow-sm backdrop-blur">
            <MapControlButton
              label="Zoom in"
              icon={IconProp.MagnifyingGlassPlus}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => {
                changeViewport(zoomViewport(viewport, ZOOM_STEP));
              }}
            />
            <MapControlButton
              label="Zoom out"
              icon={IconProp.MagnifyingGlassMinus}
              disabled={isWholeWorld}
              onClick={() => {
                changeViewport(zoomViewport(viewport, 1 / ZOOM_STEP));
              }}
            />
            <MapControlButton
              label="Fit to sites"
              icon={IconProp.MapPin}
              disabled={isFitted}
              onClick={() => {
                changeViewport(fittedViewport);
              }}
            />
            <MapControlButton
              label="Whole world"
              icon={IconProp.Globe}
              disabled={isWholeWorld}
              onClick={() => {
                changeViewport(clampViewport(WORLD_VIEWPORT));
              }}
            />
          </div>

          {/* Hover/focus label — readable in both themes, unlike a native title. */}
          {hovered && !openCluster ? (
            <div
              className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-md"
              style={overlayPosition(hovered.x, hovered.y, viewport, 12)}
            >
              {hovered.label}
            </div>
          ) : (
            <></>
          )}

          {/* Site picker for multi-site clusters. */}
          {openCluster ? (
            <div
              className="absolute z-20 w-60 rounded-md border border-gray-200 bg-white shadow-lg"
              style={overlayPosition(
                openCluster.x,
                openCluster.y,
                viewport,
                12,
              )}
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
                <span className="text-xs font-medium text-gray-700">
                  {openCluster.ids.length} sites here
                </span>
                <button
                  type="button"
                  aria-label="Close site list"
                  className="rounded text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  onClick={() => {
                    setOpenCluster(null);
                  }}
                >
                  ✕
                </button>
              </div>
              <ul role="list" className="max-h-48 overflow-y-auto py-1">
                {openCluster.ids.map((siteId: string): ReactElement | null => {
                  const site: MapSiteView | undefined = siteById.get(siteId);
                  if (!site) {
                    return null;
                  }
                  return (
                    <li key={siteId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                        title={
                          site.parentBreadcrumb
                            ? `${site.name} — ${site.parentBreadcrumb}`
                            : site.name
                        }
                        onClick={() => {
                          setOpenCluster(null);
                          props.onSiteClick(siteId);
                        }}
                      >
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: dotColorForSite(site) }}
                        />
                        <span className="truncate">{site.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>

      {/*
       * Legend + scale line. Without it a viewer cannot tell what a green
       * dot means, or how much of the network the map is actually showing.
       */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 px-3 py-2.5 sm:px-4">
        <ul
          role="list"
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          aria-label="Marker color key"
        >
          {LEGEND.map(
            (entry: { key: ClusterColorKey; label: string }): ReactElement => {
              return (
                <li
                  key={entry.key}
                  className="flex items-center gap-1.5 text-xs text-gray-600"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: CLUSTER_COLORS[entry.key] }}
                  />
                  {entry.label}
                </li>
              );
            },
          )}
        </ul>

        {/*
         * The shape key. Color says how it is doing; SHAPE says what it is —
         * a level you can open, or a single place. Without this line the
         * square is decoration.
         */}
        {props.mode === "grouped" ? (
          <ul
            role="list"
            className="flex flex-wrap items-center gap-x-3 gap-y-1"
            aria-label="Marker shape key"
          >
            {/*
             * Colored inline from the marker palette, like the status
             * swatches above: a Tailwind gray class here would be one of the
             * steps the dark theme does not recolor, and the swatch has to
             * be the same neutral in both themes anyway — it is standing in
             * for a SHAPE, not for a state.
             */}
            <li className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 flex-shrink-0 rounded-[3px] ring-2 ring-white"
                style={{ backgroundColor: CLUSTER_COLORS["none"] }}
              />
              Group — opens
            </li>
            <li className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-white"
                style={{ backgroundColor: CLUSTER_COLORS["none"] }}
              />
              Single site
            </li>
          </ul>
        ) : (
          <></>
        )}

        {/*
         * What the lines are. Shown only when the map is drawing some, and
         * it says both halves of the rule: the color comes from the monitor
         * on the link, and a link without one is dashed rather than absent.
         */}
        {linkLines.length > 0 ? (
          <span
            data-testid="site-geo-map-link-key"
            className="flex items-center gap-1.5 text-xs text-gray-600"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 12"
              className="h-3 w-6 flex-shrink-0"
            >
              <line
                x1="2"
                y1="4"
                x2="22"
                y2="4"
                stroke={DEFAULT_MAP_LINK_COLOR}
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="2"
                y1="9"
                x2="22"
                y2="9"
                stroke={DEFAULT_MAP_LINK_COLOR}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeDasharray="4 3"
              />
            </svg>
            Site link — colored by its monitor; dashed when it has none
          </span>
        ) : (
          <></>
        )}

        {/*
         * What the threads mean. Shown only while the map is drawing some:
         * a key for something that is not on screen is clutter, and on most
         * levels nothing has to move at all.
         */}
        {hasNudgedMarkers ? (
          <span
            data-testid="site-geo-map-nudged-key"
            className="flex items-center gap-1.5 text-xs text-gray-600"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 12"
              className="h-3 w-6 flex-shrink-0"
            >
              <line
                x1="3"
                y1="9"
                x2="16"
                y2="4"
                stroke={CLUSTER_COLORS["none"]}
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <circle cx="3" cy="9" r="1.8" fill={CLUSTER_COLORS["none"]} />
              <circle cx="18" cy="4" r="4" fill={CLUSTER_COLORS["none"]} />
            </svg>
            Nudged apart — the line ends at the real spot
          </span>
        ) : (
          <></>
        )}

        {/*
         * A line on this map used to mean exactly one thing, and the key
         * above said so. A name that could not fit against its marker is
         * now joined to it by a second, thinner kind of line — so once any
         * are drawn, the key has to stop claiming every line is a nudge.
         */}
        {hasThreadedLabels ? (
          <span
            data-testid="site-geo-map-label-thread-key"
            className="flex items-center gap-1.5 text-xs text-gray-600"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 12"
              className="h-3 w-6 flex-shrink-0"
            >
              <circle cx="4" cy="6" r="3" fill={CLUSTER_COLORS["none"]} />
              <line
                x1="7"
                y1="6"
                x2="14"
                y2="6"
                stroke="var(--ou-chart-tick, #6b7280)"
                strokeWidth="1"
                strokeLinecap="round"
              />
              <rect
                x="14"
                y="3"
                width="8"
                height="6"
                rx="1"
                fill="var(--ou-chart-tick, #6b7280)"
                fillOpacity="0.35"
              />
            </svg>
            Name set clear — the line joins it to its marker
          </span>
        ) : (
          <></>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 sm:ml-auto">
          {/*
           * Once the frame no longer holds everything, say what it does hold
           * — a count that quietly shrinks as you zoom reads as sites
           * disappearing.
           */}
          <span data-testid="site-geo-map-count">{coverageLabel}</span>
          {/* Coordinates the projection cannot read at all. */}
          {unmappableCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
              {unmappableCount} without usable coordinates
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>

      {/*
       * What the map is NOT showing. A level whose card sits right under the
       * map but whose marker is nowhere on it is the single most confusing
       * thing this page can do, so the omission is stated, named, and made
       * fixable — every one of these needs coordinates on something beneath
       * it.
       */}
      {props.unplacedSites.length > 0 ? (
        <div
          data-testid="site-geo-map-unplaced"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-100 px-3 py-2.5 text-xs text-gray-500 sm:px-4"
        >
          <Icon
            className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
            icon={IconProp.MapPin}
          />
          <span>
            Not on the map — no coordinates yet
            {props.unplacedSites.length > UNPLACED_NAMES_SHOWN
              ? ` (${props.unplacedSites.length})`
              : ""}
            :
          </span>
          {props.unplacedSites
            .slice(0, UNPLACED_NAMES_SHOWN)
            .map((site: MapUnplacedSiteView): ReactElement => {
              return (
                <button
                  key={site.id}
                  type="button"
                  title={`${site.name} — ${site.siteType}. Open it and add coordinates to a site beneath it.`}
                  className="inline-flex max-w-full items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-medium text-gray-600 transition hover:border-indigo-300 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    props.onSiteClick(site.id);
                  }}
                >
                  <span className="truncate">{site.name}</span>
                </button>
              );
            })}
          {props.unplacedSites.length > UNPLACED_NAMES_SHOWN ? (
            <span className="text-gray-400">
              +{props.unplacedSites.length - UNPLACED_NAMES_SHOWN} more
            </span>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SiteGeoMap;
