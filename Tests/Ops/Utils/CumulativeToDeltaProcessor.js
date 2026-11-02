/*
 * The type the cumulative-to-delta processor goes by on a collector image.
 *
 * Collector 0.157.0 renamed it cumulative_to_delta and keeps cumulativetodelta
 * as a deprecated alias. A collector before 0.157.0 knows only
 * cumulativetodelta, and refuses a whole config that names the new type
 * ("unknown type"). The kubernetes-agent chart renders the type its image
 * knows (kubernetes-agent.cumulativeToDeltaProcessor in _helpers.tpl), because
 * a `helm upgrade --reuse-values` keeps 0.96.0 on a release from before
 * 0.161.0. Both names were validated on 0.96.0, 0.156.0, 0.157.0 and 0.161.0.
 *
 * Not a test file itself (jest only collects *.test.js).
 */

const RENAMED_TYPE = "cumulative_to_delta";
const ALIAS_TYPE = "cumulativetodelta";
// The first collector that knows the processor as cumulative_to_delta.
const RENAMED_IN = [0, 157, 0];
// How the template asks for the type.
const TEMPLATE_TYPE =
  '{{ include "kubernetes-agent.cumulativeToDeltaProcessor" . }}';

const VERSION = /:v?(\d+)\.(\d+)\.(\d+)/;

// The [major, minor, patch] an image's tag names, e.g. "...-contrib:0.96.0".
function collectorVersion(image) {
  const match = VERSION.exec(image);
  if (!match) {
    throw new Error(`no collector version in the image ${image}`);
  }
  return match.slice(1).map(Number);
}

// The type the collector `image` knows the processor by.
function cumulativeToDeltaType(image) {
  const version = collectorVersion(image);
  for (let index = 0; index < RENAMED_IN.length; index++) {
    if (version[index] !== RENAMED_IN[index]) {
      return version[index] > RENAMED_IN[index] ? RENAMED_TYPE : ALIAS_TYPE;
    }
  }
  return RENAMED_TYPE;
}

/*
 * Processor names as `image` knows them: a cumulative_to_delta/<name> becomes
 * cumulativetodelta/<name> on a collector before 0.157.0; every other name,
 * and every name with no image given, stays as it is.
 */
function processorNamesFor(names, image) {
  if (!image) {
    return names;
  }
  const type = cumulativeToDeltaType(image);
  return names.map((name) => {
    return name.startsWith(`${RENAMED_TYPE}/`)
      ? `${type}${name.substring(RENAMED_TYPE.length)}`
      : name;
  });
}

/*
 * A template's text as the chart renders it for the collector it pins: the
 * processor's type written out where the template asks for it.
 */
function templateForPinnedCollector(template) {
  return template.split(TEMPLATE_TYPE).join(RENAMED_TYPE);
}

module.exports = {
  ALIAS_TYPE,
  RENAMED_IN,
  RENAMED_TYPE,
  TEMPLATE_TYPE,
  collectorVersion,
  cumulativeToDeltaType,
  processorNamesFor,
  templateForPinnedCollector,
};
