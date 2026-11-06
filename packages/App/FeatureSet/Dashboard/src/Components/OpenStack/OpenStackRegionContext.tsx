import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Context,
  FunctionComponent,
  ReactElement,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Location,
  NavigationType,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import {
  OPENSTACK_REGION_QUERY_PARAM,
  getOpenStackRegionFromSearch,
} from "../../Pages/OpenStack/Utils/OpenStackRegion";
import { fetchOpenStackRegionOptions } from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";

/*
 * The region a cloud's pages read, for every page under the cloud's layout.
 *
 * The address holds the choice, and this keeps it there. A link inside the product knows
 * nothing about regions: the side menu, a chip, a row of Needs attention. Each one lands
 * on an address with no region in it, and the layout, which stays mounted across a
 * cloud's pages, writes the region back. So no page has to remember to carry it, and
 * every page's first read already has it, because it asks this rather than the address.
 *
 * An address that names a region changes it (the Regions card's links do). The picker
 * clears it, and so does going back to an address from before it was chosen.
 */

export interface OpenStackRegionState {
  // Null reads the whole cloud.
  region: string | null;
  // The cloud's regions, once read. Empty until then, and when it reports none.
  regions: Array<string>;
  setRegion: (region: string | null) => void;
}

const OpenStackRegionContext: Context<OpenStackRegionState | null> =
  createContext<OpenStackRegionState | null>(null);

export interface ComponentProps {
  openStackCloudId: ObjectID;
  children: ReactNode;
}

export const OpenStackRegionProvider: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();
  const [region, setRegionState] = useState<string | null>(() => {
    return getOpenStackRegionFromSearch(window.location.search);
  });
  const [regions, setRegions] = useState<Array<string>>([]);

  const setRegion: (next: string | null) => void = (
    next: string | null,
  ): void => {
    setRegionState(next);
    Navigation.setQueryString({ [OPENSTACK_REGION_QUERY_PARAM]: next });
  };

  useEffect(() => {
    /*
     * The address as it is now, not as the router last saw it: a table's filters write
     * theirs behind the router's back, and this must not undo them.
     */
    const inAddress: string | null = getOpenStackRegionFromSearch(
      window.location.search,
    );
    if (inAddress) {
      if (inAddress !== region) {
        setRegionState(inAddress);
      }
      return;
    }
    if (region) {
      // Back to an address that read every region reads every region again.
      if (navigationType === NavigationType.Pop) {
        setRegionState(null);
        return;
      }
      Navigation.setQueryString({ [OPENSTACK_REGION_QUERY_PARAM]: region });
    }
  }, [location.pathname, location.search, region]);

  useEffect(() => {
    let ignore: boolean = false;
    fetchOpenStackRegionOptions(props.openStackCloudId)
      .then((options: Array<DropdownOption>) => {
        if (!ignore) {
          setRegions(
            options.map((option: DropdownOption): string => {
              return String(option.value);
            }),
          );
        }
      })
      .catch(() => {
        // No picker is better than no page: a read of the region still works by address.
      });
    return () => {
      ignore = true;
    };
  }, [props.openStackCloudId.toString()]);

  /*
   * A region the cloud no longer has reads nothing on any page, so an old link falls back
   * to the whole cloud. Only once the regions are known: not knowing them proves nothing.
   */
  useEffect(() => {
    if (region && regions.length > 0 && !regions.includes(region)) {
      setRegion(null);
    }
  }, [region, regions.join(",")]);

  const state: OpenStackRegionState = useMemo(() => {
    return { region, regions, setRegion };
  }, [region, regions.join(",")]);

  return (
    <OpenStackRegionContext.Provider value={state}>
      {props.children}
    </OpenStackRegionContext.Provider>
  );
};

/*
 * The region this page reads. A page drawn outside the layout still reads the address,
 * and its choice has nowhere to go.
 */
export function useOpenStackRegion(): OpenStackRegionState {
  const state: OpenStackRegionState | null = useContext(OpenStackRegionContext);
  if (state) {
    return state;
  }
  return {
    region: getOpenStackRegionFromSearch(window.location.search),
    regions: [],
    setRegion: (next: string | null): void => {
      Navigation.setQueryString({ [OPENSTACK_REGION_QUERY_PARAM]: next });
    },
  };
}
