export type ProjectProfile = { id: string; type: string; risk: "low"|"standard"|"high"; defaultScopes: string[]; notes: string };
const registry: ProjectProfile[] = [
  { id:"52clips", type:"media-production", risk:"standard", defaultScopes:["decision","route","qa","context","metrics"], notes:"Pilot project for NEXT_ACTION, QA_DISPOSITION and SUBAGENT_ROUTE." },
  { id:"attendance-report-generator", type:"document-automation", risk:"standard", defaultScopes:["decision","route","qa","context"], notes:"Employee mapping, validation and document generation." },
  { id:"handbook", type:"content-publication", risk:"standard", defaultScopes:["decision","route","qa","context"], notes:"Document classification, metadata and publication readiness." },
  { id:"goffice2026", type:"web-application", risk:"standard", defaultScopes:["decision","route","qa","context","metrics"], notes:"Web/data/content workflows. Production deployment remains human-approved." },
  { id:"dbplant", type:"database-production", risk:"high", defaultScopes:["decision","context"], notes:"Read-only by default. Database writes require separately approved policy." }
];
export function listProjects(){ return registry; }
export function findProject(id:string){ return registry.find((p)=>p.id===id); }