import Countries from '../../Types/Countries';

describe('enum Countries', () => {
    test('each country should have a valid corresponding name ', () => {
        expect(Countries['Afghanistan']).toEqual('Afghanistan');
        expect(Countries['Åland Islands']).toEqual('Åland Islands');
        expect(Countries['Albania']).toEqual('Albania');
        expect(Countries['Algeria']).toEqual('Algeria');
        expect(Countries['American Samoa']).toEqual('American Samoa');
        expect(Countries['Andorra']).toEqual('Andorra');
        expect(Countries['Angola']).toEqual('Angola');
        expect(Countries['Anguilla']).toEqual('Anguilla');
        expect(Countries['Antarctica']).toEqual('Antarctica');
        expect(Countries['Antigua and Barbuda']).toEqual('Antigua and Barbuda');
        expect(Countries['Argentina']).toEqual('Argentina');
        expect(Countries['Armenia']).toEqual('Armenia');
        expect(Countries['Aruba']).toEqual('Aruba');
        expect(Countries['Australia']).toEqual('Australia');
        expect(Countries['Austria']).toEqual('Austria');
        expect(Countries['Azerbaijan']).toEqual('Azerbaijan');
        expect(Countries['Bahamas']).toEqual('Bahamas');
        expect(Countries['Bahrain']).toEqual('Bahrain');
        expect(Countries['Bangladesh']).toEqual('Bangladesh');
        expect(Countries['Barbados']).toEqual('Barbados');
        expect(Countries['Belarus']).toEqual('Belarus');
        expect(Countries['Belgium']).toEqual('Belgium');
        expect(Countries['Belize']).toEqual('Belize');
        expect(Countries['Benin']).toEqual('Benin');
        expect(Countries['Bermuda']).toEqual('Bermuda');
        expect(Countries['Bhutan']).toEqual('Bhutan');
        expect(Countries['Bolivia']).toEqual('Bolivia');
        expect(Countries['Bosnia and Herzegovina']).toEqual(
            'Bosnia and Herzegovina'
        );
        expect(Countries['Botswana']).toEqual('Botswana');
        expect(Countries['Bouvet Island']).toEqual('Bouvet Island');
        expect(Countries['Brazil']).toEqual('Brazil');
        expect(Countries['British Indian Ocean Territory']).toEqual(
            'British Indian Ocean Territory'
        );
        expect(Countries['Brunei Darussalam']).toEqual('Brunei Darussalam');
        expect(Countries['Bulgaria']).toEqual('Bulgaria');
        expect(Countries['Burkina Faso']).toEqual('Burkina Faso');
        expect(Countries['Burundi']).toEqual('Burundi');
        expect(Countries['Cambodia']).toEqual('Cambodia');
        expect(Countries['Cameroon']).toEqual('Cameroon');
        expect(Countries['Canada']).toEqual('Canada');
        expect(Countries['Cape Verde']).toEqual('Cape Verde');
        expect(Countries['Cayman Islands']).toEqual('Cayman Islands');
        expect(Countries['Central African Republic']).toEqual(
            'Central African Republic'
        );
        expect(Countries['Chad']).toEqual('Chad');
        expect(Countries['Chile']).toEqual('Chile');
        expect(Countries['China']).toEqual('China');
        expect(Countries['Christmas Island']).toEqual('Christmas Island');
        expect(Countries['Cocos (Keeling) Islands']).toEqual(
            'Cocos (Keeling) Islands'
        );
        expect(Countries['Colombia']).toEqual('Colombia');
        expect(Countries['Comoros']).toEqual('Comoros');
        expect(Countries['Congo']).toEqual('Congo');
        expect(Countries['Congo, The Democratic Republic of the']).toEqual(
            'Congo, The Democratic Republic of the'
        );
        expect(Countries['Cook Islands']).toEqual('Cook Islands');
        expect(Countries['Costa Rica']).toEqual('Costa Rica');
        expect(Countries["Cote d'Ivoire"]).toEqual("Cote d'Ivoire");
        expect(Countries['Croatia']).toEqual('Croatia');
        expect(Countries['Cuba']).toEqual('Cuba');
        expect(Countries['Cyprus']).toEqual('Cyprus');
        expect(Countries['Czech Republic']).toEqual('Czech Republic');
        expect(Countries['Denmark']).toEqual('Denmark');
        expect(Countries['Djibouti']).toEqual('Djibouti');
        expect(Countries['Dominica']).toEqual('Dominica');
        expect(Countries['Dominican Republic']).toEqual('Dominican Republic');
        expect(Countries['Ecuador']).toEqual('Ecuador');
        expect(Countries['Egypt']).toEqual('Egypt');
        expect(Countries['El Salvador']).toEqual('El Salvador');
        expect(Countries['Equatorial Guinea']).toEqual('Equatorial Guinea');
        expect(Countries['Eritrea']).toEqual('Eritrea');
        expect(Countries['Estonia']).toEqual('Estonia');
        expect(Countries['Ethiopia']).toEqual('Ethiopia');
        expect(Countries['Falkland Islands (Malvinas)']).toEqual(
            'Falkland Islands (Malvinas)'
        );
        expect(Countries['Faroe Islands']).toEqual('Faroe Islands');
        expect(Countries['Fiji']).toEqual('Fiji');
        expect(Countries['Finland']).toEqual('Finland');
        expect(Countries['France']).toEqual('France');
        expect(Countries['French Guiana']).toEqual('French Guiana');
        expect(Countries['French Polynesia']).toEqual('French Polynesia');
        expect(Countries['French Southern Territories']).toEqual(
            'French Southern Territories'
        );
        expect(Countries['Gabon']).toEqual('Gabon');
        expect(Countries['Gambia']).toEqual('Gambia');
        expect(Countries['Georgia']).toEqual('Georgia');
        expect(Countries['Germany']).toEqual('Germany');
        expect(Countries['Ghana']).toEqual('Ghana');
        expect(Countries['Gibraltar']).toEqual('Gibraltar');
        expect(Countries['Greece']).toEqual('Greece');
        expect(Countries['Greenland']).toEqual('Greenland');
        expect(Countries['Grenada']).toEqual('Grenada');
        expect(Countries['Guadeloupe']).toEqual('Guadeloupe');
        expect(Countries['Guam']).toEqual('Guam');
        expect(Countries['Guatemala']).toEqual('Guatemala');
        expect(Countries['Guernsey']).toEqual('Guernsey');
        expect(Countries['Guinea']).toEqual('Guinea');
        expect(Countries['Guinea-Bissau']).toEqual('Guinea-Bissau');
        expect(Countries['Guyana']).toEqual('Guyana');
        expect(Countries['Haiti']).toEqual('Haiti');
        expect(Countries['Heard Island and Mcdonald Islands']).toEqual(
            'Heard Island and Mcdonald Islands'
        );
        expect(Countries['Holy See (Vatican City State)']).toEqual(
            'Holy See (Vatican City State)'
        );
        expect(Countries['Honduras']).toEqual('Honduras');
        expect(Countries['Hong Kong']).toEqual('Hong Kong');
        expect(Countries['Hungary']).toEqual('Hungary');
        expect(Countries['Iceland']).toEqual('Iceland');
        expect(Countries['India']).toEqual('India');
        expect(Countries['Indonesia']).toEqual('Indonesia');
        expect(Countries['Iran']).toEqual('Iran');
        expect(Countries['Iraq']).toEqual('Iraq');
        expect(Countries['Ireland']).toEqual('Ireland');
        expect(Countries['Isle of Man']).toEqual('Isle of Man');
        expect(Countries['Israel']).toEqual('Israel');
        expect(Countries['Italy']).toEqual('Italy');
        expect(Countries['Jamaica']).toEqual('Jamaica');
        expect(Countries['Japan']).toEqual('Japan');
        expect(Countries['Jersey']).toEqual('Jersey');
        expect(Countries['Jordan']).toEqual('Jordan');
        expect(Countries['Kazakhstan']).toEqual('Kazakhstan');
        expect(Countries['Kenya']).toEqual('Kenya');
        expect(Countries['Kiribati']).toEqual('Kiribati');
        expect(Countries['South Korea']).toEqual('South Korea');
        expect(Countries['North Korea']).toEqual('North Korea');
        expect(Countries['Kuwait']).toEqual('Kuwait');
        expect(Countries['Kyrgyzstan']).toEqual('Kyrgyzstan');
        expect(Countries["Lao People's Democratic Republic"]).toEqual(
            "Lao People's Democratic Republic"
        );
        expect(Countries['Latvia']).toEqual('Latvia');
        expect(Countries['Lebanon']).toEqual('Lebanon');
        expect(Countries['Lesotho']).toEqual('Lesotho');
        expect(Countries['Liberia']).toEqual('Liberia');
        expect(Countries['Libyan Arab Jamahiriya']).toEqual(
            'Libyan Arab Jamahiriya'
        );
        expect(Countries['Liechtenstein']).toEqual('Liechtenstein');
        expect(Countries['Lithuania']).toEqual('Lithuania');
        expect(Countries['Luxembourg']).toEqual('Luxembourg');
        expect(Countries['Macao']).toEqual('Macao');
        expect(Countries['Macedonia']).toEqual('Macedonia');
        expect(Countries['Madagascar']).toEqual('Madagascar');
        expect(Countries['Malawi']).toEqual('Malawi');
        expect(Countries['Malaysia']).toEqual('Malaysia');
        expect(Countries['Maldives']).toEqual('Maldives');
        expect(Countries['Mali']).toEqual('Mali');
        expect(Countries['Malta']).toEqual('Malta');
        expect(Countries['Marshall Islands']).toEqual('Marshall Islands');
        expect(Countries['Martinique']).toEqual('Martinique');
        expect(Countries['Mauritania']).toEqual('Mauritania');
        expect(Countries['Mauritius']).toEqual('Mauritius');
        expect(Countries['Mayotte']).toEqual('Mayotte');
        expect(Countries['Mexico']).toEqual('Mexico');
        expect(Countries['Micronesia']).toEqual('Micronesia');
        expect(Countries['Moldova']).toEqual('Moldova');
        expect(Countries['Monaco']).toEqual('Monaco');
        expect(Countries['Mongolia']).toEqual('Mongolia');
        expect(Countries['Montserrat']).toEqual('Montserrat');
        expect(Countries['Morocco']).toEqual('Morocco');
        expect(Countries['Mozambique']).toEqual('Mozambique');
        expect(Countries['Myanmar']).toEqual('Myanmar');
        expect(Countries['Namibia']).toEqual('Namibia');
        expect(Countries['Nauru']).toEqual('Nauru');
        expect(Countries['Nepal']).toEqual('Nepal');
        expect(Countries['Netherlands']).toEqual('Netherlands');
        expect(Countries['Netherlands Antilles']).toEqual(
            'Netherlands Antilles'
        );
        expect(Countries['New Caledonia']).toEqual('New Caledonia');
        expect(Countries['New Zealand']).toEqual('New Zealand');
        expect(Countries['Nicaragua']).toEqual('Nicaragua');
        expect(Countries['Niger']).toEqual('Niger');
        expect(Countries['Nigeria']).toEqual('Nigeria');
        expect(Countries['Niue']).toEqual('Niue');
        expect(Countries['Norfolk Island']).toEqual('Norfolk Island');
        expect(Countries['Northern Mariana Islands']).toEqual(
            'Northern Mariana Islands'
        );
        expect(Countries['Norway']).toEqual('Norway');
        expect(Countries['Oman']).toEqual('Oman');
        expect(Countries['Pakistan']).toEqual('Pakistan');
        expect(Countries['Palau']).toEqual('Palau');
        expect(Countries['Palestine State']).toEqual('Palestine State');
        expect(Countries['Panama']).toEqual('Panama');
        expect(Countries['Papua New Guinea']).toEqual('Papua New Guinea');
        expect(Countries['Paraguay']).toEqual('Paraguay');
        expect(Countries['Peru']).toEqual('Peru');
        expect(Countries['Philippines']).toEqual('Philippines');
        expect(Countries['Pitcairn']).toEqual('Pitcairn');
        expect(Countries['Poland']).toEqual('Poland');
        expect(Countries['Portugal']).toEqual('Portugal');
        expect(Countries['Puerto Rico']).toEqual('Puerto Rico');
        expect(Countries['Qatar']).toEqual('Qatar');
        expect(Countries['Reunion']).toEqual('Reunion');
        expect(Countries['Romania']).toEqual('Romania');
        expect(Countries['Russian Federation']).toEqual('Russian Federation');
        expect(Countries['Rwanda']).toEqual('Rwanda');
        expect(Countries['Saint Helena']).toEqual('Saint Helena');
        expect(Countries['Saint Kitts and Nevis']).toEqual(
            'Saint Kitts and Nevis'
        );
        expect(Countries['Saint Lucia']).toEqual('Saint Lucia');
        expect(Countries['Saint Pierre and Miquelon']).toEqual(
            'Saint Pierre and Miquelon'
        );
        expect(Countries['Saint Vincent and the Grenadines']).toEqual(
            'Saint Vincent and the Grenadines'
        );
        expect(Countries['Samoa']).toEqual('Samoa');
        expect(Countries['San Marino']).toEqual('San Marino');
        expect(Countries['Sao Tome and Principe']).toEqual(
            'Sao Tome and Principe'
        );
        expect(Countries['Saudi Arabia']).toEqual('Saudi Arabia');
        expect(Countries['Senegal']).toEqual('Senegal');
        expect(Countries['Serbia and Montenegro']).toEqual(
            'Serbia and Montenegro'
        );
        expect(Countries['Seychelles']).toEqual('Seychelles');
        expect(Countries['Sierra Leone']).toEqual('Sierra Leone');
        expect(Countries['Singapore']).toEqual('Singapore');
        expect(Countries['Slovakia']).toEqual('Slovakia');
        expect(Countries['Slovenia']).toEqual('Slovenia');
        expect(Countries['Solomon Islands']).toEqual('Solomon Islands');
        expect(Countries['Somalia']).toEqual('Somalia');
        expect(Countries['South Africa']).toEqual('South Africa');
        expect(
            Countries['South Georgia and the South Sandwich Islands']
        ).toEqual('South Georgia and the South Sandwich Islands');
        expect(Countries['Spain']).toEqual('Spain');
        expect(Countries['Sri Lanka']).toEqual('Sri Lanka');
        expect(Countries['Sudan']).toEqual('Sudan');
        expect(Countries['Suriname']).toEqual('Suriname');
        expect(Countries['Svalbard and Jan Mayen']).toEqual(
            'Svalbard and Jan Mayen'
        );
        expect(Countries['Swaziland']).toEqual('Swaziland');
        expect(Countries['Sweden']).toEqual('Sweden');
        expect(Countries['Switzerland']).toEqual('Switzerland');
        expect(Countries['Syrian Arab Republic']).toEqual(
            'Syrian Arab Republic'
        );
        expect(Countries['Taiwan, Province of China']).toEqual(
            'Taiwan, Province of China'
        );
        expect(Countries['Tajikistan']).toEqual('Tajikistan');
        expect(Countries['Tanzania']).toEqual('Tanzania');
        expect(Countries['Thailand']).toEqual('Thailand');
        expect(Countries['Timor-Leste']).toEqual('Timor-Leste');
        expect(Countries['Togo']).toEqual('Togo');
        expect(Countries['Tokelau']).toEqual('Tokelau');
        expect(Countries['Tonga']).toEqual('Tonga');
        expect(Countries['Trinidad and Tobago']).toEqual('Trinidad and Tobago');
        expect(Countries['Tunisia']).toEqual('Tunisia');
        expect(Countries['Turkey']).toEqual('Turkey');
        expect(Countries['Turkmenistan']).toEqual('Turkmenistan');
        expect(Countries['Turks and Caicos Islands']).toEqual(
            'Turks and Caicos Islands'
        );
        expect(Countries['Tuvalu']).toEqual('Tuvalu');
        expect(Countries['Uganda']).toEqual('Uganda');
        expect(Countries['Ukraine']).toEqual('Ukraine');
        expect(Countries['United Arab Emirates']).toEqual(
            'United Arab Emirates'
        );
        expect(Countries['United Kingdom']).toEqual('United Kingdom');
        expect(Countries['United States']).toEqual('United States');
        expect(Countries['United States Minor Outlying Islands']).toEqual(
            'United States Minor Outlying Islands'
        );
        expect(Countries['Uruguay']).toEqual('Uruguay');
        expect(Countries['Uzbekistan']).toEqual('Uzbekistan');
        expect(Countries['Vanuatu']).toEqual('Vanuatu');
        expect(Countries['Venezuela']).toEqual('Venezuela');
        expect(Countries['Viet Nam']).toEqual('Viet Nam');
        expect(Countries['Virgin Islands, British']).toEqual(
            'Virgin Islands, British'
        );
        expect(Countries['Virgin Islands, U.S.']).toEqual(
            'Virgin Islands, U.S.'
        );
        expect(Countries['Wallis and Futuna']).toEqual('Wallis and Futuna');
        expect(Countries['Western Sahara']).toEqual('Western Sahara');
        expect(Countries['Yemen']).toEqual('Yemen');
        expect(Countries['Zambia']).toEqual('Zambia');
        expect(Countries['Zimbabwe']).toEqual('Zimbabwe');
    });
});
