import { autoAnimate } from "@formkit/auto-animate";
import type {
  OrchestrationV2AgentPlan,
  OrchestrationV2AgentPlanGroup,
  OrchestrationV2AgentPlanStep,
  OrchestrationV2AgentPlanStepStatus,
  RunId,
} from "@t3tools/contracts";
import { CheckIcon, ChevronDownIcon, ChevronsLeftIcon, ListTodoIcon, LockIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useAgentPlanPanelStore } from "~/agentPlanPanelStore";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  agentPlanGroupCurrentStep,
  agentPlanGroupSettledCount,
  agentPlanGroupStartsExpanded,
  agentPlanProgress,
  agentPlanRailFraction,
  agentPlanTimelineFillIndex,
} from "./agentPlanPanel.logic";

// The panel starts right of the timeline minimap's hit strip (left-3 + 40px).
const PANEL_INSET_START = 52;
const PANEL_INSET_END = 12;
const PANEL_MAX_WIDTH = 288;
const PANEL_MIN_WIDTH = 208;
const RAIL_FILL_MS = 280;
const LIST_ANIMATION = { duration: 200, easing: "ease-out" } as const;

/** Slides children in and out as they are added or removed. */
function useListAnimation<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  useEffect(() => {
    if (element === null) return;
    const controller = autoAnimate(element, LIST_ANIMATION);
    return () => controller.destroy?.();
  }, [element]);
  return [element, setElement] as const;
}

type StepTransition = "complete" | "reopen" | null;

/**
 * Animates a step's status change once, and never on first render, so a
 * reload or a newly opened thread shows the plan at rest.
 */
function useStepTransition(status: OrchestrationV2AgentPlanStepStatus) {
  const [state, setState] = useState({ status, transition: null as StepTransition, count: 0 });
  if (state.status !== status) {
    const transition: StepTransition =
      status === "done" ? "complete" : state.status === "done" ? "reopen" : null;
    setState({ status, transition, count: state.count + 1 });
  }
  return state;
}

function StepDot({
  status,
  transition,
  delayMs,
}: {
  status: OrchestrationV2AgentPlanStepStatus;
  transition: StepTransition;
  delayMs: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="agent-plan-dot mt-[3px] size-3.5 shrink-0 overflow-visible"
      data-transition={transition ?? undefined}
      style={{ "--agent-plan-dot-delay": `${delayMs}ms` } as CSSProperties}
    >
      {status === "done" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.75"
            pathLength={1}
            fill="none"
            className="agent-plan-dot-sweep stroke-success"
            strokeWidth="1.5"
          />
          <g className="agent-plan-dot-pop">
            <circle cx="8" cy="8" r="5" className="fill-success" />
            <path
              d="M5.6 8.2l1.6 1.6 3.2-3.5"
              fill="none"
              className="stroke-background"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </>
      ) : status === "active" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.25"
            className="fill-background stroke-primary"
            strokeWidth="1.5"
          />
          <circle cx="8" cy="8" r="2.75" className="fill-primary" />
        </>
      ) : status === "failed" ? (
        <>
          <circle cx="8" cy="8" r="6.5" className="fill-destructive" />
          <path
            d="M6 6l4 4M10 6l-4 4"
            fill="none"
            className="stroke-background"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      ) : status === "skipped" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6"
            className="fill-background stroke-muted-foreground/35"
            strokeWidth="1.5"
          />
          <path
            d="M5.5 8h5"
            className="stroke-muted-foreground/60"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <circle
          cx="8"
          cy="8"
          r="6"
          className={cn(
            "fill-background",
            status === "blocked" ? "stroke-warning" : "stroke-muted-foreground/45",
          )}
          strokeWidth="1.5"
          strokeDasharray={status === "blocked" ? "2.2 2" : undefined}
        />
      )}
      {transition === "reopen" ? (
        <circle cx="8" cy="8" r="6.5" className="agent-plan-dot-unpop fill-success" />
      ) : null}
    </svg>
  );
}

function StepLink({ link }: { link: string }) {
  const className =
    "shrink-0 rounded-sm bg-muted px-1 font-mono text-3xs text-muted-foreground leading-4";
  if (!/^https?:\/\//i.test(link)) return <span className={className}>{link}</span>;
  let label = link;
  try {
    const url = new URL(link);
    const number = /\/(?:issues|pull)\/(\d+)/.exec(url.pathname)?.[1];
    label = number ? `#${number}` : url.hostname;
  } catch {
    // Keep the raw text for a malformed URL.
  }
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={cn(className, "hover:text-foreground")}
    >
      {label}
    </a>
  );
}

function stepTextClassName(status: OrchestrationV2AgentPlanStepStatus) {
  return cn(
    "min-w-0 flex-1 text-xs leading-5",
    status === "skipped" && "text-muted-foreground/50 line-through",
    status === "done" && "text-muted-foreground",
    status === "active" && "font-medium text-foreground",
    (status === "pending" || status === "blocked") && "text-foreground/75",
    status === "failed" && "text-foreground/85",
  );
}

function PlanStepRow({
  step,
  dotDelayMs,
  onJumpToRun,
  registerDot,
}: {
  step: OrchestrationV2AgentPlanStep;
  dotDelayMs: number;
  onJumpToRun: (runId: RunId) => void;
  registerDot?: (stepId: string, element: HTMLElement | null) => void;
}) {
  const { transition, count } = useStepTransition(step.status);
  const runId = step.runId;
  return (
    <li>
      <button
        type="button"
        disabled={runId === undefined}
        onClick={() => runId !== undefined && onJumpToRun(runId)}
        className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left enabled:cursor-pointer enabled:hover:bg-muted/60"
      >
        <span className="flex shrink-0" ref={(element) => registerDot?.(step.id, element)}>
          <StepDot
            key={count}
            status={step.status}
            transition={transition}
            delayMs={transition === "complete" ? dotDelayMs : 0}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-start gap-1">
            <span className={stepTextClassName(step.status)}>{step.text}</span>
            {step.link ? <StepLink link={step.link} /> : null}
          </span>
          {step.note ? (
            <span
              className={cn(
                "text-2xs leading-4",
                step.status === "failed"
                  ? "text-destructive"
                  : step.status === "blocked"
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
            >
              {step.note}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** Steps done in order, on a rail that fills up to the last settled step. */
function TimelineSteps({
  group,
  onJumpToRun,
}: {
  group: OrchestrationV2AgentPlanGroup;
  onJumpToRun: (runId: RunId) => void;
}) {
  const [list, setList] = useListAnimation<HTMLOListElement>();
  const [dots] = useState(() => new Map<string, HTMLElement>());
  const [centers, setCenters] = useState<ReadonlyArray<number>>([]);

  useLayoutEffect(() => {
    if (list === null) return;
    // Offsets ignore the transforms auto-animate applies while a row slides.
    // The rail's wrapper is the dots' offset parent; a dot's center sits 10px
    // into its holder (3px margin plus half the 14px dot).
    const measure = () => {
      const next = group.steps.map((step) => {
        let top = 0;
        let element = dots.get(step.id) ?? null;
        while (element !== null && element !== list.parentElement) {
          top += element.offsetTop;
          element = element.offsetParent as HTMLElement | null;
        }
        return top + 10;
      });
      setCenters((current) =>
        current.length === next.length && current.every((value, index) => value === next[index])
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [dots, group.steps, list]);

  const fraction = agentPlanRailFraction(centers, agentPlanTimelineFillIndex(group));
  // Remember where the fill came from so newly reached dots complete as it passes them,
  // and a retracting fill waits for the reopened dot first.
  const [rail, setRail] = useState({ fraction, from: fraction });
  if (rail.fraction !== fraction) setRail({ fraction, from: rail.fraction });
  const growing = rail.fraction > rail.from;
  const first = centers[0] ?? 0;
  const last = centers[centers.length - 1] ?? 0;
  const span = last - first;

  return (
    <div className="relative">
      {span > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-[calc(0.25rem+7px)] w-px -translate-x-1/2 bg-border"
          style={{ top: first, height: span }}
        >
          <span
            className="absolute inset-0 origin-top bg-success/70 transition-transform ease-out motion-reduce:transition-none"
            style={{
              transform: `scaleY(${fraction})`,
              transitionDuration: `${RAIL_FILL_MS}ms`,
              transitionDelay: growing ? "0ms" : "160ms",
            }}
          />
        </span>
      ) : null}
      <ol ref={setList} className="flex flex-col">
        {group.steps.map((step, index) => {
          const dotFraction = span > 0 ? ((centers[index] ?? first) - first) / span : 0;
          const travelled = growing ? (dotFraction - rail.from) / (rail.fraction - rail.from) : 0;
          return (
            <PlanStepRow
              key={step.id}
              step={step}
              dotDelayMs={Math.round(Math.min(1, Math.max(0, travelled)) * RAIL_FILL_MS)}
              onJumpToRun={onJumpToRun}
              registerDot={(stepId, element) => {
                if (element) dots.set(stepId, element);
                else dots.delete(stepId);
              }}
            />
          );
        })}
      </ol>
    </div>
  );
}

function ChecklistSteps({
  group,
  onJumpToRun,
}: {
  group: OrchestrationV2AgentPlanGroup;
  onJumpToRun: (runId: RunId) => void;
}) {
  const [, setList] = useListAnimation<HTMLOListElement>();
  return (
    <ol ref={setList} className="flex flex-col">
      {group.steps.map((step) => (
        <PlanStepRow key={step.id} step={step} dotDelayMs={0} onJumpToRun={onJumpToRun} />
      ))}
    </ol>
  );
}

function LaneMeter({ settled, total }: { settled: number; total: number }) {
  return (
    <span
      aria-hidden
      className="mt-1 flex h-3 w-1 shrink-0 overflow-hidden rounded-full bg-muted-foreground/20"
    >
      <span
        className="w-full origin-bottom self-end bg-success transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ height: "100%", transform: `scaleY(${total === 0 ? 0 : settled / total})` }}
      />
    </span>
  );
}

function PlanGroupRow({
  group,
  expanded,
  onToggle,
  onJumpToRun,
}: {
  group: OrchestrationV2AgentPlanGroup;
  expanded: boolean;
  onToggle: () => void;
  onJumpToRun: (runId: RunId) => void;
}) {
  const [, setItem] = useListAnimation<HTMLLIElement>();
  const settled = agentPlanGroupSettledCount(group);
  const current = agentPlanGroupCurrentStep(group);
  return (
    <li ref={setItem} className={cn("rounded-md", expanded && "bg-muted/40")}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60"
      >
        <LaneMeter settled={settled} total={group.steps.length} />
        <span className="flex min-w-0 flex-1 flex-col">
          {group.title ? (
            <span
              className={cn(
                "truncate text-2xs leading-4",
                current === null ? "text-muted-foreground/60" : "text-muted-foreground",
              )}
            >
              {group.title}
            </span>
          ) : null}
          {current === null ? (
            <span className="text-muted-foreground/60 text-xs leading-5">Done</span>
          ) : (
            <span className="flex min-w-0 items-start gap-1">
              <span className={cn(stepTextClassName(current.status), "truncate")}>
                {current.text}
              </span>
              {group.blockedBy || current.status === "blocked" ? (
                <LockIcon className="mt-1 size-3 shrink-0 text-warning" />
              ) : null}
            </span>
          )}
        </span>
        <span className="mt-0.5 font-mono text-3xs text-muted-foreground/70 tabular-nums leading-4">
          {settled}/{group.steps.length}
        </span>
        <ChevronDownIcon
          className={cn(
            "mt-0.5 size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? (
        <div className="pb-1 pl-3">
          {group.blockedBy ? (
            <p className="flex items-center gap-1 px-1 text-2xs text-warning leading-5">
              <LockIcon className="size-3 shrink-0" />
              <span className="min-w-0 truncate">Waits on {group.blockedBy}</span>
            </p>
          ) : null}
          {group.style === "timeline" ? (
            <TimelineSteps group={group} onJumpToRun={onJumpToRun} />
          ) : (
            <ChecklistSteps group={group} onJumpToRun={onJumpToRun} />
          )}
        </div>
      ) : null}
    </li>
  );
}

function PanelIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function PlanBody({
  plan,
  onJumpToRun,
  onCollapse,
}: {
  plan: OrchestrationV2AgentPlan;
  onJumpToRun: (runId: RunId) => void;
  onCollapse?: () => void;
}) {
  const [, setList] = useListAnimation<HTMLUListElement>();
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const progress = agentPlanProgress(plan);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 px-1 pb-1">
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {plan.title ? `${plan.title} · ` : "Plan · "}
          {progress.settled} of {progress.total}
        </span>
        {onCollapse ? (
          <PanelIconButton label="Collapse plan" onClick={onCollapse}>
            <ChevronsLeftIcon className="size-3.5" />
          </PanelIconButton>
        ) : null}
      </div>
      <ul ref={setList} className="flex flex-col gap-0.5">
        {plan.groups.map((group) => {
          const expanded = toggled.get(group.id) ?? agentPlanGroupStartsExpanded(group);
          return (
            <PlanGroupRow
              key={group.id}
              group={group}
              expanded={expanded}
              onToggle={() => setToggled((current) => new Map(current).set(group.id, !expanded))}
              onJumpToRun={onJumpToRun}
            />
          );
        })}
      </ul>
    </div>
  );
}

function PlanPill({
  plan,
  settled,
  total,
  onJumpToRun,
  onExpand,
}: {
  plan: OrchestrationV2AgentPlan;
  settled: number;
  total: number;
  onJumpToRun: (runId: RunId) => void;
  onExpand?: () => void;
}) {
  return (
    <span className="pointer-events-auto flex items-center gap-0.5">
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 text-2xs shadow-xs backdrop-blur hover:bg-muted"
            />
          }
        >
          <ListTodoIcon className="size-3 text-muted-foreground" />
          Plan
          <span className="font-mono text-muted-foreground tabular-nums">
            {settled}/{total}
          </span>
        </PopoverTrigger>
        <PopoverPopup side="right" align="center" width="md" padding="compact">
          <div className="max-h-[60vh] overflow-y-auto">
            <PlanBody plan={plan} onJumpToRun={onJumpToRun} />
          </div>
        </PopoverPopup>
      </Popover>
      {onExpand ? (
        <PanelIconButton label="Expand plan" onClick={onExpand}>
          <ChevronsLeftIcon className="size-3.5 rotate-180" />
        </PanelIconButton>
      ) : null}
    </span>
  );
}

/**
 * The plan an agent published for this thread, in the timeline's left gutter
 * beside the minimap. It folds to a pill when the gutter is narrow, the user
 * collapses it, or the Agent plan panel setting is Compact, and to a chip once
 * every step is settled.
 */
export const AgentPlanPanel = memo(function AgentPlanPanel({
  plan,
  threadKey,
  sideGutter,
  onJumpToRun,
}: {
  plan: OrchestrationV2AgentPlan | null;
  threadKey: string;
  sideGutter: number;
  onJumpToRun: (runId: RunId) => void;
}) {
  const mode = useClientSettings((settings) => settings.agentPlanPanel);
  const collapsed = useAgentPlanPanelStore((state) => threadKey in state.collapsedByThreadKey);
  const setCollapsed = useAgentPlanPanelStore((state) => state.setCollapsed);
  const [, setPresence] = useListAnimation<HTMLDivElement>();
  const [completeOpen, setCompleteOpen] = useState(false);

  const visiblePlan = mode === "off" ? null : plan;
  const progress = visiblePlan === null ? null : agentPlanProgress(visiblePlan);
  const complete = progress !== null && progress.total > 0 && progress.settled === progress.total;
  if (!complete && completeOpen) setCompleteOpen(false);

  const available = sideGutter - PANEL_INSET_START - PANEL_INSET_END;
  const fits = available >= PANEL_MIN_WIDTH;

  let content = null;
  if (visiblePlan !== null && progress !== null && progress.total > 0) {
    if (complete && !completeOpen) {
      content = (
        <button
          key="complete"
          type="button"
          onClick={() => setCompleteOpen(true)}
          className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-success/30 bg-background/80 px-2.5 py-1 text-2xs text-success shadow-xs backdrop-blur hover:bg-muted"
        >
          <CheckIcon className="size-3" />
          Plan complete
        </button>
      );
    } else if (mode === "compact" || collapsed || !fits) {
      content = (
        <PlanPill
          key="pill"
          plan={visiblePlan}
          settled={progress.settled}
          total={progress.total}
          onJumpToRun={onJumpToRun}
          {...(collapsed && mode !== "compact" && fits
            ? { onExpand: () => setCollapsed(threadKey, false) }
            : {})}
        />
      );
    } else {
      content = (
        <div
          key="panel"
          className="pointer-events-auto max-h-[min(36rem,calc(100vh-14rem))] overflow-y-auto overscroll-contain"
          style={{ width: Math.min(PANEL_MAX_WIDTH, available) }}
        >
          <PlanBody
            plan={visiblePlan}
            onJumpToRun={onJumpToRun}
            onCollapse={
              complete ? () => setCompleteOpen(false) : () => setCollapsed(threadKey, true)
            }
          />
        </div>
      );
    }
  }

  return (
    <div
      ref={setPresence}
      className="pointer-events-none absolute top-1/2 z-30 hidden -translate-y-1/2 [@media(pointer:fine)]:block"
      style={{ left: PANEL_INSET_START }}
      data-testid="agent-plan-panel"
    >
      {content}
    </div>
  );
});
