import type {
  OrchestrationV2AgentPlan,
  OrchestrationV2AgentPlanGroup,
  OrchestrationV2AgentPlanStep,
  OrchestrationV2AgentPlanStepStatus,
} from "@t3tools/contracts";

/** Done and skipped steps need no more work. */
export function isSettledStepStatus(status: OrchestrationV2AgentPlanStepStatus): boolean {
  return status === "done" || status === "skipped";
}

export function agentPlanProgress(plan: OrchestrationV2AgentPlan): {
  readonly settled: number;
  readonly total: number;
} {
  let settled = 0;
  let total = 0;
  for (const group of plan.groups) {
    for (const step of group.steps) {
      total += 1;
      if (isSettledStepStatus(step.status)) settled += 1;
    }
  }
  return { settled, total };
}

export function agentPlanGroupSettledCount(group: OrchestrationV2AgentPlanGroup): number {
  return group.steps.filter((step) => isSettledStepStatus(step.status)).length;
}

/** The step a lane is on: live work first, then the next open step. Null once settled. */
export function agentPlanGroupCurrentStep(
  group: OrchestrationV2AgentPlanGroup,
): OrchestrationV2AgentPlanStep | null {
  return (
    group.steps.find((step) => step.status === "active" || step.status === "failed") ??
    group.steps.find((step) => !isSettledStepStatus(step.status)) ??
    null
  );
}

/** Lanes with live work start expanded so their progress is visible without a click. */
export function agentPlanGroupStartsExpanded(group: OrchestrationV2AgentPlanGroup): boolean {
  return group.steps.some((step) => step.status === "active" || step.status === "failed");
}

/**
 * How far a timeline lane's rail is filled: the index of its last settled
 * step, or -1 before any step settles.
 */
export function agentPlanTimelineFillIndex(group: OrchestrationV2AgentPlanGroup): number {
  for (let index = group.steps.length - 1; index >= 0; index -= 1) {
    if (isSettledStepStatus(group.steps[index]!.status)) return index;
  }
  return -1;
}

/**
 * The fraction of a rail between its first and last dot that a fill reaching
 * `fillIndex` covers, from measured dot centers.
 */
export function agentPlanRailFraction(
  dotCenters: ReadonlyArray<number>,
  fillIndex: number,
): number {
  const first = dotCenters[0];
  const last = dotCenters[dotCenters.length - 1];
  if (first === undefined || last === undefined || last <= first || fillIndex <= 0) return 0;
  const target = dotCenters[Math.min(fillIndex, dotCenters.length - 1)]!;
  return Math.min(1, Math.max(0, (target - first) / (last - first)));
}
