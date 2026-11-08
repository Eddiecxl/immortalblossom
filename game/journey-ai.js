export const JOURNEY_PROVIDERS={groq:{label:'Groq · Qwen',model:'qwen/qwen3.8-27b'},gemini:{label:'Google · Gemini 3.8 Flash',model:'gemini-3.8-flash'}};
export function normalizeJourneyAi(value){
 if(value==null)return null;
 if(!value||!['groq','gemini','local','tokenharbor','openai','openrouter','mistral','siliconflow','custom'].includes(value.provider)||typeof value.model!=='string'||value.model.length>180)throw Error('命簿中的AI选择无效，请保留存档并检查。');
 return {provider:value.provider,model:value.model,locked:true};
}
export function bindJourneyAi(state,provider,legacyModel){
 if(state.aiRoute){if(state.aiRoute.provider!==provider)throw Error('此旅程的AI已固定；更换供应商请重新启程。');return state.aiRoute;}
 const model=JOURNEY_PROVIDERS[provider]?.model||legacyModel;
 state.aiRoute=normalizeJourneyAi({provider,model});return state.aiRoute;
}
export function journeyAiSettings(state,settings={}){
 const route=normalizeJourneyAi(state?.aiRoute);if(!route)return settings;
 return {...settings,mode:route.provider,provider:route.provider,preferred:route.provider,model:route.model,models:{...settings.models,[route.provider]:route.model},forceCloudAssist:false};
}
