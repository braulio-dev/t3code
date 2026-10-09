import { RunId, type OrchestrationV2AgentPlan } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyAgentPlanChange } from "./AgentPlan.ts";

const runA = RunId.make("run:a");
const runB = RunId.make("run:b");

const plan: OrchestrationV2AgentPlan = {
  title: "Settlers",
  groups: [
    {
      id: "lane-a",
      title: "Lane A",
      style: "timeline",
      steps: [
        { id: "a1", text: "Construction core", status: "active" },
        { id: "a2", text: "Blueprint view", status: "pending" },
      ],
    },
    {
      id: "lane-d",
      style: "checklist",
      blockedBy: "Lane A",
      steps: [{ id: "d1", text: "Camp binding", status: "blocked" }],
    },
  ],
};

function applied(result: ReturnType<typeof applyAgentPlanChange>) {
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

describe("applyAgentPlanChange", () => {
  it("stamps the working run on steps that start, and only those", () => {
    const next = applied(applyAgentPlanChange(null, { type: "set", plan }, runA));
    expect(next?.groups[0]?.steps.map((step) => step.runId)).toEqual([runA, undefined]);
    expect(next?.groups[1]?.steps[0]?.runId).toBeUndefined();
  });

  it("keeps the first run that worked on a step through later updates and replacements", () => {
    const started = applied(applyAgentPlanChange(null, { type: "set", plan }, runA));
    const finished = applied(
      applyAgentPlanChange(
        started,
        {
          type: "update-steps",
          updates: [
            { stepId: "a1", status: "done" },
            { stepId: "a2", status: "active" },
          ],
        },
        runB,
      ),
    );
    expect(finished?.groups[0]?.steps.map((step) => [step.status, step.runId])).toEqual([
      ["done", runA],
      ["active", runB],
    ]);
    const replaced = applied(applyAgentPlanChange(finished, { type: "set", plan }, null));
    expect(replaced?.groups[0]?.steps[0]?.runId).toBe(runA);
  });

  it("ignores a run id an agent sends in a plan", () => {
    const forged: OrchestrationV2AgentPlan = {
      groups: [
        {
          id: "g",
          style: "checklist",
          steps: [{ id: "s", text: "Step", status: "pending", runId: runB }],
        },
      ],
    };
    const next = applied(applyAgentPlanChange(null, { type: "set", plan: forged }, runA));
    expect(next?.groups[0]?.steps[0]?.runId).toBeUndefined();
  });

  it("sets and removes notes without touching other fields", () => {
    const base = applied(applyAgentPlanChange(null, { type: "set", plan }, null));
    const noted = applied(
      applyAgentPlanChange(
        base,
        { type: "update-steps", updates: [{ stepId: "d1", note: "Waiting on APIs" }] },
        null,
      ),
    );
    expect(noted?.groups[1]?.steps[0]).toMatchObject({
      status: "blocked",
      note: "Waiting on APIs",
    });
    const cleared = applied(
      applyAgentPlanChange(
        noted,
        { type: "update-steps", updates: [{ stepId: "d1", note: null }] },
        null,
      ),
    );
    expect(cleared?.groups[1]?.steps[0]).not.toHaveProperty("note");
  });

  it("rejects updates without a plan, unknown steps, duplicate ids, and empty plans", () => {
    expect(
      applyAgentPlanChange(
        null,
        { type: "update-steps", updates: [{ stepId: "a1", status: "done" }] },
        null,
      ).ok,
    ).toBe(false);
    const base = applied(applyAgentPlanChange(null, { type: "set", plan }, null));
    const unknown = applyAgentPlanChange(
      base,
      { type: "update-steps", updates: [{ stepId: "zz", status: "done" }] },
      null,
    );
    expect(unknown).toEqual({ ok: false, reason: "Unknown step id: zz." });
    const duplicateStep = applyAgentPlanChange(
      null,
      {
        type: "set",
        plan: {
          groups: [
            { ...plan.groups[0]!, id: "x" },
            { ...plan.groups[0]!, id: "y" },
          ],
        },
      },
      null,
    );
    expect(duplicateStep.ok).toBe(false);
    expect(applyAgentPlanChange(null, { type: "set", plan: { groups: [] } }, null).ok).toBe(false);
  });

  it("clears the plan", () => {
    expect(applyAgentPlanChange(plan, { type: "clear" }, runA)).toEqual({ ok: true, plan: null });
  });
});
