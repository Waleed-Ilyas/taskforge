import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DndContext, closestCorners, DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const columns = [
  { id: "todo", title: "Backlog" },
  { id: "inprogress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
] as const;

type ColumnId = (typeof columns)[number]["id"];

type CommentItem = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
};

type ActivityEntry = {
  id: string;
  type: string;
  actor: string;
  text: string;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  assignee: string;
  priority: "Low" | "Medium" | "High";
  column: ColumnId;
  comments: CommentItem[];
  dueDate?: string;
  labels: string[];
};

type Board = {
  id: string;
  name: string;
  columns: { id: ColumnId; title: string }[];
  members: { id: string; name: string; email: string; role: "member" | "admin" }[];
  tasks: Task[];
  activity: ActivityEntry[];
};

type User = {
  id: string;
  email: string;
  name: string;
  role: "member" | "admin";
};

const demoAccounts = [
  { email: "demo@waleed.dev", password: "Demo@1234" },
  { email: "admin@waleed.dev", password: "Admin@1234" },
];

const initialForm = {
  title: "",
  description: "",
  assignee: "Demo user",
  priority: "Medium" as Task["priority"],
  dueDate: "",
};

function getStoredToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("taskforge-token") || "";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data as T;
}


function SortableTask({ task, onDelete, onAddComment }: { task: Task, onDelete: () => void, onAddComment: (t: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'Task', task } });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onDelete={onDelete} onAddComment={onAddComment} />
    </div>
    </DndContext>
  );
}

function TaskCard({ task, onDelete, onAddComment }: { task: Task, onDelete: () => void, onAddComment: (t: string) => void }) {
  return (
    <div style={styles.taskCard}>
      <div style={styles.taskTopRow}>
        <span style={{ ...styles.priorityPill, background: task.priority === 'High' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: task.priority === 'High' ? '#fca5a5' : '#fcd34d' }}>{task.priority}</span>
        <span style={styles.taskMeta}>{task.id}</span>
      </div>
      <h4 style={styles.taskTitle}>{task.title}</h4>
      <p style={styles.taskDescription}>{task.description}</p>
      <div style={styles.taskMetaRow}>
        {task.labels.length > 0 ? task.labels.map((l) => <span key={l} style={styles.labelPill}>{l}</span>) : <span style={styles.emptyLabel}>No labels</span>}
      </div>
      <div style={styles.taskFooter}>
        <div>
          <span style={styles.assignee}>{task.assignee || 'Unassigned'}</span>
          <div style={styles.dueDate}>{task.dueDate ? 'Due ' + task.dueDate : 'No due date'}</div>
        </div>
        <div style={styles.taskActions}>
          <button style={styles.deleteButton} onClick={onDelete}>Delete</button>
        </div>
      </div>
      <div style={styles.commentBox}>
        {task.comments.map(c => (
          <div key={c.id} style={styles.commentItem}>
            <span style={styles.commentAuthor}>{c.author}:</span> {c.text}
          </div>
        ))}
        <form style={styles.commentComposer} onSubmit={(e) => { e.preventDefault(); const t = (e.target as any).text.value; if(t) onAddComment(t); (e.target as any).reset(); }}>
          <input name="text" style={styles.commentInput} placeholder="Write a comment..." />
          <button style={styles.smallButton}>Send</button>
        </form>
      </div>
    </div>
  );
}
\nexport default function App() {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === "undefined") return null;
    const cached = window.localStorage.getItem("taskforge-user");
    return cached ? (JSON.parse(cached) as User) : null;
  });

  const [board, setBoard] = useState<Board | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "demo@waleed.dev", password: "Demo@1234" });
  const [taskForm, setTaskForm] = useState(initialForm);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const loadBoard = async () => {
    const data = await request<{ board: Board }>('/api/workspace');
    setBoard(data.board);
  };

  useEffect(() => {
    if (!user) {
      setBoard(null);
      return;
    }

    loadBoard().catch(() => setError('Unable to load workspace right now.'));

    const nextSocket = io(API_URL, { transports: ['websocket'] });
    nextSocket.emit('join-workspace', 'launch-sprint');
    nextSocket.on('board:updated', (payload: { board: Board }) => {
      setBoard(payload.board);
    });
    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, [user]);

  const stats = useMemo(() => {
    if (!board) {
      return { total: 0, todo: 0, inprogress: 0, review: 0, done: 0 };
    }

    return {
      total: board.tasks.length,
      todo: board.tasks.filter((task) => task.column === 'todo').length,
      inprogress: board.tasks.filter((task) => task.column === 'inprogress').length,
      review: board.tasks.filter((task) => task.column === 'review').length,
      done: board.tasks.filter((task) => task.column === 'done').length,
    };
  }, [board]);

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    try {
      const data = await request<{ user: User; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      });
      window.localStorage.setItem('taskforge-user', JSON.stringify(data.user));
      window.localStorage.setItem('taskforge-token', data.token);
      setUser(data.user);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to sign in.');
    }
  };

  const createTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = taskForm.title.trim();
    if (!trimmed) {
      setError('Task title is required.');
      return;
    }

    try {
      const data = await request<{ board: Board }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          ...taskForm,
          title: trimmed,
          assignee: taskForm.assignee || user?.name || 'Demo user',
          column: 'todo',
        }),
      });
      setBoard(data.board);
      setTaskForm(initialForm);
      setError('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create task.');
    }
  };

  const moveTask = async (taskId: string, nextColumn: ColumnId) => {
    try {
      const data = await request<{ board: Board }>(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ column: nextColumn }),
      });
      setBoard(data.board);
      setError('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to move task.');
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const data = await request<{ board: Board }>(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      });
      setBoard(data.board);
      setError('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete task.');
    }
  };

  const addComment = async (taskId: string) => {
    const text = commentDrafts[taskId]?.trim();
    if (!text) return;

    try {
      const data = await request<{ board: Board }>(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setBoard(data.board);
      setCommentDrafts((current) => ({ ...current, [taskId]: '' }));
      setError('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to add comment.');
    }
  };

  const logout = () => {
    window.localStorage.removeItem('taskforge-user');
    window.localStorage.removeItem('taskforge-token');
    setUser(null);
    setBoard(null);
    setError('');
    socket?.disconnect();
  };

  const dropOnColumn = async (columnId: ColumnId) => {
    if (!draggedTaskId) return;
    await moveTask(draggedTaskId, columnId);
    setDraggedTaskId(null);
  };

  if (!user) {
    return (
      <main style={styles.pageShell}>
        <div style={styles.loginCard}>
          <div style={styles.brandRow}>
            <span style={styles.badge}>TaskForge</span>
            <span style={styles.muted}>Team workspace</span>
          </div>
          <h1 style={styles.title}>Ship work faster, together.</h1>
          <p style={styles.subtitle}>Real-time team kanban for launches, bugs and handoffs.</p>

          <form onSubmit={login} style={styles.form}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={loginForm.email}
              onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
              style={styles.input}
            />

            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              style={styles.input}
            />

            {error && <p style={styles.errorText}>{error}</p>}

            <button type="submit" style={styles.primaryButton}>Sign in</button>
          </form>

          <div style={styles.demoBox}>
            <strong style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Sample local accounts</strong>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {demoAccounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => setLoginForm(account)}
                  style={styles.demoButton}
                >
                  {account.email} / {account.password}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.appShell}>
      <header style={styles.topbar}>
        <div>
          <p style={styles.label}>Workspace</p>
          <h2 style={styles.workspaceName}>{board?.name || 'Launch Sprint'}</h2>
        </div>
        <div style={styles.topbarRight}>
          <div style={styles.userCard}>
            <span style={styles.avatar}>{user.name.charAt(0).toUpperCase()}</span>
            <div>
              <div style={styles.userName}>{user.name}</div>
              <div style={styles.muted}>{user.role}</div>
            </div>
          </div>
          <button type="button" onClick={logout} style={styles.secondaryButton}>Logout</button>
        </div>
      </header>

      <section style={styles.statsGrid}>
        <StatCard label="Total tasks" value={String(stats.total)} accent="#8b5cf6" />
        <StatCard label="Backlog" value={String(stats.todo)} accent="#2ee6a6" />
        <StatCard label="In progress" value={String(stats.inprogress)} accent="#fbbf24" />
        <StatCard label="Review" value={String(stats.review)} accent="#38bdf8" />
        <StatCard label="Done" value={String(stats.done)} accent="#22c55e" />
      </section>

      <section style={styles.composePanel}>
        <form onSubmit={createTask} style={styles.inlineForm}>
          <input
            value={taskForm.title}
            onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Add a task title"
            style={styles.input}
          />
          <input
            value={taskForm.assignee}
            onChange={(event) => setTaskForm((current) => ({ ...current, assignee: event.target.value }))}
            placeholder="Assignee"
            style={styles.input}
          />
          <select
            value={taskForm.priority}
            onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value as Task['priority'] }))}
            style={styles.input}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
          <input
            type="date"
            value={taskForm.dueDate}
            onChange={(event) => setTaskForm((current) => ({ ...current, dueDate: event.target.value }))}
            style={styles.input}
          />
          <textarea
            value={taskForm.description}
            onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Describe the work"
            rows={2}
            style={{ ...styles.input, resize: 'vertical' }}
          />
          <button type="submit" style={styles.primaryButton}>Create task</button>
        </form>
      </section>

      {error && <p style={styles.errorText}>{error}</p>}

      <section style={styles.workspaceLayout}>
        <div style={styles.boardWrap}>
          {board?.columns.map((column) => (
            <div
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                void dropOnColumn(column.id);
              }}
              style={styles.column}
            >
              <div style={styles.columnHeader}>
                <span>{column.title}</span>
                <span style={styles.counter}>{board.tasks.filter((task) => task.column === column.id).length}</span>
              </div>

              <div style={styles.taskList}>
                {board.tasks.filter((task) => task.column === column.id).map((task) => (
                  <article
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggedTaskId(task.id)}
                    onDragEnd={() => setDraggedTaskId(null)}
                    style={styles.taskCard}
                  >
                    <div style={styles.taskTopRow}>
                      <span style={{ ...styles.priorityPill, background: priorityColor(task.priority) }}>{task.priority}</span>
                      <span style={styles.taskMeta}>{task.comments.length} comments</span>
                    </div>
                    <h3 style={styles.taskTitle}>{task.title}</h3>
                    <p style={styles.taskDescription}>{task.description || 'No description yet.'}</p>
                    <div style={styles.taskMetaRow}>
                      {task.labels.length > 0 ? task.labels.map((label) => (
                        <span key={`${task.id}-${label}`} style={styles.labelPill}>{label}</span>
                      )) : <span style={styles.emptyLabel}>General</span>}
                    </div>
                    <div style={styles.taskFooter}>
                      <div>
                        <span style={styles.assignee}>{task.assignee}</span>
                        {task.dueDate ? <div style={styles.dueDate}>Due {task.dueDate}</div> : null}
                      </div>
                      <div style={styles.taskActions}>
                        <button type="button" onClick={() => void moveTask(task.id, getNextColumn(task.column))} style={styles.smallButton}>Next</button>
                        {user.role === 'admin' ? (
                          <button type="button" onClick={() => void deleteTask(task.id)} style={styles.deleteButton}>Delete</button>
                        ) : null}
                      </div>
                    </div>

                    <div style={styles.commentBox}>
                      {task.comments.slice(0, 2).map((comment) => (
                        <div key={comment.id} style={styles.commentItem}>
                          <strong style={styles.commentAuthor}>{comment.author}</strong>
                          <span>{comment.text}</span>
                        </div>
                      ))}
                      <div style={styles.commentComposer}>
                        <input
                          value={commentDrafts[task.id] || ''}
                          onChange={(event) => setCommentDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                          style={styles.commentInput}
                          placeholder="Add a note"
                        />
                        <button type="button" onClick={() => void addComment(task.id)} style={styles.smallButton}>Post</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>

        <aside style={styles.sidebar}>
          <div style={styles.sideCard}>
            <h3 style={styles.sideTitle}>Team</h3>
            {board?.members.map((member) => (
              <div key={member.id} style={styles.memberRow}>
                <span style={styles.memberAvatar}>{member.name.charAt(0).toUpperCase()}</span>
                <div>
                  <div style={styles.memberName}>{member.name}</div>
                  <div style={styles.memberMeta}>{member.role}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={styles.sideCard}>
            <h3 style={styles.sideTitle}>Recent activity</h3>
            <div style={styles.activityList}>
              {board?.activity.slice(0, 6).map((entry) => (
                <div key={entry.id} style={styles.activityItem}>
                  <div style={styles.activityDot} />
                  <div>
                    <div style={styles.activityText}>{entry.text}</div>
                    <div style={styles.activityMeta}>{entry.actor} • {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...styles.statCard, borderColor: `${accent}55` }}>
      <span style={{ ...styles.statLabel, color: accent }}>{label}</span>
      <strong style={styles.statValue}>{value}</strong>
    </div>
  );
}

function getNextColumn(current: ColumnId): ColumnId {
  const order: ColumnId[] = ['todo', 'inprogress', 'review', 'done'];
  const currentIndex = order.indexOf(current);
  return order[Math.min(currentIndex + 1, order.length - 1)];
}

function priorityColor(priority: Task['priority']) {
  if (priority === 'High') return 'rgba(239, 68, 68, 0.14)';
  if (priority === 'Medium') return 'rgba(251, 191, 36, 0.14)';
  return 'rgba(34, 197, 94, 0.14)';
}

const styles: Record<string, React.CSSProperties> = {
  pageShell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background: 'radial-gradient(circle at top, #1a1630 0%, #0b1020 42%, #080d18 100%)',
    color: '#edf2ff',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  loginCard: {
    width: '100%',
    maxWidth: 520,
    background: 'rgba(10, 15, 26, 0.88)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: 24,
    padding: 28,
    boxShadow: '0 30px 80px rgba(15, 23, 42, 0.45)',
  },
  brandRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: 'rgba(46, 230, 166, 0.12)', color: '#7ef7cd', padding: '7px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid rgba(46, 230, 166, 0.35)' },
  muted: { color: '#a5b4cf', fontSize: 12 },
  title: { margin: '0 0 8px', fontSize: 'clamp(2rem, 4vw, 3rem)', lineHeight: 1.1 },
  subtitle: { margin: 0, color: '#bfd0ef', lineHeight: 1.6 },
  form: { display: 'grid', gap: 12, marginTop: 26 },
  label: { fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9aa9c7' },
  input: {
    width: '100%',
    background: 'rgba(15, 23, 42, 0.9)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    color: '#eef2ff',
    borderRadius: 12,
    padding: '12px 14px',
    fontSize: 15,
    outline: 'none',
  },
  primaryButton: { border: 'none', borderRadius: 12, background: 'linear-gradient(135deg, #2ee6a6, #8b5cf6)', color: '#04120c', padding: '12px 18px', fontWeight: 700, cursor: 'pointer' },
  demoBox: { marginTop: 30, background: 'rgba(15, 23, 42, 0.72)', borderRadius: 16, padding: 14, border: '1px solid rgba(148, 163, 184, 0.18)' },
  demoButton: { width: '100%', textAlign: 'left', background: 'rgba(30, 41, 59, 0.9)', color: '#dfe9ff', border: '1px solid rgba(148, 163, 184, 0.15)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' },
  errorText: { margin: 0, color: '#fca5a5', fontSize: 14 },
  appShell: { minHeight: '100vh', background: '#0c1220', padding: '28px 18px 52px', color: '#edf2ff' },
  topbar: { maxWidth: 1320, margin: '0 auto 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  workspaceName: { margin: 0, fontSize: 'clamp(1.4rem, 2vw, 2.2rem)' },
  topbarRight: { display: 'flex', alignItems: 'center', gap: 12 },
  userCard: { display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 12, padding: '10px 12px' },
  avatar: { width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'linear-gradient(135deg, #2ee6a6, #8b5cf6)', color: '#04120c', fontWeight: 700 },
  userName: { fontWeight: 700 },
  secondaryButton: { border: '1px solid rgba(148, 163, 184, 0.2)', background: 'transparent', color: '#eef2ff', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' },
  statsGrid: { maxWidth: 1320, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 },
  statCard: { background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 16, padding: '16px 18px', display: 'grid', gap: 8 },
  statLabel: { fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' },
  statValue: { fontSize: 'clamp(1.8rem, 3vw, 2.5rem)' },
  composePanel: { maxWidth: 1320, margin: '20px auto 0', background: 'rgba(15, 23, 42, 0.78)', borderRadius: 20, border: '1px solid rgba(148, 163, 184, 0.18)', padding: 18 },
  inlineForm: { display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(160px, 1fr) minmax(140px, 1fr) minmax(170px, 1fr)', gap: 12, alignItems: 'center' },
  workspaceLayout: { maxWidth: 1320, margin: '20px auto 0', display: 'grid', gridTemplateColumns: 'minmax(0, 2.3fr) minmax(260px, 0.7fr)', gap: 18 },
  boardWrap: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  column: { background: 'rgba(15, 23, 42, 0.9)', borderRadius: 18, border: '1px solid rgba(148, 163, 184, 0.18)', minHeight: 320, padding: 12 },
  columnHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#dbe7ff', fontWeight: 700, marginBottom: 12 },
  counter: { background: 'rgba(148, 163, 184, 0.14)', borderRadius: 999, padding: '4px 8px', fontSize: 12 },
  taskList: { display: 'grid', gap: 10 },
  taskCard: { background: 'rgba(9, 15, 27, 0.98)', borderRadius: 16, border: '1px solid rgba(148, 163, 184, 0.18)', padding: 14, display: 'grid', gap: 10 },
  taskTopRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  priorityPill: { borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 700 },
  taskMeta: { color: '#99a9c7', fontSize: 12 },
  taskTitle: { margin: 0, fontSize: 16 },
  taskDescription: { margin: 0, color: '#bfd0ef', lineHeight: 1.5, fontSize: 14 },
  taskMetaRow: { display: 'flex', gap: 8, flexWrap: 'wrap', minHeight: 20 },
  labelPill: { borderRadius: 999, border: '1px solid rgba(46, 230, 166, 0.25)', background: 'rgba(46, 230, 166, 0.12)', color: '#7ef7cd', padding: '4px 8px', fontSize: 11 },
  emptyLabel: { color: '#99a9c7', fontSize: 11 },
  taskFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 },
  taskActions: { display: 'flex', gap: 8 },
  assignee: { color: '#dbe7ff', fontSize: 12, display: 'block' },
  dueDate: { color: '#99a9c7', fontSize: 11, marginTop: 4 },
  smallButton: { border: '1px solid rgba(148, 163, 184, 0.2)', background: 'rgba(46, 230, 166, 0.12)', color: '#7ef7cd', borderRadius: 10, padding: '8px 10px', cursor: 'pointer' },
  deleteButton: { border: '1px solid rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5', borderRadius: 10, padding: '8px 10px', cursor: 'pointer' },
  commentBox: { display: 'grid', gap: 8, borderTop: '1px solid rgba(148, 163, 184, 0.12)', paddingTop: 10 },
  commentItem: { fontSize: 12, color: '#dfe9ff', display: 'grid', gap: 4 },
  commentAuthor: { color: '#7ef7cd' },
  commentComposer: { display: 'flex', gap: 8 },
  commentInput: { flex: 1, background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(148, 163, 184, 0.2)', color: '#eef2ff', borderRadius: 10, padding: '8px 10px' },
  sidebar: { display: 'grid', gap: 18 },
  sideCard: { background: 'rgba(15, 23, 42, 0.8)', borderRadius: 18, border: '1px solid rgba(148, 163, 184, 0.18)', padding: 16 },
  sideTitle: { margin: '0 0 12px', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9aa9c7' },
  memberRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' },
  memberAvatar: { width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'linear-gradient(135deg, #2ee6a6, #8b5cf6)', color: '#04120c', fontWeight: 700 },
  memberName: { fontWeight: 600 },
  memberMeta: { fontSize: 11, color: '#99a9c7', textTransform: 'capitalize' },
  activityList: { display: 'grid', gap: 12 },
  activityItem: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  activityDot: { width: 8, height: 8, borderRadius: '50%', background: '#2ee6a6', marginTop: 4 },
  activityText: { fontSize: 13, lineHeight: 1.5 },
  activityMeta: { marginTop: 4, fontSize: 11, color: '#99a9c7' },
};
