import { describe, expect, it } from "vitest";
import { supervise } from "../src/supervisor.js";

const base={project:"52clips",task_id:"T-1",phase:"RUNNING" as const,goal:"finish task",attempts:0,max_attempts:3,blocked:false,dependency_ready:true,qa_status:"UNKNOWN" as const,operation:"READ" as const,active_agents:[],completed_subgoals:[],pending_subgoals:[]};

describe("Agent Core v2 supervisor",()=>{
  it("moves completed execution to verification",()=>{
    const result=supervise(base);
    expect(result.decision).toBe("VERIFY");
    expect(result.next_phase).toBe("VERIFYING");
  });

  it("delegates pending subgoals when no agent is active",()=>{
    const result=supervise({...base,pending_subgoals:["research","qa"]});
    expect(result.decision).toBe("DELEGATE");
    expect(result.parallel_read_only).toBe(true);
  });

  it("waits on blocked dependencies",()=>{
    expect(supervise({...base,blocked:true}).decision).toBe("WAIT_FOR_DEPENDENCY");
  });

  it("retries failed QA while budget remains",()=>{
    const result=supervise({...base,phase:"VERIFYING",qa_status:"FAIL",attempts:1});
    expect(result.decision).toBe("RETRY");
    expect(result.remaining_attempts).toBe(2);
  });

  it("escalates destructive work and exhausted retries",()=>{
    expect(supervise({...base,operation:"DESTRUCTIVE"}).decision).toBe("ESCALATE");
    expect(supervise({...base,attempts:3}).decision).toBe("ESCALATE");
  });

  it("stops successfully after QA pass",()=>{
    expect(supervise({...base,phase:"VERIFYING",qa_status:"PASS"}).decision).toBe("STOP_SUCCESS");
  });
});
