import { FindOperator } from 'typeorm/find-options/FindOperator';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';
import { JSONObject, ObjectType } from './JSON';

export default class Domain extends DatabaseProperty {
    private _domain: string = '';
    public get domain(): string {
        return this._domain;
    }
    public set domain(v: string) {
        const isValid: boolean = Domain.isValidDomain(v);
        if (!isValid) {
            throw new BadDataException('Domain is not in valid format.');
        }
        this._domain = v;
    }

    public static isValidDomain(domain: string): boolean {
        if (!domain.includes('.')) {
            return false;
        }

        const firstTLDs: Array<string> =
            'ac|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|be|bf|bg|bh|bi|bj|bm|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|cl|cm|cn|co|cr|cu|cv|cw|cx|cz|de|dj|dk|dm|do|dz|ec|ee|eg|es|et|eu|fi|fm|fo|fr|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|im|in|io|iq|ir|is|it|je|jo|jp|kg|ki|km|kn|kp|kr|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|na|nc|ne|nf|ng|nl|no|nr|nu|nz|om|pa|pe|pf|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|sk|sl|sm|sn|so|sr|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|yt'.split(
                '|'
            );
        const secondTLDs: Array<string> =
            'ac|academy|accountant|accountants|actor|adult|ag|agency|ai|airforce|am|amsterdam|apartments|app|archi|army|art|asia|associates|at|attorney|au|auction|auto|autos|baby|band|bar|barcelona|bargains|basketball|bayern|be|beauty|beer|berlin|best|bet|bid|bike|bingo|bio|biz|biz.pl|black|blog|blue|boats|boston|boutique|broker|build|builders|business|buzz|bz|ca|cab|cafe|camera|camp|capital|car|cards|care|careers|cars|casa|cash|casino|catering|cc|center|ceo|ch|charity|chat|cheap|church|city|cl|claims|cleaning|clinic|clothing|cloud|club|cn|co|co.in|co.jp|co.kr|co.nz|co.uk|co.za|coach|codes|coffee|college|com|com.ag|com.au|com.br|com.bz|com.cn|com.co|com.es|com.ky|com.mx|com.pe|com.ph|com.pl|com.ru|com.tw|community|company|computer|condos|construction|consulting|contact|contractors|cooking|cool|country|coupons|courses|credit|creditcard|cricket|cruises|cymru|cz|dance|date|dating|de|deals|degree|delivery|democrat|dental|dentist|design|dev|diamonds|digital|direct|directory|discount|dk|doctor|dog|domains|download|earth|education|email|energy|engineer|engineering|enterprises|equipment|es|estate|eu|events|exchange|expert|exposed|express|fail|faith|family|fan|fans|farm|fashion|film|finance|financial|firm.in|fish|fishing|fit|fitness|flights|florist|fm|football|forsale|foundation|fr|fun|fund|furniture|futbol|fyi|gallery|games|garden|gay|gen.in|gg|gifts|gives|giving|glass|global|gmbh|gold|golf|graphics|gratis|green|gripe|group|gs|guide|guru|hair|haus|health|healthcare|hockey|holdings|holiday|homes|horse|hospital|host|house|idv.tw|immo|immobilien|in|inc|ind.in|industries|info|info.pl|ink|institute|insure|international|investments|io|irish|ist|istanbul|it|jetzt|jewelry|jobs|jp|kaufen|kids|kim|kitchen|kiwi|kr|ky|la|land|lat|law|lawyer|lease|legal|lgbt|life|lighting|limited|limo|live|llc|llp|loan|loans|london|love|ltd|ltda|luxury|maison|makeup|management|market|marketing|mba|me|me.uk|media|melbourne|memorial|men|menu|miami|mobi|moda|moe|money|monster|mortgage|motorcycles|movie|ms|music|mx|nagoya|name|navy|ne.kr|net|net.ag|net.au|net.br|net.bz|net.cn|net.co|net.in|net.ky|net.nz|net.pe|net.ph|net.pl|net.ru|network|news|ninja|nl|no|nom.co|nom.es|nom.pe|nrw|nyc|okinawa|one|onl|online|org|org.ag|org.au|org.cn|org.es|org.in|org.ky|org.nz|org.pe|org.ph|org.pl|org.ru|org.uk|organic|page|paris|partners|parts|party|pe|pet|ph|photography|photos|pictures|pink|pizza|pl|place|plumbing|plus|poker|porn|press|pro|productions|promo|properties|protection|pub|pw|quebec|quest|racing|re.kr|realestate|recipes|red|rehab|reise|reisen|rent|rentals|repair|report|republican|rest|restaurant|review|reviews|rich|rip|rocks|rodeo|rugby|run|ryukyu|sale|salon|sarl|school|schule|science|se|security|services|sex|sg|sh|shiksha|shoes|shop|shopping|show|singles|site|ski|skin|soccer|social|software|solar|solutions|space|storage|store|stream|studio|study|style|supplies|supply|support|surf|surgery|sydney|systems|tax|taxi|team|tech|technology|tel|tennis|theater|theatre|tickets|tienda|tips|tires|today|tokyo|tools|tours|town|toys|trade|trading|training|travel|tube|tv|tw|uk|university|uno|us|vacations|vc|vegas|ventures|vet|viajes|video|villas|vin|vip|vision|vodka|vote|voto|voyage|wales|watch|web|webcam|website|wedding|wiki|win|wine|work|works|world|ws|wtf|xxx|xyz|yachts|yoga|yokohama|zone|移动|dev|com|edu|gov|net|mil|org|nom|sch|caa|res|off|gob|int|tur|ip6|uri|urn|asn|act|nsw|qld|tas|vic|pro|biz|adm|adv|agr|arq|art|ato|bio|bmd|cim|cng|cnt|ecn|eco|emp|eng|esp|etc|eti|far|fnd|fot|fst|g12|ggf|imb|ind|inf|jor|jus|leg|lel|mat|med|mus|not|ntr|odo|ppg|psc|psi|qsl|rec|slg|srv|teo|tmp|trd|vet|zlg|web|ltd|sld|pol|fin|k12|lib|pri|aip|fie|eun|sci|prd|cci|pvt|mod|idv|rel|sex|gen|nic|abr|bas|cal|cam|emr|fvg|laz|lig|lom|mar|mol|pmn|pug|sar|sic|taa|tos|umb|vao|vda|ven|mie|北海道|和歌山|神奈川|鹿児島|ass|rep|tra|per|ngo|soc|grp|plc|its|air|and|bus|can|ddr|jfk|mad|nrw|nyc|ski|spy|tcm|ulm|usa|war|fhs|vgs|dep|eid|fet|fla|flå|gol|hof|hol|sel|vik|cri|iwi|ing|abo|fam|gok|gon|gop|gos|aid|atm|gsm|sos|elk|waw|est|aca|bar|cpa|jur|law|sec|plo|www|bir|cbg|jar|khv|msk|nov|nsk|ptz|rnd|spb|stv|tom|tsk|udm|vrn|cmw|kms|nkz|snz|pub|fhv|red|ens|nat|rns|rnu|bbs|tel|bel|kep|nhs|dni|fed|isa|nsn|gub|e12|tec|орг|обр|упр|alt|nis|jpn|mex|ath|iki|nid|gda|inc'.split(
                '|'
            );

        const parts: Array<string> = domain.split('.');
        const lastItem: string = parts[parts.length - 1] as string;
        const beforeLastItem: string = parts[parts.length - 2] as string;

        if (firstTLDs.includes(lastItem)) {
            if (secondTLDs.includes(beforeLastItem)) {
                return true;
            }
            return true;
        } else if (secondTLDs.includes(lastItem)) {
            return true;
        }

        return false;
    }

    public constructor(domain: string) {
        super();
        this.domain = domain;
    }

    public override toString(): string {
        return this.domain;
    }

    protected static override toDatabase(
        _value: Domain | FindOperator<Domain>
    ): string | null {
        if (_value) {
            return _value.toString();
        }

        return null;
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.Domain,
            value: (this as Domain).toString(),
        }
    }

    public static override fromJSON(json: JSONObject): Domain {
        if(json['_type'] === ObjectType.Domain){
            return new Domain(json['value'] as string || '');
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    protected static override fromDatabase(_value: string): Domain | null {
        if (_value) {
            return new Domain(_value);
        }

        return null;
    }
}
