// export default class Service {
//     async getTemplates(projectId: string) {
//         const populate = [{ path: 'projectId', select: 'name' }];
//         const select = 'projectId body smsType allowedVariables';
//         const templates = await Promise.all(
//             defaultSmsTemplate.map(async template => {
//                 const smsTemplate = await this.findOneBy({
//                     query: {
//                         projectId: projectId,
//                         smsType: template.smsType,
//                     },
//                     select,
//                     populate,
//                 });
//                 return smsTemplate != null && smsTemplate != undefined
//                     ? smsTemplate
//                     : template;
//             })
//         );
//         return templates;
//     }

//     async resetTemplate(projectId: string, templateId: $TSFixMe) {
//         const oldTemplate = await this.findOneBy({
//             query: { _id: templateId },
//             select: 'smsType _id',
//         });
//         const newTemplate = defaultSmsTemplate.filter(
//             template => template.smsType === oldTemplate.smsType
//         )[0];
//         const resetTemplate = await this.updateOneBy(
//             {
//                 _id: oldTemplate._id,
//             },
//             {
//                 smsType: newTemplate.smsType,
//                 body: newTemplate.body,
//                 allowedVariables: newTemplate.allowedVariables,
//             }
//         );
//         return resetTemplate;
//     }
// }
