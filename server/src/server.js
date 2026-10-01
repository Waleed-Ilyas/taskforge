const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');

dotenv.config();

const demoUsers = {
  'demo@waleed.dev': {
    id: 'demo-user',
    name: 'Demo user',
    email: 'demo@waleed.dev',
    password: 'Demo@1234',
    role: 'member',
  },
  'admin@waleed.dev': {
    id: 'admin-user',
    name: 'Admin user',
    email: 'admin@waleed.dev',
    password: 'Admin@1234',
    role: 'admin',
  },
};

const sessionTokens = new Map();

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

const baseBoard = {
  id: 'launch-sprint',
  name: 'Launch Sprint',
  columns: [
    { id: 'todo', title: 'Backlog' },
    { id: 'inprogress', title: 'In Progress' },
    { id: 'review', title: 'Review' },
    { id: 'done', title: 'Done' },
  ],
  members: [
    { id: 'demo-user', name: 'Demo user', email: 'demo@waleed.dev', role: 'member' },
    { id: 'admin-user', name: 'Admin user', email: 'admin@waleed.dev', role: 'admin' },
  ],
  tasks: [
    {
      id: 'task-1',
      title: 'Polish onboarding flow',
      description: 'Tighten the first-run experience for new collaborators.',
      assignee: 'Demo user',
      priority: 'High',
      column: 'todo',
      comments: [
        { id: 'comment-1', author: 'Admin user', text: 'Needs a clean first-run checklist.', createdAt: new Date().toISOString() },
      ],
      dueDate: '2026-10-06',
      labels: ['UX'],
    },
    {
      id: 'task-2',
      title: 'QA release checklist',
      description: 'Confirm each workstream is ready before launch day.',
      assignee: 'Admin user',
      priority: 'Medium',
      column: 'inprogress',
      comments: [
        { id: 'comment-2', author: 'Demo user', text: 'Cockpit check is ready for signoff.', createdAt: new Date().toISOString() },
      ],
      dueDate: '2026-10-08',
      labels: ['QA'],
    },
    {
      id: 'task-3',
      title: 'Ship sprint recap',
      description: 'Share a crisp summary of wins, blockers and handoff notes.',
      assignee: 'Demo user',
      priority: 'Low',
      column: 'review',
      comments: [],
      dueDate: '2026-10-10',
      labels: ['Comms'],
    },
    {
      id: 'task-4',
      title: 'Launch customer feedback loop',
      description: 'Connect the reporting channel so the team can act on signals fast.',
      assignee: 'Admin user',
      priority: 'High',
      column: 'done',
      comments: [
        { id: 'comment-3', author: 'Demo user', text: 'Customer insights are flowing in.', createdAt: new Date().toISOString() },
      ],
      dueDate: '2026-10-12',
      labels: ['Ops'],
    },
  ],
  activity: [
    { id: 'activity-1', type: 'task-created', actor: 'Admin user', text: 'Created QA release checklist', createdAt: new Date().toISOString() },
    { id: 'activity-2', type: 'task-moved', actor: 'Demo user', text: 'Moved Ship sprint recap to review', createdAt: new Date().toISOString() },
  ],
};

let boardState = JSON.parse(JSON.stringify(baseBoard));

function resetBoard() {
  boardState = JSON.parse(JSON.stringify(baseBoard));
}

function getBoard() {
  return JSON.parse(JSON.stringify(boardState));
}

function createActivity(type, actor, text) {
  const entry = {
    id: generateId('activity'),
    type,
    actor,
    text,
    createdAt: new Date().toISOString(),
  };

  boardState.activity = [entry, ...boardState.activity].slice(0, 12);
}

function authenticateUser(email, password) {
  const user = demoUsers[String(email || '').toLowerCase()];
  if (!user) return null;
  if (user.password !== String(password || '')) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function createTask(taskInput, actorUser = null) {
  const text = String(taskInput?.title || '').trim();
  if (!text) {
    throw new Error('Task title is required.');
  }

  const assignee = String(taskInput?.assignee || 'Unassigned').trim() || 'Unassigned';
  const description = String(taskInput?.description || '').trim();
  const column = ['todo', 'inprogress', 'review', 'done'].includes(taskInput?.column) ? taskInput.column : 'todo';
  const priority = ['Low', 'Medium', 'High'].includes(taskInput?.priority) ? taskInput.priority : 'Medium';
  const labels = Array.isArray(taskInput?.labels)
    ? taskInput.labels.filter(Boolean).map((label) => String(label).trim()).slice(0, 3)
    : [];
  const dueDate = String(taskInput?.dueDate || '').trim();

  const newTask = {
    id: generateId('task'),
    title: text,
    description,
    assignee,
    priority,
    column,
    comments: [],
    dueDate: dueDate || '',
    labels: labels.length ? labels : ['General'],
  };

  boardState.tasks.push(newTask);
  createActivity('task-created', actorUser?.name || assignee, `${actorUser?.name || assignee} created ${text}`);
  return newTask;
}

function updateTask(taskId, updates, actorUser = null) {
  const task = boardState.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error('Task not found.');
  }

  const previousColumn = task.column;

  if (updates?.title) {
    task.title = String(updates.title).trim();
  }
  if (updates?.description !== undefined) {
    task.description = String(updates.description).trim();
  }
  if (updates?.assignee) {
    task.assignee = String(updates.assignee).trim();
  }
  if (updates?.priority && ['Low', 'Medium', 'High'].includes(updates.priority)) {
    task.priority = updates.priority;
  }
  if (updates?.column && ['todo', 'inprogress', 'review', 'done'].includes(updates.column)) {
    task.column = updates.column;
  }
  if (updates?.dueDate !== undefined) {
    task.dueDate = updates.dueDate ? String(updates.dueDate).trim() : '';
  }
  if (Array.isArray(updates?.labels)) {
    task.labels = updates.labels.filter(Boolean).map((label) => String(label).trim()).slice(0, 3) || ['General'];
  }

  if (updates?.column && updates.column !== previousColumn) {
    createActivity('task-moved', actorUser?.name || task.assignee, `${actorUser?.name || task.assignee} moved ${task.title} to ${updates.column}`);
  }

  return task;
}

function addComment(taskId, commentText, actorUser) {
  const task = boardState.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error('Task not found.');
  }

  const text = String(commentText || '').trim();
  if (!text) {
    throw new Error('Comment text is required.');
  }

  const comment = {
    id: generateId('comment'),
    author: actorUser?.name || 'Team member',
    text,
    createdAt: new Date().toISOString(),
  };

  task.comments.push(comment);
  createActivity('task-commented', actorUser?.name || 'Team member', `${actorUser?.name || 'Team member'} added a note to ${task.title}`);
  return comment;
}

function deleteTask(taskId, actorUser) {
  if (actorUser?.role !== 'admin') {
    throw new Error('Only admins can delete tasks.');
  }

  const index = boardState.tasks.findIndex((item) => item.id === taskId);
  if (index === -1) {
    throw new Error('Task not found.');
  }

  const [removedTask] = boardState.tasks.splice(index, 1);
  createActivity('task-deleted', actorUser.name, `${actorUser.name} deleted ${removedTask.title}`);
  return removedTask;
}

function emitBoard(io) {
  io.emit('board:updated', { board: getBoard() });
}

function authorizeRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = sessionTokens.get(token);
  if (!user) {
    return null;
  }
  return user;
}

const app = express();
const httpServer = createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'taskforge' });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const user = authenticateUser(email, password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = `taskforge-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  sessionTokens.set(token, user);

  return res.json({ user, token });
});

app.get('/api/workspace', (req, res) => {
  const user = authorizeRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  return res.json({ board: getBoard(), user });
});

app.post('/api/tasks', (req, res) => {
  const user = authorizeRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    const task = createTask(req.body || {}, user);
    emitBoard(io);
    return res.status(201).json({ task, board: getBoard() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to create task.' });
  }
});

app.patch('/api/tasks/:id', (req, res) => {
  const user = authorizeRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    const task = updateTask(req.params.id, req.body || {}, user);
    emitBoard(io);
    return res.json({ task, board: getBoard() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to update task.' });
  }
});

app.post('/api/tasks/:id/comments', (req, res) => {
  const user = authorizeRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    addComment(req.params.id, req.body?.text, user);
    emitBoard(io);
    return res.json({ board: getBoard() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to add comment.' });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  const user = authorizeRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    deleteTask(req.params.id, user);
    emitBoard(io);
    return res.json({ board: getBoard() });
  } catch (error) {
    const message = error.message || 'Unable to delete task.';
    const statusCode = message.includes('Only admins') ? 403 : 400;
    return res.status(statusCode).json({ error: message });
  }
});

io.on('connection', (socket) => {
  socket.on('join-workspace', (workspaceId) => {
    if (workspaceId) {
      socket.join(workspaceId);
    }
    socket.emit('board:updated', { board: getBoard() });
  });
});

function startServer() {
  const port = Number(process.env.PORT || 4000);
  httpServer.listen(port, () => {
    console.log(`TaskForge server listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  authorizeRequest,
  authenticateUser,
  createTask,
  updateTask,
  addComment,
  deleteTask,
  getBoard,
  resetBoard,
  startServer,
  demoUsers,
};
