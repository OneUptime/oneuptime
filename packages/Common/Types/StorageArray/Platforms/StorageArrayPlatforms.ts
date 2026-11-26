import { StorageArrayPlatform } from "../StorageArrayPlatform";
import PureStorageFlashArrayPlatform from "./PureStorage/FlashArray/FlashArrayPlatform";
import PureStorageFlashBladePlatform from "./PureStorage/FlashBlade/FlashBladePlatform";

/*
 * Every storage platform OneUptime ships: a new one is its folder beside
 * these and one line here (StorageArrayPlatform.ts says what else a
 * platform brings). StorageArrayPlatformRegistry reads this list; nothing
 * else should.
 *
 * The first is the default platform: the one the agent assumes when its
 * .env names none (docker-compose.yml's STORAGE_SYSTEM default), and the
 * one a page reads an array of a platform OneUptime cannot tell as.
 */
export const BUILT_IN_STORAGE_ARRAY_PLATFORMS: ReadonlyArray<StorageArrayPlatform> =
  [PureStorageFlashArrayPlatform, PureStorageFlashBladePlatform];
