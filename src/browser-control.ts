import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { evaluateHardPolicy } from "./policy.js";

export const browserActionSchema=z.enum([
  "BROWSER_READ",
  "BROWSER_NAVIGATE",
  "BROWSER_INPUT",
  "BROWSER_SUBMIT",
  "BROWSER_EXTERNAL_WRITE",
  "BROWSER_DESTRUCTIVE"
]);

export const browserPlanRequestSchema=z.object({
  project:z.string().min(1),
  task_id:z.string().min(1).optional(),
  url:z.string().url(),
  action:browserActionSchema,
  page_text:z.string().max(200000).default(""),
  input_text:z.string().max(20000).optional(),
  element_ref:z.string().min(1).optional(),
  allow_domains:z.array(z.string().min(1)).default([]),
  deny_domains:z.array(z.string().min(1)).default([]),
  environment:z.enum(["local","preview","production"]).default("local"),
  targets:z.array(z.string()).default([])
});

export type BrowserPlanRequest=z.infer<typeof browserPlanRequestSchema>;

function hostnameAllowed(hostname:string,allow:string[],deny:string[]) {
  const h=hostname.toLowerCase();
  if(deny.some((d)=>h===d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`)))return false;
  if(allow.length===0)return true;
  return allow.some((d)=>h===d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`));
}

function isPrivateIpv4(host:string){
  const parts=host.split(".").map(Number);
  if(parts.length!==4 || parts.some((n)=>Number.isNaN(n)))return false;
  const [a,b,c]=parts;
  return a===0 || a===10 || a===127 || a>=224                // this-network, private, loopback, multicast/reserved
    || (a===100&&b>=64&&b<=127)                                // CGNAT / Tailscale 100.64.0.0/10
    || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168)
    || (a===192&&b===0&&c===0) || (a===198&&(b===18||b===19)); // IETF assignments, benchmarking
}

function stripBrackets(host:string){ return host.startsWith("[")&&host.endsWith("]") ? host.slice(1,-1) : host; }

// IPv6 loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7) and
// IPv4-mapped/compatible forms are all treated as private/internal.
function isPrivateOrReservedIpv6(host:string){
  const h=stripBrackets(host).toLowerCase().split("%")[0];
  if(h==="::1" || h==="::" || h==="0:0:0:0:0:0:0:1")return true;
  const dotted=h.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if(dotted)return isPrivateIpv4(dotted[1]);
  const hexMapped=h.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if(hexMapped){
    const hi=parseInt(hexMapped[1],16), lo=parseInt(hexMapped[2],16);
    return isPrivateIpv4(`${hi>>8}.${hi&255}.${lo>>8}.${lo&255}`);
  }
  if(/^fe[89ab][0-9a-f]:/.test(h))return true;
  if(/^f[cd][0-9a-f]{2}:/.test(h))return true;
  return false;
}

function isUnsafeHost(hostname:string){
  const h=stripBrackets(hostname).toLowerCase();
  if(h==="localhost" || h.endsWith(".localhost") || h==="0.0.0.0" || h==="::1" || h==="::")return true;
  // decimal/hex-only single label (e.g. http://2130706433/ === 127.0.0.1)
  if(/^\d+$/.test(h))return true;
  if(/^0x[0-9a-f]+$/.test(h))return true;
  if(isIP(h)===4 && isPrivateIpv4(h))return true;
  if(isIP(h)===6 && isPrivateOrReservedIpv6(h))return true;
  return false;
}

export function detectPromptInjection(text:string){
  const value=text.toLowerCase();
  const patterns=[
    /ignore (all|any|the) (previous|prior|system) instructions/,
    /reveal (the )?(system prompt|hidden instructions|secrets|api key)/,
    /send .*?(token|password|credential|secret)/,
    /disable .*?(safety|security|policy)/,
    /you are now .*?(developer|system|administrator)/
  ];
  const hits=patterns.filter((p)=>p.test(value)).map((p)=>p.source);
  return {detected:hits.length>0,hits};
}

function actionOperation(action:z.infer<typeof browserActionSchema>):"READ"|"WRITE"|"EXTERNAL"|"DESTRUCTIVE" {
  if(action==="BROWSER_READ" || action==="BROWSER_NAVIGATE")return "READ";
  if(action==="BROWSER_INPUT")return "WRITE";
  if(action==="BROWSER_SUBMIT" || action==="BROWSER_EXTERNAL_WRITE")return "EXTERNAL";
  return "DESTRUCTIVE";
}

function actionRisk(action:z.infer<typeof browserActionSchema>) {
  if(action==="BROWSER_READ" || action==="BROWSER_NAVIGATE")return "LOW" as const;
  if(action==="BROWSER_INPUT")return "MEDIUM" as const;
  return "HIGH" as const;
}

export function planBrowserAction(raw:unknown){
  const request=browserPlanRequestSchema.parse(raw);
  const url=new URL(request.url);
  if(!["http:","https:"].includes(url.protocol))return {disposition:"DENY" as const,reason:"UNSUPPORTED_URL_SCHEME",executed:false};
  if(isUnsafeHost(url.hostname))return {disposition:"DENY" as const,reason:"PRIVATE_OR_LOCAL_HOST_BLOCKED",executed:false};
  if(!hostnameAllowed(url.hostname,request.allow_domains,request.deny_domains))return {disposition:"DENY" as const,reason:"DOMAIN_POLICY_BLOCK",executed:false};

  const injection=detectPromptInjection(request.page_text);
  if(injection.detected && request.action!=="BROWSER_READ"){
    return {disposition:"HUMAN_REVIEW" as const,reason:"PROMPT_INJECTION_SIGNAL",executed:false,injection};
  }

  const operation=actionOperation(request.action);
  const policy=evaluateHardPolicy({project:request.project,operation,targets:request.targets,environment:request.environment});
  if(policy.disposition!=="ALLOW")return {disposition:"HUMAN_REVIEW" as const,reason:policy.reason,executed:false,policy,injection};

  if(request.action==="BROWSER_SUBMIT" || request.action==="BROWSER_EXTERNAL_WRITE"){
    return {
      disposition:"EXPLICIT_WRITE_SCOPE_REQUIRED" as const,
      reason:"EXTERNAL_BROWSER_WRITE_REQUIRES_EXPLICIT_SCOPE",
      executed:false,
      policy,
      injection,
      risk:actionRisk(request.action)
    };
  }

  if(request.action==="BROWSER_DESTRUCTIVE"){
    return {disposition:"HUMAN_REVIEW" as const,reason:"BROWSER_DESTRUCTIVE_REQUIRES_APPROVAL",executed:false,policy,injection};
  }

  const receiptId=`brw_${randomUUID()}`;
  return {
    disposition:"READY" as const,
    executed:false,
    reason:"POLICY_CHECKED_BROWSER_HANDOFF",
    policy,
    injection,
    risk:actionRisk(request.action),
    receipt:{receipt_id:receiptId,project:request.project,task_id:request.task_id??null,url:`${url.protocol}//${url.host}${url.pathname}`,action:request.action},
    handoff:{capability_id:"mcp.playwright",transport:"MCP",action:request.action,url:request.url,input_text:request.input_text??null}
  };
}
