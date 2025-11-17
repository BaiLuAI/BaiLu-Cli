export type TaskType = "ask" | "fix" | "plan" | "run";

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type StepKind =
  | "analysis"
  | "read_files"
  | "propose_plan"
  | "edit_files"
  | "run_commands"
  | "summary";

export interface Task {
  id: string;
  type: TaskType;
  description: string;
  createdAt: string;
  updatedAt: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
}

export interface Step {
  id: string;
  kind: StepKind;
  title: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  error?: string;
}

export interface Run {
  id: string;
  taskId: string;
  createdAt: string;
  updatedAt: string;
  status: TaskStatus;
  steps: Step[];
}

export interface BailuConfig {
  testCommand?: string;
  buildCommand?: string;
  includePaths?: string[];
  excludePaths?: string[];
  notes?: string;
}

export interface WorkspaceContext {
  rootPath: string;
  config: BailuConfig;
  agentDoc?: string;
  importantFiles: string[];
}


