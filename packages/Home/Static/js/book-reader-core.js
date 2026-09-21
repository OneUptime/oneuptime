/*
 * The book reader's pure logic: layout, pagination maps, spreads, reading
 * positions, deep links and the page-fold geometry behind the page turn.
 *
 * Nothing here touches the DOM, so it runs unchanged in the browser (as
 * window.OneUptimeBookReaderCore) and under Jest (via module.exports), where
 * packages/Home/Tests/Books/BookReaderCore.test.ts exercises it directly.
 */
(function (root, factory) {
  "use strict";
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OneUptimeBookReaderCore = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FONT_STEPS = [0.86, 0.93, 1, 1.08, 1.17, 1.27];
  var DEFAULT_FONT_STEP = 2;
  var THEMES = ["paper", "sepia", "night"];
  var DEFAULT_THEME = "paper";
  var SECTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var SPREAD_MIN_VIEWPORT = 900;
  var SPREAD_MIN_PAGE_WIDTH = 300;
  var PAGE_ASPECT = 0.68;

  function clamp(value, min, max) {
    if (!(value >= min)) {
      return min;
    }
    return value > max ? max : value;
  }

  function isSectionId(value) {
    return typeof value === "string" && SECTION_ID_PATTERN.test(value);
  }

  /*
   * Works out the page size for a viewport. Wide screens show a two-page
   * spread, narrow ones a single page. Pages keep a book-like aspect ratio on
   * a spread; a single page on a phone uses the full height it is given.
   */
  function computeLayout(viewport, options) {
    options = options || {};
    var width = Math.max(240, Number(viewport && viewport.width) || 0);
    var height = Math.max(320, Number(viewport && viewport.height) || 0);
    var chromeTop = options.chromeTop != null ? options.chromeTop : 64;
    var chromeBottom = options.chromeBottom != null ? options.chromeBottom : 76;
    var fontStep = clamp(
      Math.round(
        options.fontStep != null ? options.fontStep : DEFAULT_FONT_STEP,
      ),
      0,
      FONT_STEPS.length - 1,
    );
    var sideGutter = width >= SPREAD_MIN_VIEWPORT ? 88 : width >= 600 ? 56 : 10;
    var verticalGutter = width >= 600 ? 28 : 10;
    var availableWidth = width - sideGutter * 2;
    var availableHeight =
      height - chromeTop - chromeBottom - verticalGutter * 2;
    var mode =
      width >= SPREAD_MIN_VIEWPORT &&
      availableWidth / 2 >= SPREAD_MIN_PAGE_WIDTH &&
      width > height * 1.05
        ? "spread"
        : "single";
    var pageWidth;
    var pageHeight;

    availableHeight = Math.max(260, availableHeight);

    if (mode === "spread") {
      pageHeight = Math.min(
        availableHeight,
        availableWidth / 2 / PAGE_ASPECT,
        900,
      );
      pageWidth = pageHeight * PAGE_ASPECT;
    } else {
      pageWidth = Math.min(availableWidth, 560);
      pageHeight = Math.min(availableHeight, pageWidth / 0.56, 900);
      if (pageHeight / pageWidth < 1.2) {
        pageWidth = Math.max(220, pageHeight / 1.2);
      }
    }

    pageWidth = Math.floor(pageWidth);
    pageHeight = Math.floor(pageHeight);

    var inner = Math.round(clamp(pageWidth * 0.1, 18, 56));
    var outer = Math.round(clamp(pageWidth * 0.085, 16, 48));
    var top = Math.round(clamp(pageHeight * 0.075, 26, 64));
    var bottom = Math.round(clamp(pageHeight * 0.085, 30, 70));
    var contentWidth = pageWidth - inner - outer;
    var contentHeight = pageHeight - top - bottom;
    var baseFont = clamp(contentWidth / 24, 15, 20);
    var fontSize = Math.round(baseFont * FONT_STEPS[fontStep] * 10) / 10;
    var lineHeight = Math.round(fontSize * 1.58 * 10) / 10;

    // Snap the text block to whole lines so no line is cut at the page foot.
    contentHeight = Math.max(
      lineHeight * 4,
      Math.floor(contentHeight / lineHeight) * lineHeight,
    );

    return {
      mode: mode,
      pageWidth: pageWidth,
      pageHeight: pageHeight,
      bookWidth: mode === "spread" ? pageWidth * 2 : pageWidth,
      bookHeight: pageHeight,
      padding: { top: top, bottom: bottom, inner: inner, outer: outer },
      contentWidth: contentWidth,
      contentHeight: Math.round(contentHeight * 100) / 100,
      columnGap: inner + outer,
      fontStep: fontStep,
      fontSize: fontSize,
      lineHeight: lineHeight,
    };
  }

  function layoutKey(layout) {
    return [
      layout.mode,
      layout.contentWidth,
      layout.contentHeight,
      layout.fontSize,
    ].join(":");
  }

  // Pagination: every section starts on a new page.
  function createPageMap(counts) {
    var starts = [];
    var total = 0;
    var safeCounts = [];

    for (var index = 0; index < counts.length; index++) {
      var count = Math.max(1, Math.floor(Number(counts[index]) || 1));
      safeCounts.push(count);
      starts.push(total);
      total += count;
    }

    return { counts: safeCounts, starts: starts, total: total };
  }

  function locatePage(map, page) {
    if (!map || map.total === 0 || !(page >= 0) || page >= map.total) {
      return null;
    }

    var low = 0;
    var high = map.starts.length - 1;

    while (low < high) {
      var middle = (low + high + 1) >> 1;
      if (map.starts[middle] <= page) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return { section: low, offset: page - map.starts[low] };
  }

  function pageOf(map, section, offset) {
    if (!map || section < 0 || section >= map.starts.length) {
      return 0;
    }
    return (
      map.starts[section] +
      clamp(Math.floor(offset || 0), 0, map.counts[section] - 1)
    );
  }

  /*
   * Views. On a spread, view 0 is the inside of the front cover facing the
   * first page; view v shows pages 2v-1 and 2v. -1 is the front endpaper and
   * `total` the back endpaper. A single-page view shows one page.
   */
  function viewCount(total, mode) {
    if (total <= 0) {
      return 0;
    }
    return mode === "spread" ? Math.floor(total / 2) + 1 : total;
  }

  function viewForPage(page, mode) {
    page = Math.max(0, Math.floor(page || 0));
    return mode === "spread" ? Math.floor((page + 1) / 2) : page;
  }

  function viewPages(view, mode) {
    if (mode === "spread") {
      return [view * 2 - 1, view * 2];
    }
    return [view];
  }

  // The page a view is "at" for positions, links and the page counter.
  function primaryPage(view, mode, total) {
    var page = mode === "spread" ? Math.max(0, view * 2 - 1) : view;
    return clamp(page, 0, Math.max(0, total - 1));
  }

  /*
   * The page a view is read from. On a spread that is the left page, unless
   * a chapter starts on the right-hand page and not on the left: then the
   * reader is about to start that chapter, so it names the view.
   */
  function readingPage(map, view, mode) {
    var total = map ? map.total : 0;
    var page = primaryPage(view, mode, total);
    if (mode !== "spread" || view < 0 || !map) {
      return page;
    }
    var left = locatePage(map, view * 2 - 1);
    var right = locatePage(map, view * 2);
    if (right && right.offset === 0 && !(left && left.offset === 0)) {
      return view * 2;
    }
    return page;
  }

  function positionForPage(map, sectionIds, page) {
    var located = locatePage(map, page);
    if (!located) {
      return null;
    }
    var count = map.counts[located.section];
    return {
      sectionId: sectionIds[located.section],
      fraction: count > 1 ? located.offset / count : 0,
    };
  }

  function pageForPosition(map, sectionIds, position) {
    if (!position || !map) {
      return 0;
    }
    var section = sectionIds.indexOf(position.sectionId);
    if (section < 0) {
      return 0;
    }
    var fraction = clamp(Number(position.fraction) || 0, 0, 0.9999);
    return pageOf(
      map,
      section,
      Math.floor(fraction * map.counts[section] + 1e-6),
    );
  }

  // Deep links: #read opens the reader, #read/m05 opens it at a section.
  function parseReaderHash(hash) {
    if (typeof hash !== "string") {
      return null;
    }
    var value = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    if (value !== "read" && value.indexOf("read/") !== 0) {
      return null;
    }
    var sectionId = value.slice(5);
    try {
      sectionId = decodeURIComponent(sectionId);
    } catch (error) {
      sectionId = "";
    }
    return { sectionId: isSectionId(sectionId) ? sectionId : null };
  }

  function readerHash(sectionId) {
    return isSectionId(sectionId) ? "#read/" + sectionId : "#read";
  }

  function parseStoredPosition(raw) {
    var value;
    try {
      value = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
      return null;
    }
    if (!value || typeof value !== "object" || !isSectionId(value.sectionId)) {
      return null;
    }
    var fraction = Number(value.fraction);
    return {
      sectionId: value.sectionId,
      fraction: isFinite(fraction) ? clamp(fraction, 0, 0.9999) : 0,
      label: typeof value.label === "string" ? value.label.slice(0, 160) : "",
      progress: isFinite(Number(value.progress))
        ? clamp(Number(value.progress), 0, 1)
        : 0,
      updatedAt: isFinite(Number(value.updatedAt))
        ? Number(value.updatedAt)
        : 0,
    };
  }

  function parseStoredSettings(raw) {
    var value;
    try {
      value = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
      value = null;
    }
    value = value && typeof value === "object" ? value : {};
    var fontStep = Math.round(Number(value.fontStep));
    return {
      fontStep: isFinite(fontStep)
        ? clamp(fontStep, 0, FONT_STEPS.length - 1)
        : DEFAULT_FONT_STEP,
      theme: THEMES.indexOf(value.theme) >= 0 ? value.theme : DEFAULT_THEME,
    };
  }

  // Mirrors isPartEntry in Utils/Books/Epub.ts: a part has whole chapters under it.
  function isPartEntry(entry) {
    return Boolean(
      entry &&
        Array.isArray(entry.children) &&
        entry.children.some(function (child) {
          return child && !child.anchorId;
        }),
    );
  }

  function stripNumberPrefix(label, number) {
    if (!number || typeof label !== "string") {
      return label;
    }
    var pattern = new RegExp(
      "^0*" + Number(number) + "\\s*[\\u00b7.:\\u2013\\u2014-]\\s*",
    );
    return label.replace(pattern, "");
  }

  function pageLabel(view, mode, total) {
    if (total <= 0) {
      return "";
    }
    if (mode === "spread") {
      var left = view * 2 - 1;
      var right = view * 2;
      var first = left >= 0 ? left : right;
      var last = right < total ? right : left;
      if (first < 0 || first >= total) {
        return "Page " + total + " of " + total;
      }
      if (last > first) {
        return "Pages " + (first + 1) + "\u2013" + (last + 1) + " of " + total;
      }
      return "Page " + (first + 1) + " of " + total;
    }
    return "Page " + (view + 1) + " of " + total;
  }

  /*
   * Page-fold geometry.
   *
   * Coordinates have their origin at the top of the spine, x to the right and
   * y down; the page being turned lies at x in [0, w] (side 1) or [-w, 0]
   * (side -1). Dragging the page's outer corner C to a point P folds it along
   * the perpendicular bisector of CP: the part of the page beyond that line
   * flips over and shows its back. The result describes the four regions the
   * reader draws: the front still lying flat, the folded flap, the page
   * revealed underneath, and the transform that maps the back page (drawn at
   * its resting place on the other side of the spine) onto the flap.
   */
  function reflectAcross(point, origin, normal) {
    var distance =
      (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;
    return {
      x: point.x - 2 * distance * normal.x,
      y: point.y - 2 * distance * normal.y,
    };
  }

  // Keeps the part of a convex polygon where (p - origin) . normal * sign <= 0.
  function clipPolygon(polygon, origin, normal, sign) {
    var result = [];
    var count = polygon.length;
    function side(point) {
      return (
        ((point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y) *
        sign
      );
    }
    for (var index = 0; index < count; index++) {
      var current = polygon[index];
      var next = polygon[(index + 1) % count];
      var currentSide = side(current);
      var nextSide = side(next);
      if (currentSide <= 0) {
        result.push(current);
      }
      if (
        (currentSide < 0 && nextSide > 0) ||
        (currentSide > 0 && nextSide < 0)
      ) {
        var t = currentSide / (currentSide - nextSide);
        result.push({
          x: current.x + (next.x - current.x) * t,
          y: current.y + (next.y - current.y) * t,
        });
      }
    }
    return result;
  }

  function constrainFoldPoint(point, width, height, cornerY) {
    var result = { x: point.x, y: point.y };
    var near = { x: 0, y: cornerY };
    var far = { x: 0, y: height - cornerY };
    var diagonal = Math.sqrt(width * width + height * height);

    // The page cannot tear away from the spine: the corner stays within reach.
    for (var pass = 0; pass < 2; pass++) {
      var dx = result.x - near.x;
      var dy = result.y - near.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > width) {
        result = {
          x: near.x + (dx * width) / distance,
          y: near.y + (dy * width) / distance,
        };
      }
      dx = result.x - far.x;
      dy = result.y - far.y;
      distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > diagonal) {
        result = {
          x: far.x + (dx * diagonal) / distance,
          y: far.y + (dy * diagonal) / distance,
        };
      }
    }
    return result;
  }

  function foldGeometry(options) {
    var width = options.width;
    var height = options.height;
    var side = options.side === -1 ? -1 : 1;
    var cornerY = options.corner === "top" ? 0 : height;
    var corner = { x: side * width, y: cornerY };
    var page =
      side === 1
        ? [
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: width, y: height },
            { x: 0, y: height },
          ]
        : [
            { x: -width, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: height },
            { x: -width, y: height },
          ];
    var point = constrainFoldPoint(options.point, width, height, cornerY);
    var dx = corner.x - point.x;
    var dy = corner.y - point.y;
    var length = Math.sqrt(dx * dx + dy * dy);
    var progress = clamp((side * (corner.x - point.x)) / (2 * width), 0, 1);

    if (length < 0.5) {
      return {
        point: point,
        progress: 0,
        folded: false,
        front: page,
        flap: [],
        reveal: [],
        matrix: [1, 0, 0, 1, 0, 0],
        foldOrigin: corner,
        foldAngle: side === 1 ? 0 : 180,
      };
    }

    var normal = { x: dx / length, y: dy / length };
    var origin = { x: (corner.x + point.x) / 2, y: (corner.y + point.y) / 2 };
    var front = clipPolygon(page, origin, normal, 1);
    var reveal = clipPolygon(page, origin, normal, -1);
    var flap = reveal.map(function (vertex) {
      return reflectAcross(vertex, origin, normal);
    });
    var along = 2 * (origin.x * normal.x + origin.y * normal.y);

    return {
      point: point,
      progress: progress,
      folded: true,
      front: front,
      flap: flap,
      reveal: reveal,
      // CSS matrix(a, b, c, d, e, f): reflection across the fold after the spine.
      matrix: [
        2 * normal.x * normal.x - 1,
        2 * normal.x * normal.y,
        -2 * normal.x * normal.y,
        1 - 2 * normal.y * normal.y,
        along * normal.x,
        along * normal.y,
      ],
      foldOrigin: origin,
      // Direction of the normal, pointing from the fold towards the corner.
      foldAngle: (Math.atan2(normal.y, normal.x) * 180) / Math.PI,
    };
  }

  function easeInOutCubic(t) {
    t = clamp(t, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // The corner's path during an automatic turn: across, with a gentle lift.
  function turnPath(t, from, to, height) {
    var eased = easeInOutCubic(t);
    var lift = Math.sin(Math.PI * clamp(t, 0, 1)) * height * 0.1;
    var towardsTop = from.y <= 0 ? 1 : -1;
    return {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased + towardsTop * lift,
    };
  }

  function shouldCompleteTurn(options) {
    var forward = options.direction === "forward";
    var velocity = Number(options.velocityX) || 0;
    if (forward) {
      return options.point.x < 0 || velocity < -0.45;
    }
    return options.point.x > 0 || velocity > 0.45;
  }

  return {
    FONT_STEPS: FONT_STEPS,
    DEFAULT_FONT_STEP: DEFAULT_FONT_STEP,
    THEMES: THEMES,
    DEFAULT_THEME: DEFAULT_THEME,
    clamp: clamp,
    isSectionId: isSectionId,
    computeLayout: computeLayout,
    layoutKey: layoutKey,
    createPageMap: createPageMap,
    locatePage: locatePage,
    pageOf: pageOf,
    viewCount: viewCount,
    viewForPage: viewForPage,
    viewPages: viewPages,
    primaryPage: primaryPage,
    readingPage: readingPage,
    positionForPage: positionForPage,
    pageForPosition: pageForPosition,
    parseReaderHash: parseReaderHash,
    readerHash: readerHash,
    parseStoredPosition: parseStoredPosition,
    parseStoredSettings: parseStoredSettings,
    isPartEntry: isPartEntry,
    stripNumberPrefix: stripNumberPrefix,
    pageLabel: pageLabel,
    clipPolygon: clipPolygon,
    constrainFoldPoint: constrainFoldPoint,
    foldGeometry: foldGeometry,
    easeInOutCubic: easeInOutCubic,
    turnPath: turnPath,
    shouldCompleteTurn: shouldCompleteTurn,
  };
});
