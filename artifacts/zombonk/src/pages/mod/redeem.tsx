import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useModListRedemptionItems,
  useModCreateRedemptionItem,
  useModUpdateRedemptionItem,
  useModDeleteRedemptionItem,
  useModListRedemptionRequests,
  useModUpdateRedemptionRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getModPassword } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLES: Record<string, string> = {
  pending: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
  fulfilled: "border-green-500/30 text-green-400 bg-green-500/10",
  denied: "border-destructive/30 text-destructive bg-destructive/10",
};

type Tab = "requests" | "items";
type RequestFilter = "all" | "pending" | "fulfilled" | "denied";

interface ItemForm { name: string; description: string; cost: number; active: boolean; }
const BLANK_FORM: ItemForm = { name: "", description: "", cost: 100, active: true };

export default function ModRedeem() {
  const [, setLocation] = useLocation();
  const password = getModPassword();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => { if (!password) setLocation("/mod"); }, [password]);

  const req = { headers: { "x-mod-password": password ?? "" } };

  const { data: items, isLoading: itemsLoading } = useModListRedemptionItems({ request: req });
  const { data: requests, isLoading: reqLoading } = useModListRedemptionRequests(
    {},
    { request: req }
  );

  const createItem = useModCreateRedemptionItem({ request: req });
  const updateItem = useModUpdateRedemptionItem({ request: req });
  const deleteItem = useModDeleteRedemptionItem({ request: req });
  const updateReq = useModUpdateRedemptionRequest({ request: req });

  const [tab, setTab] = useState<Tab>("requests");
  const [filter, setFilter] = useState<RequestFilter>("pending");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ItemForm>(BLANK_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ItemForm>(BLANK_FORM);
  const [denyNoteId, setDenyNoteId] = useState<number | null>(null);
  const [denyNote, setDenyNote] = useState("");

  const invalidateItems = () => queryClient.invalidateQueries({ queryKey: ["modListRedemptionItems"] });
  const invalidateRequests = () => queryClient.invalidateQueries({ queryKey: ["modListRedemptionRequests"] });

  const pendingCount = requests?.filter((r) => r.status === "pending").length ?? 0;

  const filteredRequests = requests?.filter((r) =>
    filter === "all" ? true : r.status === filter
  );

  // ── Item actions ────────────────────────────────────────────────────────

  const handleCreate = () => {
    createItem.mutate(
      { data: form },
      {
        onSuccess: () => {
          setShowCreate(false);
          setForm(BLANK_FORM);
          invalidateItems();
          toast({ title: "Reward created" });
        },
        onError: () => toast({ title: "Failed to create", variant: "destructive" }),
      }
    );
  };

  const handleSaveEdit = (id: number) => {
    updateItem.mutate(
      { id, data: editForm },
      {
        onSuccess: () => {
          setEditingId(null);
          invalidateItems();
          toast({ title: "Reward updated" });
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this reward? Existing pending requests will still be processed.")) return;
    deleteItem.mutate(
      { id },
      {
        onSuccess: () => { invalidateItems(); toast({ title: "Reward deleted" }); },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  };

  const handleToggleActive = (id: number, active: boolean) => {
    updateItem.mutate(
      { id, data: { active: !active } },
      {
        onSuccess: () => { invalidateItems(); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  };

  // ── Request actions ──────────────────────────────────────────────────────

  const handleFulfill = (id: number) => {
    updateReq.mutate(
      { id, data: { status: "fulfilled" } },
      {
        onSuccess: () => { invalidateRequests(); toast({ title: "Request fulfilled ✓" }); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  };

  const handleDeny = (id: number) => {
    updateReq.mutate(
      { id, data: { status: "denied", note: denyNote || undefined } },
      {
        onSuccess: () => {
          setDenyNoteId(null);
          setDenyNote("");
          invalidateRequests();
          toast({ title: "Request denied — coins refunded to player" });
        },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/mod/dashboard">
              <Button variant="ghost" size="sm">← Dashboard</Button>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-bold text-foreground">Redemptions</span>
          </div>
          {pendingCount > 0 && (
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
              {pendingCount} pending
            </Badge>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-1">
          {(["requests", "items"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`tab-${t}`}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                tab === t
                  ? "text-foreground border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "requests" ? (
                <span className="flex items-center gap-1.5">
                  Requests
                  {pendingCount > 0 && (
                    <span className="bg-yellow-500/20 text-yellow-400 text-xs px-1.5 py-0.5 rounded-full font-mono">
                      {pendingCount}
                    </span>
                  )}
                </span>
              ) : "Reward Items"}
            </button>
          ))}
        </div>

        {/* ── REQUESTS TAB ── */}
        {tab === "requests" && (
          <div className="space-y-4">
            {/* Filter buttons */}
            <div className="flex gap-2 flex-wrap">
              {(["pending", "fulfilled", "denied", "all"] as RequestFilter[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  className="capitalize h-8"
                  onClick={() => setFilter(f)}
                  data-testid={`filter-${f}`}
                >
                  {f}
                </Button>
              ))}
            </div>

            {reqLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              </div>
            )}

            {!reqLoading && (!filteredRequests || filteredRequests.length === 0) && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
                No {filter === "all" ? "" : filter} requests.
              </div>
            )}

            <div className="space-y-3">
              {filteredRequests?.map((r) => (
                <div
                  key={r.id}
                  data-testid={`card-request-${r.id}`}
                  className="bg-card border border-border rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground">{r.playerName ?? `Player #${r.playerId}`}</span>
                        <Badge variant="outline" className={`text-xs ${STATUS_STYLES[r.status] ?? ""}`}>
                          {r.status.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <span className="text-foreground font-medium">{r.itemName}</span>
                        {r.itemCost != null && (
                          <span className="ml-2 text-accent font-mono">{r.itemCost.toLocaleString()} coins</span>
                        )}
                      </p>
                      {r.itemDescription && (
                        <p className="text-xs text-muted-foreground">{r.itemDescription}</p>
                      )}
                      <p className="text-xs text-muted-foreground/60">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                      </p>
                    </div>

                    {r.status === "pending" && denyNoteId !== r.id && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          className="h-8 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleFulfill(r.id)}
                          disabled={updateReq.isPending}
                          data-testid={`button-fulfill-${r.id}`}
                        >
                          ✓ Fulfilled
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => { setDenyNoteId(r.id); setDenyNote(""); }}
                          data-testid={`button-deny-${r.id}`}
                        >
                          Deny
                        </Button>
                      </div>
                    )}
                  </div>

                  {r.note && (
                    <p className="text-xs text-muted-foreground bg-background rounded px-3 py-2 border border-border">
                      Note: {r.note}
                    </p>
                  )}

                  {/* Deny inline form */}
                  {r.status === "pending" && denyNoteId === r.id && (
                    <div className="space-y-2 bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                      <p className="text-xs text-destructive font-medium">
                        Denying will refund {r.itemCost?.toLocaleString()} coins to {r.playerName}.
                      </p>
                      <Input
                        placeholder="Optional reason for player..."
                        value={denyNote}
                        onChange={(e) => setDenyNote(e.target.value)}
                        className="h-9 text-sm"
                        data-testid={`input-deny-note-${r.id}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8"
                          onClick={() => handleDeny(r.id)}
                          disabled={updateReq.isPending}
                          data-testid={`button-confirm-deny-${r.id}`}
                        >
                          Confirm Deny
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => setDenyNoteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ITEMS TAB ── */}
        {tab === "items" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Reward Items ({items?.length ?? 0})
              </h2>
              <Button
                size="sm"
                onClick={() => { setShowCreate(!showCreate); setForm(BLANK_FORM); }}
                data-testid="button-new-item"
              >
                {showCreate ? "Cancel" : "+ New Item"}
              </Button>
            </div>

            {/* Create form */}
            {showCreate && (
              <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-3">
                <h3 className="font-semibold text-foreground text-sm">New Reward</h3>
                <ItemForm form={form} setForm={setForm} />
                <Button
                  className="w-full h-10"
                  onClick={handleCreate}
                  disabled={!form.name.trim() || createItem.isPending}
                  data-testid="button-create-item"
                >
                  {createItem.isPending ? "Creating…" : "Create Reward"}
                </Button>
              </div>
            )}

            {itemsLoading && (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            )}

            {!itemsLoading && (!items || items.length === 0) && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
                No reward items yet. Create one above.
              </div>
            )}

            <div className="space-y-3">
              {items?.map((item) => (
                <div
                  key={item.id}
                  data-testid={`card-item-${item.id}`}
                  className="bg-card border border-border rounded-xl overflow-hidden"
                >
                  <div className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground">{item.name}</span>
                        <Badge
                          variant="outline"
                          className="font-mono text-accent border-accent/40"
                          data-testid={`badge-cost-${item.id}`}
                        >
                          {item.cost.toLocaleString()} coins
                        </Badge>
                        {!item.active && (
                          <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
                            HIDDEN
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => handleToggleActive(item.id, item.active)}
                        data-testid={`button-toggle-${item.id}`}
                      >
                        {item.active ? "Hide" : "Show"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => {
                          if (editingId === item.id) { setEditingId(null); }
                          else {
                            setEditingId(item.id);
                            setEditForm({ name: item.name, description: item.description, cost: item.cost, active: item.active });
                          }
                        }}
                        data-testid={`button-edit-${item.id}`}
                      >
                        {editingId === item.id ? "Cancel" : "Edit"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-destructive hover:text-destructive"
                        onClick={() => handleDelete(item.id)}
                        data-testid={`button-delete-${item.id}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Inline edit */}
                  {editingId === item.id && (
                    <div className="border-t border-border bg-background/50 p-4 space-y-3">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Edit Reward</p>
                      <ItemForm form={editForm} setForm={setEditForm} />
                      <Button
                        className="w-full h-10"
                        onClick={() => handleSaveEdit(item.id)}
                        disabled={!editForm.name.trim() || updateItem.isPending}
                        data-testid={`button-save-${item.id}`}
                      >
                        {updateItem.isPending ? "Saving…" : "Save Changes"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared form fields ──────────────────────────────────────────────────────
function ItemForm({
  form,
  setForm,
}: {
  form: { name: string; description: string; cost: number; active: boolean };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; description: string; cost: number; active: boolean }>>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1 sm:col-span-2">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Name</label>
        <Input
          data-testid="input-item-name"
          placeholder="e.g. Extra Life, Free Pizza, Skip Homework..."
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          className="h-10"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
          Description <span className="text-muted-foreground/50 normal-case font-normal">(optional)</span>
        </label>
        <Input
          data-testid="input-item-description"
          placeholder="What does the player get?"
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          className="h-10"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Cost (coins)</label>
        <Input
          data-testid="input-item-cost"
          type="number"
          min={1}
          value={form.cost}
          onChange={(e) => setForm((p) => ({ ...p, cost: parseInt(e.target.value) || 1 }))}
          className="h-10 font-mono"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Visibility</label>
        <select
          data-testid="select-item-active"
          value={form.active ? "true" : "false"}
          onChange={(e) => setForm((p) => ({ ...p, active: e.target.value === "true" }))}
          className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="true">Visible to players</option>
          <option value="false">Hidden</option>
        </select>
      </div>
    </div>
  );
}
