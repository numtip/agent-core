import { randomUUID } from "node:crypto";
import { z } from "zod";
import { selectContext } from "./context.js";

const protectedReasonSchema = z.enum([
  "EXPLICIT_REQUIREMENT",
  "ACCEPTED_DECISION",
  "SAFETY_POLICY",
  "UNRESOLVED_BLOCKER",
  "DEPLOYMENT_STATE",
  "QA_FAILURE",
  "SOURCE_OF_TRUTH",
  "APPROVAL_REQUIREMENT"
]);

export const contextItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  path: z.string().optional(),
  kind: z.string().optional(),
  source: z.string().optional(),
  pinned: z.boolean().default(false),
  protected_reasons: z.array(protectedReasonSchema).default([]),
  age_turns: z.number().int().min(0).default(0),
  importance: z.number().min(0).max(1).default(0.5)
});

export const contextGovernorRequestSchema = z.object({
  project: z.string().min(1),
  task_id: z.string().min(1).optional(),
  query: z.string().min(1),
  items: z.array(contextItemSchema).min(1).max(500),
  max_items: z.number().int().min(1).max(100).default(20),
  compress_after_chars: z.number().int().min(200).max(20000).default(1800),
  drop_after_turns: z.number().int().min(1).max(10000).default(80)
});

export type ContextGovernorRequest = z.infer<typeof contextGovernorRequestSchema>;
export type ContextDisposition = "KEEP"|"COMPRESS"|"DROP"|"PIN";

function compactText(text:string, limit:number) {
  if(text.length<=limit)return text;
  const head=Math.max(120,Math.floor(limit*0.65));
  const tail=Math.max(80,limit-head-32);
  return `${text.slice(0,head)}\n...[deterministic compaction]...\n${text.slice(-tail)}`;
}

function classify(item:z.infer<typeof contextItemSchema>, selected:boolean, compressAfter:number, dropAfter:number):ContextDisposition {
  if(item.pinned || item.protected_reasons.length>0)return "PIN";
  if(selected){
    if(item.text.length>compressAfter && item.importance<0.9)return "COMPRESS";
    return "KEEP";
  }
  if(item.age_turns>=dropAfter && item.importance<0.7)return "DROP";
  if(item.text.length>compressAfter)return "COMPRESS";
  return item.importance>=0.75 ? "KEEP" : "DROP";
}

export function governContext(raw:unknown) {
  const request=contextGovernorRequestSchema.parse(raw);
  const ranked=selectContext({
    project:request.project,
    query:request.query,
    candidates:request.items.map((item)=>({id:item.id,path:item.path,text:item.text,kind:item.kind})),
    limit:request.max_items
  });
  const selectedIds=new Set(ranked.selected.map((item)=>item.id));
  const entries=request.items.map((item)=>{
    const disposition=classify(item,selectedIds.has(item.id),request.compress_after_chars,request.drop_after_turns);
    const outputText=disposition==="DROP" ? null : disposition==="COMPRESS" ? compactText(item.text,request.compress_after_chars) : item.text;
    return {
      id:item.id,
      disposition,
      used:selectedIds.has(item.id) || disposition==="PIN",
      protected:item.protected_reasons.length>0,
      protected_reasons:item.protected_reasons,
      original_chars:item.text.length,
      output_chars:outputText?.length ?? 0,
      text:outputText,
      path:item.path,
      kind:item.kind,
      source:item.source
    };
  });

  const bundle=entries.filter((entry)=>entry.disposition!=="DROP" && entry.used);
  const originalChars=request.items.reduce((sum,item)=>sum+item.text.length,0);
  const outputChars=bundle.reduce((sum,item)=>sum+item.output_chars,0);
  const receipt={
    receipt_id:`ctx_${randomUUID()}`,
    project:request.project,
    task_id:request.task_id ?? null,
    query:request.query,
    strategy:"context-governor-v2-deterministic",
    selected_ids:bundle.map((item)=>item.id),
    pinned_ids:entries.filter((item)=>item.disposition==="PIN").map((item)=>item.id),
    dropped_ids:entries.filter((item)=>item.disposition==="DROP").map((item)=>item.id),
    compressed_ids:entries.filter((item)=>item.disposition==="COMPRESS").map((item)=>item.id),
    original_chars:originalChars,
    output_chars:outputChars,
    reduction_ratio:originalChars>0 ? Number((1-outputChars/originalChars).toFixed(4)) : 0
  };

  return {bundle,entries,receipt};
}
