<table>
  <tr>
    <th rowspan="2">
      Running mode
    </th>
    <th rowspan="2">
      Rules order
    </th>
    <th colspan="2">
      OneUptime level configurations
    </th>
    <th colspan="2">
      Project level configurations
    </th>
    <th rowspan="2">
      Results
    </th>
  </tr>
  <tr>
    <th>
      Twilio credentials
    </th>
    <th>
      Enabled SMS/Call
    </th>
    <th>
      Twilio credentials + enable “send SMS with Twlio accounts”
    </th>
    <th>
      Enabled SMS/Call alerts (Billing page)
    </th>
  </tr>
<tbody>
  <tr>
    <td rowspan="4">
      SAAS
    </td>
    <td>
      1
    </td>
    <td>
    *
    </td>
    <td>
    *
    </td>
    <td>
    Set
    </td>
    <td>
    *
    </td>
    <td>
    Success (without checking daily limits)
    </td>
  </tr>
  <tr>
    <td>
    2
    </td>
    <td>
    Set
    </td>
    <td>
    Enabled
    </td>
    <td>
    Unset
    </td>
    <td>
    Enabled - CHARGE FOR ALERTS
    </td>
    <td>
    Success (after checking daily limits)
    </td>
  </tr>
  <tr>
    <td>
    3
    </td>
    <td>
    *
    </td>
    <td>
    *
    </td>
    <td>
    *
    </td>
    <td>
    Disabled
    </td>
    <td>
    Failure
    </td>
  </tr>
  <tr>
    <td>
    4
    </td>
    <td>
    *
    </td>
    <td>
    Disabled
    </td>
    <td>
    *
    </td>
    <td>
    *
    </td>
    <td>
    Failure
    </td>
  </tr>

  <tr>
    <td rowspan="3">
      Enterprise
    </td>
    <td>
      1
    </td>
    <td>
    *
    </td>
    <td>
    *
    </td>
    <td>
    Set
    </td>
    <td rowspan="3">
        Hidden
    </td>
    <td>
    Success (without checking daily limits)
    </td>
  </tr>
  <tr>
    <td>
    2
    </td>
    <td>
    Set
    </td>
    <td>
    Enabled
    </td>
    <td>
    *
    </td>
    <td>
    Success (After checking the daily limits)
    </td>
  </tr>
  <tr>
    <td>
    3
    </td>
    <td>
    *
    </td>
    <td>
    *
    </td>
    <td>
    *
    </td>
    <td>
    Failure
    </td>
  </tr>

</tbody>
</table>

-   In Enterprise Mode - We never charge for alerts.
-   In SaaS mode - we only charge for alerts ONLY IF global config is used.
-   Check limits for global config in both Enterprise and SaaS
-   Ideally in Enterprise Mode - Enable Alerts in Project Billing Page should be hidden. So, you should NOT check if the alerts are enabled or disabled for the project. Just check if the alerts are enabled / disabled in admin dashboard (if using global config). If using local config (project config) - do not check if the alerts are enabled or disabled.

In general, under the SAAS mode, the SMS/Call alerts can fail for one of the following reasons:
1- The custom/global twilio settings are not configured.
2- SMS/Call alerts are disabled in the global configurations, and the custom twilio settings are not set.
3- SMS/Call alerts are disabled for a project (from billing page), and the custom twilio settings are not set.
4- The project's balance is not enough, and the custom twilio settings are not set.
5- The targeted phone number doesn't comply with the policy selected in the billing page (high risk countries not selected), and the custom twilio settings are not set.
6- the alert phone number is not set (in case of on-call team alerts).
7- If the API call fail for any reason (wrong credentials, service down etc...)

The same reasons, excepet for 3, 4 and 5 , can cause the failure of alerts under enterprise mode.

Return back to the [main README](../README.md)
