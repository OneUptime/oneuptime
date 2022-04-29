export default class MonitorCriteriaInstance {
  
}


// @Column()
// const criterionEventSchema!: Schema = new Schema({
 
//  @Column()
// schedules!: [String];

// @Column()
// createAlert!: boolean;

// @Column()
// autoAcknowledge!: boolean;

// @Column()
// autoResolve!: boolean;

// @Column()
// title: { type: string, default !: '' };

// @Column()
// description: { type: string, default !: '' };

// @Column()
//     default !: boolean;

// @Column()
// name!: string;

// @Column()
// criteria!: {

//    @Column()
//    condition!: string;

//    @Column()
//    criteria!: [Schema.Types.Mixed];
// };

// @Column()
// scripts!: [
//    {
 
//  @Column()
// script!: {

//    @Column()
//       type!: Schema.Types.Object;

//    @Column()
//    ref!: 'AutomationSript';

//    @Column()
//    index!: true;
// };
//         };
//     ];
// }


// /**
//  * SAMPLE STRUCTURE OF HOW CRITERIA WILL BE STRUCTURED IN THE DB
//  * Depending of on the level, criteria will house all the conditions;
//  * in addition to nested condition if present (the nested condition will follow the same structural pattern)
//  *
 
//  @Column()
//  * criteria!: {
 
//  @Column()
//  *  condition!: 'and';
 
//  @Column()
//  *  criteria!: [
//  *      {
 
//  @Column()
//  *         condition!: 'or';
 
//  @Column()
//  *         criteria!: [
//  *            {
 
//  @Column()
//  *               "responseType"!: "requestBody";
 
//  @Column()
//  *               "filter"!: "equalTo";
 
//  @Column()
//  *                "field1"!: "ok"
//  *            };
//  *            {
 
//  @Column()
//  *               "responseType"!: "requestBody";
 
//  @Column()
//  *               "filter"!: "equalTo";
 
//  @Column()
//  *                "field1"!: "healthy"
//  *            };
//  *            {
 
//  @Column()
//  *               condition!: 'and';
 
//  @Column()
//  *               criteria!: [{}, {}; ...]
//  *            }
//  *         ]
//  *      };
//  *      {
 
//  @Column()
//  *          "responseType"!: "statusCode";
 
//  @Column()
//  *           "filter"!: "equalTo";
 
//  @Column()
//  *           "field1"!: "200"
//  *      };
//  *      {
 
//  @Column()
//  *           "responseType"!: "requestTime";
 
//  @Column()
//  *           "filter"!: "lessthan";
 
//  @Column()
//  *           "field1"!: "1000"
//  *      };
//  *      ...
//  *   ]
//  * }
//  */