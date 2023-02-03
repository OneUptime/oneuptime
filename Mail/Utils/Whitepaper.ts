//Note: This should go into a DB later.
import URL from 'Common/Types/API/URL';
import type WhitepaperType from '../Types/Whitepaper';

export default class Whitepaper {
    public static getWhitepapers(): Array<WhitepaperType> {
        return [
            {
                name: 'best-practices',
                link: URL.fromString(
                    'https://drive.google.com/open?id=1CppVP_hm1cRnquf4cb6c1mvaEpEiKo1z'
                ),
            },
            {
                name: 'digital-experience-monitoring',
                link: URL.fromString(
                    'https://drive.google.com/open?id=1CltwVDkXWIN0LWzlacoAU82rk3eKLhw-'
                ),
            },
            {
                name: 'planning-for-peak-performance',
                link: URL.fromString(
                    'https://drive.google.com/open?id=1pg2qXKM8H3ejH0LsPe_0412_eEt-j322'
                ),
            },
            {
                name: 'speed-equals-revenue',
                link: URL.fromString(
                    'https://drive.google.com/open?id=1F_LpxzOQ-8MZugnjOOybaRrPNX3L8HL-'
                ),
            },
            {
                name: 'website-monitoring',
                link: URL.fromString(
                    'https://drive.google.com/open?id=1MclG3TqtujRppWvRopP4WDlNrLN2LRbb'
                ),
            },
        ];
    }
}
