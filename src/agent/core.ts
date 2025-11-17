import { buildWorkspaceContext } from "./context";
import { Run, Step, Task, TaskStatus, TaskType, WorkspaceContext } from "./types";
import path from "path";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

export interface AgentInitOptions {
  rootPath?: string;
}

export class BailuAgent {
  private rootPath: string;
  private context: WorkspaceContext;
  private tasks = new Map<string, Task>();
  private runs = new Map<string, Run>();

  constructor(opts: AgentInitOptions = {}) {
    this.rootPath = opts.rootPath ?? process.cwd();
    this.context = buildWorkspaceContext(this.rootPath);
  }

  getWorkspaceContext(): WorkspaceContext {
    return this.context;
  }

  createTask(type: TaskType, description: string): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: nextId("task"),
      type,
      description,
      createdAt: now,
      updatedAt: now,
      status: "pending",
    };
    this.tasks.set(task.id, task);
    return task;
  }

  createRun(taskId: string): Run {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const now = new Date().toISOString();
    const run: Run = {
      id: nextId("run"),
      taskId,
      createdAt: now,
      updatedAt: now,
      status: "running",
      steps: [],
    };
    this.runs.set(run.id, run);
    task.status = "running";
    task.updatedAt = now;
    return run;
  }

  appendStep(runId: string, partial: Omit<Step, "id" | "status"> & { status?: Step["status"] }): Step {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const step: Step = {
      id: nextId("step"),
      status: partial.status ?? "pending",
      ...partial,
    };
    run.steps.push(step);
    run.updatedAt = new Date().toISOString();
    return step;
  }

  updateRunStatus(runId: string, status: TaskStatus) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = status;
    run.updatedAt = new Date().toISOString();

    const task = this.tasks.get(run.taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date().toISOString();
    }
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  listRuns(): Run[] {
    return Array.from(this.runs.values());
  }
}


