import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface AgentPlanPanelStoreState {
  /** Threads whose plan the user folded down to the pill. */
  collapsedByThreadKey: Record<string, true>;
  setCollapsed: (threadKey: string, collapsed: boolean) => void;
}

export const useAgentPlanPanelStore = create<AgentPlanPanelStoreState>()(
  persist(
    (set) => ({
      collapsedByThreadKey: {},
      setCollapsed: (threadKey, collapsed) =>
        set((state) => {
          if (collapsed === threadKey in state.collapsedByThreadKey) return state;
          if (collapsed) {
            return { collapsedByThreadKey: { ...state.collapsedByThreadKey, [threadKey]: true } };
          }
          const { [threadKey]: _removed, ...collapsedByThreadKey } = state.collapsedByThreadKey;
          return { collapsedByThreadKey };
        }),
    }),
    {
      name: "t3code:agent-plan-panel:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ collapsedByThreadKey: state.collapsedByThreadKey }),
    },
  ),
);
