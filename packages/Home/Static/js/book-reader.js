/*
 * The in-page book reader on /books.
 *
 * Loads a book's text from the site (see Utils/Books in the Home package),
 * lays it out into book pages with CSS columns, and shows it as an open book:
 * a two-page spread on wide screens and a single page on phones. Pages turn
 * with a real paper fold that follows the pointer or finger, the cover opens
 * and closes, and the reader keeps its place between visits.
 *
 * The pure logic (layout, pagination maps, fold geometry) lives in
 * book-reader-core.js; this file owns the DOM. Everything is progressive
 * enhancement: without JavaScript, every "read" link on the page still goes to
 * the book's own website.
 */
(function (window, document) {
  "use strict";

  var Core = window.OneUptimeBookReaderCore;

  if (!Core || !document) {
    return;
  }

  var SETTINGS_KEY = "oneuptime:books:reader-settings";
  var TURN_DURATION = 720;
  var SINGLE_TURN_DURATION = 580;
  var COVER_DURATION = 1000;
  var FONT_TIMEOUT = 2500;

  // Mirrors the server allow-list in Utils/Books/BookHtml.ts, as a second line of defence.
  var ALLOWED_TAGS = {
    A: 1,
    ABBR: 1,
    ARTICLE: 1,
    ASIDE: 1,
    B: 1,
    BLOCKQUOTE: 1,
    BR: 1,
    CAPTION: 1,
    CITE: 1,
    CODE: 1,
    DD: 1,
    DEL: 1,
    DFN: 1,
    DIV: 1,
    DL: 1,
    DT: 1,
    EM: 1,
    FIGCAPTION: 1,
    FIGURE: 1,
    FOOTER: 1,
    H1: 1,
    H2: 1,
    H3: 1,
    H4: 1,
    H5: 1,
    H6: 1,
    HEADER: 1,
    HR: 1,
    I: 1,
    INS: 1,
    KBD: 1,
    LI: 1,
    MARK: 1,
    OL: 1,
    P: 1,
    PRE: 1,
    Q: 1,
    S: 1,
    SAMP: 1,
    SECTION: 1,
    SMALL: 1,
    SPAN: 1,
    STRONG: 1,
    SUB: 1,
    SUP: 1,
    TABLE: 1,
    TBODY: 1,
    TD: 1,
    TFOOT: 1,
    TH: 1,
    THEAD: 1,
    TR: 1,
    U: 1,
    UL: 1,
    VAR: 1,
  };
  var ALLOWED_ATTRIBUTES = {
    class: 1,
    id: 1,
    href: 1,
    rel: 1,
    target: 1,
    lang: 1,
    title: 1,
    colspan: 1,
    rowspan: 1,
    scope: 1,
    start: 1,
    reversed: 1,
    value: 1,
    "data-book-section": 1,
    "data-book-anchor": 1,
  };
  var SAFE_HREF = /^(#read(\/[a-z0-9][a-z0-9-]{0,63})?|https?:\/\/|mailto:)/i;

  function noop() {}

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Private browsing or blocked storage: the reader still works, it just forgets.
    }
  }

  function prefersReducedMotion() {
    try {
      return Boolean(
        window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    } catch (error) {
      return false;
    }
  }

  function createElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text != null) {
      element.textContent = text;
    }
    return element;
  }

  function nextFrame(callback) {
    return (
      window.requestAnimationFrame ||
      function (fn) {
        return window.setTimeout(function () {
          fn(Date.now());
        }, 16);
      }
    )(callback);
  }

  function cancelFrame(handle) {
    (window.cancelAnimationFrame || window.clearTimeout)(handle);
  }

  function now() {
    return window.performance && window.performance.now
      ? window.performance.now()
      : Date.now();
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  /*
   * Resolves when `element` finishes transitioning `property`. A browser under
   * load can start a transition late, so a fixed timer would declare it done
   * while it is still moving; the timeout only covers a transition that never
   * runs at all (for example because the element was not rendered yet).
   */
  function transitionDone(element, property, timeout) {
    return new Promise(function (resolve) {
      var timer = 0;
      function finish() {
        element.removeEventListener("transitionend", onEnd);
        element.removeEventListener("transitioncancel", onEnd);
        window.clearTimeout(timer);
        resolve();
      }
      function onEnd(event) {
        if (event.target === element && event.propertyName === property) {
          finish();
        }
      }
      element.addEventListener("transitionend", onEnd);
      element.addEventListener("transitioncancel", onEnd);
      timer = window.setTimeout(finish, timeout);
    });
  }

  // Pages are drawn copies (aria-hidden); their links stay clickable but not tabbable.
  function removeFromTabOrder(container) {
    Array.prototype.forEach.call(
      container.querySelectorAll("a[href]"),
      function (link) {
        link.setAttribute("tabindex", "-1");
      },
    );
  }

  function polygonCss(points, offsetX) {
    if (!points || points.length < 3) {
      return "polygon(0 0, 0 0, 0 0)";
    }
    return (
      "polygon(" +
      points
        .map(function (point) {
          return (
            Math.round((point.x + offsetX) * 100) / 100 +
            "px " +
            Math.round(point.y * 100) / 100 +
            "px"
          );
        })
        .join(", ") +
      ")"
    );
  }

  /*
   * Parses trusted-but-verified book HTML in an inert <template>, removing
   * anything outside the allow-list before it can reach the live document.
   */
  function sanitizeFragment(html) {
    var template = document.createElement("template");
    template.innerHTML = html;
    var walker = [template.content];

    while (walker.length) {
      var node = walker.pop();
      var children = Array.prototype.slice.call(node.childNodes || []);

      for (var index = 0; index < children.length; index++) {
        var child = children[index];

        if (child.nodeType === 3) {
          continue;
        }

        if (child.nodeType !== 1 || !ALLOWED_TAGS[child.nodeName]) {
          child.parentNode.removeChild(child);
          continue;
        }

        var attributes = Array.prototype.slice.call(child.attributes);

        for (var a = 0; a < attributes.length; a++) {
          var name = attributes[a].name.toLowerCase();
          if (
            !ALLOWED_ATTRIBUTES[name] ||
            (name === "href" && !SAFE_HREF.test(attributes[a].value.trim()))
          ) {
            child.removeAttribute(attributes[a].name);
          }
        }

        if (child.nodeName === "A" && child.getAttribute("target")) {
          child.setAttribute("rel", "noopener noreferrer");
        }

        walker.push(child);
      }
    }

    return template.content;
  }

  function BookReader(root, options) {
    options = options || {};

    var self = this;
    var contentUrl = root.getAttribute("data-content-url");
    var slug = root.getAttribute("data-book-slug") || "book";
    var positionKey = "oneuptime:books:" + slug + ":position";
    var coverUrl = root.getAttribute("data-cover-url") || "";
    var bookTitle = root.getAttribute("data-book-title") || "";
    var bookAuthor = root.getAttribute("data-book-author") || "";
    var siteUrl = root.getAttribute("data-site-url") || "";

    var $ = function (selector) {
      return root.querySelector(selector);
    };

    var ui = {
      panel: $(".bk-reader-panel"),
      stage: $(".bk-reader-stage"),
      wrap: $(".bk-book-wrap"),
      book: $(".bk-book"),
      location: $(".bk-reader-location"),
      pages: $(".bk-reader-pages"),
      progress: $(".bk-reader-progress-bar"),
      scrubber: $(".bk-reader-scrubber"),
      prev: $('[data-reader-action="prev"]'),
      next: $('[data-reader-action="next"]'),
      close: $('[data-reader-action="close"]'),
      contentsButton: $('[data-reader-action="contents"]'),
      settingsButton: $('[data-reader-action="settings"]'),
      fullscreenButton: $('[data-reader-action="fullscreen"]'),
      drawer: $(".bk-drawer"),
      drawerList: $(".bk-drawer-list"),
      settings: $(".bk-settings"),
      fontSmaller: $('[data-reader-action="font-smaller"]'),
      fontLarger: $('[data-reader-action="font-larger"]'),
      status: $(".bk-reader-status"),
      message: $(".bk-reader-message"),
      live: $(".bk-reader-live"),
      srText: $(".bk-reader-text"),
      measure: $(".bk-measure"),
    };

    var state = {
      open: false,
      book: null,
      loading: null,
      sections: [],
      sectionIds: [],
      layout: null,
      map: null,
      view: -1,
      turn: null,
      pointer: null,
      pushedHistory: false,
      lastFocus: null,
      srSection: -1,
      settings: Core.parseStoredSettings(storageGet(SETTINGS_KEY)),
      fontsReady: false,
      wheel: { amount: 0, timer: 0 },
      resizeTimer: 0,
    };

    var reducedMotion =
      options.reducedMotion != null
        ? function () {
            return Boolean(options.reducedMotion);
          }
        : prefersReducedMotion;

    var getViewport =
      options.viewport ||
      function () {
        return { width: window.innerWidth, height: window.innerHeight };
      };

    // ---------------------------------------------------------------- loading

    function load() {
      if (state.book) {
        return Promise.resolve(state.book);
      }
      if (state.loading) {
        return state.loading;
      }
      if (!contentUrl || typeof window.fetch !== "function") {
        return Promise.reject(new Error("This browser cannot load the book."));
      }

      state.loading = window
        .fetch(contentUrl, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        })
        .then(function (response) {
          if (!response.ok) {
            throw new Error(
              "The book could not be loaded (" + response.status + ").",
            );
          }
          return response.json();
        })
        .then(function (payload) {
          if (
            !payload ||
            !Array.isArray(payload.sections) ||
            payload.sections.length === 0
          ) {
            throw new Error("The book arrived empty.");
          }
          state.book = payload;
          state.loading = null;
          return payload;
        })
        .catch(function (error) {
          state.loading = null;
          throw error;
        });

      return state.loading;
    }

    function waitForFonts() {
      if (state.fontsReady || !document.fonts || !document.fonts.load) {
        state.fontsReady = true;
        return Promise.resolve();
      }
      var loads = Promise.all([
        document.fonts.load("400 16px Literata"),
        document.fonts.load("italic 400 16px Literata"),
        document.fonts.load("600 16px Geist"),
      ]).catch(noop);
      return Promise.race([loads, wait(FONT_TIMEOUT)]).then(function () {
        state.fontsReady = true;
      });
    }

    // ------------------------------------------------------------- sections

    function buildContentsTemplate(book) {
      var wrapper = createElement("div", "bk-section bk-section--contents");
      wrapper.appendChild(createElement("h1", "bk-section-title", "Contents"));
      var list = createElement("ol", "bk-contents");
      var firstSection = state.sectionIds[0];

      (book.toc || []).forEach(function (entry) {
        if (
          !entry ||
          !Core.isSectionId(entry.sectionId) ||
          entry.sectionId === firstSection ||
          entry.sectionId === "contents"
        ) {
          return;
        }
        var item = createElement("li", "bk-contents-item");

        if (Core.isPartEntry(entry)) {
          item.className = "bk-contents-part";
          item.appendChild(
            createElement("p", "bk-contents-part-label", entry.label),
          );
          var nested = createElement("ol", "bk-contents");
          entry.children.forEach(function (child) {
            nested.appendChild(contentsEntry(child));
          });
          item.appendChild(nested);
        } else {
          item = contentsEntry(entry);
        }
        list.appendChild(item);
      });

      wrapper.appendChild(list);
      return wrapper;
    }

    function contentsEntry(entry) {
      var item = createElement("li", "bk-contents-item");
      var link = createElement("a", "bk-contents-link");
      link.setAttribute("href", Core.readerHash(entry.sectionId));
      link.setAttribute("data-book-section", entry.sectionId);
      if (entry.anchorId) {
        link.setAttribute("data-book-anchor", entry.anchorId);
      }
      link.appendChild(createElement("span", "bk-contents-label", entry.label));
      link.appendChild(createElement("span", "bk-contents-leader"));
      var number = createElement("span", "bk-contents-page", "");
      number.setAttribute(
        "data-page-for",
        entry.sectionId + (entry.anchorId ? "#" + entry.anchorId : ""),
      );
      link.appendChild(number);
      item.appendChild(link);
      return item;
    }

    function buildSectionTemplate(section, index) {
      var wrapper = createElement(
        "div",
        "bk-section bk-section--" +
          (section.kind === "contents" ? "contents" : "text"),
      );

      if (index === 0) {
        wrapper.classList.add("bk-section--title");
      }

      if (section.number || section.part) {
        var opener = createElement("div", "bk-opener");
        opener.setAttribute("aria-hidden", "true");
        if (section.part) {
          opener.appendChild(
            createElement("span", "bk-opener-part", section.part),
          );
        }
        if (section.number) {
          opener.appendChild(
            createElement("span", "bk-opener-number", section.number),
          );
        }
        wrapper.appendChild(opener);
      }

      wrapper.appendChild(sanitizeFragment(String(section.html || "")));

      var title = wrapper.querySelector("h1");
      if (title) {
        title.classList.add("bk-section-title");
        if (section.number) {
          title.textContent = Core.stripNumberPrefix(
            title.textContent,
            section.number,
          );
        }
      }

      // Ids move to data attributes: every page is a copy, and ids must be unique.
      Array.prototype.forEach.call(
        wrapper.querySelectorAll("[id]"),
        function (node) {
          node.setAttribute("data-bk-id", node.id);
          node.removeAttribute("id");
        },
      );

      return wrapper;
    }

    function prepareSections(book) {
      state.sectionIds = [];
      state.sections = book.sections
        .filter(function (section) {
          return section && Core.isSectionId(section.id);
        })
        .map(function (section) {
          state.sectionIds.push(section.id);
          return {
            id: section.id,
            kind: section.kind === "contents" ? "contents" : "text",
            title: String(section.title || ""),
            label: String(section.label || section.title || ""),
            number: section.number ? String(section.number) : "",
            part: section.part ? String(section.part) : "",
            template: null,
            anchors: {},
          };
        });

      state.sections.forEach(function (section, index) {
        var source = book.sections[index];
        section.template =
          section.kind === "contents"
            ? buildContentsTemplate(book)
            : buildSectionTemplate(source, index);
        var end = createElement("div", "bk-flow-end");
        end.setAttribute("aria-hidden", "true");
        section.template.appendChild(end);
      });

      buildDrawer(book);
    }

    // ---------------------------------------------------------------- layout

    function applyLayoutVariables(target, layout) {
      var style = target.style;
      style.setProperty("--bk-page-w", layout.pageWidth + "px");
      style.setProperty("--bk-page-h", layout.pageHeight + "px");
      style.setProperty("--bk-content-w", layout.contentWidth + "px");
      style.setProperty("--bk-content-h", layout.contentHeight + "px");
      style.setProperty("--bk-gap", layout.columnGap + "px");
      style.setProperty("--bk-pad-top", layout.padding.top + "px");
      style.setProperty("--bk-pad-bottom", layout.padding.bottom + "px");
      style.setProperty("--bk-pad-inner", layout.padding.inner + "px");
      style.setProperty("--bk-pad-outer", layout.padding.outer + "px");
      style.setProperty("--bk-font", layout.fontSize + "px");
      style.setProperty("--bk-line", layout.lineHeight + "px");
    }

    function measureSections(layout) {
      var stride = layout.contentWidth + layout.columnGap;
      var body = createElement("div", "bk-page-body");
      var flow = createElement("div", "bk-flow");

      if (options.measureSection) {
        return state.sections.map(function (section, index) {
          var result = options.measureSection(section, layout, index);
          if (result && typeof result === "object") {
            section.anchors = result.anchors || {};
            return result.pages;
          }
          section.anchors = {};
          return result;
        });
      }

      applyLayoutVariables(ui.measure, layout);
      ui.measure.textContent = "";
      body.appendChild(flow);
      ui.measure.appendChild(body);

      return state.sections.map(function (section) {
        flow.textContent = "";
        flow.appendChild(section.template.cloneNode(true));
        var origin = flow.getBoundingClientRect().left;
        var end = flow.querySelector(".bk-flow-end");
        var endLeft = end ? end.getBoundingClientRect().left - origin : 0;
        var anchors = {};

        Array.prototype.forEach.call(
          flow.querySelectorAll("[data-bk-id]"),
          function (node) {
            anchors[node.getAttribute("data-bk-id")] = Math.max(
              0,
              Math.floor(
                (node.getBoundingClientRect().left - origin + 2) / stride,
              ),
            );
          },
        );
        section.anchors = anchors;

        return Math.max(1, Math.floor((endLeft + 2) / stride) + 1);
      });
    }

    function paginate() {
      var layout = Core.computeLayout(getViewport(), {
        fontStep: state.settings.fontStep,
        chromeTop: options.chromeTop,
        chromeBottom: options.chromeBottom,
      });
      state.layout = layout;
      applyLayoutVariables(root, layout);
      ui.book.setAttribute("data-mode", layout.mode);
      state.map = Core.createPageMap(measureSections(layout));
      fillContentsPageNumbers();
    }

    function fillContentsPageNumbers() {
      var contents = state.sections.filter(function (section) {
        return section.kind === "contents";
      })[0];
      var numbers = {};

      state.sections.forEach(function (section, index) {
        numbers[section.id] = state.map.starts[index] + 1;
        Object.keys(section.anchors).forEach(function (anchor) {
          numbers[section.id + "#" + anchor] =
            state.map.starts[index] + section.anchors[anchor] + 1;
        });
      });

      var templates = [];
      if (contents) {
        templates.push(contents.template);
      }
      templates.push(ui.drawerList);

      templates.forEach(function (template) {
        Array.prototype.forEach.call(
          template.querySelectorAll("[data-page-for]"),
          function (node) {
            var key = node.getAttribute("data-page-for");
            node.textContent = numbers[key] ? String(numbers[key]) : "";
          },
        );
      });
    }

    function currentPage() {
      if (!state.map) {
        return 0;
      }
      // A chapter the reader jumped to names the view while it is on screen.
      if (
        state.focusPage != null &&
        Core.viewForPage(state.focusPage, state.layout.mode) === state.view
      ) {
        return state.focusPage;
      }
      return Core.readingPage(
        state.map,
        Math.max(0, state.view),
        state.layout.mode,
      );
    }

    function currentPosition() {
      if (!state.map) {
        return null;
      }
      return Core.positionForPage(state.map, state.sectionIds, currentPage());
    }

    function viewTotal() {
      return state.map ? Core.viewCount(state.map.total, state.layout.mode) : 0;
    }

    function relayout() {
      if (!state.open || !state.book) {
        return;
      }
      snapTurn();
      var position = currentPosition();
      var wasClosed = state.view < 0;
      state.focusPage = null;
      paginate();
      if (!wasClosed) {
        var page = Core.pageForPosition(state.map, state.sectionIds, position);
        state.view = Core.viewForPage(page, state.layout.mode);
      }
      render();
    }

    // ------------------------------------------------------------- rendering

    function endpaper(kind) {
      var content = createElement("div", "bk-endpaper-content");

      if (kind === "front") {
        var plate = createElement("div", "bk-bookplate");
        plate.appendChild(
          createElement("span", "bk-bookplate-label", "Ex libris"),
        );
        plate.appendChild(
          createElement("span", "bk-bookplate-title", "The OneUptime Library"),
        );
        plate.appendChild(
          createElement(
            "span",
            "bk-bookplate-note",
            bookTitle + " \u00b7 " + bookAuthor,
          ),
        );
        content.appendChild(plate);
        content.appendChild(
          createElement("p", "bk-endpaper-hint", "Turn the page to begin"),
        );
      } else {
        content.appendChild(
          createElement("p", "bk-endpaper-title", "The end."),
        );
        content.appendChild(
          createElement(
            "p",
            "bk-endpaper-note",
            "Thank you for reading " +
              bookTitle +
              ". Keep a copy, share it, adapt it.",
          ),
        );
        var links = createElement("p", "bk-endpaper-links");
        var contentsLink = createElement("a", "", "Back to the contents");
        contentsLink.setAttribute("href", Core.readerHash("contents"));
        contentsLink.setAttribute(
          "data-book-section",
          state.sectionIds.indexOf("contents") >= 0
            ? "contents"
            : state.sectionIds[0],
        );
        links.appendChild(contentsLink);
        if (siteUrl) {
          var online = createElement(
            "a",
            "",
            "Read it on the book\u2019s website",
          );
          online.setAttribute("href", siteUrl);
          online.setAttribute("target", "_blank");
          online.setAttribute("rel", "noopener noreferrer");
          links.appendChild(online);
        }
        content.appendChild(links);
      }

      return content;
    }

    function renderPage(index, side) {
      var page = createElement("div", "bk-page bk-page--" + side);
      var total = state.map.total;

      if (index < 0 || index >= total) {
        page.classList.add("bk-page--endpaper");
        page.appendChild(endpaper(index < 0 ? "front" : "back"));
        removeFromTabOrder(page);
        return page;
      }

      var located = Core.locatePage(state.map, index);
      var section = state.sections[located.section];
      var stride = state.layout.contentWidth + state.layout.columnGap;

      page.setAttribute("data-page", String(index + 1));
      page.setAttribute("data-section", section.id);

      if (located.offset === 0) {
        page.classList.add("bk-page--opener");
      }
      if (located.section === 0) {
        page.classList.add("bk-page--title");
      }

      var head = createElement("div", "bk-page-head");
      head.textContent =
        side === "left"
          ? bookTitle
          : section.part
            ? section.part
            : section.title;
      page.appendChild(head);

      var body = createElement("div", "bk-page-body");
      var flow = createElement("div", "bk-flow");
      flow.appendChild(section.template.cloneNode(true));
      flow.style.transform =
        "translate3d(" + -located.offset * stride + "px, 0, 0)";
      body.appendChild(flow);
      page.appendChild(body);

      var foot = createElement("div", "bk-page-foot");
      foot.appendChild(createElement("span", "bk-folio", String(index + 1)));
      page.appendChild(foot);
      removeFromTabOrder(page);

      return page;
    }

    function blankBack() {
      var page = createElement("div", "bk-page bk-page--back");
      return page;
    }

    function ensureBookStructure() {
      if (ui.book.getAttribute("data-built") === "true") {
        return;
      }
      ui.book.textContent = "";
      ui.book.setAttribute("aria-hidden", "true");

      ui.edgeLeft = createElement("div", "bk-edge bk-edge--left");
      ui.edgeRight = createElement("div", "bk-edge bk-edge--right");
      ui.slotLeft = createElement("div", "bk-slot bk-slot--left");
      ui.slotRight = createElement("div", "bk-slot bk-slot--right");
      ui.gutter = createElement("div", "bk-gutter");
      ui.cover = createElement("div", "bk-cover");

      var front = createElement("div", "bk-cover-face bk-cover-front");
      if (coverUrl) {
        var image = createElement("img", "bk-cover-image");
        image.setAttribute("src", coverUrl);
        image.setAttribute("alt", "");
        image.setAttribute("draggable", "false");
        front.appendChild(image);
      }
      front.appendChild(createElement("span", "bk-cover-sheen"));
      var back = createElement("div", "bk-cover-face bk-cover-back");
      back.appendChild(
        createElement("div", "bk-page bk-page--endpaper bk-page--left"),
      );
      back.firstChild.appendChild(endpaper("front"));
      ui.cover.appendChild(front);
      ui.cover.appendChild(back);

      [
        ui.edgeLeft,
        ui.edgeRight,
        ui.slotLeft,
        ui.slotRight,
        ui.gutter,
        ui.cover,
      ].forEach(function (node) {
        ui.book.appendChild(node);
      });
      ui.book.setAttribute("data-built", "true");
    }

    function render() {
      ensureBookStructure();
      var layout = state.layout;
      var closed = state.view < 0;
      ui.book.setAttribute("data-mode", layout.mode);
      ui.book.setAttribute("data-state", closed ? "closed" : "open");
      ui.slotLeft.textContent = "";
      ui.slotRight.textContent = "";

      if (!closed) {
        if (layout.mode === "spread") {
          var pages = Core.viewPages(state.view, "spread");
          ui.slotLeft.appendChild(renderPage(pages[0], "left"));
          ui.slotRight.appendChild(renderPage(pages[1], "right"));
        } else {
          ui.slotRight.appendChild(renderPage(state.view, "single"));
        }
      }

      updateEdges();
      updateChrome();
    }

    function updateEdges() {
      var total = viewTotal();
      var progress = total > 1 && state.view > 0 ? state.view / (total - 1) : 0;
      var closed = state.view < 0;
      ui.book.style.setProperty("--bk-read", String(closed ? 0 : progress));
      ui.book.style.setProperty(
        "--bk-unread",
        String(closed ? 1 : 1 - progress),
      );
    }

    function sectionAt(page) {
      var located = Core.locatePage(state.map, page);
      return located ? state.sections[located.section] : null;
    }

    function describeSection(section) {
      if (!section) {
        return "";
      }
      if (section.part && section.number) {
        return (
          section.part +
          " \u2014 " +
          section.number +
          " \u00b7 " +
          section.title
        );
      }
      return section.label || section.title;
    }

    function updateChrome() {
      var total = viewTotal();
      var closed = state.view < 0;
      var page = currentPage();
      var section = closed ? null : sectionAt(page);
      var label = closed
        ? "Closed \u00b7 " + state.map.total + " pages"
        : Core.pageLabel(state.view, state.layout.mode, state.map.total);

      ui.location.textContent = closed ? bookAuthor : describeSection(section);
      ui.pages.textContent = label;
      ui.scrubber.max = String(Math.max(0, total - 1));
      ui.scrubber.value = String(Math.max(0, state.view));
      ui.scrubber.setAttribute(
        "aria-valuetext",
        label + (section ? ", " + describeSection(section) : ""),
      );
      ui.progress.style.transform =
        "scaleX(" +
        (total > 1 ? Math.max(0, state.view) / (total - 1) : 0) +
        ")";
      ui.prev.disabled = closed;
      ui.next.disabled = !closed && state.view >= total - 1;

      Array.prototype.forEach.call(
        ui.drawerList.querySelectorAll("[data-book-section]"),
        function (link) {
          if (
            section &&
            link.getAttribute("data-book-section") === section.id &&
            !link.getAttribute("data-book-anchor")
          ) {
            link.setAttribute("aria-current", "true");
          } else {
            link.removeAttribute("aria-current");
          }
        },
      );

      if (!closed) {
        announce(label + ". " + describeSection(section));
        updateScreenReaderText(page);
        persistPosition(section);
        syncHash(section);
      } else {
        announce(bookTitle + " is closed.");
      }
    }

    function announce(message) {
      if (ui.live) {
        ui.live.textContent = message;
      }
    }

    function updateScreenReaderText(page) {
      var located = Core.locatePage(state.map, page);
      if (!located || located.section === state.srSection) {
        return;
      }
      state.srSection = located.section;
      ui.srText.textContent = "";
      ui.srText.appendChild(
        state.sections[located.section].template.cloneNode(true),
      );
      removeFromTabOrder(ui.srText);
    }

    function persistPosition(section) {
      var position = currentPosition();
      if (!position || !section) {
        return;
      }
      var total = viewTotal();
      storageSet(
        positionKey,
        JSON.stringify({
          sectionId: position.sectionId,
          fraction: Math.round(position.fraction * 10000) / 10000,
          label: section.number
            ? "Move " + section.number + " \u00b7 " + section.title
            : section.title,
          progress:
            total > 1
              ? Math.round((state.view / (total - 1)) * 1000) / 1000
              : 0,
          updatedAt: Date.now(),
        }),
      );
    }

    function syncHash(section) {
      if (
        !state.open ||
        !section ||
        !window.history ||
        !window.history.replaceState
      ) {
        return;
      }
      var hash = Core.readerHash(section.id);
      if (window.location.hash !== hash) {
        try {
          window.history.replaceState(window.history.state, "", hash);
        } catch (error) {
          // A sandboxed frame may refuse; the reader does not depend on the URL.
        }
      }
    }

    // ------------------------------------------------------------ page turns

    function canGo(direction) {
      if (!state.map || (state.turn && state.turn.mode === "auto")) {
        return false;
      }
      if (direction === "forward") {
        return state.view < viewTotal() - 1;
      }
      return state.view >= 0;
    }

    function buildTurnLayers() {
      var w = state.layout.pageWidth;
      var layers = {
        root: createElement("div", "bk-turn"),
        reveal: createElement("div", "bk-turn-reveal"),
        revealShade: createElement("div", "bk-turn-shade bk-turn-shade--cast"),
        front: createElement("div", "bk-turn-front"),
        frontShade: createElement("div", "bk-turn-shade bk-turn-shade--front"),
        flapShadow: createElement("div", "bk-turn-flap-shadow"),
        flapShadowShape: createElement("div", "bk-turn-flap-shadow-shape"),
        flap: createElement("div", "bk-turn-flap"),
        flapInner: createElement("div", "bk-turn-flap-inner"),
        flapShade: createElement("div", "bk-turn-shade bk-turn-shade--flap"),
      };
      layers.root.style.left = (state.layout.mode === "spread" ? 0 : -w) + "px";
      layers.reveal.appendChild(layers.revealShade);
      layers.front.appendChild(layers.frontShade);
      layers.flapShadow.appendChild(layers.flapShadowShape);
      layers.flap.appendChild(layers.flapInner);
      layers.flap.appendChild(layers.flapShade);
      layers.root.appendChild(layers.reveal);
      layers.root.appendChild(layers.front);
      layers.root.appendChild(layers.flapShadow);
      layers.root.appendChild(layers.flap);
      return layers;
    }

    function beginTurn(direction, targetView, mode, corner) {
      var layout = state.layout;
      var from = state.view;
      var lower = Math.min(from, targetView);
      var upper = Math.max(from, targetView);
      var w = layout.pageWidth;
      var h = layout.pageHeight;
      var layers = buildTurnLayers();
      var frontPage;
      var backPage;

      ui.slotLeft.textContent = "";
      ui.slotRight.textContent = "";

      if (layout.mode === "spread") {
        var lowerPages = Core.viewPages(lower, "spread");
        var upperPages = Core.viewPages(upper, "spread");
        ui.slotLeft.appendChild(renderPage(lowerPages[0], "left"));
        ui.slotRight.appendChild(renderPage(upperPages[1], "right"));
        frontPage = renderPage(lowerPages[1], "right");
        backPage = renderPage(upperPages[0], "left");
      } else {
        ui.slotRight.appendChild(renderPage(upper, "single"));
        frontPage = renderPage(lower, "single");
        backPage = blankBack();
      }

      frontPage.classList.add("bk-page--turning");
      backPage.classList.add("bk-page--turning");
      frontPage.style.left = w + "px";
      backPage.style.left = -w + "px";
      layers.front.appendChild(frontPage);
      layers.flapInner.appendChild(backPage);
      layers.front.insertBefore(frontPage, layers.frontShade);
      layers.flapInner.style.left = w + "px";
      ui.book.appendChild(layers.root);
      ui.book.classList.add("is-turning");

      var cornerY = corner === "top" ? 0 : h;
      var start =
        direction === "forward" ? { x: w, y: cornerY } : { x: -w, y: cornerY };

      state.turn = {
        direction: direction,
        from: from,
        to: targetView,
        mode: mode,
        corner: corner === "top" ? "top" : "bottom",
        layers: layers,
        point: start,
        frame: 0,
      };

      drawTurn(start);
      return state.turn;
    }

    function drawTurn(point) {
      var turn = state.turn;
      if (!turn) {
        return;
      }
      var w = state.layout.pageWidth;
      var h = state.layout.pageHeight;
      var geometry = Core.foldGeometry({
        width: w,
        height: h,
        side: 1,
        corner: turn.corner,
        point: point,
      });
      var layers = turn.layers;
      var lift = Math.sin(Math.PI * geometry.progress);
      var origin = geometry.foldOrigin;
      var place =
        "translate(" + (origin.x + w) + "px, " + origin.y + "px) rotate(";

      turn.point = geometry.point;
      turn.geometry = geometry;

      layers.front.style.clipPath = polygonCss(geometry.front, w);
      layers.reveal.style.clipPath = polygonCss(geometry.reveal, w);
      layers.flap.style.clipPath = polygonCss(geometry.flap, w);
      layers.flapShadowShape.style.clipPath = polygonCss(geometry.flap, w);
      layers.flapInner.style.transform =
        "matrix(" + geometry.matrix.join(",") + ")";
      layers.revealShade.style.transform =
        place + geometry.foldAngle + "deg) translateY(-50%)";
      layers.frontShade.style.transform =
        place + (geometry.foldAngle + 180) + "deg) translateY(-50%)";
      layers.flapShade.style.transform =
        place + (geometry.foldAngle + 180) + "deg) translateY(-50%)";
      layers.root.style.setProperty(
        "--bk-lift",
        String(Math.round(lift * 1000) / 1000),
      );
      layers.root.style.setProperty(
        "--bk-turned",
        String(Math.round(geometry.progress * 1000) / 1000),
      );
    }

    function animatePoint(target, duration, path, done) {
      var turn = state.turn;
      if (!turn) {
        return;
      }
      cancelFrame(turn.frame);
      var from = { x: turn.point.x, y: turn.point.y };
      var started = now();
      var h = state.layout.pageHeight;

      function step() {
        if (state.turn !== turn) {
          return;
        }
        var t = duration > 0 ? Math.min(1, (now() - started) / duration) : 1;
        var point = path
          ? Core.turnPath(t, from, target, h)
          : {
              x: from.x + (target.x - from.x) * Core.easeInOutCubic(t),
              y: from.y + (target.y - from.y) * Core.easeInOutCubic(t),
            };
        drawTurn(point);
        if (t < 1) {
          turn.frame = nextFrame(step);
        } else {
          turn.frame = 0;
          if (done) {
            done();
          }
        }
      }

      turn.frame = nextFrame(step);
    }

    function endTurn(completed) {
      var turn = state.turn;
      if (!turn) {
        return;
      }
      cancelFrame(turn.frame);
      state.turn = null;
      if (turn.layers.root.parentNode) {
        turn.layers.root.parentNode.removeChild(turn.layers.root);
      }
      ui.book.classList.remove("is-turning");
      state.view = completed ? turn.to : turn.from;
      render();
    }

    function snapTurn() {
      if (state.turn) {
        endTurn(state.turn.mode === "auto");
      }
    }

    function turnEnd(turn, completed) {
      var w = state.layout.pageWidth;
      var y = turn.corner === "top" ? 0 : state.layout.pageHeight;
      var forwardEnd = turn.direction === "forward" ? completed : !completed;
      return { x: forwardEnd ? -w : w, y: y };
    }

    function goToView(targetView) {
      if (!state.map) {
        return;
      }
      targetView = Core.clamp(Math.round(targetView), 0, viewTotal() - 1);
      snapTurn();

      if (state.view < 0) {
        openCover().then(function () {
          if (targetView > 0) {
            goToView(targetView);
          }
        });
        return;
      }

      if (targetView === state.view) {
        render();
        return;
      }

      var direction = targetView > state.view ? "forward" : "backward";

      if (reducedMotion()) {
        state.view = targetView;
        render();
        return;
      }

      var turn = beginTurn(direction, targetView, "auto", "bottom");
      var duration =
        state.layout.mode === "spread" ? TURN_DURATION : SINGLE_TURN_DURATION;
      animatePoint(turnEnd(turn, true), duration, true, function () {
        endTurn(true);
      });
    }

    function next() {
      if (state.view < 0) {
        openCover();
        return;
      }
      if (
        state.turn &&
        state.turn.mode === "peek" &&
        state.turn.direction === "forward"
      ) {
        completeTurn(state.turn);
        return;
      }
      // A press during a turn counts from the page that turn is going to.
      if (state.turn && state.turn.mode !== "peek") {
        snapTurn();
      }
      if (state.view < viewTotal() - 1) {
        goToView(state.view + 1);
      }
    }

    function prev() {
      if (
        state.turn &&
        state.turn.mode === "peek" &&
        state.turn.direction === "backward"
      ) {
        completeTurn(state.turn);
        return;
      }
      snapTurn();
      if (state.view === 0) {
        closeCover();
      } else if (state.view > 0) {
        goToView(state.view - 1);
      }
    }

    function completeTurn(turn) {
      turn.mode = "auto";
      var duration =
        state.layout.mode === "spread" ? TURN_DURATION : SINGLE_TURN_DURATION;
      var remaining = Core.clamp(1 - turn.geometry.progress, 0.25, 1);
      if (turn.direction === "backward") {
        remaining = Core.clamp(turn.geometry.progress, 0.25, 1);
      }
      animatePoint(
        turnEnd(turn, true),
        duration * remaining,
        false,
        function () {
          endTurn(true);
        },
      );
    }

    function cancelTurn(turn, duration) {
      turn.mode = "auto";
      animatePoint(turnEnd(turn, false), duration, false, function () {
        endTurn(false);
      });
    }

    function goToSection(sectionId, anchorId) {
      var index = state.sectionIds.indexOf(sectionId);
      if (index < 0 || !state.map) {
        return false;
      }
      var offset =
        anchorId && state.sections[index].anchors[anchorId] != null
          ? state.sections[index].anchors[anchorId]
          : 0;
      var page = Core.pageOf(state.map, index, offset);
      state.focusPage = page;
      goToView(Core.viewForPage(page, state.layout.mode));
      return true;
    }

    // ----------------------------------------------------------------- cover

    function coverTransitionDone() {
      return reducedMotion()
        ? Promise.resolve()
        : transitionDone(ui.cover, "transform", COVER_DURATION + 800);
    }

    function openCover() {
      if (state.view >= 0 || state.coverBusy) {
        return Promise.resolve();
      }
      state.coverBusy = true;
      ui.book.setAttribute("data-cover", "opening");
      state.view = 0;
      render();
      ui.book.setAttribute("data-state", "opening");
      return coverTransitionDone().then(function () {
        state.coverBusy = false;
        ui.book.removeAttribute("data-cover");
        if (state.view >= 0) {
          ui.book.setAttribute("data-state", "open");
        }
      });
    }

    function closeCover() {
      if (state.view < 0 || state.coverBusy) {
        return Promise.resolve();
      }
      snapTurn();
      state.coverBusy = true;
      state.view = 0;
      render();
      ui.book.setAttribute("data-state", "closing");
      return coverTransitionDone().then(function () {
        state.coverBusy = false;
        state.view = -1;
        render();
      });
    }

    // -------------------------------------------------------- pointer input

    function toBookPoint(event) {
      var rect = ui.book.getBoundingClientRect();
      var spine = state.layout.mode === "spread" ? state.layout.pageWidth : 0;
      return {
        x: event.clientX - rect.left - spine,
        y: event.clientY - rect.top,
      };
    }

    // Where a press lands: which way it would turn, if it is on a turnable edge.
    function pressZone(point, pointerType) {
      var w = state.layout.pageWidth;
      var h = state.layout.pageHeight;
      var spread = state.layout.mode === "spread";
      var edge = pointerType === "mouse" ? 0.22 : 1;
      var tapEdge = 0.28;

      if (point.y < 0 || point.y > h) {
        return null;
      }

      var forwardEdge = point.x > w * (1 - edge) && point.x <= w;
      var backwardEdge = spread
        ? point.x < -w * (1 - edge) && point.x >= -w
        : point.x >= 0 && point.x < w * edge;

      return {
        drag: forwardEdge ? "forward" : backwardEdge ? "backward" : null,
        tap:
          point.x > w * (1 - tapEdge) && point.x <= w
            ? "forward"
            : (
                  spread
                    ? point.x < -w * (1 - tapEdge) && point.x >= -w
                    : point.x >= 0 && point.x < w * tapEdge
                )
              ? "backward"
              : null,
        corner: point.y < h / 2 ? "top" : "bottom",
      };
    }

    function onPointerDown(event) {
      if (
        !state.map ||
        state.coverBusy ||
        event.button > 0 ||
        event.isPrimary === false
      ) {
        return;
      }
      if (event.target.closest && event.target.closest("a, button, input")) {
        return;
      }
      if (state.view < 0) {
        openCover();
        return;
      }
      if (state.turn && state.turn.mode === "auto") {
        return;
      }
      var point = toBookPoint(event);
      state.pointer = {
        id: event.pointerId,
        type: event.pointerType || "mouse",
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastTime: now(),
        startTime: now(),
        velocity: 0,
        zone: pressZone(point, event.pointerType || "mouse"),
        dragging: false,
      };
    }

    function onPointerMove(event) {
      var pointer = state.pointer;

      if (!pointer || pointer.id !== event.pointerId) {
        handleHover(event);
        return;
      }

      var dx = event.clientX - pointer.startX;
      var dy = event.clientY - pointer.startY;

      if (!pointer.dragging) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          return;
        }
        var direction = dx < 0 ? "forward" : "backward";
        if (
          !pointer.zone ||
          pointer.zone.drag !== direction ||
          !canGo(direction) ||
          (state.view === 0 && direction === "backward")
        ) {
          state.pointer = null;
          return;
        }
        if (
          state.turn &&
          state.turn.mode === "peek" &&
          state.turn.direction === direction
        ) {
          state.turn.mode = "drag";
          cancelFrame(state.turn.frame);
        } else {
          snapTurn();
          if (reducedMotion()) {
            state.pointer = null;
            goToView(state.view + (direction === "forward" ? 1 : -1));
            return;
          }
          beginTurn(
            direction,
            state.view + (direction === "forward" ? 1 : -1),
            "drag",
            pointer.zone.corner,
          );
        }
        pointer.dragging = true;
        try {
          ui.book.setPointerCapture(event.pointerId);
        } catch (error) {
          // Capture is an optimisation; moves still arrive while over the book.
        }
      }

      var time = now();
      var elapsed = Math.max(1, time - pointer.lastTime);
      pointer.velocity =
        pointer.velocity * 0.4 +
        ((event.clientX - pointer.lastX) / elapsed) * 0.6;
      pointer.lastX = event.clientX;
      pointer.lastTime = time;

      if (state.turn) {
        drawTurn(toBookPoint(event));
      }
      if (event.cancelable) {
        event.preventDefault();
      }
    }

    function onPointerUp(event) {
      var pointer = state.pointer;
      if (!pointer || pointer.id !== event.pointerId) {
        return;
      }
      state.pointer = null;

      if (pointer.dragging && state.turn) {
        var turn = state.turn;
        var completed = Core.shouldCompleteTurn({
          direction: turn.direction,
          point: turn.point,
          velocityX: pointer.velocity,
        });
        if (completed) {
          completeTurn(turn);
        } else {
          cancelTurn(turn, 320);
        }
        return;
      }

      var moved =
        Math.abs(event.clientX - pointer.startX) +
        Math.abs(event.clientY - pointer.startY);
      var selection = window.getSelection ? String(window.getSelection()) : "";
      if (
        moved < 10 &&
        now() - pointer.startTime < 500 &&
        !selection &&
        pointer.zone &&
        pointer.zone.tap
      ) {
        if (pointer.zone.tap === "forward") {
          next();
        } else {
          prev();
        }
      }
    }

    function onPointerCancel(event) {
      var pointer = state.pointer;
      if (!pointer || pointer.id !== event.pointerId) {
        return;
      }
      state.pointer = null;
      if (pointer.dragging && state.turn) {
        cancelTurn(state.turn, 240);
      }
    }

    // A small curl under the pointer when it rests on a page corner.
    function handleHover(event) {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }
      if (
        !state.map ||
        state.view < 0 ||
        state.pointer ||
        state.coverBusy ||
        reducedMotion()
      ) {
        return;
      }
      if (state.turn && state.turn.mode !== "peek") {
        return;
      }

      var point = toBookPoint(event);
      var w = state.layout.pageWidth;
      var h = state.layout.pageHeight;
      var reach = Math.min(84, w * 0.2);
      var nearBottom = point.y > h - reach && point.y <= h;
      var nearTop = point.y >= 0 && point.y < reach;
      var hot = null;

      if (
        (nearBottom || nearTop) &&
        point.x > w - reach &&
        point.x <= w &&
        canGo("forward")
      ) {
        hot = "forward";
      } else if (
        state.layout.mode === "spread" &&
        (nearBottom || nearTop) &&
        point.x < -w + reach &&
        point.x >= -w &&
        state.view > 0
      ) {
        hot = "backward";
      }

      var turn = state.turn;

      if (hot) {
        var corner = nearTop ? "top" : "bottom";
        if (turn && (turn.direction !== hot || turn.corner !== corner)) {
          endTurn(false);
          turn = null;
        }
        if (!turn) {
          turn = beginTurn(
            hot,
            state.view + (hot === "forward" ? 1 : -1),
            "peek",
            corner,
          );
        }
        var inset = Math.min(reach * 0.6, 48);
        var target = {
          x:
            hot === "forward"
              ? Core.clamp(point.x - 8, w - reach, w - inset * 0.9)
              : Core.clamp(point.x + 8, -w + inset * 0.9, -w + reach),
          y:
            corner === "bottom"
              ? Core.clamp(point.y - 8, h - reach, h - inset * 0.7)
              : Core.clamp(point.y + 8, inset * 0.7, reach),
        };
        animatePoint(target, 140, false, null);
      } else if (turn && turn.mode === "peek") {
        cancelTurn(turn, 180);
      }
    }

    function onPointerLeave(event) {
      if (
        event.pointerType === "mouse" &&
        state.turn &&
        state.turn.mode === "peek" &&
        !state.pointer
      ) {
        cancelTurn(state.turn, 180);
      }
    }

    function onWheel(event) {
      if (!state.map || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      var wheel = state.wheel;
      wheel.amount += event.deltaX;
      window.clearTimeout(wheel.timer);
      wheel.timer = window.setTimeout(function () {
        wheel.amount = 0;
        wheel.locked = false;
      }, 260);
      if (!wheel.locked && Math.abs(wheel.amount) > 60) {
        wheel.locked = true;
        if (wheel.amount > 0) {
          next();
        } else {
          prev();
        }
      }
    }

    // ----------------------------------------------------- drawer, settings

    function buildDrawer(book) {
      ui.drawerList.textContent = "";
      var firstSection = state.sectionIds[0];

      function addEntry(list, entry, depth) {
        if (!entry || !Core.isSectionId(entry.sectionId)) {
          return;
        }
        var item = createElement(
          "li",
          "bk-drawer-item bk-drawer-item--depth-" + depth,
        );
        var link = createElement("a", "bk-drawer-link");
        link.setAttribute("href", Core.readerHash(entry.sectionId));
        link.setAttribute("data-book-section", entry.sectionId);
        if (entry.anchorId) {
          link.setAttribute("data-book-anchor", entry.anchorId);
        }
        link.appendChild(createElement("span", "bk-drawer-label", entry.label));
        var number = createElement("span", "bk-drawer-page");
        number.setAttribute(
          "data-page-for",
          entry.sectionId + (entry.anchorId ? "#" + entry.anchorId : ""),
        );
        link.appendChild(number);
        item.appendChild(link);
        list.appendChild(item);
        return item;
      }

      if (state.sectionIds.indexOf("contents") >= 0) {
        addEntry(
          ui.drawerList,
          { label: "Contents", sectionId: "contents" },
          0,
        );
      }

      (book.toc || []).forEach(function (entry) {
        if (
          entry.sectionId === firstSection &&
          !(entry.children || []).length
        ) {
          addEntry(
            ui.drawerList,
            { label: "Title page", sectionId: firstSection },
            0,
          );
          return;
        }
        var children = entry.children || [];
        if (Core.isPartEntry(entry)) {
          var group = createElement("li", "bk-drawer-group");
          group.appendChild(
            createElement("p", "bk-drawer-group-label", entry.label),
          );
          var nested = createElement("ol", "bk-drawer-list-nested");
          children.forEach(function (child) {
            addEntry(nested, child, 1);
          });
          group.appendChild(nested);
          ui.drawerList.appendChild(group);
        } else {
          var item = addEntry(ui.drawerList, entry, 0);
          if (item && children.length) {
            var sub = createElement("ol", "bk-drawer-list-nested");
            children.forEach(function (child) {
              addEntry(sub, child, 1);
            });
            item.appendChild(sub);
          }
        }
      });
    }

    function setPanel(name, open) {
      var panel = name === "contents" ? ui.drawer : ui.settings;
      var button = name === "contents" ? ui.contentsButton : ui.settingsButton;
      var other = name === "contents" ? "settings" : "contents";

      if (open) {
        setPanel(other, false);
      }
      panel.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
      root.classList.toggle("has-" + name + "-open", open);

      if (open) {
        var focusTarget =
          panel.querySelector('[aria-current="true"]') ||
          panel.querySelector("a, button");
        if (focusTarget) {
          focusTarget.focus();
        }
      }
    }

    function applySettings() {
      root.setAttribute("data-theme", state.settings.theme);
      Array.prototype.forEach.call(
        root.querySelectorAll("[data-reader-theme]"),
        function (button) {
          button.setAttribute(
            "aria-checked",
            button.getAttribute("data-reader-theme") === state.settings.theme
              ? "true"
              : "false",
          );
        },
      );
      ui.fontSmaller.disabled = state.settings.fontStep <= 0;
      ui.fontLarger.disabled =
        state.settings.fontStep >= Core.FONT_STEPS.length - 1;
      storageSet(SETTINGS_KEY, JSON.stringify(state.settings));
    }

    function changeFont(delta) {
      var step = Core.clamp(
        state.settings.fontStep + delta,
        0,
        Core.FONT_STEPS.length - 1,
      );
      if (step === state.settings.fontStep) {
        return;
      }
      state.settings.fontStep = step;
      applySettings();
      relayout();
    }

    function toggleFullscreen() {
      var doc = document;
      if (doc.fullscreenElement) {
        if (doc.exitFullscreen) {
          doc.exitFullscreen();
        }
      } else if (root.requestFullscreen) {
        root.requestFullscreen().catch(noop);
      }
    }

    // ------------------------------------------------------------ keyboard

    function focusable() {
      return Array.prototype.filter.call(
        root.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
        function (element) {
          return (
            element.getAttribute("tabindex") !== "-1" &&
            !element.closest("[hidden]") &&
            !element.closest("[aria-hidden='true']")
          );
        },
      );
    }

    function onKeyDown(event) {
      if (!state.open) {
        return;
      }
      var target = event.target;
      var inField =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

      if (event.key === "Escape") {
        event.preventDefault();
        if (!ui.drawer.hidden) {
          setPanel("contents", false);
          ui.contentsButton.focus();
        } else if (!ui.settings.hidden) {
          setPanel("settings", false);
          ui.settingsButton.focus();
        } else {
          close();
        }
        return;
      }

      if (event.key === "Tab") {
        var items = focusable();
        if (!items.length) {
          return;
        }
        var first = items[0];
        var last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !root.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !root.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (inField || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      var handled = true;
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
          prev();
          break;
        case " ":
        case "Spacebar":
          if (target && target.tagName === "BUTTON") {
            handled = false;
          } else if (event.shiftKey) {
            prev();
          } else {
            next();
          }
          break;
        case "Home":
          goToView(0);
          break;
        case "End":
          goToView(viewTotal() - 1);
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
      }
    }

    // ---------------------------------------------------------- open, close

    function setMessage(kind, text, actions) {
      ui.status.setAttribute("data-kind", kind || "");
      ui.status.hidden = !kind;
      ui.message.textContent = "";
      if (!kind) {
        return;
      }
      ui.message.appendChild(
        createElement("p", "bk-reader-message-text", text),
      );
      if (actions && actions.length) {
        var row = createElement("p", "bk-reader-message-actions");
        actions.forEach(function (action) {
          var control;
          if (action.href) {
            control = createElement(
              "a",
              "bk-reader-message-link",
              action.label,
            );
            control.setAttribute("href", action.href);
            control.setAttribute("target", "_blank");
            control.setAttribute("rel", "noopener noreferrer");
          } else {
            control = createElement(
              "button",
              "bk-reader-message-button",
              action.label,
            );
            control.setAttribute("type", "button");
            control.addEventListener("click", action.onClick);
          }
          row.appendChild(control);
        });
        ui.message.appendChild(row);
      }
    }

    function fitClosedBookTo(source) {
      if (!source || !source.getBoundingClientRect || reducedMotion()) {
        return Promise.resolve();
      }
      var from = source.getBoundingClientRect();
      var to = ui.cover.getBoundingClientRect();
      if (!from.width || !to.width) {
        return Promise.resolve();
      }
      var scale = from.width / to.width;
      var dx = from.left + from.width / 2 - (to.left + to.width / 2);
      var dy = from.top + from.height / 2 - (to.top + to.height / 2);
      ui.wrap.style.transition = "none";
      ui.wrap.style.transform =
        "translate(" + dx + "px, " + dy + "px) scale(" + scale + ")";
      ui.wrap.getBoundingClientRect();
      ui.wrap.style.transition = "";
      ui.wrap.style.transform = "";
      return transitionDone(ui.wrap, "transform", 1400);
    }

    function start(openOptions) {
      var attempt = (state.attempt = (state.attempt || 0) + 1);
      var current = function () {
        return state.open && attempt === state.attempt;
      };

      setMessage("loading", "Opening " + bookTitle + "\u2026");
      root.setAttribute("aria-busy", "true");

      return load()
        .then(waitForFonts)
        .then(function () {
          if (!current()) {
            return;
          }
          if (!state.sections.length) {
            prepareSections(state.book);
          }
          paginate();
          state.view = -1;
          render();
          setMessage(null);
          root.removeAttribute("aria-busy");

          var target = 0;
          var saved = Core.parseStoredPosition(storageGet(positionKey));
          if (
            openOptions.sectionId &&
            state.sectionIds.indexOf(openOptions.sectionId) >= 0
          ) {
            var sectionIndex = state.sectionIds.indexOf(openOptions.sectionId);
            state.focusPage = Core.pageOf(state.map, sectionIndex, 0);
            target = Core.viewForPage(state.focusPage, state.layout.mode);
          } else if (
            !openOptions.fromStart &&
            saved &&
            state.sectionIds.indexOf(saved.sectionId) >= 0
          ) {
            target = Core.viewForPage(
              Core.pageForPosition(state.map, state.sectionIds, saved),
              state.layout.mode,
            );
          }

          return fitClosedBookTo(openOptions.source)
            .then(function () {
              return reducedMotion() ? null : wait(140);
            })
            .then(function () {
              if (!current()) {
                return;
              }
              if (reducedMotion()) {
                state.view = target;
                render();
                return;
              }
              return openCover().then(function () {
                if (current() && target > 0) {
                  goToView(target);
                }
              });
            });
        })
        .catch(function (error) {
          root.removeAttribute("aria-busy");
          if (!current()) {
            return;
          }
          setMessage(
            "error",
            "The book could not be opened here right now. " +
              (error && error.message ? error.message : ""),
            [
              {
                label: "Try again",
                onClick: function () {
                  start(openOptions);
                },
              },
            ].concat(
              siteUrl
                ? [
                    {
                      label: "Read it on the book\u2019s website",
                      href: siteUrl,
                    },
                  ]
                : [],
            ),
          );
        });
    }

    function open(openOptions) {
      openOptions = openOptions || {};
      var sectionId = Core.isSectionId(openOptions.sectionId)
        ? openOptions.sectionId
        : null;

      if (state.open) {
        if (sectionId && state.map) {
          goToSection(sectionId);
        }
        return Promise.resolve();
      }

      state.open = true;
      state.lastFocus = openOptions.returnFocus || document.activeElement;
      root.hidden = false;
      document.documentElement.classList.add("bk-reader-lock");
      applySettings();

      if (
        openOptions.pushHistory !== false &&
        window.history &&
        window.history.pushState
      ) {
        try {
          window.history.pushState(
            { bookReader: slug },
            "",
            Core.readerHash(sectionId),
          );
          state.pushedHistory = true;
        } catch (error) {
          state.pushedHistory = false;
        }
      }

      nextFrame(function () {
        root.classList.add("is-visible");
      });
      ui.close.focus();

      return start({
        sectionId: sectionId,
        source: openOptions.source,
        fromStart: openOptions.fromStart,
      });
    }

    function close(closeOptions) {
      closeOptions = closeOptions || {};
      if (!state.open) {
        return;
      }
      snapTurn();
      state.open = false;
      state.attempt = (state.attempt || 0) + 1;
      state.pointer = null;
      setPanel("contents", false);
      setPanel("settings", false);
      root.classList.remove("is-visible");
      document.documentElement.classList.remove("bk-reader-lock");
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(noop);
      }

      var hide = function () {
        if (!state.open) {
          root.hidden = true;
        }
      };
      if (reducedMotion()) {
        hide();
      } else {
        window.setTimeout(hide, 260);
      }

      if (!closeOptions.fromHistory && window.history) {
        if (state.pushedHistory) {
          state.pushedHistory = false;
          state.ignorePop = true;
          window.history.back();
        } else if (Core.parseReaderHash(window.location.hash)) {
          try {
            window.history.replaceState(
              window.history.state,
              "",
              window.location.pathname + window.location.search,
            );
          } catch (error) {
            // Leaving the hash in place is harmless.
          }
        }
      }
      state.pushedHistory = closeOptions.fromHistory
        ? false
        : state.pushedHistory;

      if (
        state.lastFocus &&
        state.lastFocus.focus &&
        document.contains(state.lastFocus)
      ) {
        state.lastFocus.focus();
      }
    }

    function onHistory() {
      if (state.ignorePop) {
        state.ignorePop = false;
        return;
      }
      var parsed = Core.parseReaderHash(window.location.hash);
      if (!parsed && state.open) {
        state.pushedHistory = false;
        close({ fromHistory: true });
      } else if (parsed && !state.open) {
        open({ sectionId: parsed.sectionId, pushHistory: false });
      }
    }

    // ------------------------------------------------------------- wiring

    root.addEventListener("click", function (event) {
      var actionTarget = event.target.closest
        ? event.target.closest("[data-reader-action]")
        : null;
      if (actionTarget && root.contains(actionTarget)) {
        var action = actionTarget.getAttribute("data-reader-action");
        switch (action) {
          case "close":
            close();
            break;
          case "prev":
            prev();
            break;
          case "next":
            next();
            break;
          case "contents":
            setPanel("contents", ui.drawer.hidden);
            break;
          case "settings":
            setPanel("settings", ui.settings.hidden);
            break;
          case "font-smaller":
            changeFont(-1);
            break;
          case "font-larger":
            changeFont(1);
            break;
          case "fullscreen":
            toggleFullscreen();
            break;
          case "dismiss":
            setPanel("contents", false);
            setPanel("settings", false);
            break;
          default:
            break;
        }
        return;
      }

      var themeTarget = event.target.closest
        ? event.target.closest("[data-reader-theme]")
        : null;
      if (themeTarget) {
        var theme = themeTarget.getAttribute("data-reader-theme");
        if (Core.THEMES.indexOf(theme) >= 0) {
          state.settings.theme = theme;
          applySettings();
        }
        return;
      }

      var link = event.target.closest
        ? event.target.closest("a[data-book-section]")
        : null;
      if (link && root.contains(link)) {
        event.preventDefault();
        setPanel("contents", false);
        goToSection(
          link.getAttribute("data-book-section"),
          link.getAttribute("data-book-anchor"),
        );
      }
    });

    ui.scrubber.addEventListener("input", function () {
      if (!state.map) {
        return;
      }
      var view = Number(ui.scrubber.value);
      var page = Core.readingPage(state.map, view, state.layout.mode);
      ui.pages.textContent = Core.pageLabel(
        view,
        state.layout.mode,
        state.map.total,
      );
      ui.location.textContent = describeSection(sectionAt(page));
    });
    ui.scrubber.addEventListener("change", function () {
      goToView(Number(ui.scrubber.value));
    });

    ui.book.addEventListener("pointerdown", onPointerDown);
    ui.book.addEventListener("pointermove", onPointerMove);
    ui.book.addEventListener("pointerup", onPointerUp);
    ui.book.addEventListener("pointercancel", onPointerCancel);
    ui.book.addEventListener("pointerleave", onPointerLeave);
    ui.stage.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onHistory);
    window.addEventListener("hashchange", onHistory);
    window.addEventListener("resize", function () {
      if (!state.open) {
        return;
      }
      window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(relayout, 160);
    });

    if (ui.fullscreenButton && !root.requestFullscreen) {
      ui.fullscreenButton.hidden = true;
    }

    // --------------------------------------------------------- public API

    self.open = open;
    self.close = close;
    self.next = next;
    self.prev = prev;
    self.goToSection = function (sectionId, anchorId) {
      return goToSection(sectionId, anchorId);
    };
    self.goToView = goToView;
    self.preload = function () {
      load().catch(noop);
    };
    self.isOpen = function () {
      return state.open;
    };
    self.relayout = relayout;
    self.handleHistory = onHistory;
    self.getState = function () {
      return {
        open: state.open,
        loaded: Boolean(state.book),
        view: state.view,
        views: viewTotal(),
        pages: state.map ? state.map.total : 0,
        mode: state.layout ? state.layout.mode : null,
        sectionId:
          state.map && state.view >= 0
            ? (sectionAt(currentPage()) || {}).id
            : null,
        // True while anything moves: a page turn, or the cover opening or closing.
        turning: Boolean(state.turn || state.coverBusy),
        settings: {
          fontStep: state.settings.fontStep,
          theme: state.settings.theme,
        },
      };
    };
    self.savedPosition = function () {
      return Core.parseStoredPosition(storageGet(positionKey));
    };
  }

  function create(root, options) {
    return new BookReader(root, options);
  }

  window.OneUptimeBookReader = {
    create: create,
    sanitizeFragment: sanitizeFragment,
  };
})(
  typeof window !== "undefined" ? window : undefined,
  typeof document !== "undefined" ? document : undefined,
);
