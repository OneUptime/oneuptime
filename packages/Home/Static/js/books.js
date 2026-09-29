/*
 * /books: connects the page to the in-page reader (book-reader.js).
 *
 * Every element with data-book-open is a real link to the book's website, so
 * the page works without JavaScript. With it, a plain click opens the reader
 * here instead (at data-book-section, when set); a click with a modifier key
 * or the middle button still follows the link, as the visitor asked.
 */
(function (window, document) {
  "use strict";

  var Core = window.OneUptimeBookReaderCore;
  var Reader = window.OneUptimeBookReader;
  var root = document.getElementById("book-reader");

  if (!Core || !Reader || !root) {
    return;
  }

  var reader = Reader.create(root);
  var preloaded = false;

  window.OneUptimeBooks = { reader: reader };

  function reducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (error) {
      return false;
    }
  }

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    var rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.bottom > 0 &&
      rect.top < (window.innerHeight || document.documentElement.clientHeight)
    );
  }

  function preload() {
    if (!preloaded) {
      preloaded = true;
      reader.preload();
    }
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target.closest
      ? event.target.closest("[data-book-open]")
      : null;

    if (!trigger || event.defaultPrevented) {
      return;
    }
    if (
      event.button > 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();

    var cover =
      trigger.querySelector("[data-book-cover]") ||
      document.querySelector("[data-book-cover]");

    reader.open({
      sectionId: trigger.getAttribute("data-book-section") || null,
      fromStart: trigger.hasAttribute("data-book-start"),
      source: isVisible(cover) ? cover : null,
      returnFocus: trigger,
    });
  });

  Array.prototype.forEach.call(
    document.querySelectorAll("[data-book-open]"),
    function (trigger) {
      trigger.addEventListener("pointerenter", preload, { once: true });
      trigger.addEventListener("focus", preload, { once: true });
      trigger.addEventListener("touchstart", preload, {
        once: true,
        passive: true,
      });
    },
  );

  // "Continue reading" for returning readers.
  var saved = reader.savedPosition();
  var resume = document.querySelector("[data-book-resume]");

  if (saved && resume && saved.progress > 0.004) {
    var label = resume.querySelector("[data-book-resume-label]");
    var bar = resume.querySelector("[data-book-resume-progress]");
    var percent = Math.round(saved.progress * 100);

    if (label) {
      label.textContent = saved.label || "where you left off";
    }
    if (bar) {
      bar.style.transform = "scaleX(" + Math.max(0.02, saved.progress) + ")";
      bar.parentNode.setAttribute("title", percent + "% read");
    }
    resume.hidden = false;
  }

  // The hero book leans towards the pointer.
  var object = document.querySelector("[data-book-object]");
  var hero = object ? object.closest("section") : null;
  var finePointer =
    window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  if (object && hero && finePointer && !reducedMotion()) {
    var frame = 0;
    hero.addEventListener("pointermove", function (event) {
      var rect = object.getBoundingClientRect();
      var x =
        (event.clientX - (rect.left + rect.width / 2)) /
        Math.max(rect.width * 2.5, 1);
      var y =
        (event.clientY - (rect.top + rect.height / 2)) /
        Math.max(rect.height * 2, 1);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(function () {
        object.style.setProperty("--tilt-x", Core.clamp(x, -1, 1).toFixed(3));
        object.style.setProperty("--tilt-y", Core.clamp(y, -1, 1).toFixed(3));
      });
    });
    hero.addEventListener("pointerleave", function () {
      window.cancelAnimationFrame(frame);
      object.style.setProperty("--tilt-x", "0");
      object.style.setProperty("--tilt-y", "0");
    });
  }

  // Deep links: /books#read or /books#read/m05 open the reader on arrival.
  var deepLink = Core.parseReaderHash(window.location.hash);

  if (deepLink) {
    reader.open({ sectionId: deepLink.sectionId, pushHistory: false });
  }
})(window, document);
