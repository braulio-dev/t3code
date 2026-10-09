import type {
  OrchestrationV2AgentPlan,
  OrchestrationV2AgentPlanChange,
  OrchestrationV2AgentPlanStep,
  OrchestrationV2AgentPlanStepStatus,
  RunId,
} from "@t3tools/contracts";

export type AgentPlanChangeResult =
  | { readonly ok: true; readonly plan: OrchestrationV2AgentPlan | null }
  | { readonly ok: false; readonly reason: string };

const WORKED_STATUSES = new Set<OrchestrationV2AgentPlanStepStatus>(["active", "done", "failed"]);

/** The first run to work on a step owns it, so the client can jump to where it started. */
function stampRun(
  step: OrchestrationV2AgentPlanStep,
  previousRunId: RunId | undefined,
  runId: RunId | null,
): OrchestrationV2AgentPlanStep {
  const { runId: _ignored, ...rest } = step;
  const owner = previousRunId ?? (WORKED_STATUSES.has(step.status) ? runId : null) ?? undefined;
  return owner === undefined ? rest : { ...rest, runId: owner };
}

function duplicate(ids: ReadonlyArray<string>): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

/**
 * Applies an agent's plan change. `runId` is the run making the change; steps
 * that reach active, done, or failed without an owner are stamped with it.
 */
export function applyAgentPlanChange(
  current: OrchestrationV2AgentPlan | null,
  change: OrchestrationV2AgentPlanChange,
  runId: RunId | null,
): AgentPlanChangeResult {
  switch (change.type) {
    case "clear":
      return { ok: true, plan: null };
    case "set": {
      const { groups } = change.plan;
      if (groups.every((group) => group.steps.length === 0)) {
        return { ok: false, reason: "A plan needs at least one step. Use clear to remove it." };
      }
      const duplicateGroup = duplicate(groups.map((group) => group.id));
      if (duplicateGroup !== undefined) {
        return { ok: false, reason: `Group id '${duplicateGroup}' is used twice.` };
      }
      const duplicateStep = duplicate(
        groups.flatMap((group) => group.steps.map((step) => step.id)),
      );
      if (duplicateStep !== undefined) {
        return { ok: false, reason: `Step id '${duplicateStep}' is used twice.` };
      }
      const previousRuns = new Map(
        (current?.groups ?? []).flatMap((group) =>
          group.steps.flatMap((step) =>
            step.runId === undefined ? [] : [[step.id, step.runId] as const],
          ),
        ),
      );
      return {
        ok: true,
        plan: {
          ...change.plan,
          groups: groups.map((group) => ({
            ...group,
            steps: group.steps.map((step) => stampRun(step, previousRuns.get(step.id), runId)),
          })),
        },
      };
    }
    case "update-steps": {
      if (current === null) {
        return { ok: false, reason: "This thread has no plan. Set one first." };
      }
      const updates = new Map(change.updates.map((update) => [update.stepId, update]));
      const known = new Set(current.groups.flatMap((group) => group.steps.map((step) => step.id)));
      const unknown = [...updates.keys()].filter((stepId) => !known.has(stepId));
      if (unknown.length > 0) {
        return { ok: false, reason: `Unknown step id: ${unknown.join(", ")}.` };
      }
      return {
        ok: true,
        plan: {
          ...current,
          groups: current.groups.map((group) => ({
            ...group,
            steps: group.steps.map((step) => {
              const update = updates.get(step.id);
              if (update === undefined) return step;
              const { note: _note, ...withoutNote } = step;
              const next = {
                ...(update.note === null ? withoutNote : step),
                ...(update.status === undefined ? {} : { status: update.status }),
                ...(update.note == null ? {} : { note: update.note }),
              };
              return stampRun(next, step.runId, runId);
            }),
          })),
        },
      };
    }
  }
}
