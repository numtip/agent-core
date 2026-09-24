import { z } from "zod";

export const supervisorDecisionSchema = z.enum([
  "CONTINUE","DELEGATE","WAIT_FOR_DEPENDENCY","RETRY","VERIFY","ESCALATE","STOP_SUCCESS","STOP_FAILURE"
]);

export const supervisorRequestSchema = z.object({
  project:z.string().min(1),
  task_id:z.string().min(1),
  phase:z.enum(["CREATED","ROUTED","RUNNING","VERIFYING","APPROVAL_REQUIRED","COMPLETED","FAILED","CANCELLED"]),
  goal:z.string().min(1),
  attempts:z.number().int().min(0).default(0),
  max_attempts:z.number().int().min(1).max(10).default(3),
  blocked:z.boolean().default(false),
  dependency_ready:z.boolean().default(true),
  qa_status:z.enum(["UNKNOWN","PASS","PASS_WITH_WARNING","FAIL"]).default("UNKNOWN"),
  operation:z.enum(["READ","WRITE","DESTRUCTIVE","EXTERNAL"]).default("READ"),
  active_agents:z.array(z.string()).default([]),
  completed_subgoals:z.array(z.string()).default([]),
  pending_subgoals:z.array(z.string()).default([]),
  last_error:z.string().optional()
});

export type SupervisorRequest=z.infer<typeof supervisorRequestSchema>;

export function supervise(input:SupervisorRequest){
  const req=supervisorRequestSchema.parse(input);
  let decision:z.infer<typeof supervisorDecisionSchema>="CONTINUE";
  let reason="WORK_REMAINS";

  if(req.phase==="COMPLETED"){decision="STOP_SUCCESS";reason="TASK_COMPLETED";}
  else if(req.phase==="FAILED" || req.phase==="CANCELLED"){decision="STOP_FAILURE";reason=`TASK_${req.phase}`;}
  else if(req.blocked || !req.dependency_ready){decision="WAIT_FOR_DEPENDENCY";reason="DEPENDENCY_BLOCKED";}
  else if(req.operation==="DESTRUCTIVE" || req.phase==="APPROVAL_REQUIRED"){decision="ESCALATE";reason="HUMAN_APPROVAL_REQUIRED";}
  else if(req.qa_status==="PASS"){decision="STOP_SUCCESS";reason="QA_PASSED";}
  else if(req.phase==="VERIFYING" && req.qa_status==="FAIL" && req.attempts<req.max_attempts){decision="RETRY";reason="QA_FAILED_RETRY_AVAILABLE";}
  else if(req.attempts>=req.max_attempts){decision="ESCALATE";reason="MAX_ATTEMPTS_REACHED";}
  else if(req.pending_subgoals.length>0 && req.active_agents.length===0){decision="DELEGATE";reason="PENDING_SUBGOALS";}
  else if(req.phase==="RUNNING" && req.pending_subgoals.length===0){decision="VERIFY";reason="EXECUTION_COMPLETE_NEEDS_VERIFICATION";}

  return {
    decision,
    reason,
    next_phase: decision==="VERIFY"?"VERIFYING":decision==="ESCALATE"?"APPROVAL_REQUIRED":decision==="STOP_SUCCESS"?"COMPLETED":decision==="STOP_FAILURE"?"FAILED":req.phase,
    retry_allowed:req.attempts<req.max_attempts,
    remaining_attempts:Math.max(0,req.max_attempts-req.attempts),
    parallel_read_only:req.operation==="READ" && req.pending_subgoals.length>1,
    receipt:{project:req.project,task_id:req.task_id,decision,reason,phase:req.phase,attempts:req.attempts}
  };
}
