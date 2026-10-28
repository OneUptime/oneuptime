import PageComponentProps from "../../PageComponentProps";
import { getNetworkAddressNameFormFields } from "../../../Components/NetworkTraffic/NetworkAddressNameFormFields";
import { TrafficAddressText } from "../../../Components/NetworkTraffic/TrafficAddress";
import NetworkAddressName from "Common/Models/DatabaseModels/NetworkAddressName";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const addressNamesDocumentation: string = `
### Where the names on the Traffic pages come from

Network > Traffic shows an address by its name when OneUptime knows one, with the address beside it. The first of these that names an address wins:

1. **A name on this page** for that exact address.
2. **Your inventory**: a network device polled at the address or listing it in its Other Addresses, then a host whose agent reports it, a cloud resource your cloud lists it for, a Kubernetes node or pod.
3. **DNS**: the address's reverse DNS name, looked up by the probe that received the flows, on its own network. A name is used only when it points back to the address.

An address nothing names is shown as itself.

### Subnets

Name a subnet, like \`10.18.167.0/24\` or \`2001:db8:1::/48\`, to say where its addresses are: "Mumbai office" shows beside every address in it that has traffic, and never hides a name one of them has. When subnets overlap, the narrowest one is shown.
`;

/*
 * Network > Settings > Address Names (issue #5340): the names people give
 * addresses and subnets that nothing else names - a partner's VPN gateway,
 * a SaaS endpoint, the guest Wi-Fi. A plain list: a name and an address or
 * subnet, added here or with "Name this address" on a Traffic page.
 */
const NetworkAddressNamesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkAddressName>
        modelType={NetworkAddressName}
        id="network-address-names-table"
        name="Settings > Address Names"
        userPreferencesKey="network-address-names-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        cardProps={{
          title: "Address Names",
          description:
            "Names for addresses and subnets your inventory and DNS do not name. Traffic shows an address by its name, with the address beside it.",
        }}
        helpContent={{
          title: "Where traffic names come from",
          description:
            "The order names are picked in, and what a subnet's name does.",
          markdown: addressNamesDocumentation,
        }}
        noItemsMessage="No address names yet. Name an address here, or with Name this address on a Traffic page."
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        searchableFields={["name", "address"]}
        formFields={getNetworkAddressNameFormFields()}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { address: true },
            title: "Address or Subnet",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
            getElement: (item: NetworkAddressName): ReactElement => {
              return <IsolatedText text={item.name || ""} />;
            },
          },
          {
            field: { address: true },
            title: "Address or Subnet",
            type: FieldType.Text,
            getElement: (item: NetworkAddressName): ReactElement => {
              return (
                <TrafficAddressText
                  address={item.address || ""}
                  className="text-sm text-gray-700"
                />
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkAddressNamesPage;
