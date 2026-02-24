'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FolderKanban,
  Plus,
  Pencil,
  Trash2,
  MessageSquare,
  X,
  ChevronDown,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  projects as projectsApi,
  clients as clientsApi,
  clientChatLogs as chatLogsApi,
  users as usersApi,
  type Project,
  type ProjectStatus,
  type Client,
  type User,
} from '@/lib/api';

const STATUS_CONFIG: Record<ProjectStatus, { label: string; bg: string; text: string }> = {
  in_progress: { label: 'In Progress', bg: 'bg-blue-100', text: 'text-blue-800' },
  waiting_on_client: { label: 'Waiting on Client', bg: 'bg-amber-100', text: 'text-amber-800' },
  need_to_reach_out: { label: 'Need to Reach Out', bg: 'bg-red-100', text: 'text-red-800' },
  needs_call: { label: 'Needs Call', bg: 'bg-purple-100', text: 'text-purple-800' },
  on_hold: { label: 'On Hold', bg: 'bg-gray-100', text: 'text-gray-600' },
  completed: { label: 'Completed', bg: 'bg-green-100', text: 'text-green-800' },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as ProjectStatus[];

export default function ProjectsPage() {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [clientList, setClientList] = useState<Client[]>([]);
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [formName, setFormName] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formStatus, setFormStatus] = useState<ProjectStatus>('in_progress');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formNote, setFormNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Chat panel state
  const [chatClientId, setChatClientId] = useState<string | null>(null);
  const [chatContent, setChatContent] = useState('');
  const [chatSaving, setChatSaving] = useState(false);
  const [chatDirty, setChatDirty] = useState(false);

  // Inline status editing
  const [statusDropdownId, setStatusDropdownId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [projectData, clientData, userData] = await Promise.all([
        projectsApi.list(),
        clientsApi.list(),
        usersApi.list(),
      ]);
      setProjectList(projectData);
      setClientList(clientData);
      setUserList(userData);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load chat log when panel opens
  useEffect(() => {
    if (!chatClientId) return;
    chatLogsApi.get(chatClientId).then((log) => {
      setChatContent(log.content || '');
      setChatDirty(false);
    }).catch(() => {
      setChatContent('');
      setChatDirty(false);
    });
  }, [chatClientId]);

  // Group projects by client
  const activeClients = clientList.filter((c) => c.isActive);
  const activeProjects = projectList.filter((p) => p.isActive);
  const projectsByClient = new Map<string, Project[]>();
  for (const project of activeProjects) {
    const existing = projectsByClient.get(project.clientId) || [];
    existing.push(project);
    projectsByClient.set(project.clientId, existing);
  }

  // Clients with projects first, then clients without
  const clientsWithProjects = activeClients.filter((c) => projectsByClient.has(c.id));
  const clientsWithoutProjects = activeClients.filter((c) => !projectsByClient.has(c.id));

  // Assigned-to options: user display names + "Client"
  const assignedOptions = [
    ...userList.filter((u) => u.isActive).map((u) => u.displayName),
    'Client',
  ];

  function openCreate(clientId?: string) {
    setEditing(null);
    setFormName('');
    setFormClientId(clientId || '');
    setFormStatus('in_progress');
    setFormAssignedTo('');
    setFormNote('');
    setError('');
    setDialogOpen(true);
  }

  function openEdit(project: Project) {
    setEditing(project);
    setFormName(project.name);
    setFormClientId(project.clientId);
    setFormStatus(project.status);
    setFormAssignedTo(project.assignedTo || '');
    setFormNote(project.note || '');
    setError('');
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) {
      setError('Project name is required');
      return;
    }
    if (!formClientId) {
      setError('Client is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await projectsApi.update(editing.id, {
          name: formName.trim(),
          clientId: formClientId,
          status: formStatus,
          assignedTo: formAssignedTo.trim() || null,
          note: formNote.trim() || null,
        });
      } else {
        await projectsApi.create({
          clientId: formClientId,
          name: formName.trim(),
          status: formStatus,
          assignedTo: formAssignedTo.trim() || undefined,
          note: formNote.trim() || undefined,
        });
      }
      setDialogOpen(false);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(projectId: string, newStatus: ProjectStatus) {
    setStatusDropdownId(null);
    try {
      await projectsApi.update(projectId, { status: newStatus });
      loadData();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function handleDelete(project: Project) {
    if (!confirm(`Remove "${project.name}"?`)) return;
    try {
      await projectsApi.delete(project.id);
      loadData();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }

  async function handleSaveChat() {
    if (!chatClientId) return;
    setChatSaving(true);
    try {
      await chatLogsApi.save(chatClientId, chatContent);
      setChatDirty(false);
    } catch (err) {
      console.error('Failed to save chat log:', err);
    } finally {
      setChatSaving(false);
    }
  }

  const chatClient = chatClientId ? clientList.find((c) => c.id === chatClientId) : null;

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className={`flex-1 overflow-auto ${chatClientId ? 'pr-0' : ''}`}>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <FolderKanban className="w-6 h-6" />
              Projects
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''} across {clientsWithProjects.length} client{clientsWithProjects.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button onClick={() => openCreate()}>
            <Plus className="w-4 h-4 mr-2" />
            Add Project
          </Button>
        </div>

        {loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
            Loading...
          </div>
        ) : activeProjects.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
            <FolderKanban className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No projects yet</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-4">Add your first project to start tracking client work.</p>
            <Button onClick={() => openCreate()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Project
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Clients with projects */}
            {clientsWithProjects.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                projects={projectsByClient.get(client.id) || []}
                statusDropdownId={statusDropdownId}
                onStatusDropdownToggle={(id) => setStatusDropdownId(statusDropdownId === id ? null : id)}
                onStatusChange={handleStatusChange}
                onEdit={openEdit}
                onDelete={handleDelete}
                onAddProject={() => openCreate(client.id)}
                onOpenChat={() => setChatClientId(client.id)}
                chatActive={chatClientId === client.id}
              />
            ))}

            {/* Clients without projects */}
            {clientsWithoutProjects.length > 0 && (
              <details className="mt-6">
                <summary className="text-sm text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 mb-2">
                  {clientsWithoutProjects.length} client{clientsWithoutProjects.length !== 1 ? 's' : ''} with no projects
                </summary>
                <div className="space-y-2">
                  {clientsWithoutProjects.map((client) => (
                    <div
                      key={client.id}
                      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between opacity-60"
                    >
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{client.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => openCreate(client.id)}>
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Chat panel */}
      {chatClientId && (
        <div className="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col ml-4 rounded-lg overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                {chatClient?.name || 'Chat'}
              </span>
            </div>
            <button
              onClick={() => setChatClientId(null)}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <textarea
            className="flex-1 p-3 text-sm text-gray-700 dark:text-gray-300 dark:bg-gray-800 resize-none focus:outline-none font-mono leading-relaxed"
            placeholder="Paste Telegram chat history here..."
            value={chatContent}
            onChange={(e) => {
              setChatContent(e.target.value);
              setChatDirty(true);
            }}
          />
          <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {chatDirty ? 'Unsaved changes' : 'Saved'}
            </span>
            <Button
              size="sm"
              onClick={handleSaveChat}
              disabled={chatSaving || !chatDirty}
            >
              <Save className="w-3 h-3 mr-1" />
              {chatSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Project' : 'New Project'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="proj-name">Project Name *</Label>
              <Input
                id="proj-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Website Redesign"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proj-client">Client *</Label>
              <Select value={formClientId} onValueChange={setFormClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  {activeClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proj-status">Status</Label>
              <Select value={formStatus} onValueChange={(v) => setFormStatus(v as ProjectStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proj-assigned">Assigned To</Label>
              <Select value={formAssignedTo || '__none__'} onValueChange={(v) => setFormAssignedTo(v === '__none__' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {assignedOptions.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proj-note">Note</Label>
              <Input
                id="proj-note"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="Short context (e.g. need logo files)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -- Client Card Component --

function StatusChip({
  status,
  projectId,
  isOpen,
  onToggle,
  onChange,
}: {
  status: ProjectStatus;
  projectId: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  onChange: (id: string, status: ProjectStatus) => void;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(projectId);
        }}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text} hover:opacity-80 transition-opacity`}
      >
        {config.label}
        <ChevronDown className="w-3 h-3" />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 py-1 min-w-[180px]">
          {ALL_STATUSES.map((s) => {
            const sc = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(projectId, s);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200 flex items-center gap-2 ${
                  s === status ? 'font-medium' : ''
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${sc.bg} border ${sc.text.replace('text-', 'border-')}`} />
                {sc.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClientCard({
  client,
  projects,
  statusDropdownId,
  onStatusDropdownToggle,
  onStatusChange,
  onEdit,
  onDelete,
  onAddProject,
  onOpenChat,
  chatActive,
}: {
  client: Client;
  projects: Project[];
  statusDropdownId: string | null;
  onStatusDropdownToggle: (id: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  onAddProject: () => void;
  onOpenChat: () => void;
  chatActive: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
      {/* Client header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{client.name}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenChat}
            className={chatActive ? 'text-blue-600' : ''}
            title="View chat log"
          >
            <MessageSquare className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onAddProject} title="Add project">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Project rows */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {projects.map((project) => (
          <div
            key={project.id}
            className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{project.name}</span>
                <StatusChip
                  status={project.status}
                  projectId={project.id}
                  isOpen={statusDropdownId === project.id}
                  onToggle={onStatusDropdownToggle}
                  onChange={onStatusChange}
                />
                {project.assignedTo && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                    {project.assignedTo}
                  </span>
                )}
              </div>
              {project.note && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{project.note}</p>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="sm" onClick={() => onEdit(project)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(project)}>
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
