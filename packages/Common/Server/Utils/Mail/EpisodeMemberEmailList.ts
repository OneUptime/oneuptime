import SafeHtml from "../../../Types/SafeHtml";

/*
 * THE ALERTS OR INCIDENTS OF AN EPISODE, AS THE EMAIL THAT PAGES SOMEONE FOR
 * THE EPISODE LISTS THEM.
 *
 * UserNotificationRuleService builds this list for the on-call emails
 * AcknowledgeAlertEpisode and AcknowledgeIncidentEpisode, which print it
 * raw ({{{alertsList}}} / {{{incidentsList}}}) under "Alerts in this
 * Episode" or "Incidents in this Episode": one bordered box, one row per
 * member - its number, its title linked to the dashboard, the monitors it
 * came from and a "View" link.
 *
 * A hairline divider separates one row from the next, drawn ABOVE every row
 * but the first. Each row used to draw it under itself, so the last row's
 * divider sat on the box's own bottom border and made it twice as thick.
 * (The emails' detail cards draw their dividers the same way:
 * App/FeatureSet/Notification/Utils/EmailDetailCard.ts.)
 *
 * Every value is plain text and is escaped here: a title and a monitor name
 * are free text a project member typed.
 */

export interface EpisodeMemberEmailListItem {
  // The member's number as the project writes it: "ALT-12", or "#12".
  number: string;
  // Its title.
  title: string;
  // Its page on the dashboard.
  link: string;
  // The monitors it came from, joined; empty when there are none.
  monitorName: string;
}

// How a row's number badge is coloured.
export interface EpisodeMemberEmailListBadge {
  backgroundColor: string;
  color: string;
}

export const ALERT_NUMBER_BADGE: EpisodeMemberEmailListBadge = {
  backgroundColor: "#f1f5f9",
  color: "#111111",
};

export const INCIDENT_NUMBER_BADGE: EpisodeMemberEmailListBadge = {
  backgroundColor: "#fee2e2",
  color: "#991b1b",
};

// The divider every row but the first draws above itself.
export const EPISODE_MEMBER_ROW_DIVIDER: string =
  "border-top: 1px solid #e2e8f0;";

export default class EpisodeMemberEmailList {
  /*
   * The list as HTML, or an empty string when there are no members: the
   * templates leave the whole section out then.
   */
  public static toHtml(
    items: Array<EpisodeMemberEmailListItem>,
    badge: EpisodeMemberEmailListBadge,
  ): string {
    if (items.length === 0) {
      return "";
    }

    const rows: Array<string> = items.map(
      (item: EpisodeMemberEmailListItem, index: number): string => {
        return EpisodeMemberEmailList.rowHtml(item, badge, index > 0);
      },
    );

    return `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; table-layout: fixed; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; margin: 8px 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <tbody>
              ${rows.join("")}
            </tbody>
          </table>
        `;
  }

  private static rowHtml(
    item: EpisodeMemberEmailListItem,
    badge: EpisodeMemberEmailListBadge,
    followsAnotherRow: boolean,
  ): string {
    const number: string = SafeHtml.escape(item.number);
    const title: string = SafeHtml.escape(item.title);
    const link: string = SafeHtml.escape(item.link);
    const monitorName: string = SafeHtml.escape(item.monitorName);
    const divider: string = followsAnotherRow
      ? ` ${EPISODE_MEMBER_ROW_DIVIDER}`
      : "";
    const monitorLine: string = monitorName
      ? `<span style="display: block; color: #64748b; font-size: 13px; line-height: 20px; margin-top: 6px;">Monitor: ${monitorName}</span>`
      : "";

    return `
            <tr>
              <td style="padding: 16px 20px;${divider} overflow-wrap: anywhere; word-break: break-word;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; table-layout: fixed;">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="display: inline-block; background-color: ${badge.backgroundColor}; color: ${badge.color}; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-right: 8px;">${number}</span>
                      <a href="${link}" style="color: #111111; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 24px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px;">${title}</a>
                      ${monitorLine}
                    </td>
                    <td width="52" style="text-align: right; vertical-align: middle; padding-left: 8px;">
                      <a href="${link}" style="color: #111111; font-size: 13px; line-height: 20px; text-decoration: underline;">View →</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          `;
  }
}
