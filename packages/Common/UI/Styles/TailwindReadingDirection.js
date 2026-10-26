/*
 * LEFT AND RIGHT FOLLOW THE READING DIRECTION.
 *
 * Every frontend lays its pages out with Tailwind's left and right utilities
 * - ml-3 beside an icon, pl-6 at the start of a row, right-0 on a menu, a
 * text-left dialog, border-l on a side menu's lit entry. A page in a
 * language written from right to left (Persian) sets dir="rtl" on <html>
 * (Common/UI/Utils/PageLanguage), and every flex row, grid and line of text
 * then runs from the right; a physical margin or position would stay where
 * it was, on what is now the far side.
 *
 * So in OneUptime a left or right utility means the start or the end of the
 * line: this config swaps Tailwind's own margin, padding, position, text
 * alignment, border width, corner and space/divide utilities for ones
 * written with logical properties (margin-inline-start for ml-3,
 * inset-inline-end for right-0, text-align: start for text-left, ...). On a
 * left-to-right page each one is the very same side it always was; on a
 * right-to-left page the whole layout mirrors, with no change to any
 * component. A side border colour is written for both, so an accent bar
 * keeps its colour on whichever side it is drawn.
 *
 * What does not mirror: transforms (translate-x), gradients, shadows and
 * inline styles. Mirror those with the rtl: variant, and keep a box whose
 * sides mean left and right whatever the language - a chart, a timeline,
 * code - left to right with dir="ltr", inside which the utilities are
 * physical again. A property written out in full ([margin-left:2px]) is
 * never swapped.
 *
 * Each frontend's index.ejs loads this file right after Tailwind's runtime
 * (Common/UI/esbuild-config.js copies it there), and from then on every
 * config the page gives Tailwind - `tailwind.config = {...}`, as index.ejs
 * and the offline test fixtures write it - is taken with the reading
 * direction: the file wraps the runtime's `tailwind` global. It is plain
 * browser JavaScript, served as it is, and a CommonJS module for the tests
 * (withReadingDirection, followReadingDirection).
 */
(function (root, factory) {
  "use strict";

  var api = factory();

  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.oneuptimeTailwindReadingDirection = api.withReadingDirection;
    api.followReadingDirection(root);
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var BORDER_WIDTH_DEFAULTS = ["@defaults border-width", {}];

  /*
   * Tailwind's own utilities, group by group and in its order, with each
   * physical side swapped for its logical one. A later group wins over an
   * earlier one (ml-2 over mx-4), as it does in Tailwind.
   */
  var MARGIN_GROUPS = [
    [["m", ["margin"]]],
    [
      ["mx", ["margin-left", "margin-right"]],
      ["my", ["margin-top", "margin-bottom"]],
    ],
    [
      ["ms", ["margin-inline-start"]],
      ["me", ["margin-inline-end"]],
      ["mt", ["margin-top"]],
      ["mr", ["margin-inline-end"]],
      ["mb", ["margin-bottom"]],
      ["ml", ["margin-inline-start"]],
    ],
  ];

  var PADDING_GROUPS = [
    [["p", ["padding"]]],
    [
      ["px", ["padding-left", "padding-right"]],
      ["py", ["padding-top", "padding-bottom"]],
    ],
    [
      ["ps", ["padding-inline-start"]],
      ["pe", ["padding-inline-end"]],
      ["pt", ["padding-top"]],
      ["pr", ["padding-inline-end"]],
      ["pb", ["padding-bottom"]],
      ["pl", ["padding-inline-start"]],
    ],
  ];

  var INSET_GROUPS = [
    [["inset", ["inset"]]],
    [
      ["inset-x", ["left", "right"]],
      ["inset-y", ["top", "bottom"]],
    ],
    [
      ["start", ["inset-inline-start"]],
      ["end", ["inset-inline-end"]],
      ["top", ["top"]],
      ["right", ["inset-inline-end"]],
      ["bottom", ["bottom"]],
      ["left", ["inset-inline-start"]],
    ],
  ];

  var BORDER_WIDTH_GROUPS = [
    [["border", [BORDER_WIDTH_DEFAULTS, "border-width"]]],
    [
      [
        "border-x",
        [BORDER_WIDTH_DEFAULTS, "border-left-width", "border-right-width"],
      ],
      [
        "border-y",
        [BORDER_WIDTH_DEFAULTS, "border-top-width", "border-bottom-width"],
      ],
    ],
    [
      ["border-s", [BORDER_WIDTH_DEFAULTS, "border-inline-start-width"]],
      ["border-e", [BORDER_WIDTH_DEFAULTS, "border-inline-end-width"]],
      ["border-t", [BORDER_WIDTH_DEFAULTS, "border-top-width"]],
      ["border-r", [BORDER_WIDTH_DEFAULTS, "border-inline-end-width"]],
      ["border-b", [BORDER_WIDTH_DEFAULTS, "border-bottom-width"]],
      ["border-l", [BORDER_WIDTH_DEFAULTS, "border-inline-start-width"]],
    ],
  ];

  var BORDER_RADIUS_GROUPS = [
    [["rounded", ["border-radius"]]],
    [
      ["rounded-s", ["border-start-start-radius", "border-end-start-radius"]],
      ["rounded-e", ["border-start-end-radius", "border-end-end-radius"]],
      ["rounded-t", ["border-top-left-radius", "border-top-right-radius"]],
      ["rounded-r", ["border-start-end-radius", "border-end-end-radius"]],
      [
        "rounded-b",
        ["border-bottom-right-radius", "border-bottom-left-radius"],
      ],
      ["rounded-l", ["border-start-start-radius", "border-end-start-radius"]],
    ],
    [
      ["rounded-ss", ["border-start-start-radius"]],
      ["rounded-se", ["border-start-end-radius"]],
      ["rounded-ee", ["border-end-end-radius"]],
      ["rounded-es", ["border-end-start-radius"]],
      ["rounded-tl", ["border-start-start-radius"]],
      ["rounded-tr", ["border-start-end-radius"]],
      ["rounded-br", ["border-end-end-radius"]],
      ["rounded-bl", ["border-end-start-radius"]],
    ],
  ];

  var TEXT_ALIGN_UTILITIES = {
    ".text-left": { "text-align": "start" },
    ".text-center": { "text-align": "center" },
    ".text-right": { "text-align": "end" },
    ".text-justify": { "text-align": "justify" },
    ".text-start": { "text-align": "start" },
    ".text-end": { "text-align": "end" },
  };

  // Tailwind's own plugins this config writes again.
  var REPLACED_CORE_PLUGINS = [
    "margin",
    "padding",
    "inset",
    "textAlign",
    "borderWidth",
    "borderRadius",
    "space",
    "divideWidth",
  ];

  var CHILDREN_AFTER_THE_FIRST = "& > :not([hidden]) ~ :not([hidden])";

  // Tailwind's createUtilityPlugin, with the groups above.
  var utilityGroups = function (api, themeKey, groups, options) {
    groups.forEach(function (group) {
      var utilities = {};

      group.forEach(function (entry) {
        var name = entry[0];
        var properties = entry[1];

        utilities[name] = function (value) {
          var declarations = {};

          properties.forEach(function (property) {
            if (Array.isArray(property)) {
              declarations[property[0]] = property[1];
            } else {
              declarations[property] = value;
            }
          });

          return declarations;
        };
      });

      api.matchUtilities(
        utilities,
        Object.assign({}, options || {}, { values: api.theme(themeKey) }),
      );
    });
  };

  var zeroAsLength = function (value) {
    return value === "0" ? "0px" : value;
  };

  // space-x / space-y, with space-x between the starts of a row's items.
  var space = function (api) {
    api.matchUtilities(
      {
        "space-x": function (value) {
          var length = zeroAsLength(value);
          var rule = {};

          rule[CHILDREN_AFTER_THE_FIRST] = {
            "--tw-space-x-reverse": "0",
            "margin-inline-end":
              "calc(" + length + " * var(--tw-space-x-reverse))",
            "margin-inline-start":
              "calc(" + length + " * calc(1 - var(--tw-space-x-reverse)))",
          };

          return rule;
        },
        "space-y": function (value) {
          var length = zeroAsLength(value);
          var rule = {};

          rule[CHILDREN_AFTER_THE_FIRST] = {
            "--tw-space-y-reverse": "0",
            "margin-top":
              "calc(" + length + " * calc(1 - var(--tw-space-y-reverse)))",
            "margin-bottom": "calc(" + length + " * var(--tw-space-y-reverse))",
          };

          return rule;
        },
      },
      { values: api.theme("space"), supportsNegativeValues: true },
    );

    api.addUtilities({
      ".space-y-reverse > :not([hidden]) ~ :not([hidden])": {
        "--tw-space-y-reverse": "1",
      },
      ".space-x-reverse > :not([hidden]) ~ :not([hidden])": {
        "--tw-space-x-reverse": "1",
      },
    });
  };

  // divide-x / divide-y, with divide-x ruled at the start of each item.
  var divideWidth = function (api) {
    api.matchUtilities(
      {
        "divide-x": function (value) {
          var width = zeroAsLength(value);
          var rule = {};

          rule[CHILDREN_AFTER_THE_FIRST] = {
            "@defaults border-width": {},
            "--tw-divide-x-reverse": "0",
            "border-inline-end-width":
              "calc(" + width + " * var(--tw-divide-x-reverse))",
            "border-inline-start-width":
              "calc(" + width + " * calc(1 - var(--tw-divide-x-reverse)))",
          };

          return rule;
        },
        "divide-y": function (value) {
          var width = zeroAsLength(value);
          var rule = {};

          rule[CHILDREN_AFTER_THE_FIRST] = {
            "@defaults border-width": {},
            "--tw-divide-y-reverse": "0",
            "border-top-width":
              "calc(" + width + " * calc(1 - var(--tw-divide-y-reverse)))",
            "border-bottom-width":
              "calc(" + width + " * var(--tw-divide-y-reverse))",
          };

          return rule;
        },
      },
      {
        values: api.theme("divideWidth"),
        type: ["line-width", "length", "any"],
      },
    );

    api.addUtilities({
      ".divide-y-reverse > :not([hidden]) ~ :not([hidden])": {
        "@defaults border-width": {},
        "--tw-divide-y-reverse": "1",
      },
      ".divide-x-reverse > :not([hidden]) ~ :not([hidden])": {
        "@defaults border-width": {},
        "--tw-divide-x-reverse": "1",
      },
    });
  };

  // { gray: { 200: "#e5e7eb" }, white: "#fff" } -> { "gray-200": ..., white: ... }
  var flattenColors = function (colors, prefix) {
    var flat = {};

    Object.keys(colors || {}).forEach(function (key) {
      var value = colors[key];
      var name =
        key === "DEFAULT" ? prefix : prefix ? prefix + "-" + key : key;

      if (value && typeof value === "object") {
        Object.assign(flat, flattenColors(value, name));
      } else if (name) {
        flat[name] = value;
      }
    });

    return flat;
  };

  /*
   * A side border's colour on the side its width is drawn: border-l-4
   * border-l-indigo-500 draws its bar at the start of a right-to-left line,
   * so the colour goes there too. Tailwind's own rule still colours the
   * physical side, where no width is drawn.
   */
  var sideBorderColors = function (api) {
    var colors = flattenColors(api.theme("borderColor"), "");

    delete colors.DEFAULT;

    api.matchUtilities(
      {
        "border-l": function (value) {
          return { "border-inline-start-color": value };
        },
        "border-r": function (value) {
          return { "border-inline-end-color": value };
        },
      },
      /*
       * Only the theme's colours: an arbitrary one (border-l-[#f00]) is
       * left to Tailwind's own rule, which would otherwise have two
       * plugins claiming it and draw neither.
       */
      { values: colors, type: ["lookup"] },
    );
  };

  var readingDirectionPlugin = function (api) {
    utilityGroups(api, "margin", MARGIN_GROUPS, {
      supportsNegativeValues: true,
    });
    utilityGroups(api, "padding", PADDING_GROUPS);
    utilityGroups(api, "inset", INSET_GROUPS, { supportsNegativeValues: true });
    api.addUtilities(TEXT_ALIGN_UTILITIES);
    utilityGroups(api, "borderRadius", BORDER_RADIUS_GROUPS);
    utilityGroups(api, "borderWidth", BORDER_WIDTH_GROUPS, {
      type: ["line-width", "length"],
    });
    sideBorderColors(api);
    space(api);
    divideWidth(api);
  };

  /*
   * A frontend's Tailwind config, with left and right following the reading
   * direction. Everything the config says itself is kept, and a config
   * taken twice is taken once.
   */
  var withReadingDirection = function (config) {
    var given = config || {};
    var corePlugins;

    if (Array.isArray(given.corePlugins)) {
      // The list form names the core plugins to keep.
      corePlugins = given.corePlugins.filter(function (name) {
        return REPLACED_CORE_PLUGINS.indexOf(name) === -1;
      });
    } else {
      corePlugins = Object.assign({}, given.corePlugins || {});

      REPLACED_CORE_PLUGINS.forEach(function (name) {
        corePlugins[name] = false;
      });
    }

    var plugins = Array.isArray(given.plugins) ? given.plugins.slice() : [];

    if (plugins.indexOf(readingDirectionPlugin) === -1) {
      plugins.push(readingDirectionPlugin);
    }

    return Object.assign({}, given, {
      corePlugins: corePlugins,
      plugins: plugins,
    });
  };

  var FOLLOWED = "__oneuptimeFollowsReadingDirection";

  /*
   * Wraps the runtime's `tailwind` global, so every config set on it from
   * now on follows the reading direction; so does the one it has now (the
   * runtime's empty default, until a page sets its own). False when there
   * is no runtime to wrap, or it is wrapped already.
   */
  var followReadingDirection = function (root) {
    var runtime = root && root.tailwind;

    if (!runtime || typeof Proxy !== "function" || runtime[FOLLOWED] === true) {
      return false;
    }

    var wrapped = new Proxy(runtime, {
      get: function (target, key) {
        if (key === FOLLOWED) {
          return true;
        }

        return target[key];
      },
      set: function (target, key, value) {
        target[key] = key === "config" ? withReadingDirection(value) : value;

        return true;
      },
    });

    root.tailwind = wrapped;

    var current = runtime.config;

    if (!current || Object.keys(current).length === 0) {
      wrapped.config = {};
    }

    return true;
  };

  return {
    withReadingDirection: withReadingDirection,
    followReadingDirection: followReadingDirection,
    readingDirectionPlugin: readingDirectionPlugin,
    REPLACED_CORE_PLUGINS: REPLACED_CORE_PLUGINS,
  };
});
