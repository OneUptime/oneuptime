import CardSelect from "Common/UI/Components/CardSelect/CardSelect";
import React, { FunctionComponent, ReactElement } from "react";
import {
  DISCOVERY_SCAN_METHOD_OPTIONS,
  DiscoveryScanMethod,
  getDiscoveryScanMethod,
  isSnmpEnabledForMethod,
  readDiscoveryScanMethod,
} from "../../Pages/NetworkDevice/DiscoveryScanMethod";

/*
 * The Start Scan form's "Scan method": ICMP (ping) or SNMP, as two cards side
 * by side (one above the other on a phone).
 *
 * The product's card picker, CardSelect, draws them - the same cards the
 * monitor type, the ingestion key type and a monitor secret's access are
 * picked with - and this only translates between its option values and the
 * column the form writes: the scan's isSnmpEnabled, true for SNMP and false
 * for ICMP. Keeping the form value a real boolean is what lets every rule
 * that already reads it (the SNMP Credentials step, the credential list's
 * showIf, the clearing of credentials when SNMP is left) keep reading it
 * through ScanModeUtil, unchanged.
 *
 * It reports only a pick that changes the method. It never writes on its own
 * when it is drawn: the form starts on ICMP from its initial values
 * (DiscoveryScanMethod.ts), and an Edit dialog shows the scan as stored.
 */
export interface ComponentProps {
  // The scan's isSnmpEnabled as the form holds it.
  isSnmpEnabled: boolean | null | undefined;
  onChange: (isSnmpEnabled: boolean) => void;
  // The field's label, which names the group of cards for a screen reader.
  ariaLabelledby?: string | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
}

const DiscoveryScanMethodChoice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const method: DiscoveryScanMethod = getDiscoveryScanMethod({
    isSnmpEnabled: props.isSnmpEnabled,
  });

  return (
    <CardSelect
      dataTestId="discovery-scan-method"
      options={DISCOVERY_SCAN_METHOD_OPTIONS}
      value={method}
      singleColumn={true}
      ariaLabelledby={props.ariaLabelledby}
      tabIndex={props.tabIndex}
      error={props.error}
      onChange={(value: string) => {
        const picked: DiscoveryScanMethod | null =
          readDiscoveryScanMethod(value);

        // Picking the card already chosen changes nothing.
        if (!picked || picked === method) {
          return;
        }

        props.onChange(isSnmpEnabledForMethod(picked));
      }}
    />
  );
};

export default DiscoveryScanMethodChoice;
