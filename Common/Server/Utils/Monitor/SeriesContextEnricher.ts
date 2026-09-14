import ColumnLength from "../../../Types/Database/ColumnLength";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SeriesDebugHints from "../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import SeriesLabelDisplay, {
  DisplaySeriesLabel,
} from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";

/*
 * Make a per-series alert or incident say WHICH pod, container, node or
 * mount it is about.
 *
 * A grouped metric monitor raises one alert per breaching series and
 * stores that series' identity in `seriesLabels`. Until now the identity
 * stopped there: the title came from the criteria template, which is one
 * fixed string shared by every series, so a cluster with fifty saturated
 * pods produced fifty alerts whose titles were character-for-character
 * identical. The identity was reachable - in a table, at the bottom of
 * the alert detail page - but the alert list, the Slack message, the
 * email and the phone notification all showed the same undifferentiated
 * line.
 *
 * This enricher runs at creation time, after the criteria template has
 * been rendered, and appends the series identity to the title and a
 * resource + first-commands block to the description.
 *
 * Two properties matter and are covered by tests:
 *
 *   - It never fights the user's own template. A title that already
 *     names the series (because the user wrote `{{resource.k8s.pod.name}}`
 *     into it, or because the new `{{seriesResourceSuffix}}` variable
 *     expanded there) is left exactly as the user wrote it. The check is
 *     on the VALUES, not on the placeholders, so it works the same
 *     whether the identity arrived from a template variable or was typed
 *     literally.
 *
 *   - It is a no-op for whole-monitor alerts. A monitor with no group-by
 *     has no series identity, and nothing is appended.
 */

/*
 * Hoisted rather than written inline at its single use site: two lint
 * rules disagree about parenthesising a regex literal in an expression
 * and `--fix` oscillates between them (ESLintCircularFixesWarning). A
 * named constant sidesteps the argument and reads better anyway.
 */
const WordCharacterPattern: RegExp = /[A-Za-z0-9]/;

export default class SeriesContextEnricher {
  /**
   * The `title` column's own limit, taken from the schema rather than
   * restated as a number - `Alert.title` and `Incident.title` are both
   * `ColumnType.LongText`.
   */
  private static readonly MaxTitleLength: number = ColumnLength.LongText;

  /**
   * Shortest label value that may be matched as a bare substring.
   *
   * Ceph pool ids and Proxmox vmids are one or two characters, and
   * "does the title contain 3?" is answered `true` by any title with a
   * threshold in it ("Restarts > 3"). Below this length only this
   * module's own `Name: value` rendering counts as a mention, which
   * keeps idempotency without letting a coincidence swallow the
   * identity.
   */
  private static readonly MinimumMatchableValueLength: number = 4;

  /**
   * What counts as "part of the same word" when deciding whether a
   * value found in the text is really a mention of it.
   *
   * Deliberately narrower than `\w`: `-`, `.`, `/` and `_` all appear
   * inside the values themselves (pod names, mountpoints, Ceph daemon
   * ids), so treating them as word characters would make a value that
   * IS present look like part of a longer token.
   */
  private static isWordCharacter(character: string): boolean {
    if (character === "") {
      return false;
    }

    return WordCharacterPattern.test(character);
  }

  /**
   * Whether `text` already names this label's value.
   *
   * Two ways to be already-named, and both matter:
   *
   *   - This module's own rendering (`"Pod: web-1"`) is matched exactly.
   *     That is what makes the enricher idempotent, whatever the value
   *     looks like.
   *
   *   - A distinctive value appearing anywhere on a token boundary. That
   *     is the user's own template - `{{resource.k8s.pod.name}}` has
   *     already expanded by the time this runs, so the check has to be
   *     on the VALUE, not on the placeholder. The boundary requirement
   *     stops a pod called `web` from counting as mentioned because the
   *     title happens to contain the word "website".
   */
  private static isValueMentioned(input: {
    text: string;
    label: DisplaySeriesLabel;
  }): boolean {
    const { text, label } = input;

    if (text.includes(`${label.name}: ${label.value}`)) {
      return true;
    }

    if (
      label.value.length < SeriesContextEnricher.MinimumMatchableValueLength
    ) {
      return false;
    }

    let searchFrom: number = 0;

    for (;;) {
      const index: number = text.indexOf(label.value, searchFrom);

      if (index === -1) {
        return false;
      }

      const before: string = index > 0 ? text.charAt(index - 1) : "";
      const after: string = text.charAt(index + label.value.length);

      if (
        !SeriesContextEnricher.isWordCharacter(before) &&
        !SeriesContextEnricher.isWordCharacter(after)
      ) {
        return true;
      }

      searchFrom = index + 1;
    }
  }

  /*
   * The identity labels not already present in `text`.
   *
   * Deliberately per-label rather than all-or-nothing: a title that
   * mentions the pod by name but not the namespace still gets the
   * namespace appended, because dropping the rest whenever a user's
   * template happened to mention one identifier would lose exactly the
   * context this exists to add.
   */
  private static getUnmentionedLabels(input: {
    text: string;
    seriesLabels: JSONObject | undefined;
  }): Array<DisplaySeriesLabel> {
    const labels: Array<DisplaySeriesLabel> =
      SeriesLabelDisplay.getDisplayLabels(input.seriesLabels);

    if (labels.length === 0) {
      return [];
    }

    const text: string = input.text || "";

    return labels.filter((label: DisplaySeriesLabel) => {
      return !SeriesContextEnricher.isValueMentioned({ text, label });
    });
  }

  /*
   * `title` with the series identity appended, or `title` unchanged when
   * there is no identity to add or the title already carries it.
   */
  public static enrichTitle(input: {
    title: string;
    seriesLabels: JSONObject | undefined;
  }): string {
    const title: string = input.title || "";

    const unmentioned: Array<DisplaySeriesLabel> =
      SeriesContextEnricher.getUnmentionedLabels({
        text: title,
        seriesLabels: input.seriesLabels,
      });

    if (unmentioned.length === 0) {
      return title;
    }

    /*
     * Rebuild a label map from just the unmentioned labels so the
     * shared formatter still applies its own ordering and title cap
     * rather than this module reimplementing either.
     */
    const remaining: JSONObject = {};

    for (const label of unmentioned) {
      remaining[label.key] = label.value;
    }

    const suffix: string = SeriesLabelDisplay.buildTitleSuffix(remaining);

    if (!suffix) {
      return title;
    }

    /*
     * `Alert.title` and `Incident.title` are LongText, i.e. 500
     * characters. Overflowing the column does not produce a shortened
     * title - it fails the INSERT, and the alert does not exist at all.
     * That would turn a labelling improvement into dropped pages, so the
     * appended identity is bounded here as well as per-value inside
     * SeriesLabelDisplay.
     *
     * A base title that is ALREADY at or over the limit is returned
     * untouched: it was going to fail with or without this enricher, and
     * silently truncating what the user wrote is not this module's call
     * to make.
     */
    if (title.length >= SeriesContextEnricher.MaxTitleLength) {
      return title;
    }

    const room: number = SeriesContextEnricher.MaxTitleLength - title.length;

    if (suffix.length <= room) {
      return `${title}${suffix}`;
    }

    return `${title}${suffix.slice(0, room)}`;
  }

  /*
   * `description` with an "Affected resource" block and the read-only
   * commands worth running first appended.
   *
   * The description is what reaches Slack, email and the mobile push, so
   * this is where the full identity goes - the title only has room for
   * the top few labels.
   */
  public static enrichDescription(input: {
    description: string;
    seriesLabels: JSONObject | undefined;
    monitorType: MonitorType | undefined;
  }): string {
    const description: string = input.description || "";

    const labels: Array<DisplaySeriesLabel> =
      SeriesLabelDisplay.getDisplayLabels(input.seriesLabels);

    if (labels.length === 0) {
      return description;
    }

    const sections: Array<string> = [];

    /*
     * Only skip the resource block when the description already names
     * EVERY label. A description mentioning the pod but not the node is
     * still missing the thing the engineer needs.
     */
    const unmentioned: Array<DisplaySeriesLabel> =
      SeriesContextEnricher.getUnmentionedLabels({
        text: description,
        seriesLabels: input.seriesLabels,
      });

    const block: string = SeriesLabelDisplay.buildMarkdownBlock(
      input.seriesLabels,
    );

    /*
     * The exact-block check is the idempotency guarantee. Per-label
     * matching alone cannot provide it: a one-character label value
     * (a Ceph pool id, a Proxmox vmid) is deliberately not matched as a
     * bare substring, so a second pass would append the block again.
     */
    if (unmentioned.length > 0 && block && !description.includes(block)) {
      sections.push(block);
    }

    const commandsBlock: string = SeriesDebugHints.buildMarkdownBlock({
      monitorType: input.monitorType,
      seriesLabels: input.seriesLabels,
    });

    /*
     * The commands embed the label values, so a description that
     * already carries them would otherwise get a near-duplicate block
     * appended on top of a user's own runbook snippet.
     */
    if (commandsBlock && !description.includes(commandsBlock)) {
      sections.push(commandsBlock);
    }

    if (sections.length === 0) {
      return description;
    }

    if (!description.trim()) {
      return sections.join("\n\n");
    }

    return `${description}\n\n${sections.join("\n\n")}`;
  }
}
