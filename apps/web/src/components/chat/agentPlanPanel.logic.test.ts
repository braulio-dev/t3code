import type { OrchestrationV2AgentPlanGroup } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentPlanGroupCurrentStep,
  agentPlanProgress,
  agentPlanRailFraction,
  agentPlanTimelineFillIndex,
} from "./agentPlanPanel.logic";

function lane(...statuses: OrchestrationV2AgentPlanGroup["steps"][number]["status"][]) {
  return {
    id: "lane",
    style: "timeline",
    steps: statuses.map((status, index) => ({ id: `s${index}`, text: `Step ${index}`, status })),
  } satisfies OrchestrationV2AgentPlanGroup;
}

describe("agent plan panel logic", () => {
  it("counts skipped steps as settled", () => {
    expect(agentPlanProgress({ groups: [lane("done", "skipped", "failed", "pending")] })).toEqual({
      settled: 2,
      total: 4,
    });
  });

  it("puts a lane on its live step before its next open one", () => {
    expect(agentPlanGroupCurrentStep(lane("done", "pending", "active"))?.id).toBe("s2");
    expect(agentPlanGroupCurrentStep(lane("done", "blocked", "pending"))?.id).toBe("s1");
    expect(agentPlanGroupCurrentStep(lane("done", "skipped"))).toBeNull();
  });

  it("fills a rail to the last settled step and measures it between dots", () => {
    expect(agentPlanTimelineFillIndex(lane("pending", "pending"))).toBe(-1);
    expect(agentPlanTimelineFillIndex(lane("done", "active", "pending"))).toBe(0);
    expect(agentPlanTimelineFillIndex(lane("done", "done", "pending"))).toBe(1);
    // Rows wrap to different heights, so the fill follows measured dot centers.
    expect(agentPlanRailFraction([10, 30, 90], 1)).toBe(0.25);
    expect(agentPlanRailFraction([10, 30, 90], 2)).toBe(1);
    expect(agentPlanRailFraction([10, 30, 90], 0)).toBe(0);
    expect(agentPlanRailFraction([], 1)).toBe(0);
  });
});
