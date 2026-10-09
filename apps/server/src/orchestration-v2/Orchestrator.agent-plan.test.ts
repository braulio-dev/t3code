import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for plan updates"),
} as ProviderAdapterV2Shape;
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "agent-plan" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

it.effect("stores an agent plan on the thread, updates it, and clears it", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = ThreadId.make("thread:agent-plan");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create-plan-thread"),
      threadId,
      projectId: ProjectId.make("project:agent-plan"),
      title: "Plan",
      modelSelection: { instanceId, model: "gpt-5.1-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    const created = yield* projections.getThread(threadId);

    yield* orchestrator.dispatch({
      type: "thread.agent-plan.update",
      commandId: CommandId.make("set-plan"),
      threadId,
      change: {
        type: "set",
        plan: {
          title: "Lanes",
          groups: [
            {
              id: "a",
              title: "Lane A",
              style: "timeline",
              steps: [
                { id: "a1", text: "First", status: "pending" },
                { id: "a2", text: "Second", status: "pending", link: "#12" },
              ],
            },
          ],
        },
      },
    });
    yield* orchestrator.dispatch({
      type: "thread.agent-plan.update",
      commandId: CommandId.make("finish-step"),
      threadId,
      change: { type: "update-steps", updates: [{ stepId: "a1", status: "done" }] },
    });
    const updated = yield* projections.getThread(threadId);
    assert.deepEqual(
      updated.agentPlan?.groups[0]?.steps.map((step) => step.status),
      ["done", "pending"],
    );
    assert.equal(updated.agentPlan?.groups[0]?.steps[1]?.link, "#12");
    // A plan change is not thread activity, so it must not reorder the sidebar.
    assert.equal(updated.updatedAt.epochMilliseconds, created.updatedAt.epochMilliseconds);
    const projection = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(projection.thread.agentPlan, updated.agentPlan);

    const rejected = yield* Effect.exit(
      orchestrator.dispatch({
        type: "thread.agent-plan.update",
        commandId: CommandId.make("unknown-step"),
        threadId,
        change: { type: "update-steps", updates: [{ stepId: "missing", status: "done" }] },
      }),
    );
    assert.equal(rejected._tag, "Failure");

    yield* orchestrator.dispatch({
      type: "thread.agent-plan.update",
      commandId: CommandId.make("clear-plan"),
      threadId,
      change: { type: "clear" },
    });
    assert.equal((yield* projections.getThread(threadId)).agentPlan, null);
  }).pipe(Effect.provide(layerTest)),
);
