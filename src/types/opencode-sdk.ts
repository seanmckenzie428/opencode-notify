import type { NotificationEventType } from './config.js';

export interface ShellResult {
  stdout: Buffer | Uint8Array | string;
  stderr: Buffer | Uint8Array | string;
  exitCode: number;
  text?: (encoding?: BufferEncoding) => string | Promise<string>;
  toString?: () => string;
}

export interface ShellExecution extends Promise<ShellResult> {
  quiet(): this;
  nothrow(): this;
  timeout?(milliseconds: number): this;
}

export interface ShellRunner {
  (strings: TemplateStringsArray, ...values: Array<unknown>): ShellExecution;
}

export interface Project {
  id?: string;
  worktree?: string;
  directory?: string;
  vcsDir?: string;
  vcs?: 'git' | string;
  time?: {
    created: number;
    initialized?: number;
  };
  [key: string]: unknown;
}

export interface TUIClient {
  showToast(input: {
    body: {
      message: string;
      variant?: 'info' | 'success' | 'warning' | 'error';
      duration?: number;
      title?: string;
    };
  }): Promise<unknown>;
  [key: string]: unknown;
}

export interface Session {
  id: string;
  projectID?: string;
  directory?: string;
  parentID?: string | null;
  title?: string;
  version?: string;
  status?: string;
  summary?: {
    additions?: number;
    deletions?: number;
    files?: number;
    [key: string]: unknown;
  };
  time?: {
    created?: number;
    updated?: number;
    compacting?: number;
  };
  [key: string]: unknown;
}

export interface SessionClient {
  get(input: { path: { id: string } }): Promise<{ data?: Session }>;
  [key: string]: unknown;
}

export interface PermissionClient {
  reply?(input: {
    path?: {
      id?: string;
      sessionID?: string;
      requestID?: string;
      permissionID?: string;
    };
    body?: {
      reply?: 'once' | 'always' | 'reject' | string;
      response?: string;
      [key: string]: unknown;
    };
  }): Promise<unknown>;
  [key: string]: unknown;
}

export interface QuestionClient {
  reply?(input: {
    path?: {
      id?: string;
      requestID?: string;
      sessionID?: string;
    };
    body?: {
      answers?: Array<Array<string>>;
      [key: string]: unknown;
    };
  }): Promise<unknown>;
  reject?(input: {
    path?: {
      id?: string;
      requestID?: string;
      sessionID?: string;
    };
    body?: {
      [key: string]: unknown;
    };
  }): Promise<unknown>;
  [key: string]: unknown;
}

export interface AppClient {
  log?(input: {
    body?: {
      service?: string;
      level?: string;
      message?: string;
      extra?: unknown;
      [key: string]: unknown;
    };
    service?: string;
    level?: string;
    message?: string;
    extra?: unknown;
  }): Promise<unknown>;
  [key: string]: unknown;
}

export interface OpenCodeClient {
  tui?: TUIClient;
  session: SessionClient;
  permission?: PermissionClient;
  question?: QuestionClient;
  app?: AppClient;
  [key: string]: unknown;
}

export interface PluginInitParams {
  project: Project;
  client: OpenCodeClient;
  $: ShellRunner;
  directory: string;
  worktree: string;
  serverUrl?: URL;
}

export type EventType =
  | 'server.instance.disposed'
  | 'installation.updated'
  | 'installation.update-available'
  | 'lsp.client.diagnostics'
  | 'lsp.updated'
  | 'message.updated'
  | 'message.removed'
  | 'message.part.updated'
  | 'message.part.delta'
  | 'message.part.removed'
  | 'permission.updated'
  | 'permission.asked'
  | 'permission.replied'
  | 'question.asked'
  | 'question.replied'
  | 'question.rejected'
  | 'session.status'
  | 'session.idle'
  | 'session.compacted'
  | 'session.created'
  | 'session.updated'
  | 'session.deleted'
  | 'session.diff'
  | 'session.error'
  | 'todo.updated'
  | 'command.executed'
  | 'file.edited'
  | 'file.watcher.updated'
  | 'vcs.branch.updated'
  | 'tui.prompt.append'
  | 'tui.command.execute'
  | 'tui.toast.show'
  | 'pty.created'
  | 'pty.updated'
  | 'pty.exited'
  | 'pty.deleted'
  | 'server.connected'
  | `${NotificationEventType}.${string}`
  | (string & {});

export interface EventProperties {
  sessionID?: string;
  messageID?: string;
  partID?: string;
  permissionID?: string;
  requestID?: string;
  id?: string;
  info?: unknown;
  error?: unknown;
  response?: string;
  reply?: string;
  status?: unknown;
  questions?: Array<unknown>;
  answers?: Array<Array<string>>;
  [key: string]: unknown;
}

export interface PluginEvent {
  type: EventType;
  properties?: EventProperties;
}

export interface PluginHandlers {
  event?: (input: { event: PluginEvent }) => Promise<void>;
  [key: string]: unknown;
}
