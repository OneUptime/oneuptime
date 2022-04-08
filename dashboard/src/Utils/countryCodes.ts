const countryCodes = [
    {
        value: '',
        label: 'Select an country code',
    },
    {
        value: 'us',
        label: 'United States (+1)',
    },
    {
        value: 'af',
        label: 'Afghanistan (+93)',
    },
    {
        value: 'al',
        label: 'Albania (+355)',
    },
    {
        value: 'dz',
        label: 'Algeria (+213)',
    },
    {
        value: 'as',
        label: 'American Samoa (+1)',
    },
    {
        value: 'ad',
        label: 'Andorra (+376)',
    },
    {
        value: 'ao',
        label: 'Angola (+244)',
    },
    {
        value: 'ai',
        label: 'Anguilla (+1)',
    },
    {
        value: 'ag',
        label: 'Antigua and Barbuda (+1)',
    },
    {
        value: 'ar',
        label: 'Argentina (+54)',
    },
    {
        value: 'am',
        label: 'Armenia (+374)',
    },
    {
        value: 'aw',
        label: 'Aruba (+297)',
    },
    {
        value: 'au',
        label: 'Australia/Cocos/Christmas Island (+61)',
    },
    {
        value: 'at',
        label: 'Austria (+43)',
    },
    {
        value: 'az',
        label: 'Azerbaijan (+994)',
    },
    {
        value: 'bs',
        label: 'Bahamas (+1)',
    },
    {
        value: 'bh',
        label: 'Bahrain (+973)',
    },
    {
        value: 'bd',
        label: 'Bangladesh (+880)',
    },
    {
        value: 'bb',
        label: 'Barbados (+1)',
    },
    {
        value: 'by',
        label: 'Belarus (+375)',
    },
    {
        value: 'be',
        label: 'Belgium (+32)',
    },
    {
        value: 'bz',
        label: 'Belize (+501)',
    },
    {
        value: 'bj',
        label: 'Benin (+229)',
    },
    {
        value: 'bm',
        label: 'Bermuda (+1)',
    },
    {
        value: 'bo',
        label: 'Bolivia (+591)',
    },
    {
        value: 'ba',
        label: 'Bosnia and Herzegovina (+387)',
    },
    {
        value: 'bw',
        label: 'Botswana (+267)',
    },
    {
        value: 'br',
        label: 'Brazil (+55)',
    },
    {
        value: 'bn',
        label: 'Brunei (+673)',
    },
    {
        value: 'bg',
        label: 'Bulgaria (+359)',
    },
    {
        value: 'bf',
        label: 'Burkina Faso (+226)',
    },
    {
        value: 'bi',
        label: 'Burundi (+257)',
    },
    {
        value: 'kh',
        label: 'Cambodia (+855)',
    },
    {
        value: 'cm',
        label: 'Cameroon (+237)',
    },
    {
        value: 'ca',
        label: 'Canada (+1)',
    },
    {
        value: 'cv',
        label: 'Cape Verde (+238)',
    },
    {
        value: 'ky',
        label: 'Cayman Islands (+1)',
    },
    {
        value: 'cf',
        label: 'Central Africa (+236)',
    },
    {
        value: 'td',
        label: 'Chad (+235)',
    },
    {
        value: 'cl',
        label: 'Chile (+56)',
    },
    {
        value: 'cn',
        label: 'China (+86)',
    },
    {
        value: 'co',
        label: 'Colombia (+57)',
    },
    {
        value: 'km',
        label: 'Comoros (+269)',
    },
    {
        value: 'cg',
        label: 'Congo (+242)',
    },
    {
        value: 'cd',
        label: 'Congo, Dem Rep (+243)',
    },
    {
        value: 'cr',
        label: 'Costa Rica (+506)',
    },
    {
        value: 'hr',
        label: 'Croatia (+385)',
    },
    {
        value: 'cy',
        label: 'Cyprus (+357)',
    },
    {
        value: 'cz',
        label: 'Czech Republic (+420)',
    },
    {
        value: 'dk',
        label: 'Denmark (+45)',
    },
    {
        value: 'dj',
        label: 'Djibouti (+253)',
    },
    {
        value: 'dm',
        label: 'Dominica (+1)',
    },
    {
        value: 'do',
        label: 'Dominican Republic (+1)',
    },
    {
        value: 'eg',
        label: 'Egypt (+20)',
    },
    {
        value: 'sv',
        label: 'El Salvador (+503)',
    },
    {
        value: 'gq',
        label: 'Equatorial Guinea (+240)',
    },
    {
        value: 'ee',
        label: 'Estonia (+372)',
    },
    {
        value: 'et',
        label: 'Ethiopia (+251)',
    },
    {
        value: 'fo',
        label: 'Faroe Islands (+298)',
    },
    {
        value: 'fj',
        label: 'Fiji (+679)',
    },
    {
        value: 'fi',
        label: 'Finland/Aland Islands (+358)',
    },
    {
        value: 'fr',
        label: 'France (+33)',
    },
    {
        value: 'gf',
        label: 'French Guiana (+594)',
    },
    {
        value: 'pf',
        label: 'French Polynesia (+689)',
    },
    {
        value: 'ga',
        label: 'Gabon (+241)',
    },
    {
        value: 'gm',
        label: 'Gambia (+220)',
    },
    {
        value: 'ge',
        label: 'Georgia (+995)',
    },
    {
        value: 'de',
        label: 'Germany (+49)',
    },
    {
        value: 'gh',
        label: 'Ghana (+233)',
    },
    {
        value: 'gi',
        label: 'Gibraltar (+350)',
    },
    {
        value: 'gr',
        label: 'Greece (+30)',
    },
    {
        value: 'gl',
        label: 'Greenland (+299)',
    },
    {
        value: 'gd',
        label: 'Grenada (+1)',
    },
    {
        value: 'gp',
        label: 'Guadeloupe (+590)',
    },
    {
        value: 'gu',
        label: 'Guam (+1)',
    },
    {
        value: 'gt',
        label: 'Guatemala (+502)',
    },
    {
        value: 'gn',
        label: 'Guinea (+224)',
    },
    {
        value: 'gy',
        label: 'Guyana (+592)',
    },
    {
        value: 'ht',
        label: 'Haiti (+509)',
    },
    {
        value: 'hn',
        label: 'Honduras (+504)',
    },
    {
        value: 'hk',
        label: 'Hong Kong (+852)',
    },
    {
        value: 'hu',
        label: 'Hungary (+36)',
    },
    {
        value: 'is',
        label: 'Iceland (+354)',
    },
    {
        value: 'in',
        label: 'India (+91)',
    },
    {
        value: 'id',
        label: 'Indonesia (+62)',
    },
    {
        value: 'ir',
        label: 'Iran (+98)',
    },
    {
        value: 'iq',
        label: 'Iraq (+964)',
    },
    {
        value: 'ie',
        label: 'Ireland (+353)',
    },
    {
        value: 'il',
        label: 'Israel (+972)',
    },
    {
        value: 'it',
        label: 'Italy (+39)',
    },
    {
        value: 'jm',
        label: 'Jamaica (+1)',
    },
    {
        value: 'jp',
        label: 'Japan (+81)',
    },
    {
        value: 'jo',
        label: 'Jordan (+962)',
    },
    {
        value: 'ke',
        label: 'Kenya (+254)',
    },
    {
        value: 'kr',
        label: 'Korea, Republic of (+82)',
    },
    {
        value: 'kw',
        label: 'Kuwait (+965)',
    },
    {
        value: 'kg',
        label: 'Kyrgyzstan (+996)',
    },
    {
        value: 'la',
        label: 'Laos (+856)',
    },
    {
        value: 'lv',
        label: 'Latvia (+371)',
    },
    {
        value: 'lb',
        label: 'Lebanon (+961)',
    },
    {
        value: 'ls',
        label: 'Lesotho (+266)',
    },
    {
        value: 'lr',
        label: 'Liberia (+231)',
    },
    {
        value: 'ly',
        label: 'Libya (+218)',
    },
    {
        value: 'li',
        label: 'Liechtenstein (+423)',
    },
    {
        value: 'lt',
        label: 'Lithuania (+370)',
    },
    {
        value: 'lu',
        label: 'Luxembourg (+352)',
    },
    {
        value: 'mo',
        label: 'Macao (+853)',
    },
    {
        value: 'mk',
        label: 'Macedonia (+389)',
    },
    {
        value: 'mg',
        label: 'Madagascar (+261)',
    },
    {
        value: 'mw',
        label: 'Malawi (+265)',
    },
    {
        value: 'my',
        label: 'Malaysia (+60)',
    },
    {
        value: 'mv',
        label: 'Maldives (+960)',
    },
    {
        value: 'ml',
        label: 'Mali (+223)',
    },
    {
        value: 'mt',
        label: 'Malta (+356)',
    },
    {
        value: 'mq',
        label: 'Martinique (+596)',
    },
    {
        value: 'mr',
        label: 'Mauritania (+222)',
    },
    {
        value: 'mu',
        label: 'Mauritius (+230)',
    },
    {
        value: 'mx',
        label: 'Mexico (+52)',
    },
    {
        value: 'mc',
        label: 'Monaco (+377)',
    },
    {
        value: 'mn',
        label: 'Mongolia (+976)',
    },
    {
        value: 'me',
        label: 'Montenegro (+382)',
    },
    {
        value: 'ms',
        label: 'Montserrat (+1)',
    },
    {
        value: 'ma',
        label: 'Morocco/Western Sahara (+212)',
    },
    {
        value: 'mz',
        label: 'Mozambique (+258)',
    },
    {
        value: 'na',
        label: 'Namibia (+264)',
    },
    {
        value: 'np',
        label: 'Nepal (+977)',
    },
    {
        value: 'nl',
        label: 'Netherlands (+31)',
    },
    {
        value: 'nz',
        label: 'New Zealand (+64)',
    },
    {
        value: 'ni',
        label: 'Nicaragua (+505)',
    },
    {
        value: 'ne',
        label: 'Niger (+227)',
    },
    {
        value: 'ng',
        label: 'Nigeria (+234)',
    },
    {
        value: 'no',
        label: 'Norway (+47)',
    },
    {
        value: 'om',
        label: 'Oman (+968)',
    },
    {
        value: 'pk',
        label: 'Pakistan (+92)',
    },
    {
        value: 'ps',
        label: 'Palestinian Territory (+970)',
    },
    {
        value: 'pa',
        label: 'Panama (+507)',
    },
    {
        value: 'py',
        label: 'Paraguay (+595)',
    },
    {
        value: 'pe',
        label: 'Peru (+51)',
    },
    {
        value: 'ph',
        label: 'Philippines (+63)',
    },
    {
        value: 'pl',
        label: 'Poland (+48)',
    },
    {
        value: 'pt',
        label: 'Portugal (+351)',
    },
    {
        value: 'pr',
        label: 'Puerto Rico (+1)',
    },
    {
        value: 'qa',
        label: 'Qatar (+974)',
    },
    {
        value: 're',
        label: 'Reunion/Mayotte (+262)',
    },
    {
        value: 'ro',
        label: 'Romania (+40)',
    },
    {
        value: 'ru',
        label: 'Russia/Kazakhstan (+7)',
    },
    {
        value: 'rw',
        label: 'Rwanda (+250)',
    },
    {
        value: 'ws',
        label: 'Samoa (+685)',
    },
    {
        value: 'sm',
        label: 'San Marino (+378)',
    },
    {
        value: 'sa',
        label: 'Saudi Arabia (+966)',
    },
    {
        value: 'sn',
        label: 'Senegal (+221)',
    },
    {
        value: 'rs',
        label: 'Serbia (+381)',
    },
    {
        value: 'sc',
        label: 'Seychelles (+248)',
    },
    {
        value: 'sl',
        label: 'Sierra Leone (+232)',
    },
    {
        value: 'sg',
        label: 'Singapore (+65)',
    },
    {
        value: 'sk',
        label: 'Slovakia (+421)',
    },
    {
        value: 'si',
        label: 'Slovenia (+386)',
    },
    {
        value: 'za',
        label: 'South Africa (+27)',
    },
    {
        value: 'es',
        label: 'Spain (+34)',
    },
    {
        value: 'lk',
        label: 'Sri Lanka (+94)',
    },
    {
        value: 'kn',
        label: 'St Kitts and Nevis (+1)',
    },
    {
        value: 'lc',
        label: 'St Lucia (+1)',
    },
    {
        value: 'vc',
        label: 'St Vincent Grenadines (+1)',
    },
    {
        value: 'sd',
        label: 'Sudan (+249)',
    },
    {
        value: 'sr',
        label: 'Suriname (+597)',
    },
    {
        value: 'sz',
        label: 'Swaziland (+268)',
    },
    {
        value: 'se',
        label: 'Sweden (+46)',
    },
    {
        value: 'ch',
        label: 'Switzerland (+41)',
    },
    {
        value: 'sy',
        label: 'Syria (+963)',
    },
    {
        value: 'tw',
        label: 'Taiwan (+886)',
    },
    {
        value: 'tj',
        label: 'Tajikistan (+992)',
    },
    {
        value: 'tz',
        label: 'Tanzania (+255)',
    },
    {
        value: 'th',
        label: 'Thailand (+66)',
    },
    {
        value: 'tg',
        label: 'Togo (+228)',
    },
    {
        value: 'to',
        label: 'Tonga (+676)',
    },
    {
        value: 'tt',
        label: 'Trinidad and Tobago (+1)',
    },
    {
        value: 'tn',
        label: 'Tunisia (+216)',
    },
    {
        value: 'tr',
        label: 'Turkey (+90)',
    },
    {
        value: 'tc',
        label: 'Turks and Caicos Islands (+1)',
    },
    {
        value: 'ug',
        label: 'Uganda (+256)',
    },
    {
        value: 'ua',
        label: 'Ukraine (+380)',
    },
    {
        value: 'ae',
        label: 'United Arab Emirates (+971)',
    },
    {
        value: 'gb',
        label: 'United Kingdom (+44)',
    },
    {
        value: 'us',
        label: 'United States (+1)',
    },
    {
        value: 'uy',
        label: 'Uruguay (+598)',
    },
    {
        value: 'uz',
        label: 'Uzbekistan (+998)',
    },
    {
        value: 've',
        label: 'Venezuela (+58)',
    },
    {
        value: 'vn',
        label: 'Vietnam (+84)',
    },
    {
        value: 'vg',
        label: 'Virgin Islands, British (+1)',
    },
    {
        value: 'vi',
        label: 'Virgin Islands, U.S. (+1)',
    },
    {
        value: 'ye',
        label: 'Yemen (+967)',
    },
    {
        value: 'zm',
        label: 'Zambia (+260)',
    },
    {
        value: 'zw',
        label: 'Zimbabwe (+263)',
    },
];

export default countryCodes;
